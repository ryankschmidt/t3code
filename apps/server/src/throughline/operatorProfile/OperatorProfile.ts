// @effect-diagnostics nodeBuiltinImport:off
/**
 * ThroughLine: the operator profile at runtime. Every settings load runs the profile over the
 * settings (serverSettings.ts calls `applyOperatorProfileIfMounted`), writes
 * `<stateDir>/operator-profile-receipt.json`, and keeps the same report for the diagnostics route.
 *
 * A deliberate per-machine value is kept by listing its entry id in
 * `<stateDir>/operator-profile-overrides.json`:
 *   { "overrides": [{ "entry": "providerInstances.codex", "reason": "testing a local build" }] }
 * That file is read at each settings load; it is never written by the server.
 */
import * as NodeOS from "node:os";

import {
  OPERATOR_PROFILE,
  OPERATOR_PROFILE_NOT_OWNED,
  OPERATOR_PROFILE_VERSION,
  type OperatorProfileEntry,
  type OperatorProfileNotOwned,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import packageJson from "../../../package.json" with { type: "json" };
import { writeFileStringAtomically } from "../../atomicWrite.ts";
import * as ServerConfig from "../../config.ts";
import {
  applyOperatorProfile,
  hostFromPlatform,
  resolveHome,
  type OperatorProfileHost,
  type OperatorProfileRow,
} from "./applyOperatorProfile.ts";

export const OPERATOR_PROFILE_RECEIPT_FILE = "operator-profile-receipt.json";
export const OPERATOR_PROFILE_OVERRIDES_FILE = "operator-profile-overrides.json";

export interface OperatorProfileReport {
  readonly schema: "throughline.operator-profile-receipt.v1";
  readonly written_at: string;
  readonly app_version: string;
  readonly profile_version: string;
  readonly host: { readonly platform: OperatorProfileHost; readonly home: string };
  /** True when no entry was rejected. */
  readonly ok: boolean;
  readonly counts: {
    readonly applied: number;
    readonly overridden_locally: number;
    readonly rejected: number;
    readonly not_for_this_host: number;
  };
  readonly overrides_file: {
    readonly path: string;
    readonly state: "absent" | "read" | "unreadable";
    readonly detail?: string;
  };
  /** The effective settings for this host, limited to the fields the profile owns. */
  readonly effective: Readonly<Record<string, unknown>>;
  /** What diverged: one row per profile entry. */
  readonly rows: ReadonlyArray<OperatorProfileRow>;
  readonly not_owned: ReadonlyArray<OperatorProfileNotOwned>;
}

export class OperatorProfile extends Context.Service<
  OperatorProfile,
  {
    readonly apply: (settings: ServerSettings) => Effect.Effect<ServerSettings>;
    readonly latest: Effect.Effect<Option.Option<OperatorProfileReport>>;
  }
>()("t3/throughline/operatorProfile/OperatorProfile") {}

export interface OperatorProfileOptions {
  readonly profile?: ReadonlyArray<OperatorProfileEntry>;
  readonly host?: OperatorProfileHost;
  readonly home?: string;
}

interface OverridesRead {
  readonly map: ReadonlyMap<string, string>;
  readonly state: OperatorProfileReport["overrides_file"]["state"];
  readonly detail?: string;
}

const parseOverrides = (text: string): OverridesRead => {
  try {
    const parsed = JSON.parse(text) as { readonly overrides?: unknown };
    if (!Array.isArray(parsed.overrides)) {
      return { map: new Map(), state: "unreadable", detail: "no overrides array" };
    }
    const map = new Map<string, string>();
    for (const item of parsed.overrides as ReadonlyArray<Record<string, unknown>>) {
      if (typeof item?.entry !== "string") {
        return { map: new Map(), state: "unreadable", detail: "an override has no entry id" };
      }
      map.set(item.entry, typeof item.reason === "string" ? item.reason : "no reason given");
    }
    return { map, state: "read" };
  } catch (error) {
    return { map: new Map(), state: "unreadable", detail: String(error).slice(0, 200) };
  }
};

const formatReceipt = (report: OperatorProfileReport): string =>
  `${JSON.stringify(report, null, 2)}\n`;

export const make = (options: OperatorProfileOptions = {}) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const latestRef = yield* Ref.make(Option.none<OperatorProfileReport>());
    const profile = options.profile ?? OPERATOR_PROFILE;
    const host = options.host ?? hostFromPlatform(yield* HostProcessPlatform);
    const home = options.home ?? NodeOS.homedir();
    const receiptPath = pathService.join(config.stateDir, OPERATOR_PROFILE_RECEIPT_FILE);
    const overridesPath = pathService.join(config.stateDir, OPERATOR_PROFILE_OVERRIDES_FILE);

    const noOverrides: OverridesRead = { map: new Map(), state: "absent" };
    const readOverrides = Effect.gen(function* () {
      const exists = yield* fs.exists(overridesPath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) return noOverrides;
      return yield* fs.readFileString(overridesPath).pipe(
        Effect.map(parseOverrides),
        Effect.orElseSucceed((): OverridesRead => ({
          map: new Map(),
          state: "unreadable",
          detail: "read failed",
        })),
      );
    });

    const launcherPresence = Effect.forEach(
      [
        ...new Set(
          profile.flatMap((entry) =>
            entry.requires_launcher === undefined
              ? []
              : [resolveHome(entry.requires_launcher, home)],
          ),
        ),
      ],
      (launcher) =>
        fs.exists(launcher).pipe(
          Effect.orElseSucceed(() => false),
          Effect.map((exists) => [launcher, exists] as const),
        ),
    ).pipe(Effect.map((pairs) => new Map(pairs)));

    const apply = (settings: ServerSettings) =>
      Effect.gen(function* () {
        const overrides = yield* readOverrides;
        const launchers = yield* launcherPresence;
        const result = applyOperatorProfile({
          settings,
          profile,
          host,
          home,
          launcherExists: (launcher) => launchers.get(launcher) ?? false,
          overrides: overrides.map,
        });
        const count = (outcome: OperatorProfileRow["outcome"]) =>
          result.rows.filter((row) => row.outcome === outcome).length;
        const report: OperatorProfileReport = {
          schema: "throughline.operator-profile-receipt.v1",
          written_at: DateTime.formatIso(yield* DateTime.now),
          app_version: packageJson.version,
          profile_version: OPERATOR_PROFILE_VERSION,
          host: { platform: host, home },
          ok: count("rejected") === 0,
          counts: {
            applied: count("applied"),
            overridden_locally: count("overridden-locally"),
            rejected: count("rejected"),
            not_for_this_host: count("not-for-this-host"),
          },
          overrides_file: {
            path: overridesPath,
            state: overrides.state,
            ...(overrides.detail === undefined ? {} : { detail: overrides.detail }),
          },
          effective: Object.fromEntries(result.rows.map((row) => [row.entry, row.effective])),
          rows: result.rows,
          not_owned: OPERATOR_PROFILE_NOT_OWNED,
        };
        yield* Ref.set(latestRef, Option.some(report));
        yield* writeFileStringAtomically({
          filePath: receiptPath,
          contents: formatReceipt(report),
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, pathService),
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to write the operator profile receipt", {
              path: receiptPath,
              cause,
            }),
          ),
        );
        if (!report.ok) {
          yield* Effect.logWarning("operator profile rejected entries", {
            receipt: receiptPath,
            rejected: result.rows
              .filter((row) => row.outcome === "rejected")
              .map((row) => `${row.entry}: ${row.code} ${row.detail}`),
          });
        }
        return result.settings;
      }).pipe(
        // The profile must never stop settings from loading.
        Effect.catchCause((cause) =>
          Effect.logWarning("operator profile could not run; settings load unchanged", {
            cause,
          }).pipe(Effect.as(settings)),
        ),
      );

    return OperatorProfile.of({ apply, latest: Ref.get(latestRef) });
  });

export const layer = Layer.effect(OperatorProfile, make());

export const layerWith = (options: OperatorProfileOptions) =>
  Layer.effect(OperatorProfile, make(options));

/** The one call serverSettings.ts makes. A no-op where the service is not provided. */
export const applyOperatorProfileIfMounted = (
  settings: ServerSettings,
): Effect.Effect<ServerSettings> =>
  Effect.serviceOption(OperatorProfile).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(settings),
        onSome: (operatorProfile) => operatorProfile.apply(settings),
      }),
    ),
  );

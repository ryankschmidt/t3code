import {
  type ModelCapabilities,
  type PiSettings,
  ProviderDriverKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import type * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { discoverPiModels } from "./PiSessionRuntime.ts";

/**
 * Pi provider snapshot/status helpers (D2 — pi-harness as a first-class
 * provider, per pingdotgg/t3code#402 constraints):
 *   - NO fake fallback models: with discovery unavailable, only the user's
 *     explicit customModels appear. Live model discovery arrives through the
 *     Pi RPC session (adapter path), not a hard-coded list.
 *   - availability respects the CONFIGURED binary path (Ryan's governed
 *     `ryan-pi` door) — never assumes `pi` on PATH.
 */
const PI_PRESENTATION = {
  displayName: "Pi",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: false,
} as const;
const PROVIDER = ProviderDriverKind.make("pi");
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const VERSION_PROBE_TIMEOUT_MS = 4_000;

/** No built-in models by design (#402: models come from Pi, never a static list). */
const PI_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [];

export function piModelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    PI_BUILT_IN_MODELS,
    PROVIDER,
    customModels ?? [],
    EMPTY_CAPABILITIES,
  );
}

export function buildInitialPiProviderSnapshot(
  piSettings: PiSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = piModelsFromSettings(piSettings.customModels);

    if (!piSettings.enabled) {
      return buildServerProvider({
        presentation: PI_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Pi is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Pi CLI availability...",
      },
    });
  });
}

const runPiVersionCommand = (piSettings: PiSettings, environment: NodeJS.ProcessEnv = process.env) =>
  Effect.gen(function* () {
    const command = piSettings.binaryPath || "pi";
    const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], {
      env: environment,
    });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  });

export const checkPiProviderStatus = Effect.fn("checkPiProviderStatus")(function* (
  piSettings: PiSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const models = piModelsFromSettings(piSettings.customModels);

  if (!piSettings.enabled) {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Pi is disabled in T3 Code settings.",
      },
    });
  }

  const versionResult = yield* runPiVersionCommand(piSettings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionResult)) {
    const error = versionResult.failure;
    yield* Effect.logWarning("Pi CLI health check failed.", {
      errorTag: error._tag,
    });
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: piSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? `Pi CLI is not installed at the configured path (${piSettings.binaryPath || "pi"}).`
          : "Failed to execute Pi CLI health check.",
      },
    });
  }

  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: piSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Pi CLI is installed but timed out while running `pi --version`.",
      },
    });
  }

  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    yield* Effect.logWarning("Pi CLI version probe exited with a non-zero status.", {
      exitCode: versionOutput.code,
    });
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: piSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: `Pi CLI version probe exited with status ${versionOutput.code}.`,
      },
    });
  }

  return buildServerProvider({
    presentation: PI_PRESENTATION,
    enabled: piSettings.enabled,
    checkedAt,
    models,
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "unknown" },
      message: `Pi CLI ${version ?? "(version unknown)"} available.`,
    },
  });
});

/**
 * enrichPiSnapshot — provider-scoped, on-demand model discovery (#402:
 * models come from Pi; never a hard-coded list, never fake fallbacks).
 *
 * Runs in the managed snapshot's enrich phase — forked by
 * `makeManagedServerProvider`, so it can never block the health probe.
 * Spawns a short-lived Pi RPC child, asks for the real model catalog, and
 * republishes the snapshot with discovered models merged ahead of the
 * user's customModels. On any discovery failure the settings-derived
 * snapshot stands unchanged.
 */
export const enrichPiSnapshot = Effect.fn("enrichPiSnapshot")(function* (input: {
  readonly piSettings: PiSettings;
  readonly snapshot: ServerProvider;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly environment?: NodeJS.ProcessEnv;
}): Effect.fn.Return<void, never, ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto> {
  if (!input.piSettings.enabled) {
    return;
  }
  if (input.snapshot.status !== "ready") {
    // Discovery needs a working binary; the probe said it is not ready.
    return;
  }

  const catalogResult = yield* discoverPiModels({
    binaryPath: input.piSettings.binaryPath || "pi",
    ...(input.environment ? { environment: input.environment } : {}),
  }).pipe(Effect.result);

  if (Result.isFailure(catalogResult)) {
    yield* Effect.logDebug("Pi model discovery failed; keeping settings-derived models.", {
      errorTag: catalogResult.failure._tag,
      detail: catalogResult.failure.detail,
    });
    return;
  }

  const catalog = catalogResult.success;
  if (catalog.models.length === 0) {
    // No models discovered — show nothing rather than inventing entries.
    return;
  }

  const discoveredModels: ReadonlyArray<ServerProviderModel> = catalog.models.map((model) => ({
    slug: model.slug,
    name: model.name,
    isCustom: false,
    capabilities: EMPTY_CAPABILITIES,
  }));
  const models = providerModelsFromSettings(
    discoveredModels,
    PROVIDER,
    input.piSettings.customModels ?? [],
    EMPTY_CAPABILITIES,
  );

  yield* input.publishSnapshot({ ...input.snapshot, models });
});

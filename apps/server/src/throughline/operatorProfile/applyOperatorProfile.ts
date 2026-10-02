/**
 * ThroughLine: layers the operator profile over the loaded settings. Pure: the caller supplies the
 * host, its home folder, which launchers exist and which entries are deliberate local overrides.
 *
 * Order of precedence: upstream default < settings.json < operator profile < a local override
 * listed in operator-profile-overrides.json. A settings-file value that differs from the profile
 * and is not listed as an override is replaced, and the row says so; nothing is replaced silently.
 */
import {
  DEFAULT_SERVER_SETTINGS,
  operatorProfileEntryId,
  ServerSettings,
  type OperatorProfileEntry,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export type OperatorProfileHost = "mac" | "linux" | "other";

export type OperatorProfileOutcome =
  | "applied"
  | "overridden-locally"
  | "rejected"
  | "not-for-this-host";

export type OperatorProfileCode =
  | "APPLIED_ALREADY_HELD"
  | "APPLIED_OVER_DEFAULT"
  | "APPLIED_OVER_FILE_VALUE"
  | "OVERRIDDEN_LOCALLY"
  | "LAUNCHER_MISSING"
  | "SCHEMA_REJECTED"
  | "HOST_SCOPE";

export interface OperatorProfileRow {
  readonly entry: string;
  readonly key: string;
  readonly outcome: OperatorProfileOutcome;
  readonly code: OperatorProfileCode;
  readonly detail: string;
  readonly reason: string;
  /** This host's value for the fields the entry owns, after the profile ran. */
  readonly effective: unknown;
}

export interface ApplyOperatorProfileInput {
  readonly settings: ServerSettings;
  readonly profile: ReadonlyArray<OperatorProfileEntry>;
  readonly host: OperatorProfileHost;
  readonly home: string;
  readonly launcherExists: (path: string) => boolean;
  /** Entry id → the reason it is kept local. */
  readonly overrides: ReadonlyMap<string, string>;
}

export interface ApplyOperatorProfileResult {
  readonly settings: ServerSettings;
  readonly rows: ReadonlyArray<OperatorProfileRow>;
}

const encodeSettings = Schema.encodeSync(ServerSettings);
const decodeSettings = Schema.decodeUnknownSync(ServerSettings);

export const hostFromPlatform = (platform: string): OperatorProfileHost =>
  platform === "darwin" ? "mac" : platform === "linux" ? "linux" : "other";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const resolveHome = <T>(value: T, home: string): T => {
  if (typeof value === "string") return value.replaceAll("{home}", home) as T;
  if (Array.isArray(value)) return value.map((item) => resolveHome(item, home)) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveHome(item, home)]),
    ) as T;
  }
  return value;
};

const deepMerge = (base: unknown, patch: unknown): unknown => {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = deepMerge(base[key], value);
  }
  return merged;
};

/** The part of `source` at the paths `shape` names. */
const pick = (source: unknown, shape: unknown): unknown => {
  if (!isPlainObject(shape)) return source;
  if (!isPlainObject(source)) return undefined;
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    if (key in source) picked[key] = pick(source[key], shape[key]);
  }
  return picked;
};

const deepEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const ownedView = (source: unknown, entry: OperatorProfileEntry, value: unknown): unknown =>
  entry.merge === "deep" ? pick(source, value) : source;

const inScope = (entry: OperatorProfileEntry, host: OperatorProfileHost): boolean =>
  entry.scope === "all" || entry.scope === host;

const schemaMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 400);

export function applyOperatorProfile(input: ApplyOperatorProfileInput): ApplyOperatorProfileResult {
  const defaults = encodeSettings(DEFAULT_SERVER_SETTINGS) as Record<string, unknown>;
  let encoded = encodeSettings(input.settings) as Record<string, unknown>;
  const appliedKeys = new Set<string>();
  const pending: Array<
    Omit<OperatorProfileRow, "effective"> & {
      readonly value: unknown;
      readonly profileEntry: OperatorProfileEntry;
    }
  > = [];

  for (const entry of input.profile) {
    const id = operatorProfileEntryId(entry);
    const value = resolveHome(entry.value as unknown, input.home);
    const base = { entry: id, key: entry.key, reason: entry.reason, value, profileEntry: entry };

    if (!inScope(entry, input.host)) {
      pending.push({
        ...base,
        outcome: "not-for-this-host",
        code: "HOST_SCOPE",
        detail: `scoped to ${entry.scope}; this host is ${input.host}`,
      });
      continue;
    }

    const overrideReason = input.overrides.get(id);
    if (overrideReason !== undefined) {
      pending.push({
        ...base,
        outcome: "overridden-locally",
        code: "OVERRIDDEN_LOCALLY",
        detail: `kept local: ${overrideReason}`,
      });
      continue;
    }

    if (entry.requires_launcher !== undefined) {
      const launcher = resolveHome(entry.requires_launcher, input.home);
      if (!input.launcherExists(launcher)) {
        pending.push({
          ...base,
          outcome: "rejected",
          code: "LAUNCHER_MISSING",
          detail: `launcher not found at ${launcher}`,
        });
        continue;
      }
    }

    const current = encoded[entry.key];
    const next = entry.merge === "deep" ? deepMerge(current, value) : value;
    const candidate = { ...encoded, [entry.key]: next };
    try {
      decodeSettings(candidate);
    } catch (error) {
      pending.push({
        ...base,
        outcome: "rejected",
        code: "SCHEMA_REJECTED",
        detail: schemaMessage(error),
      });
      continue;
    }

    const before = ownedView(current, entry, value);
    const code: OperatorProfileCode = deepEqual(before, ownedView(next, entry, value))
      ? "APPLIED_ALREADY_HELD"
      : deepEqual(before, ownedView(defaults[entry.key], entry, value))
        ? "APPLIED_OVER_DEFAULT"
        : "APPLIED_OVER_FILE_VALUE";
    encoded = candidate;
    appliedKeys.add(entry.key);
    pending.push({
      ...base,
      outcome: "applied",
      code,
      detail:
        code === "APPLIED_ALREADY_HELD"
          ? "this host already held the profile value"
          : code === "APPLIED_OVER_DEFAULT"
            ? "set over the upstream default"
            : "replaced a different settings-file value; list the entry in operator-profile-overrides.json to keep a local value",
    });
  }

  let settings = input.settings;
  if (appliedKeys.size > 0) {
    const decoded = decodeSettings(encoded);
    const next: Record<string, unknown> = { ...input.settings };
    for (const key of appliedKeys) next[key] = (decoded as Record<string, unknown>)[key];
    settings = next as ServerSettings;
  }

  const rows = pending.map(({ value, profileEntry, ...row }) => ({
    ...row,
    effective: ownedView(encoded[row.key], profileEntry, value),
  }));
  return { settings, rows };
}

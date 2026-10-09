// Explicit public contract source; owning package exports are activated separately.
import {
  normalizeReleaseIdentity,
  type ReleaseIdentity,
} from "../../../contracts/src/releaseIdentity.ts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The caller supplies compiler-replaced constants, not live server or request metadata. */
export function readWebReleaseIdentity(buildEnvironment: unknown): ReleaseIdentity {
  const constants = asRecord(buildEnvironment);
  return normalizeReleaseIdentity({
    release: constants?.APP_VERSION,
    fullCommit: constants?.APP_COMMIT,
  });
}

/** Reads only the deliberately embedded identity; native IDs and manifest versions are not commits. */
export function readExpoReleaseIdentity(expoConfig: unknown): ReleaseIdentity {
  const extra = asRecord(asRecord(expoConfig)?.extra);
  return normalizeReleaseIdentity(extra?.throughlineReleaseIdentity);
}

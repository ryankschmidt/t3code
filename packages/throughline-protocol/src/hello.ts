export interface ClientHello {
  readonly protocol_version: number;
  readonly release: string;
  readonly commit: string | null;
  readonly platform: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly last_cursor: number | null;
}

export interface HelloPolicy {
  readonly protocol_version: number;
  readonly min_protocol_version: number;
  readonly server_release: string;
  readonly server_commit: string | null;
  readonly min_supported_client: string;
  readonly capabilities: ReadonlyArray<string>;
}

export interface ServerHello {
  readonly [field: string]: unknown;
  readonly protocol_version: number;
  readonly outcome: "compatible" | "degraded" | "update-required";
  readonly server_release: string;
  readonly server_commit: string | null;
  readonly min_supported_client: string;
  readonly capabilities: ReadonlyArray<string>;
}

// Capability names describe existing RPC opt-ins. Hello does not enable them,
// replace authentication, deduplicate commands, or consume a replay cursor.
export const existingTransportCapabilities = [
  "environmentThemes",
  "usageLimitSources",
  "usageLimitsCommand",
  "orchestration.afterSequence",
] as const;

/** No app-track minimum has been admitted for this first cut: keep the legacy floor. */
export function existingTransportPolicy(serverRelease: string): HelloPolicy {
  return {
    protocol_version: 1,
    min_protocol_version: 1,
    server_release: serverRelease,
    // The current environment descriptor witnesses release, not build commit.
    // A null witness must not be replaced with a guessed checkout hash.
    server_commit: null,
    min_supported_client: "0.0.0",
    capabilities: existingTransportCapabilities,
  };
}

export function negotiateHello(client: ClientHello, policy: HelloPolicy): ServerHello {
  const floor = parseRelease(policy.min_supported_client);
  if (floor === null) throw new Error("Invalid minimum supported client release");
  const release = parseRelease(client.release);
  const releaseComparison = release === null ? null : compareReleases(release, floor);
  const supported = new Set(policy.capabilities);
  const requested = [...new Set(client.capabilities)];
  const capabilities = requested.filter((capability) => supported.has(capability));
  const outcome =
    client.protocol_version < policy.min_protocol_version ||
    (releaseComparison !== null && releaseComparison < 0)
      ? "update-required"
      : releaseComparison === null ||
          client.protocol_version > policy.protocol_version ||
          capabilities.length !== requested.length
        ? "degraded"
        : "compatible";
  return {
    protocol_version: policy.protocol_version,
    outcome,
    server_release: policy.server_release,
    server_commit: policy.server_commit,
    min_supported_client: policy.min_supported_client,
    capabilities: outcome === "update-required" ? [] : capabilities,
  };
}

interface ReleaseVersion {
  readonly core: ReadonlyArray<number>;
  readonly prerelease: ReadonlyArray<string>;
}

function parseRelease(value: string): ReleaseVersion | null {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      value,
    );
  if (match === null) return null;
  const core = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!core.every(Number.isSafeInteger)) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) {
    return null;
  }
  return { core, prerelease };
}

function compareReleases(left: ReleaseVersion, right: ReleaseVersion): number {
  for (let i = 0; i < 3; i++) {
    const difference = left.core[i]! - right.core[i]!;
    if (difference !== 0) return difference;
  }
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1;
  if (right.prerelease.length === 0) return -1;
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const a = left.prerelease[i],
      b = right.prerelease[i];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a),
      bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return BigInt(a) < BigInt(b) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

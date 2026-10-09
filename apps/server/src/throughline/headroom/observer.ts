/** Pure projection of the broker's existing observer snapshot. No reads, meters or routing. */
export interface QuotaObservation {
  readonly state: "unknown" | "available" | "empty";
  readonly observed_at?: string | null;
  readonly reset_at?: string | null;
}

export interface ConfiguredIdentity {
  readonly identity: string;
  readonly provider: string;
}

export interface ObservedIdentity extends ConfiguredIdentity {
  readonly credential_loaded: boolean;
  readonly quota?: QuotaObservation;
}

export interface ObserverSnapshot {
  readonly identities: readonly ObservedIdentity[];
}

function timestamp(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** `admit` is the headroom slot only: credential availability is a separate decision. */
export function readHeadroom({
  configured = [],
  snapshot,
  now,
  freshnessMs,
}: {
  readonly configured?: readonly ConfiguredIdentity[] | undefined;
  readonly snapshot?: ObserverSnapshot | undefined;
  readonly now: number;
  readonly freshnessMs: number;
}) {
  const key = (row: ConfiguredIdentity) => JSON.stringify([row.provider, row.identity]);
  const observed = new Map(snapshot?.identities.map((row) => [key(row), row]));
  const identities = new Map(configured.map((row) => [key(row), row]));
  const configuredKeys = new Set(identities.keys());
  for (const row of snapshot?.identities ?? []) identities.set(key(row), row);
  return [...identities.values()].map((identity) => {
    const row = observed.get(key(identity));
    const quota = row?.quota;
    const observedAt = timestamp(quota?.observed_at);
    const resetAt = timestamp(quota?.reset_at);
    const usableClock = Number.isFinite(now) && Number.isFinite(freshnessMs) && freshnessMs > 0;
    const freshness =
      !usableClock || observedAt === null || observedAt > now
        ? "unknown"
        : now - observedAt >= freshnessMs
          ? "stale"
          : "fresh";
    // Passing reset expires the old empty observation; it does not invent available quota.
    const resetPassed = resetAt !== null && resetAt <= now;
    const state =
      freshness === "fresh" &&
      !resetPassed &&
      (quota?.state === "available" || quota?.state === "empty")
        ? quota.state
        : "unknown";
    return {
      identity: identity.identity,
      provider: identity.provider,
      configured: configuredKeys.has(key(identity)),
      loaded: row?.credential_loaded ?? null,
      state,
      freshness,
      observed_at: quota?.observed_at ?? null,
      reset_at: quota?.reset_at ?? null,
      admit: state !== "empty",
    } as const;
  });
}

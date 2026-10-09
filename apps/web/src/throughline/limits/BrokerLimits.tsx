export interface ConfiguredBrokerIdentity {
  readonly identity: string;
  readonly provider: string;
}

/** Optional fields on the existing observer status; absence is not available quota. */
export interface BrokerObserverSnapshot {
  readonly identities: readonly (ConfiguredBrokerIdentity & {
    readonly credential_loaded: boolean;
    readonly quota?: {
      readonly state: "unknown" | "available" | "empty";
      readonly observed_at?: string | null;
      readonly reset_at?: string | null;
    };
  })[];
}

/** Display the same observation semantics as the headroom slot, without acquiring quota. */
export function BrokerLimits({
  snapshot,
  configured,
  now,
  freshnessMs,
}: {
  readonly snapshot?: BrokerObserverSnapshot | undefined;
  readonly configured?: readonly ConfiguredBrokerIdentity[] | undefined;
  readonly now: number;
  readonly freshnessMs: number;
}) {
  const key = (row: ConfiguredBrokerIdentity) => JSON.stringify([row.provider, row.identity]);
  const reported = new Map(snapshot?.identities.map((row) => [key(row), row]));
  const configuredKeys = new Set(configured?.map(key));
  const identities = new Map(configured?.map((row) => [key(row), row]));
  for (const row of snapshot?.identities ?? []) identities.set(key(row), row);
  const rows = [...identities.values()].map((identity) => {
    const source = reported.get(key(identity));
    const quota = source?.quota;
    const observedAt = Date.parse(quota?.observed_at ?? "");
    const resetAt = Date.parse(quota?.reset_at ?? "");
    const freshness =
      !Number.isFinite(now) ||
      !Number.isFinite(freshnessMs) ||
      freshnessMs <= 0 ||
      !Number.isFinite(observedAt) ||
      observedAt > now
        ? "unknown"
        : now - observedAt >= freshnessMs
          ? "stale"
          : "fresh";
    const state =
      freshness === "fresh" &&
      !(resetAt <= now) &&
      (quota?.state === "empty" || quota?.state === "available")
        ? quota.state
        : "unknown";
    return {
      ...identity,
      configured: configuredKeys.has(key(identity)),
      loaded: source?.credential_loaded ?? null,
      freshness,
      state,
      observed_at: quota?.observed_at,
      reset_at: quota?.reset_at,
    };
  });
  return (
    <section aria-label="Broker headroom" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Broker headroom</h2>
      {!snapshot ? (
        <p className="text-sm text-muted-foreground">
          Broker headroom unknown: no observer snapshot is available.
        </p>
      ) : null}
      {rows.map((row) => (
        <div
          key={JSON.stringify([row.provider, row.identity])}
          className="rounded-lg border p-4 text-sm"
        >
          <h3 className="font-medium">
            {row.identity} · {row.provider}
          </h3>
          <p>
            {row.configured ? "Configured" : "Reported by observer"} ·{" "}
            {row.loaded === null ? "Loading unknown" : row.loaded ? "Loaded" : "Not loaded"} · Quota{" "}
            {row.state}
          </p>
          <p className="text-muted-foreground">
            {row.freshness === "fresh"
              ? "Fresh observation"
              : row.freshness === "stale"
                ? "Stale observation"
                : "Observation freshness unknown"}
            {row.observed_at ? ` · Observed ${row.observed_at}` : ""}
          </p>
          {row.reset_at ? <p>Reported reset: {row.reset_at}</p> : null}
        </div>
      ))}
    </section>
  );
}

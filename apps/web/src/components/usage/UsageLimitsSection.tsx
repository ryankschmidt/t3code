import {
  BrokerLimits,
  type BrokerObserverSnapshot,
  type ConfiguredBrokerIdentity,
} from "../../throughline/limits/BrokerLimits";
import { UsageLimitsSection as ExistingLimitsSection } from "./UsageLimits";

/** Existing Limits page, extended only by an optional broker observation. */
export function UsageLimitsSection({
  observerSnapshot,
  configuredIdentities,
  freshnessMs = 60_000,
  ...existing
}: Parameters<typeof ExistingLimitsSection>[0] & {
  readonly observerSnapshot?: BrokerObserverSnapshot;
  readonly configuredIdentities?: readonly ConfiguredBrokerIdentity[];
  readonly freshnessMs?: number;
}) {
  return (
    <div className="flex flex-col gap-8">
      <ExistingLimitsSection {...existing} />
      <BrokerLimits
        snapshot={observerSnapshot}
        configured={configuredIdentities}
        now={existing.now}
        freshnessMs={freshnessMs}
      />
    </div>
  );
}

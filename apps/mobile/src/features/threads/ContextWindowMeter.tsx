import {
  type ContextWindowSnapshot,
  formatContextWindowTokens,
} from "@t3tools/client-runtime/context-window";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";

/**
 * ThroughLine: the context window readout, on the phone.
 *
 * The desktop has shown this on every thread and the phone showed nothing, because the numbers
 * behind it lived in `apps/web/src/lib/contextWindow.ts` — on the desktop's side of the rail.
 * That derivation moved to `@t3tools/client-runtime/context-window`, the layer web and mobile
 * already share, and this is the React Native view of it.
 *
 * Only the view is per-surface, and it has to be: web renders React DOM and this renders React
 * Native, so the component tree itself cannot be shared at any price. Everything that decides
 * what the numbers ARE is shared, so the two surfaces cannot drift apart on the reading.
 *
 * Colors come from the same semantic classes the rest of the mobile app uses, so this follows
 * the operator's theme rather than carrying colors of its own.
 */
export function ContextWindowMeter({ usage }: { readonly usage: ContextWindowSnapshot }) {
  const maxTokens = usage.maxTokens ?? null;
  const usedPercentage = usage.usedPercentage ?? null;
  const percentage =
    maxTokens !== null && maxTokens > 0 && usedPercentage !== null
      ? Math.max(0, Math.min(100, usedPercentage))
      : null;
  const percentageLabel = percentage === null ? null : `${Math.round(percentage)}%`;
  const tokensLabel = formatContextWindowTokens(usage.usedTokens ?? null);

  return (
    <View
      accessibilityLabel={
        percentageLabel
          ? `Context window ${percentageLabel} used`
          : `Context window ${tokensLabel} tokens used`
      }
      accessibilityRole="progressbar"
      className="flex-row items-center gap-2 overflow-hidden rounded-[20px] border-continuous bg-card px-3 py-2"
    >
      <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        {percentage === null ? null : (
          <View className="h-full rounded-full bg-accent" style={{ width: `${percentage}%` }} />
        )}
      </View>
      <Text className="text-xs tabular-nums accent-text-muted">
        {percentageLabel ?? `${tokensLabel} tokens`}
      </Text>
    </View>
  );
}

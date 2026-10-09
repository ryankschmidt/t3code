import { View } from "react-native";
import { AppText } from "../../../components/AppText";
import { launcherFamilyRows, type ScopedLauncherFamily } from "./launcherFamily";

export function LauncherFamilyDetails(props: {
  environmentId: string;
  threadId: string;
  result: ScopedLauncherFamily | null;
  pending: boolean;
  error: string | null;
}) {
  let error = props.error;
  let rows: ReturnType<typeof launcherFamilyRows> = [];
  if (props.result !== null) {
    try {
      rows = launcherFamilyRows(props, props.result);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  return (
    <View className="mb-4 rounded-xl border border-border bg-card p-4">
      <AppText className="mb-3 text-lg font-t3-bold text-foreground">Launcher lineage</AppText>
      {error ? (
        <AppText accessibilityRole="alert" className="text-base text-foreground">
          {error}
        </AppText>
      ) : props.pending || rows.length === 0 ? (
        <AppText className="text-base text-foreground-secondary">
          {props.pending
            ? "Loading launcher lineage…"
            : "Lineage read API unavailable from this environment"}
        </AppText>
      ) : (
        rows.map((row) => (
          <View key={row.label} className="mb-3">
            <AppText className="text-sm text-foreground-secondary">{row.label}</AppText>
            <AppText selectable className="text-base text-foreground">
              {row.value}
            </AppText>
          </View>
        ))
      )}
    </View>
  );
}

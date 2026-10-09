import * as React from "react";
import { Pressable, Text, View } from "react-native";
type Props = {
  rawTranscript: string | null;
  canUndo: boolean;
  onUndo: () => unknown;
  disabled?: boolean;
};
export function VoiceOptimizationUndoControl({ rawTranscript, canUndo, onUndo, disabled }: Props) {
  const [showRaw, setShowRaw] = React.useState(false);
  if (rawTranscript === null) return null;
  return (
    <View className="gap-1 px-2 py-1">
      <View className="flex-row items-center gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show original dictation"
          onPress={() => setShowRaw((shown) => !shown)}
        >
          <Text className="text-xs text-muted">{showRaw ? "Hide original" : "Original"}</Text>
        </Pressable>
        {canUndo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo voice optimization"
            disabled={disabled}
            onPress={() => {
              onUndo();
            }}
          >
            <Text className="text-xs text-muted">Undo</Text>
          </Pressable>
        ) : null}
      </View>
      {showRaw ? (
        <Text selectable className="text-xs text-muted">
          {rawTranscript}
        </Text>
      ) : null}
    </View>
  );
}

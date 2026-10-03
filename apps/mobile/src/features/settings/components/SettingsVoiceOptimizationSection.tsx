import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { SymbolView } from "../../../components/AppSymbol";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../state/preferences";
import type { VoiceOptimizationProvider } from "../../voice-input/messageOptimizer";
import { SettingsSection } from "./SettingsSection";

const OPTIONS: ReadonlyArray<{ value: VoiceOptimizationProvider; label: string }> = [
  { value: "claude", label: "Claude (default)" },
  { value: "codex", label: "Codex" },
  { value: "off", label: "Off" },
];

export function SettingsVoiceOptimizationSection() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const ready = AsyncResult.isSuccess(preferences) && !preferences.waiting;
  const selected = AsyncResult.isSuccess(preferences)
    ? (preferences.value.voiceOptimizationProvider ?? "claude")
    : null;

  return (
    <View className="gap-2">
      <SettingsSection title="Voice Message Optimizer">
        {OPTIONS.map((option, index) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected === option.value, disabled: !ready }}
            disabled={!ready}
            onPress={() => savePreferences({ voiceOptimizationProvider: option.value })}
            className={
              index === 0
                ? "flex-row items-center gap-4 p-4"
                : "flex-row items-center gap-4 border-t border-border-subtle p-4"
            }
          >
            <Text className="min-w-0 flex-1 text-lg text-foreground">{option.label}</Text>
            {selected === option.value ? (
              <SymbolView
                name="checkmark"
                size={18}
                tintColorClassName="accent-icon"
                type="monochrome"
                weight="semibold"
              />
            ) : null}
          </Pressable>
        ))}
      </SettingsSection>
      <Text className="px-2 text-sm leading-normal text-foreground-muted">
        Sends voice transcripts to your tower over Tailscale before adding them to the composer. If
        optimization fails, your original words are kept. Off keeps transcription on-device.
      </Text>
    </View>
  );
}

import { Pressable, Text } from "react-native";

export function TerminalCopyButton(props: {
  readonly onPress: () => void;
  readonly disabled: boolean;
  readonly copied: boolean;
  readonly color: string;
}) {
  return (
    <Pressable
      accessible
      collapsable={false}
      accessibilityRole="button"
      accessibilityLabel="Copy all terminal output"
      accessibilityHint="Copies the terminal screen and scrollback as plain text"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        alignSelf: "flex-end",
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: 16,
        opacity: props.disabled ? 0.35 : pressed ? 0.65 : 1,
      })}
    >
      <Text style={{ color: props.color, fontSize: 14 }}>
        {props.copied ? "Copied" : "Copy all"}
      </Text>
    </Pressable>
  );
}

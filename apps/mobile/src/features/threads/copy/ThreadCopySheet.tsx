import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { AppText } from "../../../components/AppText";
import { useEnvironmentThread } from "../../../state/threads";
import { copyThreadValue, threadCopyItems, type ThreadCopyField } from "./threadCopy";
import { LauncherFamilyDetails } from "./LauncherFamilyDetails";
import type { ScopedLauncherFamily } from "./launcherFamily";

export function ThreadCopyButton(props: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Copy thread IDs"
      onPress={props.onPress}
      className="rounded-xl bg-card px-4 py-3 active:bg-row-hover"
    >
      <AppText className="text-base text-foreground">Copy IDs</AppText>
    </Pressable>
  );
}

export function ThreadCopySheet(props: {
  launcherFamilyResult?: ScopedLauncherFamily | null;
  launcherFamilyPending?: boolean;
  launcherFamilyError?: string | null;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  open: boolean;
  onClose: () => void;
}) {
  const state = useEnvironmentThread(props.environmentId, props.threadId);
  const thread = Option.getOrNull(state.data);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const identity = thread
    ? {
        environmentId: props.environmentId,
        threadId: thread.id,
        session: thread.session,
      }
    : null;
  const items = threadCopyItems(
    identity ?? { environmentId: props.environmentId, threadId: props.threadId, session: null },
  );
  const copy = async (field: ThreadCopyField, label: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await copyThreadValue({
        ref: props,
        field,
        read: () => identity,
        write: (value) => Clipboard.setStringAsync(value),
      });
      setMessage(
        result === "copied"
          ? `${label.replace(/^Copy /, "")} copied`
          : "Unavailable from the owning environment",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      visible={props.open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      <View className="flex-1 bg-screen px-5 pb-8 pt-8">
        <ScrollView className="flex-1">
          <AppText className="mb-4 text-2xl font-t3-bold text-foreground">
            Copy thread identity
          </AppText>
          <AppText className="mb-4 text-sm text-foreground-secondary">
            Values come from this thread’s owning environment. Provider session identity is not a
            native agent session ID.
          </AppText>
          {items.map((item) => (
            <Pressable
              key={item.field}
              accessibilityRole="button"
              accessibilityLabel={item.value === null ? `${item.label}, unavailable` : item.label}
              disabled={busy || !identity || item.value === null}
              onPress={() => void copy(item.field, item.label)}
              className="mb-3 rounded-xl border border-border bg-card p-4 active:bg-row-hover"
            >
              <AppText className="text-base text-foreground">{item.label}</AppText>
              <AppText className="mt-1 text-sm text-foreground-secondary" selectable>
                {item.value ?? "Unavailable"}
              </AppText>
            </Pressable>
          ))}
          {message && (
            <AppText accessibilityRole="alert" className="py-3 text-base text-foreground">
              {message}
            </AppText>
          )}
          <LauncherFamilyDetails
            environmentId={props.environmentId}
            threadId={props.threadId}
            result={props.launcherFamilyResult ?? null}
            pending={props.launcherFamilyPending ?? false}
            error={props.launcherFamilyError ?? null}
          />
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            setMessage(null);
            props.onClose();
          }}
          className="mt-3 rounded-xl bg-card p-4 active:bg-row-hover"
        >
          <AppText className="text-base text-foreground">Close</AppText>
        </Pressable>
      </View>
    </Modal>
  );
}

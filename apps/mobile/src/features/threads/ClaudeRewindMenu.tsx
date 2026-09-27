import { useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import * as Option from "effect/Option";
import { ComposerContextId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { buildRewindEntries, type RewindEntry } from "@t3tools/shared/claudeComposerMenus";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/AppText";
import {
  environmentThreadDetails,
  threadEnvironment,
  useEnvironmentThread,
} from "../../state/threads";
import { appAtomRegistry } from "../../state/atom-registry";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  appendComposerDraftAttachments,
  getComposerDraftSnapshot,
  setComposerDraftText,
} from "../../state/use-composer-drafts";
import { importAttachment } from "../../lib/composerContextClipboard";
import { uuidv4 } from "../../lib/uuid";

export function ClaudeRewindMenu(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  ownerKey: string;
  open: boolean;
  onClose: () => void;
}) {
  const state = useEnvironmentThread(props.environmentId, props.threadId);
  const thread = Option.getOrNull(state.data);
  const entries = useMemo(
    () =>
      buildRewindEntries({
        messages: thread?.messages ?? [],
        checkpoints: thread?.checkpoints ?? [],
      }),
    [thread?.messages, thread?.checkpoints],
  );
  const [selected, setSelected] = useState<RewindEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const revert = useAtomCommand(threadEnvironment.revertCheckpoint, { reportFailure: false });
  const isRunning = thread?.session?.status === "running" || thread?.session?.status === "starting";
  const close = () => {
    if (!busyRef.current) {
      setSelected(null);
      setError(null);
      props.onClose();
    }
  };
  const restore = async (restoreFiles: boolean) => {
    if (!thread || !selected || busyRef.current || isRunning) return;
    const message = thread.messages.find((message) => message.id === selected.id);
    if (!message) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      // Acquire attachments before changing history, so an unavailable asset cannot strand the prompt.
      const attachments = await Promise.all(
        (message.attachments ?? []).map((attachment) =>
          importAttachment(
            {
              ...attachment,
              version: 1,
              label: attachment.name,
              contextId: ComposerContextId.make(uuidv4()),
              attachmentId: attachment.id,
              kind: attachment.type === "image" ? "image" : "file",
            },
            props.environmentId,
            new AbortController().signal,
          ),
        ),
      );
      const atom = environmentThreadDetails.detailAtom({
        environmentId: props.environmentId,
        threadId: props.threadId,
      });
      const previousFailures = new Set(
        thread.activities
          .filter((activity) => activity.kind === "checkpoint.revert.failed")
          .map((activity) => activity.id),
      );
      const turnCount = selected.turnCount ?? 0;
      await new Promise<void>((resolve, reject) => {
        let accepted = false;
        let settled = false;
        let unsubscribe = () => {};
        const finish = (failure?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          unsubscribe();
          if (failure) reject(failure);
          else resolve();
        };
        const inspect = () => {
          const current = appAtomRegistry.get(atom);
          if (!current) return;
          const failure = current.activities.find(
            (activity) =>
              activity.kind === "checkpoint.revert.failed" && !previousFailures.has(activity.id),
          );
          if (failure) {
            const payload = failure.payload;
            finish(
              new Error(
                typeof payload === "object" &&
                  payload !== null &&
                  "detail" in payload &&
                  typeof payload.detail === "string"
                  ? payload.detail
                  : failure.summary,
              ),
            );
            return;
          }
          if (
            accepted &&
            !current.messages.some((row) => row.id === message.id) &&
            (!restoreFiles ||
              current.checkpoints.every((row) => row.checkpointTurnCount <= turnCount)) &&
            (!restoreFiles || turnCount === 0
              ? current.latestTurn === null
              : current.checkpoints.some((row) => row.turnId === current.latestTurn?.turnId))
          )
            finish();
        };
        const timeout = setTimeout(
          () =>
            finish(
              new Error(
                "Timed out waiting for rewind. Reconnect and inspect the conversation before trying again.",
              ),
            ),
          120_000,
        );
        unsubscribe = appAtomRegistry.subscribe(atom, inspect);
        void revert({
          environmentId: props.environmentId,
          input: {
            threadId: props.threadId,
            turnCount,
            restoreFiles,
            ...(!restoreFiles ? { beforeMessageId: message.id } : {}),
          },
        }).then(
          (result) => {
            if (result._tag === "Failure") {
              finish(new Error(String(squashAtomCommandFailure(result))));
              return;
            }
            accepted = true;
            inspect();
          },
          (error: unknown) => finish(new Error(String(error))),
        );
      });
      const draft = getComposerDraftSnapshot(props.ownerKey);
      setComposerDraftText(props.ownerKey, [draft.text, message.text].filter(Boolean).join("\n\n"));
      appendComposerDraftAttachments(props.ownerKey, attachments, { allowOverflow: true });
      setSelected(null);
      props.onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      visible={props.open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <View className="flex-1 bg-background px-5 pb-8 pt-12">
        <Text className="text-xl font-t3-medium">
          {selected ? "Restore to before this message?" : "Rewind conversation"}
        </Text>
        <Text className="py-3 text-foreground-muted">
          {selected
            ? "The selected message returns to your composer. Nothing is sent."
            : "Choose a user message. Times are shown in your local timezone."}
        </Text>
        {error && (
          <Text accessibilityRole="alert" className="py-2 text-foreground">
            {error}
          </Text>
        )}
        {isRunning && <Text className="py-2">Interrupt the current turn before rewinding.</Text>}
        <ScrollView className="flex-1">
          {selected ? (
            <>
              <Text className="py-4">{selected.text.slice(0, 500)}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Restore conversation, default"
                disabled={busy || isRunning}
                className="rounded-xl bg-primary p-4"
                onPress={() => void restore(false)}
              >
                <Text className="text-primary-foreground">
                  {busy ? "Restoring…" : "Restore conversation (default)"}
                </Text>
              </Pressable>
              {thread?.worktreePath && selected.turnCount !== null && (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || isRunning}
                  className="mt-3 rounded-xl border border-border p-4"
                  onPress={() => void restore(true)}
                >
                  <Text>Restore code and conversation</Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              {entries.length === 0 && <Text>No user messages loaded.</Text>}
              {Option.isSome(state.page) && state.page.value.hasMore && (
                <Text className="py-2 text-foreground-muted">
                  Older messages are available. Close this menu and load earlier messages in the
                  conversation.
                </Text>
              )}
              {entries.map((entry) => (
                <Pressable
                  key={entry.id}
                  accessibilityRole="button"
                  disabled={isRunning}
                  className="my-1 rounded-xl border border-border p-3"
                  onPress={() => setSelected(entry)}
                >
                  <Text className="text-xs text-foreground-muted">
                    {new Date(entry.createdAt).toLocaleString()}
                  </Text>
                  <Text numberOfLines={2}>{entry.text.slice(0, 180) || "[Attachments]"}</Text>
                  {entry.unavailableReason && (
                    <Text className="text-xs text-foreground-muted">{entry.unavailableReason}</Text>
                  )}
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          className="mt-3 p-4"
          onPress={selected ? () => setSelected(null) : close}
        >
          <Text>{selected ? "Back" : "Cancel"}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

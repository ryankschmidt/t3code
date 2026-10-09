import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import { toastManager } from "../../components/ui/toast";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironmentThread } from "../../state/threads";
import { copyThreadValue, threadCopyItems, type ThreadCopyField } from "./threadCopy";

export function ThreadCopyMenu(props: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const state = useEnvironmentThread(props.environmentId, props.threadId);
  const thread = Option.getOrNull(state.data);
  const [busy, setBusy] = useState(false);
  const identity = thread
    ? { environmentId: props.environmentId, threadId: thread.id, session: thread.session }
    : null;
  const items = threadCopyItems(identity ?? { ...props, session: null });

  const copy = async (field: ThreadCopyField) => {
    setBusy(true);
    try {
      const result = await copyThreadValue({
        ref: props,
        field,
        read: () => identity,
        write: (value) => writeTextToClipboard(value, "thread identity"),
      });
      toastManager.add({
        type: result === "copied" ? "success" : "warning",
        title: result === "copied" ? "Copied" : "Unavailable from the owning environment",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not copy thread identity",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Menu>
      <MenuTrigger render={<Button size="sm" variant="ghost" />}>Copy IDs</MenuTrigger>
      <MenuPopup align="end" aria-label="Copy thread identity">
        {items.map((item) => (
          <MenuItem
            key={item.field}
            disabled={busy || !identity || item.value === null}
            onClick={() => void copy(item.field)}
          >
            {item.label}
            {item.value === null ? " · unavailable" : ""}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

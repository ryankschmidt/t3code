import { useRef } from "react";
import type { RewindEntry } from "@t3tools/shared/claudeComposerMenus";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogPanel,
} from "../ui/dialog";

export function RewindMenu(props: {
  open: boolean;
  entries: ReadonlyArray<RewindEntry>;
  disabledReason: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (entry: RewindEntry) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup
        initialFocus={() =>
          Array.from(
            list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
          ).at(-1) ?? list.current
        }
      >
        <DialogHeader>
          <DialogTitle>Rewind conversation</DialogTitle>
          <DialogDescription>
            Restore to before a message. Your files stay unchanged unless you explicitly choose to
            restore them too.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {props.disabledReason && <p role="status">{props.disabledReason}</p>}
          <div
            ref={list}
            tabIndex={-1}
            className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto py-3"
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              const buttons = Array.from(
                list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
              );
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              buttons[
                Math.max(
                  0,
                  Math.min(buttons.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)),
                )
              ]?.focus();
            }}
          >
            {props.entries.length === 0 && (
              <p>
                No user messages loaded. Load earlier messages in the conversation to see more
                restore points.
              </p>
            )}
            {props.entries.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-1">
                <button
                  type="button"
                  className="min-h-14 w-full rounded-lg border border-border bg-background px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  disabled={props.disabledReason !== null}
                  onClick={() => props.onSelect(entry)}
                >
                  <span className="flex min-w-0 flex-1 flex-col items-start text-left">
                    <time className="text-xs" dateTime={entry.createdAt}>
                      {new Date(entry.createdAt).toLocaleString()}
                    </time>
                    <span className="w-full truncate">
                      {entry.text.slice(0, 180) || "[Attachments]"}
                    </span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

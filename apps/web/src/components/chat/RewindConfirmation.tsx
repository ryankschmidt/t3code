import { useRef } from "react";
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";

export function RewindConfirmation(props: {
  open: boolean;
  canRestoreFiles: boolean;
  onClose: () => void;
  onRestore: (restoreFiles: boolean) => void;
}) {
  const defaultButton = useRef<HTMLButtonElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <AlertDialogPopup initialFocus={defaultButton}>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore to before this message?</AlertDialogTitle>
          <AlertDialogDescription>
            Your prompt and attachments return to the composer. Nothing is sent.{" "}
            {props.canRestoreFiles
              ? "Files change only if you explicitly choose to restore them."
              : "Files stay as they are."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div
          ref={choices}
          onKeyDown={(event) => {
            if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            const buttons = Array.from(
              choices.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
            );
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[
              (index +
                (event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1) +
                buttons.length) %
                buttons.length
            ]?.focus();
          }}
        >
          <AlertDialogFooter>
            <Button ref={defaultButton} onClick={() => props.onRestore(false)}>
              Restore conversation
            </Button>
            {props.canRestoreFiles && (
              <Button variant="destructive" onClick={() => props.onRestore(true)}>
                Restore code and conversation
              </Button>
            )}
            <Button variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
          </AlertDialogFooter>
        </div>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

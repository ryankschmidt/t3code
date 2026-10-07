import type { DesktopBridge } from "@t3tools/contracts";

export const DESKTOP_PASTE_AS_TEXT_EVENT = "t3:paste-as-text";

/**
 * On a Mac, Chromium performs no paste for Command+Shift+V, and the Edit menu's
 * accelerator path deliberately does nothing so the Linux and Windows chord, which
 * Chromium does paste, is not pasted twice. A composer surface that sees the chord
 * on a Mac desktop build therefore requests the paste itself.
 */
export function requestDesktopPasteAsTextForChord(
  event: Pick<KeyboardEvent, "preventDefault">,
  macPlatform: boolean,
  bridge: Pick<DesktopBridge, "pasteAsText"> | undefined,
): boolean {
  if (!macPlatform || typeof bridge?.pasteAsText !== "function") return false;
  event.preventDefault();
  void bridge.pasteAsText();
  return true;
}

/** Arm composer paste handling before Electron delivers the native clipboard event. */
export function installDesktopPasteAsText(
  bridge: Pick<DesktopBridge, "onMenuAction" | "pasteAsText"> | undefined,
  target: EventTarget,
): (() => void) | undefined {
  return bridge?.onMenuAction((action) => {
    if (action !== "paste-as-text") return;
    target.dispatchEvent(new Event(DESKTOP_PASTE_AS_TEXT_EVENT));
    void bridge.pasteAsText?.();
  });
}

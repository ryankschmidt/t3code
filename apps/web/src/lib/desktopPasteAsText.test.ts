import type { DesktopBridge } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  DESKTOP_PASTE_AS_TEXT_EVENT,
  installDesktopPasteAsText,
  requestDesktopPasteAsTextForChord,
} from "./desktopPasteAsText";

describe("paste-as-text chord on a desktop build", () => {
  it.each([
    { macPlatform: true, hasBridge: true, requested: true },
    { macPlatform: false, hasBridge: true, requested: false },
    { macPlatform: true, hasBridge: false, requested: false },
  ])("mac $macPlatform, bridge $hasBridge requests a paste: $requested", (input) => {
    const event = { preventDefault: vi.fn() };
    const bridge = { pasteAsText: vi.fn(async () => {}) };
    const requested = requestDesktopPasteAsTextForChord(
      event,
      input.macPlatform,
      input.hasBridge ? bridge : undefined,
    );
    expect(requested).toBe(input.requested);
    expect(event.preventDefault).toHaveBeenCalledTimes(input.requested ? 1 : 0);
    expect(bridge.pasteAsText).toHaveBeenCalledTimes(input.requested ? 1 : 0);
  });
});

describe("desktop paste as text", () => {
  it.each([false, true])("pastes with a mounted composer: %s", (hasComposer) => {
    const target = new EventTarget();
    let menuAction: ((action: string) => void) | undefined;
    const order: string[] = [];
    const bridge = {
      onMenuAction: (listener) => {
        menuAction = listener;
        return () => {
          menuAction = undefined;
        };
      },
      pasteAsText: vi.fn(async () => {
        order.push("paste");
      }),
    } satisfies Pick<DesktopBridge, "onMenuAction" | "pasteAsText">;
    if (hasComposer)
      target.addEventListener(DESKTOP_PASTE_AS_TEXT_EVENT, () => order.push("armed"));
    const uninstall = installDesktopPasteAsText(bridge, target);
    menuAction?.("open-settings");
    expect(order).toEqual([]);
    menuAction?.("paste-as-text");
    expect(order).toEqual(hasComposer ? ["armed", "paste"] : ["paste"]);
    uninstall?.();
    menuAction?.("paste-as-text");
    expect(bridge.pasteAsText).toHaveBeenCalledOnce();
  });
});

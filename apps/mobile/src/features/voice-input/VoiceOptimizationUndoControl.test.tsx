// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
vi.mock("react-native", () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => (
    <button onClick={onPress} disabled={disabled} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
}));
import { VoiceOptimizationUndoControl } from "./VoiceOptimizationUndoControl";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});
describe("phone original/undo controls", () => {
  it("shows the exact raw transcript and exposes a usable undo action", async () => {
    const onUndo = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <VoiceOptimizationUndoControl rawTranscript={"raw\nwords"} canUndo onUndo={onUndo} />,
      ),
    );
    await act(async () =>
      (
        container.querySelector('[aria-label="Show original dictation"]') as HTMLButtonElement
      ).click(),
    );
    expect(container.textContent).toContain("raw\nwords");
    await act(async () =>
      (
        container.querySelector('[aria-label="Undo voice optimization"]') as HTMLButtonElement
      ).click(),
    );
    expect(onUndo).toHaveBeenCalledOnce();
  });
  it("does not expose stale undo, and has no raw panel before a committed dictation", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <VoiceOptimizationUndoControl rawTranscript={null} canUndo={false} onUndo={() => {}} />,
      ),
    );
    expect(container.textContent).toBe("");
    await act(async () =>
      root.render(
        <VoiceOptimizationUndoControl rawTranscript="raw" canUndo={false} onUndo={() => {}} />,
      ),
    );
    expect(container.querySelector('[aria-label="Undo voice optimization"]')).toBeNull();
  });
});

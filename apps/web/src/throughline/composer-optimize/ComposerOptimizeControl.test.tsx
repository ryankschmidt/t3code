import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ComposerOptimizeControl } from "./ComposerOptimizeControl";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.restoreAllMocks());

describe("mounted composer optimization", () => {
  it("applies the selected range, displays original/status, and restores the draft on Undo", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ optimized: "Clear" })),
    );
    let draft = { owner: "mac:thread", text: "before messy after", revision: 1 };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ComposerOptimizeControl
          ownerKey={draft.owner}
          readDraft={() => draft}
          readSelection={() => ({ start: 7, end: 12 })}
          writeDraft={(text) => {
            draft = { ...draft, text, revision: draft.revision + 1 };
          }}
        />,
      );
    });
    await act(async () => {
      await renderer.root
        .findByProps({ "aria-label": "Optimize draft or selection" })
        .props.onClick();
    });
    expect(draft.text).toBe("before Clear after");
    expect(renderer.root.findByType("pre").children).toEqual(["messy"]);
    expect(renderer.root.findByProps({ role: "status" }).children).toEqual(["Optimized"]);
    await act(async () => {
      renderer.root.findByProps({ "aria-label": "Undo optimization" }).props.onClick();
    });
    expect(draft.text).toBe("before messy after");
    await act(async () => renderer.unmount());
  });

  it("Off does not call the tower or change the draft", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    const draft = { owner: "mac:thread", text: "raw", revision: 1 };
    const writeDraft = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ComposerOptimizeControl
          ownerKey={draft.owner}
          readDraft={() => draft}
          readSelection={() => ({ start: 0, end: 0 })}
          writeDraft={writeDraft}
        />,
      );
    });
    await act(async () => {
      renderer.root
        .findByProps({ "aria-label": "Optimization provider" })
        .props.onChange({ target: { value: "off" } });
    });
    await act(async () => {
      await renderer.root
        .findByProps({ "aria-label": "Optimize draft or selection" })
        .props.onClick();
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(writeDraft).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain("Off");
    await act(async () => renderer.unmount());
  });
});

import { describe, expect, it, vi } from "vite-plus/test";
import { ComposerOptimization, requestOptimization, type DraftSnapshot } from "./draftOptimization";

function harness(text = "before um fix this after") {
  let draft: DraftSnapshot = { owner: "mac:thread", text, revision: 0 };
  const request = vi.fn<
    (text: string, provider: "claude" | "codex", signal: AbortSignal) => Promise<string>
  >(async () => "Fix this.");
  const write = vi.fn((text: string) => {
    draft = { ...draft, text, revision: draft.revision + 1 };
  });
  const controller = new ComposerOptimization({ read: () => draft, write, request });
  return {
    controller,
    request,
    write,
    read: () => draft,
    change: (text: string, owner = draft.owner) => {
      draft = { owner, text, revision: draft.revision + 1 };
    },
  };
}

describe("reversible composer optimization", () => {
  it("publishes undo availability and clears prior raw text when rebound to another owner", async () => {
    const h = harness();
    expect(typeof h.controller.subscribe).toBe("function");
    const listener = vi.fn();
    const unsubscribe = h.controller.subscribe(listener);
    await h.controller.optimize("claude");
    expect(h.controller.state.canUndo).toBe(true);
    expect(listener).toHaveBeenCalled();
    h.change("other draft", "mac:other-thread");
    h.controller.rebind({ read: h.read, write: h.write, request: h.request });
    expect(h.controller.state).toMatchObject({ phase: "idle", raw: "", canUndo: false });
    unsubscribe();
  });
  it("optimizes only the selection, retains raw text, and undoes the whole edit", async () => {
    const h = harness();
    await h.controller.optimize("claude", { start: 7, end: 18 });
    expect(h.request).toHaveBeenCalledWith("um fix this", "claude", expect.any(AbortSignal));
    expect(h.read().text).toBe("before Fix this. after");
    expect(h.controller.state.raw).toBe("um fix this");
    expect(h.controller.state.phase).toBe("optimized");
    expect(h.controller.undo()).toBe(true);
    expect(h.read().text).toBe("before um fix this after");
    expect(h.controller.state.phase).toBe("undone");
  });
  it("optimizes the whole draft for a collapsed caret", async () => {
    const h = harness();
    await h.controller.optimize("codex", { start: 3, end: 3 });
    expect(h.request.mock.calls[0]?.[0]).toBe("before um fix this after");
    expect(h.read().text).toBe("Fix this.");
  });
  it("keeps Off local and keeps the original on a failed request", async () => {
    const h = harness();
    await h.controller.optimize("off");
    expect(h.request).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
    h.request.mockRejectedValueOnce(new Error("Unavailable"));
    await h.controller.optimize("claude");
    expect(h.read().text).toBe("before um fix this after");
    expect(h.controller.state).toMatchObject({ phase: "original-kept", reason: "Unavailable" });
  });
  it.each(["typing", "owner", "same-text-new-revision"])(
    "rejects late results after %s changes",
    async (change) => {
      const h = harness();
      let finish!: (text: string) => void;
      h.request.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      );
      const pending = h.controller.optimize("claude");
      expect(h.controller.state.phase).toBe("optimizing");
      const before = h.read().text;
      if (change === "typing") h.change("new typing");
      if (change === "owner") h.change(before, "mac:other-thread");
      if (change === "same-text-new-revision") {
        h.change("intermediate");
        h.change(before);
      }
      finish("Late result");
      await pending;
      expect(h.write).not.toHaveBeenCalled();
      expect(h.controller.state.phase).toBe("stale");
    },
  );
  it("refuses undo after a later edit and cancels a pending request", async () => {
    const h = harness();
    await h.controller.optimize("claude");
    h.change("new typing");
    expect(h.controller.undo()).toBe(false);
    expect(h.read().text).toBe("new typing");
    let finish!: (text: string) => void;
    h.request.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = h.controller.optimize("claude");
    const signal = h.request.mock.calls.at(-1)?.[2];
    h.controller.cancel();
    expect(signal?.aborted).toBe(true);
    finish("Cancelled result");
    await pending;
    expect(h.read().text).toBe("new typing");
  });
});

describe("existing tower optimizer client", () => {
  it("uses the tower route without cookies and rejects an empty response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ optimized: "Clear text" })));
    const signal = new AbortController().signal;
    await expect(requestOptimization("raw", "codex", signal, fetcher)).resolves.toBe("Clear text");
    expect(fetcher).toHaveBeenCalledWith(
      "https://twr.tailec334b.ts.net:8443/optimize",
      expect.objectContaining({
        credentials: "omit",
        method: "POST",
        body: JSON.stringify({ text: "raw", provider: "codex" }),
      }),
    );
    fetcher.mockResolvedValue(new Response(JSON.stringify({ optimized: " " })));
    await expect(requestOptimization("raw", "codex", signal, fetcher)).rejects.toThrow(
      "Invalid optimizer response",
    );
  });
});

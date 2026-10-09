import { describe, expect, it, vi } from "vite-plus/test";
import { withMessageOptimizer } from "./messageOptimizer";

describe("committed voice raw-text channel", () => {
  it("reports exact raw text separately from the existing optimized text/outcome contract", async () => {
    const raw = "um\nplease fix it";
    const onRaw = vi.fn(),
      onOutcome = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ optimized: "Please fix it." })));
    const wrapped = withMessageOptimizer(
      { prepare: async () => ({ locale: "en-US", transcribe: async () => raw }) },
      () => "claude",
      fetcher,
      onOutcome,
      onRaw,
    );
    const options = { signal: new AbortController().signal };
    const prepared = await wrapped.prepare(options);
    await expect(prepared.transcribe("file:///voice.m4a", options)).resolves.toBe("Please fix it.");
    expect(onRaw).toHaveBeenCalledWith(raw);
    expect(onOutcome).toHaveBeenCalledWith({
      text: "Please fix it.",
      outcome: "optimized",
      reason: null,
    });
  });
  it("keeps Off raw locally and never reports raw text after native cancellation", async () => {
    const onRaw = vi.fn(),
      fetcher = vi.fn<typeof fetch>();
    const controller = new AbortController();
    const wrapped = withMessageOptimizer(
      { prepare: async () => ({ locale: "en-US", transcribe: async () => "raw\ntext" }) },
      () => "off",
      fetcher,
      undefined,
      onRaw,
    );
    const prepared = await wrapped.prepare({ signal: controller.signal });
    await expect(
      prepared.transcribe("file:///voice.m4a", { signal: controller.signal }),
    ).resolves.toBe("raw\ntext");
    expect(onRaw).toHaveBeenCalledWith("raw\ntext");
    expect(fetcher).not.toHaveBeenCalled();
    onRaw.mockClear();
    controller.abort();
    await expect(
      prepared.transcribe("file:///voice.m4a", { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(onRaw).not.toHaveBeenCalled();
  });
});

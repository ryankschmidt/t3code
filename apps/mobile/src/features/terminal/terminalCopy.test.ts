import { describe, expect, it, vi } from "vite-plus/test";

import { copyTerminalOutput } from "./terminalCopy";

describe("copyTerminalOutput", () => {
  it("copies the complete captured scrollback without truncating or adding visual wraps", async () => {
    const text = `first scrollback line\n${"long-path/".repeat(120)}\nUnicode: café 中文 🚀\nlast line`;
    let clipboard = "previous clipboard";
    expect(
      await copyTerminalOutput(text, async (value) => {
        clipboard = value;
      }),
    ).toBe(true);
    expect(clipboard).toBe(text);
  });

  it("does not overwrite the clipboard when there is no output", async () => {
    const write = vi.fn();
    expect(await copyTerminalOutput("\n \n", write)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("does not report success until the platform clipboard has accepted the text", async () => {
    let finish: (() => void) | undefined;
    let completed = false;
    const write = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const copy = copyTerminalOutput("scrollback", () => write).then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    finish?.();
    await copy;
    expect(completed).toBe(true);
  });

  it("waits for the clipboard write and propagates a write failure", async () => {
    await expect(
      copyTerminalOutput("output", async () => {
        throw new Error("clipboard unavailable");
      }),
    ).rejects.toThrow("clipboard unavailable");
  });
});

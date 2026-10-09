import { describe, expect, it } from "vite-plus/test";
import {
  isPasteAsTextShortcut,
  pastedTextDisposition,
  replaceTextSelection,
} from "@t3tools/client-runtime/text-paste";
import { resolveCarriedComposerMenu } from "./carriedComposerPolicy";

describe("local composer commands must not consume attached prompts", () => {
  it.each(["/rewind", "/config"])("keeps the existing bare %s local menu", (text) => {
    expect(
      resolveCarriedComposerMenu({
        driver: "claudeAgent",
        text,
        attachmentCount: 0,
        hasPendingAttachments: false,
      }),
    ).toBe(text.slice(1));
  });

  it.each(["/rewind", "/config"])(
    "sends attached %s as a prompt without clearing its draft",
    (text) => {
      expect(
        resolveCarriedComposerMenu({
          driver: "claudeAgent",
          text,
          attachmentCount: 1,
          hasPendingAttachments: false,
        }),
      ).toBeNull();
    },
  );

  it("does not swallow a prompt while its pasted attachment is still arriving", () => {
    expect(
      resolveCarriedComposerMenu({
        driver: "claudeAgent",
        text: "/rewind",
        attachmentCount: 0,
        hasPendingAttachments: true,
      }),
    ).toBeNull();
  });

  it.each(["codex", undefined])(
    "does not reinterpret another provider's command (%s)",
    (driver) => {
      expect(
        resolveCarriedComposerMenu({
          driver,
          text: "/rewind",
          attachmentCount: 0,
          hasPendingAttachments: false,
        }),
      ).toBeNull();
    },
  );

  it("leaves multiline raw prompt text alone", () => {
    const text = "  /rewind\r\nKeep these spaces and this body.  ";
    expect(
      resolveCarriedComposerMenu({
        driver: "claudeAgent",
        text,
        attachmentCount: 0,
        hasPendingAttachments: false,
      }),
    ).toBeNull();
    expect(text).toBe("  /rewind\r\nKeep these spaces and this body.  ");
  });
});

describe("retained inline-paste protections", () => {
  it("recognizes Mac Command-Shift-V and keeps a large raw paste inline", () => {
    expect(
      isPasteAsTextShortcut(
        { key: "V", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
        true,
      ),
    ).toBe(true);
    const text = "  line\r\n🙂\n".repeat(5000);
    expect(pastedTextDisposition({ text, canAttach: true, bypassAutoAttachment: true })).toBe(
      "inline",
    );
    const result = replaceTextSelection({
      value: "before AFTER tail",
      selection: { start: 7, end: 12 },
      text,
    });
    expect(result).toEqual({ value: `before ${text} tail`, cursor: 7 + text.length });
  });
});

import { describe, expect, it } from "vite-plus/test";
import {
  composerReturnBehavior,
  resolveCarriedComposerSubmission,
  sendWithComposerGuard,
} from "./composerCarriedBehavior";

const base = {
  platform: "ios",
  source: "send-arrow" as const,
  draftMessage: "prompt",
  attachmentCount: 0,
  driver: "claudeAgent",
  blocked: false,
};

describe("carried composer submission behavior", () => {
  it("makes iOS Return a newline and refuses every keyboard-submit path", () => {
    expect(composerReturnBehavior("ios")).toBe("newline");
    expect(resolveCarriedComposerSubmission({ ...base, source: "keyboard-submit" })).toEqual({
      kind: "blocked",
    });
    expect(resolveCarriedComposerSubmission(base)).toEqual({ kind: "send" });
  });

  it("does not override the existing Android keyboard policy", () => {
    expect(composerReturnBehavior("android")).toBeUndefined();
    expect(
      resolveCarriedComposerSubmission({ ...base, platform: "android", source: "keyboard-submit" }),
    ).toEqual({ kind: "send" });
  });

  it.each(["/rewind", "/config"])(
    "keeps attached %s as a prompt instead of consuming it locally",
    (draftMessage) => {
      expect(
        resolveCarriedComposerSubmission({ ...base, draftMessage, attachmentCount: 1 }),
      ).toEqual({ kind: "send" });
      expect(resolveCarriedComposerSubmission({ ...base, draftMessage })).toEqual({
        kind: "local-menu",
        menu: draftMessage.slice(1),
      });
    },
  );

  it("does not reinterpret another provider or a multiline raw body", () => {
    expect(
      resolveCarriedComposerSubmission({ ...base, driver: "codex", draftMessage: "/rewind" }),
    ).toEqual({ kind: "send" });
    expect(
      resolveCarriedComposerSubmission({ ...base, draftMessage: " /rewind\r\n raw body  " }),
    ).toEqual({ kind: "send" });
  });

  it("does not consume even a local command when voice or an attachment import blocks sending", () => {
    expect(
      resolveCarriedComposerSubmission({ ...base, draftMessage: "/rewind", blocked: true }),
    ).toEqual({ kind: "blocked" });
  });

  it("preserves raw/newline text and attachment state when the send is refused, then permits retry", async () => {
    const draft = { text: "  first\r\nsecond\n🙂  ", attachments: [{ id: "original-file" }] };
    const initial = structuredClone(draft);
    const inFlight = new Set<string>();
    const refusal = await sendWithComposerGuard(inFlight, "host:thread", async () => null);
    expect(refusal).toBeNull();
    expect(draft).toEqual(initial);
    expect(inFlight.size).toBe(0);
    const sent: (typeof draft)[] = [];
    const id = await sendWithComposerGuard(inFlight, "host:thread", async () => {
      sent.push(structuredClone(draft));
      return "message-id";
    });
    expect(id).toBe("message-id");
    expect(sent).toEqual([initial]);
  });

  it("allows only one in-flight send per thread without blocking another thread", async () => {
    const inFlight = new Set<string>();
    let release!: (id: string) => void;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const first = sendWithComposerGuard(inFlight, "host:first", () => pending);
    let duplicateCalls = 0;
    expect(
      await sendWithComposerGuard(inFlight, "host:first", async () => {
        duplicateCalls++;
        return "duplicate";
      }),
    ).toBeNull();
    expect(duplicateCalls).toBe(0);
    expect(await sendWithComposerGuard(inFlight, "host:second", async () => "second")).toBe(
      "second",
    );
    release("first");
    expect(await first).toBe("first");
    expect(inFlight.size).toBe(0);
  });

  it("releases the send guard after rejection without clearing the next draft", async () => {
    const inFlight = new Set<string>();
    const draft = "  keep this\nraw  ";
    await expect(
      sendWithComposerGuard(inFlight, "thread", async () => {
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    expect(inFlight.size).toBe(0);
    expect(await sendWithComposerGuard(inFlight, "thread", async () => draft)).toBe(draft);
  });
});

import { describe, expect, it } from "vite-plus/test";
import { createVoiceUndo, restoreVoiceUndo } from "../voice-input/voiceOptimizationUndo";

describe("composer consumption of pinned voice undo guards", () => {
  const before = {
    ownerKey: "environment:thread",
    text: "  existing\r\ndraft  ",
    selection: { start: 2, end: 2 },
    revision: 7,
  };
  const raw = "  raw\r\nutterance\n🙂  ";

  it("retains exact original dictation and restores the pre-dictation draft/selection", () => {
    const undo = createVoiceUndo(before, "optimized draft", raw);
    const restored = restoreVoiceUndo(undo, { ...before, text: "optimized draft", revision: 8 });
    expect(undo.rawTranscript).toBe(raw);
    expect(restored).toEqual({
      text: before.text,
      selection: before.selection,
      rawTranscript: raw,
    });
  });

  it.each(["another-environment:thread", "environment:another-thread"])(
    "does not restore across owner boundary %s",
    (ownerKey) => {
      const undo = createVoiceUndo(before, "optimized draft", raw);
      expect(
        restoreVoiceUndo(undo, { ...before, ownerKey, text: "optimized draft", revision: 8 }),
      ).toBeNull();
    },
  );

  it("refuses a changed revision even when the text was changed away and back", () => {
    const undo = createVoiceUndo(before, "optimized draft", raw);
    expect(restoreVoiceUndo(undo, { ...before, text: "optimized draft", revision: 10 })).toBeNull();
  });
});

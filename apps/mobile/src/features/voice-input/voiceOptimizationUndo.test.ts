import { describe, expect, it } from "vite-plus/test";
import { createVoiceUndo, restoreVoiceUndo } from "./voiceOptimizationUndo";

const before = {
  ownerKey: "phone:thread",
  text: "before\nafter",
  selection: { start: 7, end: 7 },
  revision: 4,
};
describe("voice draft reversal", () => {
  it("keeps the raw transcript and restores original text/selection only at the committed revision", () => {
    const undo = createVoiceUndo(before, "before\nClear text.after", "um\nraw words");
    expect(undo.rawTranscript).toBe("um\nraw words");
    expect(
      restoreVoiceUndo(undo, { ...before, text: "before\nClear text.after", revision: 5 }),
    ).toEqual({
      text: "before\nafter",
      selection: { start: 7, end: 7 },
      rawTranscript: "um\nraw words",
    });
  });
  it.each(["owner", "typing", "same-text-new-revision"])(
    "refuses a reversal after %s changes",
    (kind) => {
      const undo = createVoiceUndo(before, "optimized", "raw");
      const current = { ...before, text: "optimized", revision: 5 };
      if (kind === "owner") current.ownerKey = "phone:other-thread";
      if (kind === "typing") current.text = "new typing";
      if (kind === "same-text-new-revision") current.revision = 7;
      expect(restoreVoiceUndo(undo, current)).toBeNull();
    },
  );
  it("handles a no-change result and copies the original selection", () => {
    const original = { ...before, selection: { ...before.selection } };
    const undo = createVoiceUndo(original, original.text, "raw");
    original.selection.start = 0;
    expect(restoreVoiceUndo(undo, before)?.selection).toEqual({ start: 7, end: 7 });
  });
});

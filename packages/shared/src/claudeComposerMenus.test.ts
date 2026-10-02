import { describe, expect, it } from "vite-plus/test";
import { buildRewindEntries, parseClaudeComposerMenu } from "./claudeComposerMenus.ts";

describe("Claude composer menus", () => {
  it("recognizes only whole commands, not requests mentioning commands", () => {
    expect(parseClaudeComposerMenu(" /rewind\n")).toBe("rewind");
    expect(parseClaudeComposerMenu("/config")).toBe("config");
    for (const text of ["explain /rewind", "/rewind please", "/configuration", "/compact"])
      expect(parseClaudeComposerMenu(text)).toBeNull();
  });
  it("uses absolute checkpoint counts, never the index of a paginated message", () => {
    const message = (id: string, turnId: string | null, role = "user") => ({
      id,
      turnId,
      role,
      text: id,
      createdAt: "2026-09-25T21:06:49Z",
    });
    const rows = buildRewindEntries({
      messages: [
        message("old", "t9"),
        message("reply", "t9", "assistant"),
        message("failed", "t10"),
        message("steer", "t10"),
        message("unknown", null),
      ],
      checkpoints: [
        { turnId: "t9", checkpointTurnCount: 9 },
        { turnId: "t10", checkpointTurnCount: 10 },
      ],
    });
    expect(rows.map((row) => [row.id, row.turnCount])).toEqual([
      ["old", 8],
      ["failed", 9],
      ["steer", null],
      ["unknown", null],
    ]);
    expect(rows[2]?.unavailableReason).toMatch(/first message/);
    expect(rows[3]?.unavailableReason).toMatch(/boundary/);
  });
});

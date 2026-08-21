import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  branch: null,
  sessionUuid: null,
  transcriptPath: null,
  isPinned: false,
  isSettled: false,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: { settlement: true, snooze: true, pinning: true, titleRegeneration: true },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

function ids(state: ThreadActionMenuState): string[] {
  return buildThreadActionMenuItems(state).map((item) => item.id);
}

describe("buildThreadActionMenuItems", () => {
  it("hides lifecycle items when the environment lacks the capabilities", () => {
    expect(
      ids({
        ...baseState,
        supports: { settlement: false, snooze: false, pinning: false, titleRegeneration: false },
      }),
    ).toEqual(["rename", "mark-unread", "copy-path", "copy-thread-id", "archive", "delete"]);
  });

  it("includes branch items only for threads with a branch", () => {
    const withBranch = ids({ ...baseState, branch: "feat/menu" });
    expect(withBranch).toContain("new-thread-on-branch");
    expect(withBranch).toContain("copy-branch");
    expect(ids(baseState)).not.toContain("new-thread-on-branch");
    expect(ids(baseState)).not.toContain("copy-branch");
  });

  it("includes native session items only when the thread records that identity", () => {
    expect(ids(baseState)).not.toContain("copy-session-uuid");
    expect(ids(baseState)).not.toContain("copy-transcript-path");

    const withSession = ids({ ...baseState, sessionUuid: "99ff54ed-45a4-4838-b203-8d974a4d1618" });
    expect(withSession).toContain("copy-session-uuid");
    expect(withSession).not.toContain("copy-transcript-path");

    const withTranscript = ids({ ...baseState, transcriptPath: "/tmp/session.jsonl" });
    expect(withTranscript).toContain("copy-transcript-path");
    expect(withTranscript).not.toContain("copy-session-uuid");
  });

  it("keeps the native session items distinct from the thread-id item", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      sessionUuid: "99ff54ed-45a4-4838-b203-8d974a4d1618",
      transcriptPath: "/tmp/session.jsonl",
    });
    expect(items.find((item) => item.id === "copy-thread-id")?.label).toBe("Copy thread ID");
    expect(items.find((item) => item.id === "copy-session-uuid")?.label).toBe("Copy session UUID");
    expect(items.find((item) => item.id === "copy-transcript-path")?.label).toBe(
      "Copy transcript path",
    );
  });

  it("flips lifecycle labels with thread state", () => {
    expect(ids({ ...baseState, isPinned: true, isSettled: true, isSnoozed: true })).toEqual(
      expect.arrayContaining(["unpin", "unsettle", "unsnooze"]),
    );
    expect(ids(baseState)).toEqual(expect.arrayContaining(["pin", "settle", "snooze"]));
  });

  it("disables snooze when the thread cannot snooze, keeping presets visible", () => {
    const snooze = buildThreadActionMenuItems({ ...baseState, canSnoozeNow: false }).find(
      (item) => item.id === "snooze",
    );
    expect(snooze?.disabled).toBe(true);
    expect(snooze?.children?.map((child) => child.id)).toEqual(["snooze:hour"]);
  });

  it("disables title regeneration while one is in flight", () => {
    const item = buildThreadActionMenuItems({ ...baseState, isRegeneratingTitle: true }).find(
      (candidate) => candidate.id === "regenerate-title",
    );
    expect(item).toMatchObject({ label: "Regenerating…", disabled: true });
  });

  it("marks delete as destructive and keeps it last", () => {
    const items = buildThreadActionMenuItems({ ...baseState, branch: "main" });
    expect(items.at(-1)).toMatchObject({ id: "delete", destructive: true });
  });

  it("offers archive as a non-destructive action right before delete", () => {
    const items = buildThreadActionMenuItems(baseState);
    const archiveItem = items.at(-2);
    expect(archiveItem?.id).toBe("archive");
    expect(archiveItem?.destructive).toBeFalsy();
    expect(items.at(-1)?.id).toBe("delete");
  });

  it("keeps archive available even when the environment lacks every other capability", () => {
    expect(
      ids({
        ...baseState,
        supports: { settlement: false, snooze: false, pinning: false, titleRegeneration: false },
      }),
    ).toContain("archive");
  });

  it("disables archive while the thread is running", () => {
    const archiveItem = buildThreadActionMenuItems({ ...baseState, isRunning: true }).find(
      (item) => item.id === "archive",
    );
    expect(archiveItem?.disabled).toBe(true);
  });
});

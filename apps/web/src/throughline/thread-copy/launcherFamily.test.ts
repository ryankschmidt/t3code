import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { launcherFamilyRows, type LauncherFamilyViewInput } from "./launcherFamily";

const ref = { environmentId: "mac", threadId: "copy-thread" };
const family: LauncherFamilyViewInput = {
  threadId: ref.threadId,
  source: "agent-instruments.thread-lineage.v1",
  status: "recorded",
  parentThreadId: "54f430b5-4b16-4e2b-8200-ff7033d853f9",
  creatorResolution: "RESOLVED",
  launcherSeat: "lead-tlupgrade-54f430b5",
  purpose: "Copy and rewind",
  handle: "worker-copy-cab2ab6f",
  host: "mac",
  family: {
    status: "unknown",
    reason: "ancestor-not-recorded",
    ancestorThreadIds: ["54f430b5-4b16-4e2b-8200-ff7033d853f9"],
  },
};

describe("factual launcher lineage display", () => {
  it("shows the explicit parent while retaining the unknown family root", () => {
    const rows = launcherFamilyRows(ref, { environmentId: "mac", family });
    assert.equal(rows.find((row) => row.label === "Parent thread")?.value, family.parentThreadId);
    assert.equal(
      rows.find((row) => row.label === "Family root")?.value,
      "Unknown · ancestor-not-recorded",
    );
    assert.equal(rows.find((row) => row.label === "Visible handle")?.value, "worker-copy-cab2ab6f");
  });
  it("uses only the recorded family root when one exists", () => {
    const result = {
      ...family,
      family: {
        status: "recorded" as const,
        rootThreadId: "real-root",
        ancestorThreadIds: ["parent", "real-root"],
      },
    };
    assert.equal(
      launcherFamilyRows(ref, { environmentId: "mac", family: result }).find(
        (row) => row.label === "Family root",
      )?.value,
      "real-root",
    );
  });
  it("rejects stale results from another owning environment", () => {
    assert.throws(
      () => launcherFamilyRows(ref, { environmentId: "tower", family }),
      /owning environment/,
    );
  });
  it("rejects stale results from another public thread", () => {
    assert.throws(
      () =>
        launcherFamilyRows(ref, {
          environmentId: "mac",
          family: { ...family, threadId: "other-thread" },
        }),
      /thread/,
    );
  });
  it("never invents parentage when the launcher record is absent", () => {
    const rows = launcherFamilyRows(ref, {
      environmentId: "mac",
      family: {
        threadId: ref.threadId,
        source: "agent-instruments.thread-lineage.v1",
        status: "unknown",
        reason: "not-recorded",
      },
    });
    assert.equal(
      rows.find((row) => row.label === "Parent thread")?.value,
      "Unknown · not-recorded",
    );
    assert.equal(rows.find((row) => row.label === "Family root")?.value, "Unknown · not-recorded");
  });
  it("keeps a null parent distinct from a known parent or guessed root", () => {
    const rows = launcherFamilyRows(ref, {
      environmentId: "mac",
      family: { ...family, parentThreadId: null },
    });
    assert.equal(rows.find((row) => row.label === "Parent thread")?.value, "No parent recorded");
    assert.equal(
      rows.find((row) => row.label === "Family root")?.value,
      "Unknown · ancestor-not-recorded",
    );
  });
});

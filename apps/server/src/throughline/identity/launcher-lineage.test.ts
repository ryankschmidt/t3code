// @effect-diagnostics nodeBuiltinImport:off - Confined launcher-record fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { readLauncherThreadFamily } from "./launcher-lineage.ts";

const row = (threadId: string, parent: string | null, extra: Record<string, unknown> = {}) => ({
  schema: "agent-instruments.thread-lineage.v1",
  kind: "created",
  thread_id: threadId,
  creating_thread_id: parent,
  creating_thread_resolution: parent === null ? "NO_SESSION" : "RESOLVED",
  creating_session_id: "native-session-not-a-thread",
  launcher_seat: "launcher-visible-handle",
  purpose: "recorded purpose",
  handle: `recorded-${threadId}`,
  host: "mac",
  ...extra,
});

async function fixture(records: unknown[], use: (filePath: string) => Promise<void>) {
  const directory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "throughline-launcher-lineage-"),
  );
  const filePath = NodePath.join(directory, "thread-lineage.jsonl");
  try {
    await NodeFSP.writeFile(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    await use(filePath);
  } finally {
    await NodeFSP.rm(directory, { recursive: true });
  }
}

it("reads recorded parents/family, ignoring amendment actors, titles and native-session identifiers", async () => {
  await fixture(
    [
      row("root", null, { kind: undefined }),
      row("child", "root", { title: "lead-wrong-parent: title is not lineage" }),
      row("grandchild", "child"),
      {
        schema: "agent-instruments.thread-lineage.v1",
        kind: "finish_line_amended",
        thread_id: "grandchild",
        actor_thread_id: "unrelated",
        finish_line: "changed work",
      },
    ],
    async (filePath) => {
      const before = await NodeFSP.readFile(filePath, "utf8");
      const result = await readLauncherThreadFamily("grandchild", { filePath });
      expect(result.status).toBe("recorded");
      if (result.status !== "recorded") throw new Error("expected recorded lineage");
      expect(result.parentThreadId).toBe("child");
      expect(result.launcherSeat).toBe("launcher-visible-handle");
      expect(result.purpose).toBe("recorded purpose");
      expect(result.handle).toBe("recorded-grandchild");
      expect(result.family).toEqual({
        status: "recorded",
        rootThreadId: "root",
        ancestorThreadIds: ["child", "root"],
      });
      expect(await NodeFSP.readFile(filePath, "utf8")).toBe(before);
      expect(
        await readLauncherThreadFamily("native-session-not-a-thread", { filePath }),
      ).toMatchObject({ status: "unknown", reason: "not-recorded" });
    },
  );
});

it("keeps absent, unresolved and conflicting ancestry unknown rather than inventing a root", async () => {
  await fixture(
    [
      row("orphan", "missing-parent"),
      row("unresolved", null, {
        creating_thread_resolution: "THREAD_ADDRESS_NOT_FOUND",
        handle: null,
      }),
      row("conflict", "parent-a"),
      row("conflict", "parent-b"),
      row("cycle-a", "cycle-b"),
      row("cycle-b", "cycle-a"),
    ],
    async (filePath) => {
      for (const [threadId, reason] of [
        ["orphan", "ancestor-not-recorded"],
        ["unresolved", "creator-unresolved"],
        ["cycle-a", "cycle"],
      ] as const) {
        const result = await readLauncherThreadFamily(threadId, { filePath });
        expect(result.status).toBe("recorded");
        if (result.status === "recorded")
          expect(result.family).toMatchObject({ status: "unknown", reason });
      }
      expect(await readLauncherThreadFamily("conflict", { filePath })).toMatchObject({
        status: "unknown",
        reason: "conflicting-records",
      });
      expect(await readLauncherThreadFamily("absent", { filePath })).toMatchObject({
        status: "unknown",
        reason: "not-recorded",
      });
      expect(
        await readLauncherThreadFamily("absent", { filePath: filePath + ".missing" }),
      ).toMatchObject({ status: "unknown", reason: "file-missing" });
    },
  );
});

it("bounds bytes/records/depth and does not admit a partially appended tail", async () => {
  await fixture([row("root", null), row("child", "root")], async (filePath) => {
    expect(await readLauncherThreadFamily("child", { filePath, maxBytes: 8 })).toMatchObject({
      status: "unknown",
      reason: "byte-limit",
    });
    expect(await readLauncherThreadFamily("child", { filePath, maxRecords: 1 })).toMatchObject({
      status: "unknown",
      reason: "record-limit",
    });
    const shallow = await readLauncherThreadFamily("child", { filePath, maxDepth: 1 });
    if (shallow.status !== "recorded") throw new Error("expected recorded child");
    expect(shallow.family).toMatchObject({ status: "unknown", reason: "depth-limit" });
    await NodeFSP.appendFile(
      filePath,
      '{"schema":"agent-instruments.thread-lineage.v1","thread_id":"partial"',
    );
    expect(await readLauncherThreadFamily("child", { filePath })).toMatchObject({
      status: "recorded",
    });
    expect(await readLauncherThreadFamily("partial", { filePath })).toMatchObject({
      status: "unknown",
      reason: "not-recorded",
    });
  });
});

it("does not let an unrelated incomplete legacy creation hide an explicitly recorded parent", async () => {
  await fixture(
    [
      { schema: "agent-instruments.thread-lineage.v1", thread_id: "legacy-without-creator" },
      row("root", null),
      row("child", "root"),
    ],
    async (filePath) => {
      expect(await readLauncherThreadFamily("child", { filePath })).toMatchObject({
        status: "recorded",
        parentThreadId: "root",
      });
      expect(await readLauncherThreadFamily("legacy-without-creator", { filePath })).toMatchObject({
        status: "unknown",
        reason: "invalid-record",
      });
    },
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicationStore } from "../src/index.ts";

type Allocation = {
  taskId: string;
  agentId: string;
  path: string;
  baseline: string;
  scope: string[];
  status: "private-draft";
};
type Allocator = PublicationStore & {
  materializeTask(request: { taskId: string; workspaceRoot: string }): Promise<Allocation>;
};
async function fixture(t: test.TestContext) {
  const base = await mkdtemp(join(tmpdir(), "throughline-workspace-test-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const store = new PublicationStore({ root: join(base, "publisher") }) as Allocator;
  await store.initialize({ "help.txt": "published baseline" });
  return { base, store, workspaceRoot: join(base, "private") };
}

test("task workspaces have private Git metadata and edits cannot change accepted files", async (t) => {
  const { store, workspaceRoot } = await fixture(t);
  await store.openTask({ taskId: "task-a", agentId: "agent-a", scope: ["help.txt"] });
  await store.openTask({ taskId: "task-b", agentId: "agent-b", scope: ["help.txt"] });
  const a = await store.materializeTask({ taskId: "task-a", workspaceRoot });
  const b = await store.materializeTask({ taskId: "task-b", workspaceRoot });
  assert.notEqual(a.path, b.path);
  assert.equal(a.status, "private-draft");
  assert.equal((await lstat(join(a.path, ".git"))).isDirectory(), true);
  assert.equal((await lstat(join(b.path, ".git"))).isDirectory(), true);
  await writeFile(join(a.path, "help.txt"), "private draft");
  assert.equal(await readFile(join(b.path, "help.txt"), "utf8"), "published baseline");
  assert.equal(await store.readAccepted("help.txt"), "published baseline");
});

test("resuming an allocation preserves its baseline and uncommitted private edits", async (t) => {
  const { base, store, workspaceRoot } = await fixture(t);
  const task = await store.openTask({
    taskId: "task-a",
    agentId: "agent-persistent",
    scope: ["help.txt"],
  });
  const first = await store.materializeTask({ taskId: "task-a", workspaceRoot });
  await writeFile(join(first.path, "help.txt"), "unfinished draft");
  const reopened = new PublicationStore({ root: join(base, "publisher") }) as Allocator;
  const resumed = await reopened.materializeTask({ taskId: "task-a", workspaceRoot });
  assert.deepEqual(resumed, first);
  assert.equal(resumed.baseline, task.baseline);
  assert.equal(await readFile(join(resumed.path, "help.txt"), "utf8"), "unfinished draft");
});

test("same persistent agent can own successive independent task workspaces", async (t) => {
  const { store, workspaceRoot } = await fixture(t);
  for (const taskId of ["first", "second"])
    await store.openTask({ taskId, agentId: "same-agent", scope: ["help.txt"] });
  const a = await store.materializeTask({ taskId: "first", workspaceRoot });
  const b = await store.materializeTask({ taskId: "second", workspaceRoot });
  assert.equal(a.agentId, b.agentId);
  assert.notEqual(a.taskId, b.taskId);
  assert.notEqual(a.path, b.path);
});

test("unregistered task cannot acquire an untracked workspace", async (t) => {
  const { store, workspaceRoot } = await fixture(t);
  await assert.rejects(
    store.materializeTask({ taskId: "missing", workspaceRoot }),
    /TASK_NOT_FOUND/,
  );
});

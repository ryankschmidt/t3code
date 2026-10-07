import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  PublicationStore,
  changesDigest,
  type Task,
  type Change,
  type CheckReceipt,
} from "../src/index.ts";

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "throughline-publication-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new PublicationStore({ root });
  const baseline = await store.initialize({
    "docs/a.txt": "original-a",
    "docs/b.txt": "original-b",
    "private.txt": "outside-scope",
  });
  return { root, store, baseline };
}
async function checked(
  store: PublicationStore,
  task: Task,
  changes: Change[],
): Promise<CheckReceipt> {
  return {
    ...(await store.preparePublication({ taskId: task.taskId, changes })),
    passed: true,
    reviewerId: "reviewer-independent",
  };
}
async function publish(store: PublicationStore, task: Task, requestId: string, changes: Change[]) {
  return store.publish({
    taskId: task.taskId,
    requestId,
    changes,
    check: await checked(store, task, changes),
  });
}

test("trusted seed creates one accepted revision and missing files remain absent", async (t) => {
  const { store, baseline } = await fixture(t);
  assert.match(baseline, /^[a-f0-9]{40,64}$/);
  assert.equal(await store.currentRevision(), baseline);
  assert.equal(await store.readAccepted("docs/a.txt"), "original-a");
  assert.equal(await store.readAccepted("missing.txt"), null);
});

test("checked scoped publication changes accepted content and preserves unrelated content", async (t) => {
  const { store, baseline } = await fixture(t);
  const task = await store.openTask({ taskId: "task-a", agentId: "agent-a", scope: ["docs/"] });
  const result = await publish(store, task, "request-a", [
    { path: "docs/a.txt", content: "accepted-a" },
  ]);
  assert.equal(result.status, "accepted");
  assert.equal(result.previousRevision, baseline);
  assert.notEqual(result.revision, baseline);
  assert.equal(await store.currentRevision(), result.revision);
  assert.equal(await store.readAccepted("docs/a.txt"), "accepted-a");
  assert.equal(await store.readAccepted("private.txt"), "outside-scope");
});

test("unchecked, false, self-reviewed or mismatched evidence cannot mutate accepted files", async (t) => {
  const { store, baseline } = await fixture(t);
  const task = await store.openTask({ taskId: "task-a", agentId: "agent-a", scope: ["docs/"] });
  const changes = [{ path: "docs/a.txt", content: "forbidden" }];
  const good = await checked(store, task, changes);
  const invalid: unknown[] = [
    undefined,
    { ...good, passed: false },
    { ...good, reviewerId: task.agentId },
    { ...good, taskId: "foreign" },
    { ...good, baseline: "0".repeat(40) },
    { ...good, changesSha256: "0".repeat(64) },
    { ...good, acceptedParent: "0".repeat(40) },
    { ...good, candidateTree: "0".repeat(40) },
  ];
  for (let i = 0; i < invalid.length; i++) {
    await assert.rejects(
      store.publish({
        taskId: task.taskId,
        requestId: `bad-${i}`,
        changes,
        check: invalid[i] as CheckReceipt,
      }),
    );
    assert.equal(await store.currentRevision(), baseline);
  }
});

test("scope and path escapes refuse before accepted mutation", async (t) => {
  const { store, baseline } = await fixture(t);
  const task = await store.openTask({ taskId: "task-a", agentId: "agent-a", scope: ["docs/"] });
  for (const path of [
    "../escape",
    "/absolute",
    "docs/../escape",
    "docs/.git/config",
    "docs-evil/file",
    "private.txt",
    "docs\\escape",
    "docs/./a.txt",
    "docs/\u0000bad",
  ]) {
    await assert.rejects(async () =>
      publish(store, task, "unsafe", [{ path, content: "forbidden" }]),
    );
    assert.equal(await store.currentRevision(), baseline);
  }
});

test("same-file concurrent conflict cannot silently overwrite the first accepted change", async (t) => {
  const { store } = await fixture(t);
  const a = await store.openTask({ taskId: "task-a", agentId: "agent-a", scope: ["docs/"] });
  const b = await store.openTask({ taskId: "task-b", agentId: "agent-b", scope: ["docs/"] });
  const accepted = await publish(store, a, "request-a", [
    { path: "docs/a.txt", content: "winner" },
  ]);
  await assert.rejects(
    publish(store, b, "request-b", [{ path: "docs/a.txt", content: "loser" }]),
    /PUBLICATION_CONFLICT/,
  );
  assert.equal(await store.currentRevision(), accepted.revision);
  assert.equal(await store.readAccepted("docs/a.txt"), "winner");
});

test("disjoint changes from a stale baseline integrate without losing either task", async (t) => {
  const { store } = await fixture(t);
  const a = await store.openTask({ taskId: "task-a", agentId: "agent-a", scope: ["docs/"] });
  const b = await store.openTask({ taskId: "task-b", agentId: "agent-b", scope: ["docs/"] });
  await publish(store, a, "request-a", [{ path: "docs/a.txt", content: "new-a" }]);
  await publish(store, b, "request-b", [{ path: "docs/b.txt", content: "new-b" }]);
  assert.equal(await store.readAccepted("docs/a.txt"), "new-a");
  assert.equal(await store.readAccepted("docs/b.txt"), "new-b");
});

test("replayed request returns exactly the same receipt and creates no new revision", async (t) => {
  const { root, store } = await fixture(t);
  const task = await store.openTask({ taskId: "task-a", agentId: "agent-a", scope: ["docs/"] });
  const changes = [{ path: "docs/a.txt", content: "once" }];
  const request = {
    taskId: task.taskId,
    requestId: "request-a",
    changes,
    check: await checked(store, task, changes),
  };
  const first = await store.publish(request);
  const reopened = new PublicationStore({ root });
  assert.deepEqual(await reopened.publish(request), first);
  assert.equal(await reopened.currentRevision(), first.revision);
  await assert.rejects(
    publish(reopened, task, "request-a", [{ path: "docs/a.txt", content: "twice" }]),
  );
});

test("reopen preserves task owner, baseline and scope; cannot silently widen or reassign", async (t) => {
  const { root, store } = await fixture(t);
  const args = { taskId: "task-a", agentId: "agent-a", scope: ["docs/"] };
  const task = await store.openTask(args);
  const reopened = new PublicationStore({ root });
  assert.deepEqual(await reopened.getTask("task-a"), task);
  assert.deepEqual(await reopened.openTask(args), task);
  await assert.rejects(reopened.openTask({ ...args, agentId: "different-agent" }));
  await assert.rejects(reopened.openTask({ ...args, scope: ["."] }));
  await reopened.initialize({ "docs/a.txt": "must-not-reset-existing-store" });
  assert.equal(await reopened.readAccepted("docs/a.txt"), "original-a");
});

test("concurrent independent store instances serialize publications without lost updates", async (t) => {
  const { root, store } = await fixture(t);
  const second = new PublicationStore({ root });
  const a = await store.openTask({ taskId: "task-a", agentId: "agent-a", scope: ["docs/"] });
  const b = await second.openTask({ taskId: "task-b", agentId: "agent-b", scope: ["docs/"] });
  async function retryFreshChecks(s: PublicationStore, task: Task, id: string, changes: Change[]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await publish(s, task, id, changes);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("CHECK_STALE") || attempt === 2)
          throw error;
      }
    }
    throw new Error("unreachable");
  }
  await Promise.all([
    retryFreshChecks(store, a, "request-a", [{ path: "docs/a.txt", content: "parallel-a" }]),
    retryFreshChecks(second, b, "request-b", [{ path: "docs/b.txt", content: "parallel-b" }]),
  ]);
  assert.equal(await store.readAccepted("docs/a.txt"), "parallel-a");
  assert.equal(await store.readAccepted("docs/b.txt"), "parallel-b");
});

test("deletion is scope-checked and conflicts with a later stale write", async (t) => {
  const { store } = await fixture(t);
  const a = await store.openTask({ taskId: "task-a", agentId: "agent-a", scope: ["docs/"] });
  const b = await store.openTask({ taskId: "task-b", agentId: "agent-b", scope: ["docs/"] });
  await publish(store, a, "request-delete", [{ path: "docs/a.txt", content: null }]);
  assert.equal(await store.readAccepted("docs/a.txt"), null);
  await assert.rejects(
    publish(store, b, "request-stale", [{ path: "docs/a.txt", content: "resurrect" }]),
    /PUBLICATION_CONFLICT/,
  );
});

test("digest is order-independent but duplicates are rejected", () => {
  const a = { path: "docs/a.txt", content: "a" },
    b = { path: "docs/b.txt", content: "b" };
  assert.equal(changesDigest([a, b]), changesDigest([b, a]));
  assert.throws(() => changesDigest([a, a]));
});

test("checks for an old combined candidate cannot authorize a new integrated tree", async (t) => {
  const { store } = await fixture(t);
  const a = await store.openTask({ taskId: "task-a", agentId: "agent-a", scope: ["docs/"] });
  const b = await store.openTask({ taskId: "task-b", agentId: "agent-b", scope: ["docs/"] });
  const changes = [{ path: "docs/b.txt", content: "new-b" }];
  const staleCheck = await checked(store, b, changes);
  const accepted = await publish(store, a, "request-a", [{ path: "docs/a.txt", content: "new-a" }]);
  await assert.rejects(
    store.publish({ taskId: b.taskId, requestId: "request-b", changes, check: staleCheck }),
    /CHECK_STALE/,
  );
  assert.equal(await store.currentRevision(), accepted.revision);
  assert.equal(await store.readAccepted("docs/b.txt"), "original-b");
  const freshCheck = await checked(store, b, changes);
  assert.notEqual(freshCheck.acceptedParent, staleCheck.acceptedParent);
  assert.notEqual(freshCheck.candidateTree, staleCheck.candidateTree);
});

test("simultaneous task registration cannot assign the same id to two owners", async (t) => {
  const { root, store } = await fixture(t);
  const other = new PublicationStore({ root });
  const results = await Promise.allSettled([
    store.openTask({ taskId: "same-task", agentId: "agent-a", scope: ["docs/"] }),
    other.openTask({ taskId: "same-task", agentId: "agent-b", scope: ["private.txt"] }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
});

function childOperation(root: string, expression: string) {
  const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const moduleUrl = new URL(`../src/index${extension}`, import.meta.url).href;
  const script = `import { PublicationStore } from ${JSON.stringify(moduleUrl)}; const store = new PublicationStore({root:${JSON.stringify(root)}}); process.stdout.write('ready\\n'); await new Promise(resolve => process.stdin.once('data', resolve)); process.stdin.pause(); try { const result = await (${expression}); console.log(JSON.stringify({ok:true,result})); } catch(e) { console.log(JSON.stringify({ok:false,error:String(e)})); }`;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "",
    stderr = "";
  let signalReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    signalReady = resolve;
  });
  child.stdout.on("data", (data) => {
    output += String(data);
    if (output.includes("ready\n")) signalReady?.();
  });
  child.stderr.on("data", (data) => {
    stderr += String(data);
  });
  const result = new Promise<{ ok: boolean; result?: Task | string; error?: string }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("child operation timeout"));
      }, 20000);
      child.on("error", (e) => {
        clearTimeout(timer);
        signalReady?.();
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signalReady?.();
        if (code !== 0) return reject(new Error(`child exit ${code}: ${stderr}`));
        try {
          resolve(JSON.parse(output.trim().split("\n").at(-1)!));
        } catch (e) {
          reject(e);
        }
      });
    },
  );
  return { ready, result, start: () => child.stdin.end("go\n") };
}

test("different OS processes cannot register the same task id with different owners", async (t) => {
  const { root, store } = await fixture(t);
  const a = childOperation(
    root,
    'store.openTask({taskId:"same-id",agentId:"agent-a",scope:["docs/"]})',
  );
  const b = childOperation(
    root,
    'store.openTask({taskId:"same-id",agentId:"agent-b",scope:["private.txt"]})',
  );
  await Promise.all([a.ready, b.ready]);
  a.start();
  b.start();
  const outcomes = await Promise.all([a.result, b.result]);
  const winners = outcomes.filter((x) => x.ok);
  assert.equal(winners.length, 1);
  assert.equal(outcomes.filter((x) => !x.ok).length, 1);
  assert.deepEqual(await store.getTask("same-id"), winners[0]!.result);
});

test("different OS processes initialize once and do not overwrite the winning seed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "throughline-initialize-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = childOperation(root, 'store.initialize({"winner.txt":"seed-a"})');
  const b = childOperation(root, 'store.initialize({"winner.txt":"seed-b"})');
  await Promise.all([a.ready, b.ready]);
  a.start();
  b.start();
  const outcomes = await Promise.all([a.result, b.result]);
  assert.equal(
    outcomes.every((x) => x.ok),
    true,
  );
  assert.equal(outcomes[0]!.result, outcomes[1]!.result);
  const store = new PublicationStore({ root });
  assert.ok(["seed-a", "seed-b"].includes((await store.readAccepted("winner.txt"))!));
  assert.equal(await store.currentRevision(), outcomes[0]!.result);
});

test("exception after accepted ref moves recovers the original receipt without publishing twice", async (t) => {
  const { root, store, baseline } = await fixture(t);
  const task = await store.openTask({ taskId: "task-a", agentId: "agent-a", scope: ["docs/"] });
  const changes = [{ path: "docs/a.txt", content: "accepted-before-response" }];
  const request = {
    taskId: task.taskId,
    requestId: "lost-response",
    changes,
    check: await checked(store, task, changes),
  };
  const instrumented = store as unknown as {
    git: (args: string[], input?: string, index?: string) => string;
  };
  const realGit = instrumented.git.bind(store);
  let threw = false;
  instrumented.git = (args, input, index) => {
    const result = realGit(args, input, index);
    if (args[0] === "update-ref" && !threw) {
      threw = true;
      throw new Error("INJECTED_RESPONSE_LOSS_AFTER_REF_UPDATE");
    }
    return result;
  };
  await assert.rejects(store.publish(request), /INJECTED_RESPONSE_LOSS_AFTER_REF_UPDATE/);
  const accepted = await store.currentRevision();
  assert.notEqual(accepted, baseline);
  const reopened = new PublicationStore({ root });
  const receipt = await reopened.publish(request);
  assert.equal(receipt.revision, accepted);
  assert.equal(await reopened.currentRevision(), accepted);
  assert.equal(await reopened.readAccepted("docs/a.txt"), "accepted-before-response");
  assert.equal(realGit(["rev-list", "--count", "refs/heads/accepted"]).trim(), "2");
});

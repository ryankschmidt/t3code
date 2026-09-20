import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicationStore, type PreparedPublication } from "../src/index.ts";

type Peer = { uid: number; gid: number; pid: number };
type Reply = { ok: boolean; result?: unknown; error?: { code: string } };
type Dispatch = (peer: Peer, raw: Uint8Array) => Promise<Reply>;
const worker = { uid: 1002, gid: 1002, pid: 20001 };
const reviewer = { uid: 1001, gid: 1001, pid: 20002 };
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "throughline-ipc-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new PublicationStore({ root: join(root, "publisher") });
  await store.initialize({ "help.txt": "accepted" });
  await store.openTask({ taskId: "task-a", agentId: "worker-a", scope: ["help.txt"] });
  const url = new URL(
    `../src/publisher-ipc${import.meta.url.endsWith(".ts") ? ".ts" : ".js"}`,
    import.meta.url,
  ).href;
  const module = (await import(url)) as {
    createPublisherDispatcher: (options: {
      store: PublicationStore;
      reviewsRoot: string;
      maxRequestBytes: number;
      resolvePrincipal: (
        peer: Peer,
      ) => Promise<{ id: string; kind: "worker" | "reviewer"; taskIds: string[] }>;
    }) => Dispatch;
  };
  const dispatch = module.createPublisherDispatcher({
    store,
    reviewsRoot: join(root, "reviews"),
    maxRequestBytes: 2048,
    resolvePrincipal: async (peer) => {
      if (peer.uid === 1002 && peer.pid === 20001)
        return { id: "worker-a", kind: "worker", taskIds: ["task-a"] };
      if (peer.uid === 1001 && peer.pid === 20002)
        return { id: "reviewer-a", kind: "reviewer", taskIds: ["task-a"] };
      throw new Error("unknown peer");
    },
  });
  const call = (peer: Peer, request: unknown) =>
    dispatch(peer, Buffer.from(JSON.stringify(request)));
  return { store, dispatch, call };
}
test("unknown peer and payload-supplied identity cannot authorize a request", async (t) => {
  const { call } = await fixture(t);
  assert.equal(
    (
      await call(
        { uid: 0, gid: 0, pid: 1 },
        { requestId: "r1", operation: "task.snapshot", taskId: "task-a" },
      )
    ).ok,
    false,
  );
  const result = await call(worker, {
    requestId: "r2",
    operation: "publication.review",
    taskId: "task-a",
    peer: reviewer,
    reviewerId: "reviewer-a",
    data: { passed: true },
  });
  assert.equal(result.ok, false);
});
test("snapshot is scoped to an authenticated principal's task grant", async (t) => {
  const { call } = await fixture(t);
  assert.equal(
    (await call(worker, { requestId: "r1", operation: "task.snapshot", taskId: "task-a" })).ok,
    true,
  );
  assert.equal(
    (await call(worker, { requestId: "r2", operation: "task.snapshot", taskId: "foreign-task" }))
      .ok,
    false,
  );
});
test("oversized, malformed, multi-message and unknown operations fail closed", async (t) => {
  const { dispatch, call } = await fixture(t);
  for (const bytes of [Buffer.from("{bad"), Buffer.alloc(2049, 65), Buffer.from("{}\n{}")])
    assert.equal((await dispatch(worker, bytes)).ok, false);
  assert.equal(
    (
      await call(worker, {
        requestId: "r1",
        operation: "shell.exec",
        taskId: "task-a",
        data: { command: "true" },
      })
    ).ok,
    false,
  );
});
test("worker cannot review; separate reviewer permits publication of exact stored bytes", async (t) => {
  const { call, store } = await fixture(t);
  const changes = [{ path: "help.txt", content: "checked over IPC" }];
  const preparedReply = await call(worker, {
    requestId: "prepare",
    operation: "publication.prepare",
    taskId: "task-a",
    data: { changes },
  });
  assert.equal(preparedReply.ok, true);
  const prepared = preparedReply.result as PreparedPublication;
  const reviewRequest = {
    requestId: "review",
    operation: "publication.review",
    taskId: "task-a",
    data: { changes, prepared, passed: true },
  };
  assert.equal((await call(worker, reviewRequest)).ok, false);
  const review = await call(reviewer, reviewRequest);
  assert.equal(review.ok, true);
  const reviewId = (review.result as { reviewId: string }).reviewId;
  assert.equal(
    (
      await call(worker, {
        requestId: "publish",
        operation: "publication.publish",
        taskId: "task-a",
        data: { reviewId },
      })
    ).ok,
    true,
  );
  assert.equal(await store.readAccepted("help.txt"), "checked over IPC");
});
test("publication cannot accept caller replacement bytes or caller-supplied check", async (t) => {
  const { call, store } = await fixture(t);
  assert.equal(
    (
      await call(worker, {
        requestId: "r1",
        operation: "publication.publish",
        taskId: "task-a",
        data: {
          reviewId: "pretend",
          changes: [{ path: "help.txt", content: "forged" }],
          check: { passed: true },
        },
      })
    ).ok,
    false,
  );
  assert.equal(await store.readAccepted("help.txt"), "accepted");
});
test("operation must be a string and single-object pretty multiline frames refuse", async (t) => {
  const { call, dispatch, store } = await fixture(t);
  const changes = [{ path: "help.txt", content: "reviewed" }];
  const prepared = (
    await call(worker, {
      requestId: "p",
      operation: "publication.prepare",
      taskId: "task-a",
      data: { changes },
    })
  ).result;
  const reviewed = await call(reviewer, {
    requestId: "r",
    operation: "publication.review",
    taskId: "task-a",
    data: { changes, prepared, passed: true },
  });
  const reviewId = (reviewed.result as { reviewId: string }).reviewId;
  assert.equal(
    (
      await call(worker, {
        requestId: "bad-op",
        operation: ["publication.publish"],
        taskId: "task-a",
        data: { reviewId },
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await dispatch(
        worker,
        Buffer.from(
          JSON.stringify(
            { requestId: "pretty", operation: "task.snapshot", taskId: "task-a" },
            null,
            2,
          ),
        ),
      )
    ).ok,
    false,
  );
  assert.equal(await store.readAccepted("help.txt"), "accepted");
});
test("review request replay returns the same id and changed content cannot reuse it", async (t) => {
  const { call } = await fixture(t);
  const changes = [{ path: "help.txt", content: "one" }];
  const prepared = (
    await call(worker, {
      requestId: "p",
      operation: "publication.prepare",
      taskId: "task-a",
      data: { changes },
    })
  ).result;
  const request = {
    requestId: "same-review",
    operation: "publication.review",
    taskId: "task-a",
    data: { changes, prepared, passed: true },
  };
  const a = await call(reviewer, request),
    b = await call(reviewer, request);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.deepEqual(a.result, b.result);
  const changed = [{ path: "help.txt", content: "two" }];
  const another = (
    await call(worker, {
      requestId: "p2",
      operation: "publication.prepare",
      taskId: "task-a",
      data: { changes: changed },
    })
  ).result;
  assert.equal(
    (
      await call(reviewer, {
        ...request,
        data: { changes: changed, prepared: another, passed: true },
      })
    ).ok,
    false,
  );
});

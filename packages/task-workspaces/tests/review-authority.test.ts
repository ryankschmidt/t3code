import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicationStore, type PreparedPublication } from "../src/index.ts";

// Server composition must supply this identity from authenticated transport.
// No claimed actor or passed:true supplied by a model is an authority source.
type Principal = { id: string; kind: "worker" | "reviewer"; taskIds: string[] };
type ReviewService = {
  recordReview(
    context: unknown,
    input: {
      taskId: string;
      requestId: string;
      changes: { path: string; content: string | null }[];
      prepared: PreparedPublication;
      passed: boolean;
    },
  ): Promise<{ reviewId: string }>;
  publish(
    context: unknown,
    input: { taskId: string; requestId: string; reviewId: string },
  ): Promise<{ status: string; revision: string }>;
};

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "throughline-review-authority-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new PublicationStore({ root: join(root, "publisher") });
  await store.initialize({ "help.txt": "accepted" });
  await store.openTask({ taskId: "task-a", agentId: "worker-a", scope: ["help.txt"] });
  // Import only this seam; absence is the first red witness, not a fake validator.
  const moduleUrl = new URL(
    `../src/review-authority${import.meta.url.endsWith(".ts") ? ".ts" : ".js"}`,
    import.meta.url,
  ).href;
  const mod = (await import(moduleUrl)) as {
    CheckedPublicationService: new (options: {
      store: PublicationStore;
      root: string;
      authenticate: (context: unknown) => Promise<Principal>;
    }) => ReviewService;
  };
  const service = new mod.CheckedPublicationService({
    store,
    root: join(root, "reviews"),
    authenticate: async (context) => {
      if (context === "worker") return { id: "worker-a", kind: "worker", taskIds: ["task-a"] };
      if (context === "reviewer")
        return { id: "reviewer-a", kind: "reviewer", taskIds: ["task-a"] };
      throw new Error("UNAUTHENTICATED");
    },
  });
  return { store, service };
}

async function reviewInput(store: PublicationStore, content: string, passed = true) {
  const changes = [{ path: "help.txt", content }];
  return {
    taskId: "task-a",
    requestId: "review-r1",
    changes,
    prepared: await store.preparePublication({ taskId: "task-a", changes }),
    passed,
  };
}
test("worker cannot issue its own accepted review even when it claims passed", async (t) => {
  const { store, service } = await fixture(t);
  await assert.rejects(service.recordReview("worker", await reviewInput(store, "draft")));
  assert.equal(await store.readAccepted("help.txt"), "accepted");
});
test("unknown transport principal and unknown review cannot publish", async (t) => {
  const { store, service } = await fixture(t);
  await assert.rejects(
    service.publish("untrusted", { taskId: "task-a", requestId: "r1", reviewId: "made-up" }),
  );
  await assert.rejects(
    service.publish("worker", { taskId: "task-a", requestId: "r2", reviewId: "made-up" }),
  );
  assert.equal(await store.readAccepted("help.txt"), "accepted");
});
test("worker publishes only bytes bound to a separate registered reviewer receipt", async (t) => {
  const { store, service } = await fixture(t);
  const review = await service.recordReview("reviewer", await reviewInput(store, "checked draft"));
  const receipt = await service.publish("worker", {
    taskId: "task-a",
    requestId: "r1",
    reviewId: review.reviewId,
  });
  assert.equal(receipt.status, "accepted");
  assert.equal(await store.readAccepted("help.txt"), "checked draft");
});
test("negative reviewer result cannot authorize publication", async (t) => {
  const { store, service } = await fixture(t);
  let review: { reviewId: string } | undefined;
  try {
    review = await service.recordReview(
      "reviewer",
      await reviewInput(store, "rejected draft", false),
    );
  } catch {}
  if (review)
    await assert.rejects(
      service.publish("worker", { taskId: "task-a", requestId: "r1", reviewId: review.reviewId }),
    );
  assert.equal(await store.readAccepted("help.txt"), "accepted");
});
test("review cannot silently certify a different candidate after the accepted parent changes", async (t) => {
  const { store, service } = await fixture(t);
  const oldReview = await reviewInput(store, "checked against old parent");
  const other = await store.openTask({
    taskId: "task-b",
    agentId: "worker-b",
    scope: ["other.txt"],
  });
  const changes = [{ path: "other.txt", content: "intervening accepted dependency" }];
  const prepared = await store.preparePublication({ taskId: other.taskId, changes });
  await store.publish({
    taskId: other.taskId,
    requestId: "other-publication",
    changes,
    check: { ...prepared, passed: true, reviewerId: "reviewer-b" },
  });
  await assert.rejects(service.recordReview("reviewer", oldReview), /CHECK_STALE/);
  assert.equal(await store.readAccepted("help.txt"), "accepted");
});

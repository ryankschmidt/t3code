import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, link, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  changesDigest,
  PublicationError,
  type Change,
  type CheckReceipt,
  type PreparedPublication,
  type PublicationReceipt,
  type PublicationStore,
} from "./index.ts";

export type Principal = { id: string; kind: "worker" | "reviewer"; taskIds: string[] };
type Review = {
  schema: "checked-publication-review.v1";
  reviewId: string;
  requestId: string;
  requestDigest: string;
  changes: Change[];
  check: CheckReceipt;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Options = {
  store: PublicationStore;
  root: string;
  authenticate: (context: unknown) => Promise<Principal>;
};

function refuse(code: string): never {
  throw new PublicationError(code);
}
function identifier(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))
    refuse("INVALID_IDENTIFIER");
}
function snapshot(changes: Change[]): Change[] {
  changesDigest(changes);
  return changes
    .map((c) => ({ path: c.path, content: c.content }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** A trusted transport authenticator supplies principals. This service never authenticates claimed actor text. */
export class CheckedPublicationService {
  private readonly store: PublicationStore;
  private readonly root: string;
  private readonly authenticate: Options["authenticate"];
  constructor(options: Options) {
    this.store = options.store;
    this.root = resolve(options.root);
    this.authenticate = options.authenticate;
  }
  private async principal(
    context: unknown,
    taskId: string,
    kind: Principal["kind"],
  ): Promise<Principal> {
    const identity = await this.authenticate(context);
    if (
      !identity ||
      identity.kind !== kind ||
      !Array.isArray(identity.taskIds) ||
      !identity.taskIds.includes(taskId)
    )
      refuse("NOT_AUTHORIZED");
    identifier(identity.id);
    // Do not retain authenticator-owned mutable arrays across later awaits.
    return { id: identity.id, kind: identity.kind, taskIds: [...identity.taskIds] };
  }
  async recordReview(
    context: unknown,
    input: {
      taskId: string;
      requestId: string;
      changes: Change[];
      passed: boolean;
      prepared: PreparedPublication;
    },
  ): Promise<{ reviewId: string }> {
    const taskId = input.taskId;
    const requestId = input.requestId;
    identifier(taskId);
    identifier(requestId);
    if (input.passed !== true) refuse("REVIEW_FAILED");
    const changes = snapshot(input.changes);
    const supplied = input.prepared;
    if (
      !supplied ||
      typeof supplied !== "object" ||
      supplied.taskId !== taskId ||
      typeof supplied.baseline !== "string" ||
      !/^[a-f0-9]{40,64}$/.test(supplied.baseline) ||
      typeof supplied.acceptedParent !== "string" ||
      !/^[a-f0-9]{40,64}$/.test(supplied.acceptedParent) ||
      typeof supplied.candidateTree !== "string" ||
      !/^[a-f0-9]{40,64}$/.test(supplied.candidateTree) ||
      supplied.changesSha256 !== changesDigest(changes)
    )
      refuse("INVALID_PREPARED_REVIEW");
    const reviewed: PreparedPublication = {
      taskId: supplied.taskId,
      baseline: supplied.baseline,
      acceptedParent: supplied.acceptedParent,
      candidateTree: supplied.candidateTree,
      changesSha256: supplied.changesSha256,
    };
    const reviewer = await this.principal(context, taskId, "reviewer");
    const task = await this.store.getTask(taskId);
    if (!task) refuse("TASK_NOT_FOUND");
    if (task.agentId === reviewer.id) refuse("SELF_REVIEW");
    if (task.baseline !== reviewed.baseline) refuse("INVALID_PREPARED_REVIEW");
    const reviewId = digest({ reviewerId: reviewer.id, requestId });
    const requestDigest = digest({
      taskId,
      changes,
      prepared: reviewed,
      reviewerId: reviewer.id,
      passed: true,
    });
    const recordPath = join(this.root, `${reviewId}.json`);
    const replay = async (): Promise<{ reviewId: string } | null> => {
      let existing: Review;
      try {
        existing = JSON.parse(await readFile(recordPath, "utf8")) as Review;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
      if (
        !existing ||
        existing.schema !== "checked-publication-review.v1" ||
        existing.reviewId !== reviewId ||
        existing.requestId !== requestId ||
        existing.requestDigest !== requestDigest
      )
        refuse("REQUEST_REUSED");
      return { reviewId: existing.reviewId };
    };
    const previous = await replay();
    if (previous) return previous;
    if ((await this.store.currentRevision()) !== reviewed.acceptedParent) refuse("CHECK_STALE");
    const prepared = await this.store.preparePublication({ taskId, changes });
    if (prepared.acceptedParent !== reviewed.acceptedParent) refuse("CHECK_STALE");
    if (
      prepared.candidateTree !== reviewed.candidateTree ||
      prepared.changesSha256 !== reviewed.changesSha256
    )
      refuse("INVALID_PREPARED_REVIEW");
    const review: Review = {
      schema: "checked-publication-review.v1",
      reviewId,
      requestId,
      requestDigest,
      changes,
      check: { ...prepared, passed: true, reviewerId: reviewer.id },
    };
    // This directory is publisher-owned, never allocated to a worker.
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const temporary = join(this.root, `${reviewId}-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(review));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      try {
        await link(temporary, recordPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const winner = await replay();
        if (!winner) refuse("REVIEW_RACE_LOST");
        return winner;
      }
      const directory = await open(this.root, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await rm(temporary, { force: true });
    }
    return { reviewId };
  }
  async publish(
    context: unknown,
    input: { taskId: string; requestId: string; reviewId: string },
  ): Promise<PublicationReceipt> {
    const { taskId, requestId, reviewId } = input;
    identifier(taskId);
    identifier(requestId);
    identifier(reviewId);
    if (Object.keys(input).some((key) => !["taskId", "requestId", "reviewId"].includes(key)))
      refuse("INVALID_PUBLICATION_INPUT");
    const worker = await this.principal(context, taskId, "worker");
    const task = await this.store.getTask(taskId);
    if (!task) refuse("TASK_NOT_FOUND");
    if (task.agentId !== worker.id) refuse("NOT_TASK_OWNER");
    let review: Review;
    try {
      review = JSON.parse(await readFile(join(this.root, `${reviewId}.json`), "utf8")) as Review;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") refuse("REVIEW_NOT_FOUND");
      throw error;
    }
    if (
      !review ||
      review.schema !== "checked-publication-review.v1" ||
      review.reviewId !== reviewId ||
      !review.check ||
      review.check.passed !== true ||
      review.check.taskId !== taskId ||
      review.check.baseline !== task.baseline ||
      review.check.reviewerId === worker.id
    )
      refuse("INVALID_REVIEW");
    const changes = snapshot(review.changes);
    if (changesDigest(changes) !== review.check.changesSha256) refuse("INVALID_REVIEW");
    return this.store.publish({ taskId, requestId, changes, check: review.check });
  }
}

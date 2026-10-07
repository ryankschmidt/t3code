import { TextDecoder } from "node:util";
import { CheckedPublicationService, type Principal } from "./review-authority.ts";
import {
  PublicationError,
  type Change,
  type PreparedPublication,
  type PublicationStore,
} from "./index.ts";

export type KernelPeer = Readonly<{ uid: number; gid: number; pid: number }>;
type Reply =
  | { ok: true; requestId: string; result: unknown }
  | { ok: false; requestId?: string; error: { code: string } };
type Options = {
  store: PublicationStore;
  reviewsRoot: string;
  maxRequestBytes?: number;
  /** Must resolve a live supervisor-issued identity/grant from the kernel peer. Never use request fields. */
  resolvePrincipal: (peer: KernelPeer) => Promise<Principal>;
};
const decoder = new TextDecoder("utf-8", { fatal: true });
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function fail(code: string): never {
  throw new PublicationError(code);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_REQUEST");
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail("UNEXPECTED_FIELD");
}
function id(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) fail("INVALID_IDENTIFIER");
  return value;
}
function peerSnapshot(peer: KernelPeer): KernelPeer {
  if (
    !peer ||
    !Number.isSafeInteger(peer.uid) ||
    peer.uid < 0 ||
    !Number.isSafeInteger(peer.gid) ||
    peer.gid < 0 ||
    !Number.isSafeInteger(peer.pid) ||
    peer.pid <= 0
  )
    fail("INVALID_KERNEL_PEER");
  return Object.freeze({ uid: peer.uid, gid: peer.gid, pid: peer.pid });
}

/** Library dispatcher. Production must supply kernel peer facts via the locked socket-activation wrapper. */
export function createPublisherDispatcher(
  options: Options,
): (peer: KernelPeer, bytes: Uint8Array) => Promise<Reply> {
  const limit = options.maxRequestBytes ?? 64 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1024 * 1024)
    fail("INVALID_REQUEST_LIMIT");
  return async (peer, bytes) => {
    let requestId: string | undefined;
    try {
      const verifiedPeer = peerSnapshot(peer);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > limit)
        fail("REQUEST_SIZE_REFUSED");
      let input: Record<string, unknown>;
      try {
        const text = decoder.decode(bytes);
        const frame = text.endsWith("\n") ? text.slice(0, -1) : text;
        if (frame.includes("\n") || frame.includes("\r")) fail("MULTILINE_REFUSED");
        input = record(JSON.parse(frame));
      } catch {
        fail("INVALID_REQUEST");
      }
      only(input, ["requestId", "operation", "taskId", "data"]);
      requestId = id(input.requestId);
      const taskId = id(input.taskId);
      const operation = input.operation;
      if (
        typeof operation !== "string" ||
        ![
          "task.snapshot",
          "publication.prepare",
          "publication.review",
          "publication.publish",
        ].includes(operation)
      )
        fail("UNKNOWN_OPERATION");
      let principal: Principal;
      try {
        principal = await options.resolvePrincipal(verifiedPeer);
      } catch {
        fail("UNAUTHENTICATED");
      }
      if (
        !principal ||
        !["worker", "reviewer"].includes(principal.kind) ||
        !Array.isArray(principal.taskIds) ||
        !principal.taskIds.includes(taskId)
      )
        fail("NOT_AUTHORIZED");
      principal = { id: id(principal.id), kind: principal.kind, taskIds: [...principal.taskIds] };
      const task = await options.store.getTask(taskId);
      if (!task) fail("TASK_NOT_FOUND");
      if (principal.kind === "worker" && principal.id !== task.agentId) fail("NOT_TASK_OWNER");
      // One resolved transport identity for this request; no second mutable lookup after awaits.
      const authenticated = principal;
      const reviews = new CheckedPublicationService({
        store: options.store,
        root: options.reviewsRoot,
        authenticate: async () => authenticated,
      });
      let result: unknown;
      if (operation === "task.snapshot") {
        if (input.data !== undefined) fail("UNEXPECTED_FIELD");
        result = { task, acceptedRevision: await options.store.currentRevision() };
      } else {
        const data = record(input.data);
        if (operation === "publication.prepare") {
          only(data, ["changes"]);
          result = await options.store.preparePublication({
            taskId,
            changes: data.changes as Change[],
          });
        } else if (operation === "publication.review") {
          only(data, ["changes", "prepared", "passed"]);
          result = await reviews.recordReview(verifiedPeer, {
            taskId,
            requestId,
            changes: data.changes as Change[],
            prepared: data.prepared as PreparedPublication,
            passed: data.passed === true,
          });
        } else {
          only(data, ["reviewId"]);
          result = await reviews.publish(verifiedPeer, {
            taskId,
            requestId,
            reviewId: id(data.reviewId),
          });
        }
      }
      return { ok: true, requestId, result };
    } catch (error) {
      return {
        ok: false,
        ...(requestId ? { requestId } : {}),
        error: { code: error instanceof PublicationError ? error.code : "INTERNAL_ERROR" },
      };
    }
  };
}

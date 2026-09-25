import { createHash } from "node:crypto";
import { join } from "node:path";
import { readProtectedJson } from "./protected-files.ts";
import { ProtectedDatabase, type ProtectedDatabaseOptions } from "./protected-database.ts";
import type { Task } from "./index.ts";
import type { KernelPeer } from "./publisher-ipc.ts";
import type { Principal } from "./review-authority.ts";
import type { GrantClearance, GrantClearanceReader } from "./inference-authorizer.ts";

export type OperatorTarget = {
  schema: "throughline.operator-target.v1";
  targetId: string;
  statement: string;
};
export type LaunchRequest = {
  requestId: string;
  taskId: string;
  requesterId: string;
  targetId: string;
  finishLine: string;
  tokenCeiling: number;
  allowedModels: string[];
  allowedEfforts: string[];
};
export type LaunchRuling = {
  requestId: string;
  requestDigest: string;
  judgeId: string;
  verdict: "serves" | "does-not-serve";
  reason: string;
};
export type LaunchClearance = {
  clearanceId: string;
  request: LaunchRequest;
  requestDigest: string;
  ruling: LaunchRuling;
  target: OperatorTarget;
};
export type LaunchClearanceOptions = ProtectedDatabaseOptions & {
  /** Folder of <targetId>.json operator targets. Nothing in this package writes it. */
  targetsRoot: string;
  /** Owner the target files and their folders must have: root (the default) on the tower. */
  targetsOwnerUid?: number;
  tasks: { getTask(taskId: string): Promise<Task | null> };
  /** Kernel peer to principal: the same resolver the publisher uses for reviewers. */
  resolvePrincipal: (peer: KernelPeer) => Promise<Principal>;
};

const FIELDS = [
  "requestId",
  "taskId",
  "requesterId",
  "targetId",
  "finishLine",
  "tokenCeiling",
  "allowedModels",
  "allowedEfforts",
];
const RULING_FIELDS = ["requestId", "requestDigest", "verdict", "reason"];
const SCHEMA =
  "CREATE TABLE launch_requests(request_id TEXT PRIMARY KEY,digest TEXT NOT NULL,request TEXT NOT NULL); CREATE TABLE launch_rulings(request_id TEXT PRIMARY KEY REFERENCES launch_requests(request_id),ruling TEXT NOT NULL); CREATE TABLE grant_clearances(grant_id TEXT PRIMARY KEY,request_id TEXT NOT NULL REFERENCES launch_requests(request_id));";

function refuse(code: string): never {
  throw Error(code);
}
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim() !== "" && value.length <= max;
function names(value: unknown, max: number): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > max ||
    new Set(value).size !== value.length ||
    value.some((name) => typeof name !== "string" || name.length < 1 || name.length > 256)
  )
    refuse("INVALID_LAUNCH_REQUEST");
  return [...(value as string[])].sort();
}
/** JSON with object keys sorted at every level; array order is kept. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** sha256 of the request's canonical JSON: what a ruling names and what launch re-checks. */
export function launchRequestDigest(request: LaunchRequest): string {
  return createHash("sha256").update(canonical(request)).digest("hex");
}
/** Validates and normalizes a request. The same check runs at submission and at launch. */
function launchRequest(value: unknown): LaunchRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse("INVALID_LAUNCH_REQUEST");
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some((key) => !FIELDS.includes(key))) refuse("INVALID_LAUNCH_REQUEST");
  if (typeof r.finishLine !== "string" || r.finishLine.trim() === "") refuse("FINISH_LINE_MISSING");
  if (
    r.finishLine.length > 4000 ||
    ![r.requestId, r.taskId, r.requesterId, r.targetId].every(identifier) ||
    !Number.isSafeInteger(r.tokenCeiling) ||
    (r.tokenCeiling as number) <= 0
  )
    refuse("INVALID_LAUNCH_REQUEST");
  return {
    requestId: r.requestId as string,
    taskId: r.taskId as string,
    requesterId: r.requesterId as string,
    targetId: r.targetId as string,
    finishLine: r.finishLine,
    tokenCeiling: r.tokenCeiling as number,
    allowedModels: names(r.allowedModels, 256),
    allowedEfforts: names(r.allowedEfforts, 32),
  };
}

/**
 * Operator targets, launch requests, rulings and the clearance recorded with each grant. Targets
 * are read-only files; a request is bound to its ruling by digest; a ruling's judge comes only
 * from the kernel peer, never from the ruling's text.
 */
export class LaunchClearanceStore implements GrantClearanceReader {
  private readonly store: ProtectedDatabase;
  private readonly db: ProtectedDatabase["db"];
  private readonly targetsRoot: string;
  private readonly targetsOwnerUid: number;
  private readonly getTask: LaunchClearanceOptions["tasks"]["getTask"];
  private readonly resolvePrincipal: LaunchClearanceOptions["resolvePrincipal"];
  private constructor(store: ProtectedDatabase, options: LaunchClearanceOptions) {
    this.store = store;
    this.db = store.db;
    this.targetsRoot = options.targetsRoot;
    this.targetsOwnerUid = options.targetsOwnerUid ?? 0;
    this.getTask = options.tasks.getTask.bind(options.tasks);
    this.resolvePrincipal = options.resolvePrincipal;
  }
  /** Creates clearances.sqlite on first use; the folder must already be protected. */
  static async open(options: LaunchClearanceOptions): Promise<LaunchClearanceStore> {
    const store = await ProtectedDatabase.open(
      options,
      "clearances.sqlite",
      "LAUNCH_CLEARANCE",
      SCHEMA,
    );
    return new LaunchClearanceStore(store, options);
  }
  close() {
    this.store.close();
  }
  /** A target is admitted only as an intact file its owner alone can write. */
  private async target(targetId: string): Promise<OperatorTarget> {
    try {
      const t = (await readProtectedJson(
        join(this.targetsRoot, `${targetId}.json`),
        this.targetsOwnerUid,
        16384,
      )) as Record<string, unknown> | null;
      if (
        !t ||
        t.schema !== "throughline.operator-target.v1" ||
        t.targetId !== targetId ||
        !text(t.statement, 16000)
      )
        throw Error();
      return { schema: t.schema, targetId, statement: t.statement };
    } catch {
      return refuse("TARGET_NOT_ADMITTED");
    }
  }
  private stored(requestId: string): { request: LaunchRequest; digest: string } | null {
    const row = this.db
      .prepare("SELECT digest,request FROM launch_requests WHERE request_id=?")
      .get(requestId);
    if (!row) return null;
    return {
      request: launchRequest(JSON.parse(row.request as string)),
      digest: row.digest as string,
    };
  }
  /** The principal the kernel peer resolves to; never a name the caller supplies. */
  private async principal(peer: KernelPeer): Promise<Principal> {
    let principal: Principal;
    try {
      principal = await this.resolvePrincipal(
        Object.freeze({ uid: peer.uid, gid: peer.gid, pid: peer.pid }),
      );
    } catch {
      return refuse("NOT_AUTHORIZED");
    }
    if (!principal || !identifier(principal.id) || !Array.isArray(principal.taskIds))
      refuse("NOT_AUTHORIZED");
    return { id: principal.id, kind: principal.kind, taskIds: [...principal.taskIds] };
  }
  /**
   * The requester is the principal the submitting kernel peer resolves to, and the request must
   * name exactly that principal. The same request again is a no-op.
   */
  async submitRequest(
    peer: KernelPeer,
    input: unknown,
  ): Promise<{ requestId: string; requestDigest: string }> {
    const request = launchRequest(input);
    const requester = await this.principal(peer);
    if (request.requesterId !== requester.id) refuse("REQUESTER_MISMATCH");
    await this.target(request.targetId);
    if (!(await this.getTask(request.taskId))) refuse("TASK_NOT_FOUND");
    const digest = launchRequestDigest(request);
    await this.store.check();
    this.store.transaction(() => {
      const row = this.db
        .prepare("SELECT digest FROM launch_requests WHERE request_id=?")
        .get(request.requestId);
      if (row) {
        if (row.digest !== digest) refuse("LAUNCH_REQUEST_REUSED");
        return;
      }
      this.db
        .prepare("INSERT INTO launch_requests(request_id,digest,request) VALUES(?,?,?)")
        .run(request.requestId, digest, JSON.stringify(request));
    });
    return { requestId: request.requestId, requestDigest: digest };
  }
  /** The judge is the reviewer the kernel peer resolves to; a ruling, once recorded, is fixed. */
  async recordRuling(
    peer: KernelPeer,
    input: { requestId: string; requestDigest: string; verdict: string; reason: string },
  ): Promise<LaunchRuling> {
    if (
      !input ||
      typeof input !== "object" ||
      Object.keys(input).some((key) => !RULING_FIELDS.includes(key)) ||
      !identifier(input.requestId) ||
      typeof input.requestDigest !== "string" ||
      (input.verdict !== "serves" && input.verdict !== "does-not-serve") ||
      !text(input.reason, 4000)
    )
      refuse("INVALID_RULING");
    await this.store.check();
    const stored = this.stored(input.requestId);
    if (!stored) refuse("LAUNCH_REQUEST_NOT_FOUND");
    const judge = await this.principal(peer);
    if (judge.kind !== "reviewer" || !judge.taskIds.includes(stored.request.taskId))
      refuse("NOT_AUTHORIZED");
    if (input.requestDigest !== stored.digest) refuse("CLEARANCE_DIGEST_MISMATCH");
    const task = await this.getTask(stored.request.taskId);
    if (!task) refuse("TASK_NOT_FOUND");
    if (judge.id === stored.request.requesterId || judge.id === task.agentId) refuse("SELF_RULING");
    const ruling: LaunchRuling = {
      requestId: input.requestId,
      requestDigest: stored.digest,
      judgeId: judge.id,
      verdict: input.verdict,
      reason: input.reason,
    };
    const recorded = JSON.stringify(ruling);
    await this.store.check();
    this.store.transaction(() => {
      const row = this.db
        .prepare("SELECT ruling FROM launch_rulings WHERE request_id=?")
        .get(ruling.requestId);
      if (row) {
        if (row.ruling !== recorded) refuse("RULING_ALREADY_RECORDED");
        return;
      }
      this.db
        .prepare("INSERT INTO launch_rulings(request_id,ruling) VALUES(?,?)")
        .run(ruling.requestId, recorded);
    });
    return ruling;
  }
  /**
   * The supervisor's launch gate: an admitted target, a written finish line, a "serves" ruling
   * from a principal who is neither the requester nor the task's agent, and a request that still
   * has the digest the ruling named.
   */
  async verifyClearance(
    clearanceId: string,
    expected: { taskId: string; agentId: string },
  ): Promise<LaunchClearance> {
    if (!identifier(clearanceId)) refuse("CLEARANCE_NOT_FOUND");
    await this.store.check();
    const row = this.db
      .prepare("SELECT digest,request FROM launch_requests WHERE request_id=?")
      .get(clearanceId);
    if (!row) refuse("CLEARANCE_NOT_FOUND");
    const request = launchRequest(JSON.parse(row.request as string));
    if (request.requestId !== clearanceId || request.taskId !== expected.taskId)
      refuse("CLEARANCE_TASK_MISMATCH");
    const target = await this.target(request.targetId);
    const rulingRow = this.db
      .prepare("SELECT ruling FROM launch_rulings WHERE request_id=?")
      .get(clearanceId);
    if (!rulingRow) refuse("RULING_MISSING");
    const ruling = JSON.parse(rulingRow.ruling as string) as LaunchRuling;
    const digest = launchRequestDigest(request);
    if (digest !== row.digest || ruling.requestDigest !== digest)
      refuse("CLEARANCE_DIGEST_MISMATCH");
    if (ruling.judgeId === request.requesterId || ruling.judgeId === expected.agentId)
      refuse("SELF_RULING");
    if (ruling.verdict !== "serves") refuse("RULING_NOT_SERVES");
    return { clearanceId, request, requestDigest: digest, ruling, target };
  }
  /** Grant-issuing path only. The same binding again is a no-op; a different one is refused. */
  async bindGrant(input: { grantId: string; clearanceId: string }): Promise<void> {
    if (!identifier(input.grantId) || !identifier(input.clearanceId))
      refuse("INVALID_GRANT_BINDING");
    await this.store.check();
    this.store.transaction(() => {
      const row = this.db
        .prepare("SELECT request_id FROM grant_clearances WHERE grant_id=?")
        .get(input.grantId);
      if (row) {
        if (row.request_id !== input.clearanceId) refuse("GRANT_ALREADY_BOUND");
        return;
      }
      this.db
        .prepare("INSERT INTO grant_clearances(grant_id,request_id) VALUES(?,?)")
        .run(input.grantId, input.clearanceId);
    });
  }
  /** For the inference authorizer: the task and models the grant's clearance allowed. */
  async grantClearance(grantId: string): Promise<GrantClearance | null> {
    if (!identifier(grantId)) return null;
    await this.store.check();
    const row = this.db
      .prepare(
        "SELECT r.request FROM grant_clearances g JOIN launch_requests r ON r.request_id=g.request_id WHERE g.grant_id=?",
      )
      .get(grantId);
    if (!row) return null;
    const request = launchRequest(JSON.parse(row.request as string));
    return {
      taskId: request.taskId,
      allowedModels: request.allowedModels,
      allowedEfforts: request.allowedEfforts,
    };
  }
}

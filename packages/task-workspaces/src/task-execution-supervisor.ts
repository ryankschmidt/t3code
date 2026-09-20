import { createHash } from "node:crypto";
import { isAbsolute, join, normalize } from "node:path";
import {
  systemdExecutionPlan,
  type ExecutionBinding,
  type ExecutionProfile,
} from "./systemd-execution.ts";
import type { PublicationStore, Task, WorkspaceAllocation } from "./index.ts";
import type { ExecutionGrantAuthority, GrantState } from "./execution-grant-authority.ts";
import type { ExecutionIdentity } from "./execution-grants.ts";

/** Caller atomically deduplicates a shared key and persists its serializable result. */
export type DurableExecutionStep = <T>(key: string, effect: () => Promise<T>) => Promise<T>;
export type ExecutionInspection = {
  invocationId: string;
  pid: number;
  identity: ExecutionIdentity;
  workspace: string;
};
export type SupervisorHost = {
  prepare(
    binding: ExecutionBinding,
    profile: ExecutionProfile,
  ): Promise<{ workspaceRoot: string; workspacePath: string }>;
  launch(binding: ExecutionBinding, profile: ExecutionProfile): Promise<unknown>;
  /** Idempotent channel-readiness/reattachment check; throw if the channel cannot be recovered. */
  ready(binding: ExecutionBinding): Promise<{ pid: number }>;
  /** null means confirmed absence, never a transport/ownership error. */
  inspect(
    binding: ExecutionBinding,
    profile: ExecutionProfile,
  ): Promise<ExecutionInspection | null>;
  release(binding: ExecutionBinding, grant: { grantId: string; expiresAt: number }): Promise<void>;
  stop(binding: ExecutionBinding, profile: ExecutionProfile, invocationId: string): Promise<void>;
};
export type TaskExecutionInput = ExecutionBinding & {
  scope: string[];
  profile: ExecutionProfile;
  expiresAt: number;
  grantId: string;
  issueRequestId: string;
  revokeRequestId: string;
};
type Options = {
  store: Pick<PublicationStore, "getTask" | "materializeTask">;
  authority: Pick<ExecutionGrantAuthority, "issue" | "read" | "revoke">;
  host: SupervisorHost;
  step: DurableExecutionStep;
  now?: () => number;
};
type CleanupReport = {
  revocation: "revoked" | "absent" | "unconfirmed" | "binding-mismatch";
  process: "stopped" | "not-running" | "unconfirmed" | "different-invocation";
};
type Recovery = {
  status: "recovery-required";
  reason: string;
  cleanup: "stopped" | "pending";
  cleanupDetail: CleanupReport;
  planDigest: string;
  binding: ExecutionBinding;
  grantId: string;
  execution: ExecutionInspection | null;
};
type Admission = {
  input: TaskExecutionInput;
  binding: ExecutionBinding;
  task: Task;
  planDigest: string;
  key: string;
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function refuse(code: string): never {
  throw Error(code);
}
function identifier(value: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))
    refuse("INVALID_SUPERVISOR_IDENTIFIER");
}
function scope(values: string[]) {
  if (
    !Array.isArray(values) ||
    !values.length ||
    new Set(values).size !== values.length ||
    values.some((v) => typeof v !== "string" || !v)
  )
    refuse("INVALID_SUPERVISOR_SCOPE");
  return [...values].sort();
}
function plain(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return refuse("NON_SERIALIZABLE_EXECUTION_REFERENCE");
}
function identity(value: ExecutionIdentity) {
  return {
    uid: value.uid,
    gid: value.gid,
    bootId: value.bootId,
    cgroup: value.cgroup,
    leaderPid: value.leaderPid,
    leaderStartTicks: value.leaderStartTicks,
  };
}
function sameExecution(a: ExecutionInspection, b: ExecutionInspection) {
  return (
    a.invocationId === b.invocationId &&
    a.pid === b.pid &&
    a.workspace === b.workspace &&
    hash(identity(a.identity)) === hash(identity(b.identity))
  );
}
function allocationBinding(a: WorkspaceAllocation) {
  return {
    taskId: a.taskId,
    agentId: a.agentId,
    baseline: a.baseline,
    scope: scope(a.scope),
    path: a.path,
    status: a.status,
  };
}

/** Coordinates existing owners. The supplied durable step engine owns progress; no local task journal. */
export class TaskExecutionSupervisor {
  private readonly options: Options;
  constructor(options: Options) {
    this.options = { ...options };
  }
  private instant() {
    const now = (this.options.now ?? Date.now)();
    if (!Number.isSafeInteger(now)) refuse("INVALID_SUPERVISOR_CLOCK");
    return now;
  }
  private async admit(value: TaskExecutionInput): Promise<Admission> {
    const input = structuredClone(value);
    const fields = [
      "agentId",
      "taskId",
      "runId",
      "scope",
      "profile",
      "expiresAt",
      "grantId",
      "issueRequestId",
      "revokeRequestId",
    ];
    if (Object.keys(input).some((k) => !fields.includes(k))) refuse("UNKNOWN_SUPERVISOR_FIELD");
    for (const key of [
      "agentId",
      "taskId",
      "runId",
      "grantId",
      "issueRequestId",
      "revokeRequestId",
    ] as const)
      identifier(input[key]);
    if (input.issueRequestId === input.revokeRequestId) refuse("GRANT_REQUEST_IDS_MUST_DIFFER");
    input.scope = scope(input.scope);
    const binding = { agentId: input.agentId, taskId: input.taskId, runId: input.runId };
    systemdExecutionPlan(binding, input.profile); // Validate a trusted pinned profile, never execute it here.
    input.profile = {
      id: input.profile.id,
      executable: input.profile.executable,
      executableSha256: input.profile.executableSha256,
      args: [...input.profile.args],
      memoryBytes: input.profile.memoryBytes,
      cpuPercent: input.profile.cpuPercent,
      maxSeconds: input.profile.maxSeconds,
      tasksMax: input.profile.tasksMax,
    };
    Object.freeze(input.profile.args);
    Object.freeze(input.profile);
    Object.freeze(binding);
    if (!Number.isSafeInteger(input.expiresAt)) refuse("INVALID_EXECUTION_DEADLINE");
    const task = await this.options.store.getTask(input.taskId);
    if (!task || task.agentId !== input.agentId || hash(scope(task.scope)) !== hash(input.scope))
      refuse("TASK_ADMISSION_REFUSED");
    const planDigest = hash({
      binding,
      scope: input.scope,
      profile: input.profile,
      expiresAt: input.expiresAt,
      grantId: input.grantId,
      issueRequestId: input.issueRequestId,
      revokeRequestId: input.revokeRequestId,
      baseline: task.baseline,
    });
    const key = `execution:${hash({ runId: input.runId })}`;
    const pinned = await this.options.step(`${key}:admission`, async () => ({ planDigest }));
    if (pinned.planDigest !== planDigest) refuse("EXECUTION_PLAN_CHANGED");
    return { input, binding, task, planDigest, key };
  }
  private checkInspection(
    value: ExecutionInspection | null,
    workspace: string,
  ): ExecutionInspection {
    if (
      !value ||
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 0 ||
      !/^[a-f0-9]{32}$/.test(value.invocationId) ||
      value.identity.leaderPid !== value.pid ||
      value.workspace !== workspace
    )
      refuse("EXECUTION_INSPECTION_MISMATCH");
    return structuredClone(value);
  }
  private grantMatches(state: GrantState, a: Admission, execution: ExecutionInspection) {
    const grant = state.grant;
    return (
      grant.grantId === a.input.grantId &&
      grant.principal.id === a.input.agentId &&
      grant.principal.kind === "worker" &&
      hash(grant.principal.taskIds) === hash([a.input.taskId]) &&
      hash(identity(grant)) === hash(identity(execution.identity))
    );
  }
  private async current(a: Admission, execution: ExecutionInspection) {
    const task = await this.options.store.getTask(a.input.taskId);
    if (
      !task ||
      task.agentId !== a.input.agentId ||
      task.baseline !== a.task.baseline ||
      hash(scope(task.scope)) !== hash(a.input.scope)
    )
      refuse("TASK_ADMISSION_CHANGED");
    const state = await this.options.authority.read(a.input.grantId);
    if (
      !state ||
      !this.grantMatches(state, a, execution) ||
      state.status !== "active" ||
      state.grant.expiresAt !== a.input.expiresAt ||
      state.grant.expiresAt <= this.instant()
    )
      refuse("EXECUTION_GRANT_NOT_CURRENT");
    const inspected = this.checkInspection(
      await this.options.host.inspect(a.binding, a.input.profile),
      execution.workspace,
    );
    if (!sameExecution(execution, inspected)) refuse("EXECUTION_INVOCATION_CHANGED");
    return state;
  }
  private async cleanup(
    a: Admission,
    expected: ExecutionInspection | null,
  ): Promise<CleanupReport> {
    const result: CleanupReport = { revocation: "unconfirmed", process: "unconfirmed" };
    try {
      const current = await this.options.authority.read(a.input.grantId);
      if (current) {
        if (!expected || !this.grantMatches(current, a, expected))
          result.revocation = "binding-mismatch";
        else {
          if (current.status === "active")
            await this.options.authority.revoke({
              requestId: a.input.revokeRequestId,
              grantId: a.input.grantId,
              expectedRevision: current.revision,
              expectedDigest: current.digest,
            });
          const revoked = await this.options.authority.read(a.input.grantId);
          if (revoked?.status === "revoked" && this.grantMatches(revoked, a, expected))
            result.revocation = "revoked";
        }
      } else result.revocation = "absent";
    } catch {
      /* Stop of the verified original process invalidates its live PID/starttime grant even if the DB is unavailable. */
    }
    try {
      const actual = await this.options.host.inspect(a.binding, a.input.profile);
      if (!actual) {
        result.process = "not-running";
        return result;
      }
      if (!expected) return result;
      if (!sameExecution(expected, actual)) {
        result.process = "different-invocation";
        return result;
      }
      // Never infer a stop target from a reusable unit name after lost or mismatched readiness.
      await this.options.host.stop(a.binding, a.input.profile, actual.invocationId);
      if ((await this.options.host.inspect(a.binding, a.input.profile)) === null)
        result.process = "stopped";
    } catch {
      /* Owning orchestration receives the unresolved cleanup, never a false stopped result. */
    }
    return result;
  }
  private cleanupComplete(result: CleanupReport) {
    return (
      ["revoked", "absent"].includes(result.revocation) &&
      ["stopped", "not-running"].includes(result.process)
    );
  }
  async start(value: TaskExecutionInput): Promise<
    | {
        status: "provider-released";
        planDigest: string;
        allocation: WorkspaceAllocation;
        execution: ExecutionInspection;
        grant: GrantState;
      }
    | Recovery
  > {
    const a = await this.admit(value);
    let launched = false;
    let execution: ExecutionInspection | null = null;
    let phase = "prepare";
    try {
      const now = this.instant();
      if (a.input.expiresAt <= now || a.input.expiresAt - now > 86400000)
        refuse("EXECUTION_DEADLINE_EXPIRED_OR_EXCESSIVE");
      const prepared = await this.options.host.prepare(a.binding, a.input.profile);
      if (
        !isAbsolute(prepared.workspaceRoot) ||
        normalize(prepared.workspaceRoot) !== prepared.workspaceRoot ||
        prepared.workspacePath !== join(prepared.workspaceRoot, a.input.taskId)
      )
        refuse("WORKSPACE_CONTRACT_MISMATCH");
      const pinned = await this.options.step(`${a.key}:workspace-contract`, async () =>
        structuredClone(prepared),
      );
      if (
        pinned.workspaceRoot !== prepared.workspaceRoot ||
        pinned.workspacePath !== prepared.workspacePath
      )
        refuse("WORKSPACE_CONTRACT_CHANGED");
      const allocation = await this.options.step(`${a.key}:allocation`, () =>
        this.options.store.materializeTask({
          taskId: a.input.taskId,
          workspaceRoot: prepared.workspaceRoot,
        }),
      );
      const liveAllocation = await this.options.store.materializeTask({
        taskId: a.input.taskId,
        workspaceRoot: prepared.workspaceRoot,
      });
      if (
        hash(allocationBinding(allocation)) !== hash(allocationBinding(liveAllocation)) ||
        allocation.path !== prepared.workspacePath ||
        allocation.agentId !== a.input.agentId ||
        allocation.baseline !== a.task.baseline ||
        hash(scope(allocation.scope)) !== hash(a.input.scope)
      )
        refuse("WORKSPACE_ALLOCATION_MISMATCH");
      phase = "launch";
      await this.options.step(`${a.key}:launch`, async () => {
        const existing = await this.options.host.inspect(a.binding, a.input.profile);
        if (existing) {
          execution = this.checkInspection(existing, allocation.path);
          launched = true;
          return { reattached: true, execution };
        }
        // The host may have launched even if its acknowledgement fails; cleanup inspects ownership.
        launched = true;
        return plain(await this.options.host.launch(a.binding, a.input.profile));
      });
      launched = true;
      phase = "ready";
      let readyObserved = false;
      execution = await this.options.step(`${a.key}:execution`, async () => {
        const ready = await this.options.host.ready(a.binding);
        readyObserved = true;
        const actual = this.checkInspection(
          await this.options.host.inspect(a.binding, a.input.profile),
          allocation.path,
        );
        if (ready.pid !== actual.pid) refuse("READY_PID_MISMATCH");
        return actual;
      });
      if (!readyObserved) {
        const ready = await this.options.host.ready(a.binding);
        if (ready.pid !== execution.pid) refuse("READY_PID_MISMATCH");
      }
      const actual = this.checkInspection(
        await this.options.host.inspect(a.binding, a.input.profile),
        allocation.path,
      );
      if (!sameExecution(execution, actual)) refuse("EXECUTION_INVOCATION_CHANGED");
      phase = "grant";
      await this.options.step(`${a.key}:grant`, () =>
        this.options.authority.issue({
          requestId: a.input.issueRequestId,
          grantId: a.input.grantId,
          principal: { id: a.input.agentId, kind: "worker", taskIds: [a.input.taskId] },
          execution: identity(execution!.identity),
          expiresAt: a.input.expiresAt,
        }),
      );
      let grant = await this.current(a, execution);
      phase = "release";
      await this.options.step(`${a.key}:release`, async () => {
        grant = await this.current(a, execution!);
        await this.options.host.release(a.binding, {
          grantId: a.input.grantId,
          expiresAt: a.input.expiresAt,
        });
        return { released: true, invocationId: execution!.invocationId };
      });
      // This reports the release event, not continued liveness or task completion. A short-lived
      // provider may legitimately exit immediately after its release acknowledgement.
      return {
        status: "provider-released",
        planDigest: a.planDigest,
        allocation,
        execution,
        grant,
      };
    } catch (error) {
      if (!launched) throw error;
      const reason =
        (error as { code?: unknown })?.code === "EXECUTION_CHANNEL_UNAVAILABLE" ||
        String(error).includes("EXECUTION_CHANNEL_UNAVAILABLE")
          ? "EXECUTION_CHANNEL_UNAVAILABLE"
          : `EXECUTION_${phase.toUpperCase()}_FAILED`;
      const cleanupDetail = await this.cleanup(a, execution);
      return {
        status: "recovery-required",
        reason,
        cleanup: this.cleanupComplete(cleanupDetail) ? "stopped" : "pending",
        cleanupDetail,
        planDigest: a.planDigest,
        binding: a.binding,
        grantId: a.input.grantId,
        execution,
      };
    }
  }
  async stop(
    value: TaskExecutionInput,
  ): Promise<{ status: "stopped"; planDigest: string } | Recovery> {
    const a = await this.admit(value);
    const execution = await this.options.step<ExecutionInspection>(`${a.key}:execution`, async () =>
      refuse("EXECUTION_RECORD_REQUIRED"),
    );
    const cleanupDetail = await this.cleanup(a, execution);
    if (!this.cleanupComplete(cleanupDetail))
      return {
        status: "recovery-required",
        reason: "REVOCATION_OR_PROCESS_CLEANUP_PENDING",
        cleanup: "pending",
        cleanupDetail,
        planDigest: a.planDigest,
        binding: a.binding,
        grantId: a.input.grantId,
        execution,
      };
    await this.options.step(`${a.key}:stopped`, async () => ({ stopped: true }));
    return { status: "stopped", planDigest: a.planDigest };
  }
}

import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, lstat } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { assertProtectedPath } from "./protected-files.ts";
import { withPublicationLock } from "./publication-lock.ts";
import { attestExecution } from "./execution-grants.ts";

export type ExecutionBinding = { agentId: string; taskId: string; runId: string };
export type ExecutionProfile = {
  id: string;
  executable: string;
  executableSha256: string;
  args: string[];
  memoryBytes: number;
  cpuPercent: number;
  maxSeconds: number;
  tasksMax: number;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function id(value: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))
    throw Error("INVALID_EXECUTION_IDENTIFIER");
}
function number(value: number, low: number, high: number) {
  if (!Number.isSafeInteger(value) || value < low || value > high)
    throw Error("INVALID_EXECUTION_LIMIT");
}
function only(value: object, keys: string[]) {
  if (Object.keys(value).some((k) => !keys.includes(k))) throw Error("UNKNOWN_EXECUTION_FIELD");
}

/** Trusted supervisor profile only. Model text cannot supply service properties or environment. */
export function systemdExecutionPlan(binding: ExecutionBinding, profile: ExecutionProfile) {
  only(binding, ["agentId", "taskId", "runId"]);
  only(profile, [
    "id",
    "executable",
    "executableSha256",
    "args",
    "memoryBytes",
    "cpuPercent",
    "maxSeconds",
    "tasksMax",
  ]);
  id(binding.agentId);
  id(binding.taskId);
  id(binding.runId);
  id(profile.id);
  if (
    typeof profile.executable !== "string" ||
    !isAbsolute(profile.executable) ||
    normalize(profile.executable) !== profile.executable ||
    /[\0\r\n%]/.test(profile.executable) ||
    !/^[a-f0-9]{64}$/.test(profile.executableSha256) ||
    !Array.isArray(profile.args) ||
    profile.args.length > 64 ||
    profile.args.some((a) => typeof a !== "string" || a.length > 4096 || /[\0\r\n%]/.test(a))
  )
    throw Error("INVALID_EXECUTION_PROFILE");
  number(profile.memoryBytes, 16 * 1024 * 1024, 16 * 1024 * 1024 * 1024);
  number(profile.cpuPercent, 1, 400);
  number(profile.maxSeconds, 1, 86400);
  number(profile.tasksMax, 1, 1024);
  const agentKey = digest(binding.agentId).slice(0, 24),
    taskKey = digest(binding.taskId).slice(0, 24);
  const unit = `throughline-exec-${agentKey}.service`;
  // Object member order is transport formatting, not execution ownership.
  const description = `throughline-execution-v1-${digest({
    binding: { agentId: binding.agentId, taskId: binding.taskId, runId: binding.runId },
    profile: {
      id: profile.id,
      executable: profile.executable,
      executableSha256: profile.executableSha256,
      args: [...profile.args],
      memoryBytes: profile.memoryBytes,
      cpuPercent: profile.cpuPercent,
      maxSeconds: profile.maxSeconds,
      tasksMax: profile.tasksMax,
    },
  })}`;
  const home = `/var/lib/throughline-agents/${agentKey}`,
    workspaceRoot = `/var/lib/throughline-tasks/${taskKey}`,
    workspace = join(workspaceRoot, binding.taskId);
  const properties = [
    "DynamicUser=yes",
    `User=tl-${agentKey}`,
    `StateDirectory=throughline-agents/${agentKey} throughline-tasks/${taskKey}`,
    "StateDirectoryMode=0700",
    `WorkingDirectory=${workspace}`,
    "Slice=system.slice",
    "Restart=no",
    "KillMode=control-group",
    "TimeoutStopSec=10",
    "NoNewPrivileges=yes",
    "PrivateTmp=yes",
    "ProtectHome=yes",
    "ProtectSystem=strict",
    "ProtectKernelTunables=yes",
    "ProtectKernelModules=yes",
    "ProtectControlGroups=yes",
    "RestrictSUIDSGID=yes",
    "CapabilityBoundingSet=",
    "UMask=0077",
    `MemoryMax=${profile.memoryBytes}`,
    `CPUQuota=${profile.cpuPercent}%`,
    `RuntimeMaxSec=${profile.maxSeconds}`,
    `TasksMax=${profile.tasksMax}`,
  ];
  return {
    unit,
    description,
    home,
    workspaceRoot,
    workspace,
    args: [
      "--system",
      "--no-ask-password",
      "--quiet",
      "--pipe",
      "--wait",
      "--collect",
      "--service-type=exec",
      "--expand-environment=no",
      `--unit=${unit}`,
      `--description=${description}`,
      ...properties.map((p) => `--property=${p}`),
      "--",
      "/usr/bin/env",
      "-i",
      "PATH=/usr/bin:/bin",
      `HOME=${home}`,
      "LANG=C",
      profile.executable,
      ...profile.args,
    ],
  };
}

export function parseOwnedUnit(output: string, plan: ReturnType<typeof systemdExecutionPlan>) {
  const fields = new Map<string, string>();
  for (const line of output.trim().split("\n")) {
    const pos = line.indexOf("=");
    if (pos < 1 || fields.has(line.slice(0, pos))) throw Error("INVALID_UNIT_SNAPSHOT");
    fields.set(line.slice(0, pos), line.slice(pos + 1));
  }
  const pid = Number(fields.get("MainPID")),
    invocationId = fields.get("InvocationID") ?? "",
    cgroup = fields.get("ControlGroup") ?? "";
  if (
    fields.get("Id") !== plan.unit ||
    fields.get("Description") !== plan.description ||
    fields.get("LoadState") !== "loaded" ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !/^[a-f0-9]{32}$/.test(invocationId) ||
    cgroup !== `/system.slice/${plan.unit}` ||
    fields.get("ActiveState") !== "active"
  )
    throw Error("EXECUTION_UNIT_NOT_OWNED_OR_ACTIVE");
  return { unit: plan.unit, invocationId, pid, cgroup, active: "active" as const };
}

const execute = promisify(execFile);
const cleanEnv = { PATH: "/usr/bin:/bin", LANG: "C" };
/** Root service adapter; there is deliberately no sudo or unprivileged fallback. */
export class SystemdExecutionDriver {
  private readonly profile: ExecutionProfile;
  constructor(
    private readonly controlRoot: string,
    profile: ExecutionProfile,
  ) {
    this.profile = structuredClone(profile);
  }
  private async managerPlan(binding: ExecutionBinding) {
    if (process.platform !== "linux") throw Error("LINUX_EXECUTION_REQUIRED");
    const plan = systemdExecutionPlan(structuredClone(binding), this.profile);
    await assertProtectedPath(this.controlRoot, 0);
    if (!(await lstat(this.controlRoot)).isDirectory()) throw Error("INVALID_CONTROL_ROOT");
    await assertProtectedPath("/usr/bin/systemctl", 0);
    const manager = await lstat("/usr/bin/systemctl");
    if (!manager.isFile() || !(manager.mode & 0o111)) throw Error("PROTECTED_EXECUTABLE_REQUIRED");
    return plan;
  }
  async prepare(binding: ExecutionBinding) {
    const plan = await this.managerPlan(binding);
    for (const path of [
      "/usr/bin/systemd-run",
      "/usr/bin/systemctl",
      "/usr/bin/env",
      this.profile.executable,
    ]) {
      await assertProtectedPath(path, 0);
      const s = await lstat(path);
      if (!s.isFile() || !(s.mode & 0o111)) throw Error("PROTECTED_EXECUTABLE_REQUIRED");
    }
    const sha = createHash("sha256")
      .update(await readFile(this.profile.executable))
      .digest("hex");
    if (sha !== this.profile.executableSha256) throw Error("EXECUTABLE_VERSION_CHANGED");
    return plan;
  }
  private async show(unit: string) {
    const { stdout } = await execute(
      "/usr/bin/systemctl",
      [
        "show",
        unit,
        "--property=Id,Description,LoadState,ActiveState,MainPID,ControlGroup,InvocationID",
      ],
      { env: cleanEnv, timeout: 10000, maxBuffer: 16384 },
    );
    return stdout;
  }
  async inspect(binding: ExecutionBinding) {
    // Inspection/cleanup must still work if an old release's executable was removed.
    const plan = await this.managerPlan(binding);
    const unit = parseOwnedUnit(await this.show(plan.unit), plan);
    const identity = await attestExecution(unit.pid);
    if (identity.cgroup !== unit.cgroup) throw Error("EXECUTION_CGROUP_MISMATCH");
    return { ...unit, identity, home: plan.home, workspace: plan.workspace };
  }
  async lookup(binding: ExecutionBinding) {
    binding = structuredClone(binding);
    const plan = await this.managerPlan(binding);
    const output = await this.show(plan.unit);
    const rows = output.trim().split("\n");
    if (rows.includes(`Id=${plan.unit}`) && rows.includes("LoadState=not-found")) return null;
    // Inactive, foreign, malformed and transport failure are not evidence of absence.
    return this.inspect(binding);
  }
  async start(binding: ExecutionBinding) {
    const plan = await this.prepare(binding);
    if (process.getuid?.() !== 0) throw Error("EXECUTION_ROOT_SERVICE_REQUIRED");
    return withPublicationLock(join(this.controlRoot, plan.unit), async () => {
      const state = await this.show(plan.unit);
      if (!/^LoadState=not-found$/m.test(state)) throw Error("EXECUTION_UNIT_ALREADY_EXISTS");
      const child = spawn("/usr/bin/systemd-run", plan.args, {
        env: cleanEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      // This is a launch request, NOT readiness/completion. Inspect only after a child-ready event.
      return { phase: "launch-requested" as const, unit: plan.unit, child };
    });
  }
  async stop(binding: ExecutionBinding, expectedInvocationId: string) {
    binding = structuredClone(binding);
    const plan = await this.managerPlan(binding);
    if (!/^[a-f0-9]{32}$/.test(expectedInvocationId)) throw Error("INVOCATION_ID_REQUIRED");
    if (process.getuid?.() !== 0) throw Error("EXECUTION_ROOT_SERVICE_REQUIRED");
    await withPublicationLock(join(this.controlRoot, plan.unit), async () => {
      const owned = await this.inspect(binding);
      if (owned.invocationId !== expectedInvocationId) throw Error("EXECUTION_INVOCATION_CHANGED");
      await execute("/usr/bin/systemctl", ["stop", plan.unit], {
        env: cleanEnv,
        timeout: 20000,
        maxBuffer: 16384,
      });
    });
  }
}

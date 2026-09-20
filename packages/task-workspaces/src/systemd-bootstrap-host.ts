import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { assertProtectedPath } from "./protected-files.ts";
import {
  SystemdExecutionDriver,
  systemdExecutionPlan,
  type ExecutionBinding,
  type ExecutionProfile,
} from "./systemd-execution.ts";
import { bootstrapDigest } from "./worker-bootstrap.ts";
import { BootstrapChannel } from "./bootstrap-channel.ts";
import type { SupervisorHost } from "./task-execution-supervisor.ts";
import type { WorkerEntryConfig } from "./worker-entry.ts";

export type BootstrapExecutable = {
  node: string;
  nodeSha256: string;
  entry: string;
  entrySha256: string;
};
/** One live run's I/O handles only. Durable progress and recovery policy stay with the caller. */
export class SystemdBootstrapHost implements SupervisorHost {
  private readonly pin: {
    binding: ExecutionBinding;
    expiresAt: number;
    executable: BootstrapExecutable;
  };
  private channel?: BootstrapChannel;
  private child?: ChildProcessWithoutNullStreams;
  private launchedProfile?: string;
  constructor(
    private readonly controlRoot: string,
    pin: { binding: ExecutionBinding; expiresAt: number; executable: BootstrapExecutable },
  ) {
    this.pin = structuredClone(pin);
    bootstrapDigest(this.pin.binding, this.pin.expiresAt);
  }
  private check(binding: ExecutionBinding) {
    if (
      bootstrapDigest(binding, this.pin.expiresAt) !==
      bootstrapDigest(this.pin.binding, this.pin.expiresAt)
    )
      throw Error("HOST_BINDING_MISMATCH");
  }
  effectiveProfile(binding: ExecutionBinding, profile: ExecutionProfile): ExecutionProfile {
    this.check(binding);
    const plan = systemdExecutionPlan(binding, profile);
    const config: WorkerEntryConfig = {
      binding: { agentId: binding.agentId, taskId: binding.taskId, runId: binding.runId },
      expiresAt: this.pin.expiresAt,
      workspace: plan.workspace,
      home: plan.home,
      executable: profile.executable,
      executableSha256: profile.executableSha256,
      args: [...profile.args],
    };
    return {
      ...structuredClone(profile),
      executable: this.pin.executable.node,
      executableSha256: this.pin.executable.nodeSha256,
      args: [this.pin.executable.entry, JSON.stringify(config)],
    };
  }
  private driver(binding: ExecutionBinding, profile: ExecutionProfile) {
    return new SystemdExecutionDriver(this.controlRoot, this.effectiveProfile(binding, profile));
  }
  async prepare(binding: ExecutionBinding, profile: ExecutionProfile) {
    this.check(binding);
    // Both the waiting program and eventual provider are pinned before any root launch.
    for (const [path, sha] of [
      [this.pin.executable.entry, this.pin.executable.entrySha256],
      [profile.executable, profile.executableSha256],
    ]) {
      await assertProtectedPath(path!, 0);
      if (
        createHash("sha256")
          .update(await readFile(path!))
          .digest("hex") !== sha
      )
        throw Error("BOOTSTRAP_OR_PROVIDER_CHANGED");
    }
    const provider = await lstat(profile.executable);
    if (!provider.isFile() || !(provider.mode & 0o111)) throw Error("PROVIDER_EXECUTABLE_REQUIRED");
    const plan = await this.driver(binding, profile).prepare(binding);
    return { workspaceRoot: plan.workspaceRoot, workspacePath: plan.workspace };
  }
  async launch(binding: ExecutionBinding, profile: ExecutionProfile) {
    await this.prepare(binding, profile);
    const effective = this.effectiveProfile(binding, profile),
      key = systemdExecutionPlan(binding, effective).description;
    if (this.child) {
      if (key !== this.launchedProfile || this.child.exitCode !== null)
        throw Error("EXECUTION_CHANNEL_UNAVAILABLE");
      return { phase: "launch-requested", unit: systemdExecutionPlan(binding, effective).unit };
    }
    const launched = await this.driver(binding, profile).start(binding);
    this.child = launched.child;
    this.launchedProfile = key;
    this.channel = new BootstrapChannel(
      launched.child.stdin,
      launched.child.stdout,
      binding,
      this.pin.expiresAt,
    );
    return { phase: launched.phase, unit: launched.unit };
  }
  async ready(binding: ExecutionBinding) {
    this.check(binding);
    if (!this.channel) throw Error("EXECUTION_CHANNEL_UNAVAILABLE");
    return this.channel.ready();
  }
  async inspect(binding: ExecutionBinding, profile: ExecutionProfile) {
    this.check(binding);
    return this.driver(binding, profile).lookup(binding);
  }
  async release(binding: ExecutionBinding, grant: { grantId: string; expiresAt: number }) {
    this.check(binding);
    if (grant.expiresAt !== this.pin.expiresAt || !this.channel)
      throw Error("EXECUTION_CHANNEL_UNAVAILABLE");
    await this.channel.release(grant.grantId);
  }
  async stop(binding: ExecutionBinding, profile: ExecutionProfile, invocationId: string) {
    this.check(binding);
    await this.driver(binding, profile).stop(binding, invocationId);
  }
  providerStreams() {
    if (!this.channel || !this.child) throw Error("EXECUTION_CHANNEL_UNAVAILABLE");
    return { ...this.channel.providerStreams(), error: this.child.stderr };
  }
}

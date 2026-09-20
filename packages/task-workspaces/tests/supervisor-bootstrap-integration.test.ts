import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicationStore } from "../src/index.ts";
import { ExecutionGrantAuthority } from "../src/execution-grant-authority.ts";
import { attestExecution } from "../src/execution-grants.ts";
import { BootstrapChannel } from "../src/bootstrap-channel.ts";
import {
  TaskExecutionSupervisor,
  type DurableExecutionStep,
  type SupervisorHost,
  type TaskExecutionInput,
} from "../src/task-execution-supervisor.ts";

test(
  "registered private task reaches real gated process only with its current grant, then revokes and stops",
  { skip: process.platform !== "linux" || process.getuid?.() === 0 },
  async (t) => {
    const root = await mkdtemp(join(homedir(), ".supervisor-bootstrap-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new PublicationStore({ root: join(root, "publisher") });
    await store.initialize({ "help.txt": "accepted baseline" });
    await store.openTask({ taskId: "task-a", agentId: "agent-a", scope: ["help.txt"] });
    const authorityRoot = join(root, "authority");
    await mkdir(authorityRoot, { mode: 0o700 });
    const authority = await ExecutionGrantAuthority.bootstrap({
      root: authorityRoot,
      authorityUid: process.getuid!(),
    });
    t.after(() => authority.close());
    const request: TaskExecutionInput = {
      agentId: "agent-a",
      taskId: "task-a",
      runId: "run-a",
      scope: ["help.txt"],
      expiresAt: Date.now() + 10000,
      grantId: "grant-a",
      issueRequestId: "issue-a",
      revokeRequestId: "revoke-a",
      profile: {
        id: "cat-fixture",
        executable: "/usr/bin/cat",
        executableSha256: createHash("sha256")
          .update(await readFile("/usr/bin/cat"))
          .digest("hex"),
        args: [],
        memoryBytes: 64 * 1024 * 1024,
        cpuPercent: 100,
        maxSeconds: 10,
        tasksMax: 32,
      },
    };
    const binding = { agentId: request.agentId, taskId: request.taskId, runId: request.runId };
    const workspaceRoot = join(root, "workspaces"),
      workspace = join(workspaceRoot, request.taskId),
      home = join(root, "agent-home");
    await mkdir(home, { mode: 0o700 });
    let child: ChildProcessWithoutNullStreams | undefined,
      channel: BootstrapChannel | undefined,
      exited: Promise<number | null> | undefined;
    let launchCount = 0,
      stopped = false;
    t.after(() => {
      if (child && child.exitCode === null) child.kill("SIGTERM");
    });
    const host: SupervisorHost = {
      async prepare() {
        return { workspaceRoot, workspacePath: workspace };
      },
      async launch() {
        launchCount++;
        assert.equal(await readFile(join(workspace, "help.txt"), "utf8"), "accepted baseline");
        assert.equal(await authority.read(request.grantId), null);
        child = spawn(
          process.execPath,
          [
            fileURLToPath(new URL("../src/worker-entry.js", import.meta.url)),
            JSON.stringify({
              binding,
              expiresAt: request.expiresAt,
              workspace,
              home,
              executable: request.profile.executable,
              executableSha256: request.profile.executableSha256,
              args: request.profile.args,
            }),
          ],
          {
            cwd: workspace,
            env: { PATH: "/usr/bin:/bin", HOME: home, LANG: "C" },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        exited = new Promise((resolve, reject) => {
          child!.once("error", reject);
          child!.once("exit", resolve);
        });
        channel = new BootstrapChannel(child.stdin, child.stdout, binding, request.expiresAt);
        return { kind: "same-account-process-rehearsal", pid: child.pid! };
      },
      async ready() {
        if (!channel) throw Error("EXECUTION_CHANNEL_UNAVAILABLE");
        return channel.ready();
      },
      async inspect() {
        if (!child || stopped || child.exitCode !== null) return null;
        const identity = await attestExecution(child.pid!);
        return {
          invocationId: child.pid!.toString(16).padStart(32, "0"),
          pid: child.pid!,
          identity,
          workspace,
        };
      },
      async release(_binding, grant) {
        const current = await authority.read(grant.grantId);
        assert.equal(current?.status, "active");
        assert.equal(current?.grant.leaderPid, child!.pid);
        assert.equal(
          (await readFile(`/proc/${child!.pid}/task/${child!.pid}/children`, "utf8")).trim(),
          "",
        );
        await channel!.release(grant.grantId);
      },
      async stop(_binding, _profile, invocation) {
        assert.equal(invocation, child!.pid!.toString(16).padStart(32, "0"));
        assert.equal((await authority.read(request.grantId))?.status, "revoked");
        child!.stdin.end();
        await exited;
        stopped = true;
      },
    };
    const cache = new Map<string, Promise<unknown>>();
    const step: DurableExecutionStep = async <T>(key: string, work: () => Promise<T>) => {
      if (!cache.has(key)) cache.set(key, work());
      return (await cache.get(key)) as T;
    };
    const supervisor = new TaskExecutionSupervisor({ store, authority, host, step });
    const released = await supervisor.start(request);
    assert.equal(released.status, "provider-released");
    assert.equal(launchCount, 1);
    // Native provider data crosses only after supervisor admission, readiness and current-grant checks.
    const stream = channel!.providerStreams();
    const echoed = new Promise<string>((resolve) =>
      stream.output.once("data", (b) => resolve(b.toString())),
    );
    stream.output.resume();
    stream.input.write("native-input\n");
    assert.equal(await echoed, "native-input\n");
    const resumed = await supervisor.start(request);
    assert.equal(resumed.status, "provider-released");
    assert.equal(launchCount, 1);
    const stoppedResult = await supervisor.stop(request);
    assert.equal(stoppedResult.status, "stopped");
    assert.equal((await authority.read(request.grantId))?.status, "revoked");
    assert.equal(await readFile(join(workspace, "help.txt"), "utf8"), "accepted baseline");
  },
);

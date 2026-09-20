import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { PublicationStore } from "../src/index.ts";
import {
  ExecutionGrantAuthority,
  openExecutionGrantReader,
} from "../src/execution-grant-authority.ts";
import { createExecutionGrantResolver } from "../src/execution-grants.ts";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  TaskExecutionSupervisor,
  type TaskExecutionInput,
  type ExecutionInspection,
  type SupervisorHost,
  type DurableExecutionStep,
} from "../src/task-execution-supervisor.ts";
const linux = { skip: process.platform !== "linux" || process.getuid?.() === 0 };
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(homedir(), ".task-supervisor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new PublicationStore({ root: join(root, "publisher") });
  await store.initialize({ "help.txt": "baseline" });
  await store.openTask({ taskId: "task1", agentId: "agent1", scope: ["help.txt"] });
  const grantRoot = join(root, "grants");
  await mkdir(grantRoot, { mode: 0o700 });
  const authority = await ExecutionGrantAuthority.bootstrap({
    root: grantRoot,
    authorityUid: process.getuid!(),
  });
  t.after(() => authority.close());
  const identity = await authority.attest(process.pid),
    workspaceRoot = join(root, "private"),
    workspacePath = join(workspaceRoot, "task1");
  const input: TaskExecutionInput = {
    taskId: "task1",
    agentId: "agent1",
    runId: "run1",
    scope: ["help.txt"],
    profile: {
      id: "profile1",
      executable: "/usr/bin/true",
      executableSha256: "a".repeat(64),
      args: [],
      memoryBytes: 16777216,
      cpuPercent: 50,
      maxSeconds: 60,
      tasksMax: 16,
    },
    expiresAt: Date.now() + 60000,
    grantId: "grant1",
    issueRequestId: "issue1",
    revokeRequestId: "revoke1",
  };
  let running: ExecutionInspection | null = null;
  const events: string[] = [];
  const host: SupervisorHost = {
    async prepare() {
      events.push("prepare");
      return { workspaceRoot, workspacePath };
    },
    async launch() {
      events.push("launch");
      running = {
        pid: process.pid,
        invocationId: "a".repeat(32),
        identity,
        workspace: workspacePath,
      };
      return { phase: "launch-requested" };
    },
    async ready() {
      events.push("ready");
      return { pid: process.pid };
    },
    async inspect() {
      events.push("inspect");
      return running ? structuredClone(running) : null;
    },
    async release() {
      events.push("release");
      assert.equal((await authority.read("grant1"))?.status, "active");
    },
    async stop(_b, _p, invocationId) {
      events.push("stop");
      assert.notEqual((await authority.read("grant1"))?.status, "active");
      assert.equal(running?.invocationId, invocationId);
      running = null;
    },
  };
  const memory = new Map<string, unknown>(),
    inflight = new Map<string, Promise<unknown>>();
  const step: DurableExecutionStep = async <T>(key: string, effect: () => Promise<T>) => {
    if (memory.has(key)) return structuredClone(memory.get(key)) as T;
    if (inflight.has(key)) return structuredClone(await inflight.get(key)) as T;
    const pending = effect();
    inflight.set(key, pending);
    try {
      const result = await pending;
      memory.set(key, structuredClone(result));
      return result;
    } finally {
      inflight.delete(key);
    }
  };
  const make = () => new TaskExecutionSupervisor({ store, authority, host, step });
  return {
    root,
    store,
    authority,
    input,
    host,
    events,
    memory,
    make,
    workspacePath,
    setRunning: (v: ExecutionInspection | null) => {
      running = v;
    },
    getRunning: () => running,
  };
}
test(
  "registered baseline precedes grant and provider release; replay preserves drafts without another launch",
  linux,
  async (t) => {
    const f = await fixture(t),
      first = await f.make().start(f.input);
    assert.equal(first.status, "provider-released");
    assert.equal(await readFile(join(f.workspacePath, "help.txt"), "utf8"), "baseline");
    await writeFile(join(f.workspacePath, "help.txt"), "private draft");
    const replay = await f.make().start(f.input);
    assert.equal(replay.status, "provider-released");
    assert.equal(f.events.filter((e) => e === "launch").length, 1);
    assert.equal(f.events.filter((e) => e === "release").length, 1);
    assert.equal(await readFile(join(f.workspacePath, "help.txt"), "utf8"), "private draft");
    assert.equal((await f.make().stop(f.input)).status, "stopped");
    assert.equal((await f.authority.read("grant1"))?.status, "revoked");
    assert.equal(await readFile(join(f.workspacePath, "help.txt"), "utf8"), "private draft");
  },
);
test(
  "wrong owner/scope and changed pinned run profile refuse before another launch",
  linux,
  async (t) => {
    const f = await fixture(t);
    await assert.rejects(f.make().start({ ...f.input, agentId: "other" }), /ADMISSION/);
    await assert.rejects(f.make().start({ ...f.input, scope: ["other"] }), /ADMISSION/);
    assert.equal(f.events.length, 0);
    await f.make().start(f.input);
    await assert.rejects(
      f.make().start({ ...f.input, profile: { ...f.input.profile, args: ["changed"] } }),
      /PLAN_CHANGED/,
    );
    await assert.rejects(
      f.make().start({ ...f.input, expiresAt: f.input.expiresAt + 1 }),
      /PLAN_CHANGED/,
    );
    assert.equal(f.events.filter((e) => e === "launch").length, 1);
  },
);
test(
  "allocation parent is not provider cwd; mismatched host path refuses before launch",
  linux,
  async (t) => {
    const f = await fixture(t);
    f.host.prepare = async () => ({
      workspaceRoot: join(f.root, "private"),
      workspacePath: join(f.root, "private"),
    });
    await assert.rejects(f.make().start(f.input), /WORKSPACE_CONTRACT/);
    assert.equal(f.events.includes("launch"), false);
  },
);
test("old cached issue receipt cannot release a revoked grant", linux, async (t) => {
  const f = await fixture(t);
  await f.make().start(f.input);
  const g = (await f.authority.read("grant1"))!;
  await f.authority.revoke({
    requestId: "outside-revoke",
    grantId: "grant1",
    expectedRevision: g.revision,
    expectedDigest: g.digest,
  });
  const result = await f.make().start(f.input);
  assert.equal(result.status, "recovery-required");
  assert.equal(f.events.filter((e) => e === "release").length, 1);
  assert.equal(f.events.filter((e) => e === "stop").length, 1);
});
test(
  "lost release channel revokes before owned stop and reports recoverable outcome",
  linux,
  async (t) => {
    const f = await fixture(t);
    f.host.release = async () => {
      throw Error("EXECUTION_CHANNEL_UNAVAILABLE");
    };
    const result = await f.make().start(f.input);
    assert.equal(result.status, "recovery-required");
    if (result.status === "recovery-required") {
      assert.equal(result.reason, "EXECUTION_CHANNEL_UNAVAILABLE");
      assert.equal(result.cleanup, "stopped");
    }
    assert.equal((await f.authority.read("grant1"))?.status, "revoked");
    assert.equal(f.events.includes("stop"), true);
  },
);
test(
  "changed invocation is never stopped even while old authority is revoked",
  linux,
  async (t) => {
    const f = await fixture(t);
    await f.make().start(f.input);
    f.setRunning({ ...f.getRunning()!, invocationId: "b".repeat(32) });
    const result = await f.make().stop(f.input);
    assert.equal(result.status, "recovery-required");
    assert.equal((await f.authority.read("grant1"))?.status, "revoked");
    assert.equal(f.events.includes("stop"), false);
  },
);
test(
  "loss of launch acknowledgement reattaches inspected live execution instead of relaunching",
  linux,
  async (t) => {
    const f = await fixture(t);
    await f.make().start(f.input);
    for (const key of f.memory.keys()) if (key.endsWith(":launch")) f.memory.delete(key);
    assert.equal((await f.make().start(f.input)).status, "provider-released");
    assert.equal(f.events.filter((e) => e === "launch").length, 1);
  },
);
test(
  "failed revocation still stops verified invocation and keeps record cleanup explicit",
  linux,
  async (t) => {
    const f = await fixture(t);
    await f.make().start(f.input);
    f.authority.revoke = async () => {
      throw Error("authority unavailable");
    };
    f.host.stop = async (_b, _p, invocationId) => {
      assert.equal(invocationId, f.getRunning()!.invocationId);
      f.events.push("stop");
      f.setRunning(null);
    };
    const result = await f.make().stop(f.input);
    assert.equal(result.status, "recovery-required");
    if (result.status === "recovery-required") {
      assert.equal(result.cleanupDetail.revocation, "unconfirmed");
      assert.equal(result.cleanupDetail.process, "stopped");
    }
    assert.equal(f.events.includes("stop"), true);
    assert.equal((await f.authority.read("grant1"))?.status, "active");
  },
);

test(
  "cached released step cannot fabricate resume when native channel is lost",
  linux,
  async (t) => {
    const f = await fixture(t);
    await f.make().start(f.input);
    f.host.ready = async () => {
      throw Error("EXECUTION_CHANNEL_UNAVAILABLE");
    };
    const result = await f.make().start(f.input);
    assert.equal(result.status, "recovery-required");
    assert.equal((await f.authority.read("grant1"))?.status, "revoked");
    assert.equal(f.events.filter((e) => e === "launch").length, 1);
  },
);

test(
  "reused run cannot switch registered tasks and colliding grant request ids refuse",
  linux,
  async (t) => {
    const f = await fixture(t);
    await assert.rejects(
      f.make().start({ ...f.input, revokeRequestId: f.input.issueRequestId }),
      /MUST_DIFFER/,
    );
    await f.make().start(f.input);
    await f.store.openTask({ taskId: "task2", agentId: "agent1", scope: ["help.txt"] });
    await assert.rejects(f.make().start({ ...f.input, taskId: "task2" }), /PLAN_CHANGED/);
    assert.equal(f.events.filter((e) => e === "launch").length, 1);
  },
);

test("mismatched ready PID cannot grant or stop an unconfirmed invocation", linux, async (t) => {
  const f = await fixture(t);
  f.host.ready = async () => ({ pid: process.pid + 1000 });
  const result = await f.make().start(f.input);
  assert.equal(result.status, "recovery-required");
  assert.equal(await f.authority.read("grant1"), null);
  assert.equal(f.events.includes("release"), false);
  assert.equal(f.events.includes("stop"), false);
});

test(
  "caller durable step deduplication prevents duplicate concurrent launch and release",
  linux,
  async (t) => {
    const f = await fixture(t);
    const results = await Promise.all([f.make().start(f.input), f.make().start(f.input)]);
    assert.equal(
      results.every((r) => r.status === "provider-released"),
      true,
    );
    assert.equal(f.events.filter((e) => e === "launch").length, 1);
    assert.equal(f.events.filter((e) => e === "release").length, 1);
  },
);

test(
  "provider release is not confused with continued liveness or task completion",
  linux,
  async (t) => {
    const f = await fixture(t);
    f.host.release = async () => {
      assert.equal((await f.authority.read("grant1"))?.status, "active");
      f.setRunning(null);
    };
    assert.equal((await f.make().start(f.input)).status, "provider-released");
    assert.equal((await f.make().stop(f.input)).status, "stopped");
    assert.equal((await f.authority.read("grant1"))?.status, "revoked");
  },
);

test(
  "real same-account child death makes unrevoked grant unusable after revocation outage",
  linux,
  async (t) => {
    const f = await fixture(t);
    const child = spawn(
      process.execPath,
      ["-e", "process.stdout.write('READY\\n');setInterval(()=>{},1000)"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });
    await once(child.stdout!, "data");
    const execution = await f.authority.attest(child.pid!);
    f.host.launch = async () => {
      f.setRunning({
        pid: child.pid!,
        invocationId: "c".repeat(32),
        identity: execution,
        workspace: f.workspacePath,
      });
      return { phase: "launch-requested" };
    };
    f.host.ready = async () => ({ pid: child.pid! });
    f.host.stop = async (_b, _p, invocationId) => {
      assert.equal(invocationId, "c".repeat(32));
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      assert.equal((await exited)[1], "SIGKILL");
      f.setRunning(null);
    };
    assert.equal((await f.make().start(f.input)).status, "provider-released");
    f.authority.revoke = async () => {
      throw Error("DB transport unavailable");
    };
    const result = await f.make().stop(f.input);
    assert.equal(result.status, "recovery-required");
    if (result.status === "recovery-required") {
      assert.equal(result.cleanupDetail.revocation, "unconfirmed");
      assert.equal(result.cleanupDetail.process, "stopped");
    }
    assert.equal((await f.authority.read("grant1"))?.status, "active");
    const reader = await openExecutionGrantReader({
      root: join(f.root, "grants"),
      authorityUid: process.getuid!(),
    });
    t.after(() => reader.close());
    await assert.rejects(
      createExecutionGrantResolver({
        grantRoot: join(f.root, "grants"),
        authorityUid: process.getuid!(),
        store: reader,
      })({ uid: execution.uid, gid: execution.gid, pid: child.pid! }),
    );
  },
);

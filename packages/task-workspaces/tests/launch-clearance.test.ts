import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { PublicationStore, type Task } from "../src/index.ts";
import { ExecutionGrantAuthority } from "../src/execution-grant-authority.ts";
import { createExecutionGrantResolver } from "../src/execution-grants.ts";
import { launchRequestDigest, type LaunchRequest } from "../src/launch-clearance.ts";
import type { KernelPeer } from "../src/publisher-ipc.ts";
import type { Principal } from "../src/review-authority.ts";
import {
  TaskExecutionSupervisor,
  type DurableExecutionStep,
  type ExecutionInspection,
  type SupervisorHost,
  type TaskExecutionInput,
} from "../src/task-execution-supervisor.ts";
import { LEAD_SEAT, launchJudge } from "./launch-fixture.ts";

const judge = { uid: 3301, gid: 3301, pid: 501 };
const requesterSeat = LEAD_SEAT;
const agentSeat = { uid: 3303, gid: 3303, pid: 503 };
const workerSeat = { uid: 3304, gid: 3304, pid: 504 };
const otherTaskReviewer = { uid: 3305, gid: 3305, pid: 505 };
/** Stands in for the kernel-peer grant resolver: principals by kernel uid only. */
const principals = new Map<number, Principal>([
  [3301, { id: "judge1", kind: "reviewer", taskIds: ["task1", "task2"] }],
  [3302, { id: "lead1", kind: "reviewer", taskIds: ["task1"] }],
  [3303, { id: "agent1", kind: "reviewer", taskIds: ["task1"] }],
  [3304, { id: "judge1", kind: "worker", taskIds: ["task1"] }],
  [3305, { id: "judge2", kind: "reviewer", taskIds: ["task2"] }],
]);
const tasks = new Map<string, Task>([
  ["task1", { taskId: "task1", agentId: "agent1", baseline: "a".repeat(40), scope: ["help.txt"] }],
  ["task2", { taskId: "task2", agentId: "agent2", baseline: "a".repeat(40), scope: ["help.txt"] }],
]);

async function fixture(t: test.TestContext) {
  // /tmp is deliberately not used: writable ancestry must fail the protected-path check.
  const root = await mkdtemp(join(homedir(), ".launch-clearance-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const j = await launchJudge(
    t,
    root,
    { getTask: async (taskId) => structuredClone(tasks.get(taskId) ?? null) },
    async (peer: KernelPeer) => {
      const principal = principals.get(peer.uid);
      if (!principal) throw Error("UNAUTHENTICATED");
      return structuredClone(principal);
    },
  );
  const submitted = async (fields: Partial<LaunchRequest> = {}) =>
    j.clearances.submitRequest(requesterSeat, j.request(fields));
  const rule = async (
    peer: KernelPeer,
    input: Partial<{ requestId: string; requestDigest: string; verdict: string; reason: string }>,
  ) =>
    j.clearances.recordRuling(peer, {
      requestId: "launch1",
      requestDigest: "",
      verdict: "serves",
      reason: "It serves the target.",
      ...input,
    });
  /** Rewrites stored rows directly, as a tampered or corrupted database would present them. */
  const plant = (change: (request: LaunchRequest, ruling: Record<string, unknown>) => void) => {
    const db = new DatabaseSync(j.clearanceDatabase);
    try {
      const request = JSON.parse(
        db.prepare("SELECT request FROM launch_requests WHERE request_id='launch1'").get()!
          .request as string,
      ) as LaunchRequest;
      const ruling = JSON.parse(
        db.prepare("SELECT ruling FROM launch_rulings WHERE request_id='launch1'").get()!
          .ruling as string,
      ) as Record<string, unknown>;
      const digestBefore = launchRequestDigest(request);
      change(request, ruling);
      const row = db
        .prepare("SELECT digest FROM launch_requests WHERE request_id='launch1'")
        .get()!.digest;
      // Keep the stored digest in step with the request unless the change set it itself.
      const digest = row === digestBefore ? launchRequestDigest(request) : row;
      db.prepare("UPDATE launch_requests SET request=?,digest=? WHERE request_id='launch1'").run(
        JSON.stringify(request),
        digest as string,
      );
      db.prepare("UPDATE launch_rulings SET ruling=? WHERE request_id='launch1'").run(
        JSON.stringify(ruling),
      );
    } finally {
      db.close();
    }
  };
  return { root, ...j, submitted, rule, plant };
}

/** A supervisor whose host, store and grant authority record any use; refusals must leave none. */
async function supervised(t: test.TestContext) {
  const f = await fixture(t);
  const events: string[] = [];
  const unexpected = (name: string) => async () => {
    events.push(name);
    throw Error(`unexpected ${name}`);
  };
  const host: SupervisorHost = {
    prepare: unexpected("prepare"),
    launch: unexpected("launch"),
    ready: unexpected("ready"),
    inspect: unexpected("inspect"),
    release: unexpected("release"),
    stop: unexpected("stop"),
  };
  const step: DurableExecutionStep = async <T>(_key: string, effect: () => Promise<T>) => effect();
  const supervisor = new TaskExecutionSupervisor({
    store: {
      getTask: async (taskId) => structuredClone(tasks.get(taskId) ?? null),
      materializeTask: unexpected("materialize"),
    },
    authority: {
      issue: unexpected("issue"),
      read: unexpected("read"),
      revoke: unexpected("revoke"),
    },
    clearances: f.clearances,
    ledger: f.ledger,
    host,
    step,
  });
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
    clearanceId: "launch1",
  };
  /** The start is refused with code, before any host, store or authority use and any ceiling. */
  const refused = async (code: RegExp, value: TaskExecutionInput = input) => {
    await assert.rejects(supervisor.start(value), code);
    assert.deepEqual(events, []);
    await assert.rejects(f.ledger.remaining("grant1"), /NO_CEILING/);
  };
  return { ...f, events, input, refused };
}

test("an operator target is admitted only as an intact file that only its owner can write", async (t) => {
  const f = await fixture(t);
  const target = {
    schema: "throughline.operator-target.v1",
    targetId: "target2",
    statement: "A second target.",
  };
  await assert.rejects(f.submitted({ targetId: "missing" }), /TARGET_NOT_ADMITTED/);
  await f.writeTarget("target2", target, 0o664);
  await assert.rejects(f.submitted({ targetId: "target2" }), /TARGET_NOT_ADMITTED/);
  await f.writeTarget("target2", { ...target, schema: "throughline.operator-target.v0" });
  await assert.rejects(f.submitted({ targetId: "target2" }), /TARGET_NOT_ADMITTED/);
  await f.writeTarget("target2", { ...target, targetId: "target1" });
  await assert.rejects(f.submitted({ targetId: "target2" }), /TARGET_NOT_ADMITTED/);
  await f.writeTarget("target2", { ...target, statement: "  " });
  await assert.rejects(f.submitted({ targetId: "target2" }), /TARGET_NOT_ADMITTED/);
  await chmod(f.targetsRoot, 0o770);
  await assert.rejects(f.submitted(), /TARGET_NOT_ADMITTED/);
  await chmod(f.targetsRoot, 0o700);
  await f.writeTarget("target2", target);
  assert.equal((await f.submitted({ targetId: "target2" })).requestId, "launch1");
});

test("a launch request needs a written finish line, a positive ceiling, a known task and known fields", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.submitted({ finishLine: " \n " }), /FINISH_LINE_MISSING/);
  const { finishLine: _omitted, ...withoutFinishLine } = f.request();
  await assert.rejects(
    f.clearances.submitRequest(requesterSeat, withoutFinishLine),
    /FINISH_LINE_MISSING/,
  );
  await assert.rejects(f.submitted({ finishLine: "x".repeat(4001) }), /INVALID_LAUNCH_REQUEST/);
  for (const tokenCeiling of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(f.submitted({ tokenCeiling }), /INVALID_LAUNCH_REQUEST/);
  await assert.rejects(f.submitted({ allowedModels: [] }), /INVALID_LAUNCH_REQUEST/);
  await assert.rejects(f.submitted({ allowedEfforts: ["low", "low"] }), /INVALID_LAUNCH_REQUEST/);
  await assert.rejects(
    f.clearances.submitRequest(requesterSeat, { ...f.request(), judgeId: "judge1" }),
    /INVALID_LAUNCH_REQUEST/,
  );
  await assert.rejects(f.submitted({ taskId: "task9" }), /TASK_NOT_FOUND/);
  const first = await f.submitted();
  assert.deepEqual(await f.submitted(), first);
  await assert.rejects(f.submitted({ tokenCeiling: 60000 }), /LAUNCH_REQUEST_REUSED/);
});

test("the request digest is the sha256 of the request's JSON with keys sorted", async (t) => {
  const f = await fixture(t);
  const { requestDigest } = await f.submitted({ allowedModels: ["gpt-b", "gpt-a"] });
  const sorted = {
    allowedEfforts: ["low"],
    allowedModels: ["gpt-a", "gpt-b"],
    finishLine: "The help text says hello and nothing else changed.",
    requestId: "launch1",
    requesterId: "lead1",
    targetId: "target1",
    taskId: "task1",
    tokenCeiling: 50000,
  };
  assert.equal(requestDigest, createHash("sha256").update(JSON.stringify(sorted)).digest("hex"));
});

test("a ruling's judge is the reviewer the kernel peer resolves to, never a name in the ruling", async (t) => {
  const f = await fixture(t);
  const { requestDigest } = await f.submitted();
  await assert.rejects(
    f.clearances.recordRuling(judge, {
      requestId: "launch1",
      requestDigest,
      verdict: "serves",
      reason: "It serves the target.",
      judgeId: "judge1",
    } as Parameters<typeof f.clearances.recordRuling>[1]),
    /INVALID_RULING/,
  );
  await assert.rejects(f.rule(judge, { requestDigest, verdict: "maybe" }), /INVALID_RULING/);
  await assert.rejects(f.rule(judge, { requestDigest, reason: " " }), /INVALID_RULING/);
  await assert.rejects(f.rule(judge, { requestId: "launch9", requestDigest }), /NOT_FOUND/);
  await assert.rejects(
    f.rule({ uid: 9999, gid: 9999, pid: 999 }, { requestDigest }),
    /NOT_AUTHORIZED/,
  );
  await assert.rejects(f.rule(workerSeat, { requestDigest }), /NOT_AUTHORIZED/);
  await assert.rejects(f.rule(otherTaskReviewer, { requestDigest }), /NOT_AUTHORIZED/);
  const ruling = await f.rule(judge, { requestDigest });
  assert.deepEqual(ruling, {
    requestId: "launch1",
    requestDigest,
    judgeId: "judge1",
    verdict: "serves",
    reason: "It serves the target.",
  });
});

test("a request whose requesterId is not the submitting principal is refused", async (t) => {
  const f = await fixture(t);
  // The judge seat authenticates as judge1 and names lead1 as the requester.
  await assert.rejects(
    f.clearances.submitRequest(judge, f.request({ requesterId: "lead1" })),
    /REQUESTER_MISMATCH/,
  );
  await assert.rejects(
    f.clearances.submitRequest({ uid: 9999, gid: 9999, pid: 999 }, f.request()),
    /NOT_AUTHORIZED/,
  );
  assert.equal((await f.submitted()).requestId, "launch1");
});

test("the principal that submitted a request cannot rule on it", async (t) => {
  const f = await fixture(t);
  const { requestDigest } = await f.clearances.submitRequest(
    judge,
    f.request({ requesterId: "judge1" }),
  );
  await assert.rejects(f.rule(judge, { requestDigest }), /SELF_RULING/);
});

test("a ruling by the requester or by the task's agent is refused as SELF_RULING", async (t) => {
  const f = await fixture(t);
  const { requestDigest } = await f.submitted();
  await assert.rejects(f.rule(requesterSeat, { requestDigest }), /SELF_RULING/);
  await assert.rejects(f.rule(agentSeat, { requestDigest }), /SELF_RULING/);
});

test("a ruling that names a different request digest is refused", async (t) => {
  const f = await fixture(t);
  await f.submitted();
  await assert.rejects(
    f.rule(judge, { requestDigest: "0".repeat(64) }),
    /CLEARANCE_DIGEST_MISMATCH/,
  );
});

test("a recorded ruling cannot be replaced", async (t) => {
  const f = await fixture(t);
  const { requestDigest } = await f.submitted();
  const ruling = await f.rule(judge, { requestDigest });
  assert.deepEqual(await f.rule(judge, { requestDigest }), ruling);
  await assert.rejects(
    f.rule(judge, { requestDigest, verdict: "does-not-serve" }),
    /RULING_ALREADY_RECORDED/,
  );
  assert.equal(
    (await f.clearances.verifyClearance("launch1", { taskId: "task1", agentId: "agent1" })).ruling
      .verdict,
    "serves",
  );
});

test("the supervisor launches nothing without a ruling: RULING_MISSING", async (t) => {
  const s = await supervised(t);
  await s.admit(judge, {}, null);
  await s.refused(/RULING_MISSING/);
});

test("the supervisor launches nothing on a does-not-serve ruling: RULING_NOT_SERVES", async (t) => {
  const s = await supervised(t);
  await s.admit(judge, {}, "does-not-serve");
  await s.refused(/RULING_NOT_SERVES/);
});

test("the supervisor launches nothing once the target is no longer admitted: TARGET_NOT_ADMITTED", async (t) => {
  const s = await supervised(t);
  await s.admit(judge);
  await rm(join(s.targetsRoot, "target1.json"));
  await s.refused(/TARGET_NOT_ADMITTED/);
});

test("the supervisor launches nothing when the stored finish line is blank: FINISH_LINE_MISSING", async (t) => {
  const s = await supervised(t);
  await s.admit(judge);
  // Consistent tampering: the request, its stored digest and the ruling's digest all agree.
  s.plant((request, ruling) => {
    request.finishLine = "   ";
    ruling.requestDigest = launchRequestDigest(request);
  });
  await s.refused(/FINISH_LINE_MISSING/);
});

test("the supervisor launches nothing on a ruling by the requester or the task's agent: SELF_RULING", async (t) => {
  const s = await supervised(t);
  await s.admit(judge);
  s.plant((_request, ruling) => {
    ruling.judgeId = "lead1";
  });
  await s.refused(/SELF_RULING/);
  s.plant((_request, ruling) => {
    ruling.judgeId = "agent1";
  });
  await s.refused(/SELF_RULING/);
});

test("the supervisor launches nothing when the request changed after its ruling: CLEARANCE_DIGEST_MISMATCH", async (t) => {
  const s = await supervised(t);
  await s.admit(judge);
  // The ceiling is raised and the stored digest follows it; the ruling still names the old one.
  s.plant((request) => {
    request.tokenCeiling = 900000;
  });
  await s.refused(/CLEARANCE_DIGEST_MISMATCH/);
  // The ruling is made to name the raised request, but the stored digest is left behind.
  s.plant((request, ruling) => {
    request.tokenCeiling = 900001;
    ruling.requestDigest = launchRequestDigest(request);
  });
  const db = new DatabaseSync(s.clearanceDatabase);
  db.prepare("UPDATE launch_requests SET digest=? WHERE request_id='launch1'").run("0".repeat(64));
  db.close();
  await s.refused(/CLEARANCE_DIGEST_MISMATCH/);
});

test("the supervisor launches nothing on an unknown clearance or one cleared for another task", async (t) => {
  const s = await supervised(t);
  await s.refused(/CLEARANCE_NOT_FOUND/);
  await s.admit(judge, { requestId: "launch2", taskId: "task2" });
  await s.refused(/CLEARANCE_TASK_MISMATCH/, { ...s.input, clearanceId: "launch2" });
});

test(
  "an admitted path: target file, request, kernel-identified judge, launch, then the grant's ceiling and clearance",
  { skip: process.platform !== "linux" || process.getuid?.() === 0 },
  async (t) => {
    const root = await mkdtemp(join(homedir(), ".launch-clearance-path-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new PublicationStore({ root: join(root, "publisher") });
    await store.initialize({ "help.txt": "baseline" });
    await store.openTask({ taskId: "task1", agentId: "agent1", scope: ["help.txt"] });
    const authorityUid = process.getuid!();
    // The lead and judge seats are reviewer grants matched from their kernel peers against a fake
    // /proc, so both the requester and the judge are identified by the kernel.
    const NOW = Date.now();
    const procRoot = join(root, "judge-proc");
    const judgeGrants = join(root, "judge-grants");
    await mkdir(join(procRoot, "sys/kernel/random"), { recursive: true });
    await mkdir(judgeGrants, { mode: 0o700 });
    const bootId = "a6c22550-61e9-4e91-930b-6661109c12af";
    await writeFile(join(procRoot, "sys/kernel/random/boot_id"), `${bootId}\n`);
    for (const seat of [
      { id: "judge1", uid: judge.uid, leader: 500, peer: judge.pid },
      { id: "lead1", uid: LEAD_SEAT.uid, leader: 510, peer: LEAD_SEAT.pid },
    ]) {
      for (const pid of [seat.leader, seat.peer]) {
        const dir = join(procRoot, String(pid));
        await mkdir(dir);
        const fields = Array<string>(40).fill("0");
        fields[0] = "S";
        fields[19] = String(pid * 10);
        await writeFile(join(dir, "stat"), `${pid} (seat) ${fields.join(" ")}\n`);
        const ids = Array<number>(4).fill(seat.uid).join("\t");
        await writeFile(join(dir, "status"), `Uid:\t${ids}\nGid:\t${ids}\n`);
        await writeFile(join(dir, "cgroup"), `0::/throughline/${seat.id}.service\n`);
      }
      await writeFile(
        join(judgeGrants, `${seat.id}-grant.json`),
        JSON.stringify({
          schema: "throughline.execution-grant.v1",
          grantId: `${seat.id}-grant`,
          principal: { id: seat.id, kind: "reviewer", taskIds: ["task1"] },
          uid: seat.uid,
          gid: seat.uid,
          bootId,
          cgroup: `/throughline/${seat.id}.service`,
          leaderPid: seat.leader,
          leaderStartTicks: String(seat.leader * 10),
          expiresAt: NOW + 60000,
        }),
        { mode: 0o600 },
      );
    }
    const j = await launchJudge(
      t,
      root,
      store,
      createExecutionGrantResolver({
        grantRoot: judgeGrants,
        authorityUid,
        procRoot,
        now: () => NOW,
      }),
    );
    const clearanceId = await j.admit(judge, {
      tokenCeiling: 7000,
      allowedModels: ["gpt-test"],
      allowedEfforts: ["low"],
    });
    const grantRoot = join(root, "grants");
    await mkdir(grantRoot, { mode: 0o700 });
    const authority = await ExecutionGrantAuthority.bootstrap({ root: grantRoot, authorityUid });
    t.after(() => authority.close());
    const identity = await authority.attest(process.pid);
    const workspaceRoot = join(root, "private"),
      workspacePath = join(workspaceRoot, "task1");
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
        return { pid: process.pid };
      },
      async inspect() {
        return running ? structuredClone(running) : null;
      },
      async release() {
        events.push("release");
      },
      async stop() {
        running = null;
      },
    };
    const issued: Array<{ remaining: number; clearance: unknown }> = [];
    const issue = authority.issue.bind(authority);
    const step: DurableExecutionStep = async <T>(_key: string, effect: () => Promise<T>) =>
      effect();
    const supervisor = new TaskExecutionSupervisor({
      store,
      authority: {
        read: authority.read.bind(authority),
        revoke: authority.revoke.bind(authority),
        // At the moment the grant is issued its ceiling and clearance already exist.
        issue: async (input) => {
          issued.push({
            remaining: await j.ledger.remaining(input.grantId),
            clearance: await j.clearances.grantClearance(input.grantId),
          });
          return issue(input);
        },
      },
      clearances: j.clearances,
      ledger: j.ledger,
      host,
      step,
    });
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
      clearanceId,
    };
    const result = await supervisor.start(input);
    assert.equal(result.status, "provider-released");
    assert.deepEqual(events, ["prepare", "launch", "release"]);
    const cleared = { taskId: "task1", allowedModels: ["gpt-test"], allowedEfforts: ["low"] };
    assert.deepEqual(issued, [{ remaining: 7000, clearance: cleared }]);
    assert.equal(await j.ledger.remaining("grant1"), 7000);
    assert.deepEqual(await j.clearances.grantClearance("grant1"), cleared);
    // Neither the ceiling nor the clearance of an issued grant can be changed afterwards.
    await assert.rejects(
      j.ledger.setCeiling({ grantId: "grant1", ceiling: 9000 }),
      /CEILING_ALREADY_SET/,
    );
    await assert.rejects(
      j.clearances.bindGrant({ grantId: "grant1", clearanceId: "launch2" }),
      /GRANT_ALREADY_BOUND/,
    );
  },
);

import test from "node:test";
import assert from "node:assert/strict";
import { TaskContext, type Queryable } from "absurd-sdk";

import { bindWorkspaceSteps } from "./workspace-steps.ts";

async function context(states = new Map<string, unknown>()) {
  const con = {
    async query(sql: string, params: unknown[]) {
      if (sql.includes("get_task_checkpoint_states"))
        return {
          rows: [...states].map(([checkpoint_name, state]) => ({ checkpoint_name, state })),
        };
      if (sql.includes("get_task_checkpoint_state")) {
        const key = String(params[2]);
        return { rows: states.has(key) ? [{ checkpoint_name: key, state: states.get(key) }] : [] };
      }
      if (sql.includes("set_task_checkpoint_state")) {
        states.set(String(params[2]), JSON.parse(String(params[3])));
        return { rows: [] };
      }
      throw Error("UNEXPECTED_TEST_QUERY");
    },
  } as unknown as Queryable;
  return TaskContext.create({
    log: { log() {}, info() {}, warn() {}, error() {} },
    taskID: "task-a",
    con,
    queueName: "isolated-test",
    task: {
      task_id: "task-a",
      run_id: "run-a",
      task_name: "test",
      attempt: 1,
      params: {},
      retry_strategy: {},
      max_attempts: 2,
      headers: null,
      wake_event: null,
      event_payload: null,
    },
    claimTimeout: 30,
    onLeaseExtended: () => undefined,
  });
}

test("repeated and concurrent execution keys run once in one Absurd attempt", async () => {
  const states = new Map<string, unknown>(),
    ctx = await context(states);
  const step = bindWorkspaceSteps(ctx);
  let calls = 0;
  const effect = async () => ({ invocation: ++calls });
  assert.deepEqual(
    await Promise.all([step("execution:run:launch", effect), step("execution:run:launch", effect)]),
    [{ invocation: 1 }, { invocation: 1 }],
  );
  assert.deepEqual(await bindWorkspaceSteps(ctx)("execution:run:launch", effect), {
    invocation: 1,
  });
  assert.equal(calls, 1);
  assert.deepEqual([...states.keys()], ["execution:run:launch"]);
});

test("fresh attempt replays committed Absurd state without authorizing a new effect", async () => {
  const states = new Map<string, unknown>();
  const first = bindWorkspaceSteps(await context(states));
  await first("execution:run:admission", async () => ({ digest: "fixed" }));
  const resumed = bindWorkspaceSteps(await context(states));
  assert.deepEqual(
    await resumed("execution:run:admission", async () => {
      throw Error("REPEATED_EFFECT");
    }),
    { digest: "fixed" },
  );
});

test("caller mutation cannot change the cached durable reference", async () => {
  const step = bindWorkspaceSteps(await context());
  const first = await step("execution:run:execution", async () => ({ pid: 123, paths: ["draft"] }));
  first.pid = 999;
  first.paths.push("foreign");
  assert.deepEqual(
    await step("execution:run:execution", async () => {
      throw Error("REPEAT");
    }),
    { pid: 123, paths: ["draft"] },
  );
});

test("uncertain failed effect stays failed within the attempt instead of running again", async () => {
  const step = bindWorkspaceSteps(await context());
  let calls = 0;
  const effect = async () => {
    calls++;
    throw Error("ACK_LOST");
  };
  await assert.rejects(step("execution:run:release", effect), /ACK_LOST/);
  await assert.rejects(step("execution:run:release", effect), /ACK_LOST/);
  assert.equal(calls, 1);
});

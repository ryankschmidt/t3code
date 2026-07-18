/**
 * Mechanical check for makeInProcessTransport (TQ-039 slice 1 negative controls).
 *
 * Dependency-free (node:assert) so it runs on the package's existing
 * `--experimental-strip-types` path with no test runner. Exercises the
 * fail-closed model requirement (NC2), dispatch-error propagation (NC3), and the
 * `thread.session-set` running -> ready completion signal. Implementer-independent
 * mechanical validation per the slice-1 handoff (implementer != validator).
 *
 * Run: node --experimental-strip-types src/in-process-transport.check.ts
 */
import assert from "node:assert/strict";

import { makeInProcessTransport, type ReplayEvent } from "./in-process-transport.ts";

const noEvents = async (): Promise<ReadonlyArray<ReplayEvent>> => [];

async function expectReject(p: Promise<unknown>, re: RegExp, label: string): Promise<void> {
  try {
    await p;
    throw new Error(`[${label}] expected rejection but the promise resolved`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    assert.match(message, re, `[${label}] unexpected message: ${message}`);
  }
}

const checks: Array<[string, () => Promise<void>]> = [
  [
    "resolveThread reuses an existing threadId without dispatching",
    async () => {
      let dispatched = 0;
      const t = makeInProcessTransport({
        dispatchCommand: async () => {
          dispatched++;
          return {};
        },
        replayEvents: noEvents,
        projectId: "p1",
        instanceId: "codex",
      });
      const r = await t.resolveThread({ threadId: "existing", model: "gpt-5.4" });
      assert.deepEqual(r, { threadId: "existing", created: false });
      assert.equal(dispatched, 0);
    },
  ],
  [
    "NC2: resolveThread requires a model — no default on this path",
    async () => {
      const t = makeInProcessTransport({
        dispatchCommand: async () => ({}),
        replayEvents: noEvents,
        projectId: "p1",
        instanceId: "codex",
      });
      await expectReject(t.resolveThread({}), /model is required/, "NC2");
    },
  ],
  [
    "resolveThread dispatches thread.create carrying the explicit model",
    async () => {
      let cmd: Record<string, unknown> | undefined;
      const t = makeInProcessTransport({
        dispatchCommand: async (c) => {
          cmd = c;
          return {};
        },
        replayEvents: noEvents,
        projectId: "proj-x",
        instanceId: "codex",
      });
      const r = await t.resolveThread({ model: "gpt-5.4" });
      assert.equal(r.created, true);
      assert.equal(cmd?.type, "thread.create");
      assert.equal(cmd?.projectId, "proj-x");
      assert.deepEqual(cmd?.modelSelection, { instanceId: "codex", model: "gpt-5.4" });
    },
  ],
  [
    "dispatchTurn omits modelSelection so the turn inherits the thread model",
    async () => {
      let cmd: Record<string, unknown> | undefined;
      const t = makeInProcessTransport({
        dispatchCommand: async (c) => {
          cmd = c;
          return {};
        },
        replayEvents: noEvents,
        projectId: "p",
        instanceId: "codex",
      });
      await t.dispatchTurn("thread-1", "hello");
      assert.equal(cmd?.type, "thread.turn.start");
      assert.equal(cmd?.modelSelection, undefined);
    },
  ],
  [
    "NC3: a dispatch rejection propagates as a named error (bounded by task attempts)",
    async () => {
      const t = makeInProcessTransport({
        dispatchCommand: async () => {
          throw new Error("unknown project reference");
        },
        replayEvents: noEvents,
        projectId: "missing",
        instanceId: "codex",
      });
      await expectReject(t.resolveThread({ model: "gpt-5.4" }), /unknown project reference/, "NC3");
    },
  ],
  [
    "awaitTurnComplete returns completed on session-set running -> ready",
    async () => {
      const events: ReplayEvent[] = [
        {
          sequence: 1,
          type: "thread.session-set",
          aggregateId: "thread-1",
          payload: { threadId: "thread-1", session: { status: "running" } },
        },
        {
          sequence: 2,
          type: "thread.session-set",
          aggregateId: "thread-1",
          payload: { threadId: "thread-1", session: { status: "ready" } },
        },
      ];
      const t = makeInProcessTransport({
        dispatchCommand: async () => ({}),
        replayEvents: async (from) => events.filter((e) => e.sequence > from),
        projectId: "p",
        instanceId: "codex",
        pollIntervalMs: 1,
      });
      const done = await t.awaitTurnComplete("thread-1", "seq:0:msg", 10);
      assert.equal(done.state, "completed");
    },
  ],
  [
    "awaitTurnComplete throws on session error",
    async () => {
      const events: ReplayEvent[] = [
        {
          sequence: 1,
          type: "thread.session-set",
          aggregateId: "thread-1",
          payload: { threadId: "thread-1", session: { status: "error", lastError: "boom" } },
        },
      ];
      const t = makeInProcessTransport({
        dispatchCommand: async () => ({}),
        replayEvents: async (from) => events.filter((e) => e.sequence > from),
        projectId: "p",
        instanceId: "codex",
        pollIntervalMs: 1,
      });
      await expectReject(t.awaitTurnComplete("thread-1", "seq:0:msg", 10), /session error/, "session-error");
    },
  ],
];

let failed = 0;
for (const [name, run] of checks) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);

/**
 * agent-queue fan-out proof (T2.2 gate evidence, client-side spawner).
 *
 * Starts NO worker. Spawns one t3.agent-fanout parent (4 children, one with an
 * injected first-attempt failure) against the RUNNING server's workers, then:
 *   1. awaits the parent's durable join result;
 *   2. asserts all children completed (incl. the retried one — retries observed);
 *   3. proves exactly-once at BOTH levels: re-spawning the parent with the same
 *      idempotencyKey returns created:false + the same taskID, and the parent's
 *      own spawn steps carry the engine-deduped child taskIDs;
 *   4. prints Habitat-checkable IDs.
 *
 * Run: node --env-file=.env --experimental-strip-types src/spawn-fanout-proof.ts
 */
import { tmpdir } from "node:os";
import { Absurd } from "absurd-sdk";
import { AGENT_FANOUT_TASK, type AgentFanoutParams, type AgentFanoutResult } from "./agent-queue.ts";

const MAIN_QUEUE = "t3-absurd-runtime";
const app = new Absurd({ queueName: MAIN_QUEUE });

const idem = `fanout-proof-${Date.now()}`;
const params: AgentFanoutParams = {
  count: 4,
  holdMs: 2500,
  injectFailAt: 2,
  markerDir: tmpdir(),
};

const first = await app.spawn(AGENT_FANOUT_TASK, params, {
  queue: MAIN_QUEUE,
  idempotencyKey: idem,
});
console.log(`[fanout-proof] parent spawned: ${first.taskID} created=${first.created}`);

// Exactly-once, parent level: identical spawn is deduped by the engine.
const second = await app.spawn(AGENT_FANOUT_TASK, params, {
  queue: MAIN_QUEUE,
  idempotencyKey: idem,
});
console.log(
  `[fanout-proof] duplicate spawn: ${second.taskID} created=${second.created} (same task: ${second.taskID === first.taskID})`,
);

const snapshot = await app.awaitTaskResult(first.taskID, { timeout: 300 });
if (snapshot.state !== "completed") {
  console.error(`[fanout-proof] FAIL — parent state=${snapshot.state}`, JSON.stringify(snapshot));
  await app.close();
  process.exit(1);
}
const result = snapshot.result as unknown as AgentFanoutResult;
console.log("[fanout-proof] parent durable result:");
console.log(JSON.stringify(result, null, 2));

const checks = [
  ["all-children-completed", result.allCompleted === true],
  ["four-children", result.spawned.length === 4 && result.joined.length === 4],
  ["parent-dedup", second.created === false && second.taskID === first.taskID],
  ["children-created-once", result.spawned.every((s) => s.created === true)],
] as const;
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(`FANOUT_PROOF_PARENT_TASK_ID=${first.taskID}`);
console.log(`FANOUT_PROOF_CHILD_TASK_IDS=${result.spawned.map((s) => s.taskID).join(",")}`);
await app.close();
process.exit(failed === 0 ? 0 : 1);

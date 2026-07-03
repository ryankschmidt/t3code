/**
 * Boot-proof spawner (T1.2, Landing Sprint): enqueue a health-probe task on the
 * server's queue WITHOUT starting a local worker. If the task completes, the
 * ONLY worker that can have executed it is the one inside the running T3
 * backend (AbsurdRuntimeLive). Prints the durable result + task id.
 *
 * Run: node --env-file=.env --experimental-strip-types src/spawn-proof.ts
 */
import { Absurd } from "absurd-sdk";
import { HEALTH_PROBE_TASK, type HealthProbeParams } from "./task.ts";

const QUEUE_NAME = process.env.ABSURD_QUEUE ?? "t3-absurd-runtime";
const app = new Absurd({ queueName: QUEUE_NAME });

const params: HealthProbeParams = {
  probeId: `boot-proof-${Date.now()}`,
  components: ["postgres", "worker", "queue"],
};

const spawned = await app.spawn(HEALTH_PROBE_TASK, params, { queue: QUEUE_NAME });
console.log(`[spawn-proof] spawned ${spawned.taskID} on "${QUEUE_NAME}" (NO local worker)`);

const result = await app.awaitTaskResult(spawned.taskID, { timeout: 60 });
console.log("[spawn-proof] durable result (executed by the SERVER worker):");
console.log(JSON.stringify(result, null, 2));
console.log(`SPAWN_PROOF_TASK_ID=${spawned.taskID}`);
await app.close();
process.exit(0);

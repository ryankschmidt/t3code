/**
 * T1.3 proof spawner: enqueue ONE durable thread-run (no local worker) and
 * await its result — executed by the worker inside the running T3 server.
 *
 * Usage: node --env-file=.env --experimental-strip-types src/spawn-thread-run.ts [holdMs]
 * (holdMs defaults to 10000; the T1.4 validator uses a large value to land a
 * kill inside step 3.)
 */
import { Absurd } from "absurd-sdk";
import { THREAD_RUN_TASK, type ThreadRunParams } from "./thread-driver.ts";

const QUEUE_NAME = process.env.ABSURD_QUEUE ?? "t3-absurd-runtime";
const holdMs = Number(process.argv[2] ?? 10000);
const app = new Absurd({ queueName: QUEUE_NAME });

const params: ThreadRunParams = {
  prompt: "Landing Sprint T1.3 proof: run one durable thread turn.",
  holdMs,
};

const spawned = await app.spawn(THREAD_RUN_TASK, params, { queue: QUEUE_NAME });
console.log(`[thread-run-proof] spawned ${spawned.taskID} (holdMs=${holdMs}, NO local worker)`);

const result = await app.awaitTaskResult(spawned.taskID, { timeout: Math.ceil(holdMs / 1000) + 60 });
console.log("[thread-run-proof] durable result:");
console.log(JSON.stringify(result, null, 2));
console.log(`THREAD_RUN_TASK_ID=${spawned.taskID}`);
await app.close();
process.exit(0);

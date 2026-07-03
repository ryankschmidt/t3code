/**
 * Self-contained smoke test for the @t3tools/absurd-runtime overlay module.
 *
 * Proves the full Absurd durable stack works INSIDE the T3 Code fork in ONE run:
 *   1. ensure the queue exists (idempotent, via the documented `absurdctl create-queue`)
 *   2. start the durable worker (registers the task, polls in the background)
 *   3. spawn one durable task
 *   4. await its durable result and print it
 *   5. close cleanly and exit
 *
 * Modeled on absurd-sandbox/src/demo.ts. Connection comes from
 * ABSURD_DATABASE_URL (loaded via `node --env-file=.env`).
 *
 * Run:  corepack pnpm -C packages/absurd-runtime smoke
 */
import { spawnSync } from "node:child_process";
import { startAbsurdRuntime } from "./worker.ts";
import { HEALTH_PROBE_TASK, type HealthProbeParams } from "./task.ts";

const QUEUE_NAME = "t3-absurd-runtime";

/**
 * Ensure the queue exists. `absurdctl create-queue` is idempotent in intent;
 * if it already exists we tolerate the non-zero exit and continue. absurdctl
 * shells out to psql, so libpq must be on PATH (prepended here).
 */
function ensureQueue(queueName: string): void {
  const libpqBin = "/opt/homebrew/opt/libpq/bin";
  const localBin = `${process.env.HOME ?? ""}/.local/bin`;
  const res = spawnSync("absurdctl", ["create-queue", queueName], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${libpqBin}:${localBin}:${process.env.PATH ?? ""}`,
    },
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  if (res.status === 0) {
    console.log(`[smoke] ensured queue "${queueName}"`);
  } else if (/exist/i.test(out)) {
    console.log(`[smoke] queue "${queueName}" already exists — continuing`);
  } else {
    // Non-fatal: the queue may already exist via a path absurdctl reports
    // differently. Surface it but let the worker/spawn be the real arbiter.
    console.warn(
      `[smoke] create-queue returned status=${res.status}; output: ${out || "(none)"}`,
    );
  }
}

async function main(): Promise<void> {
  ensureQueue(QUEUE_NAME);

  const runtime = startAbsurdRuntime({ queueName: QUEUE_NAME, concurrency: 1 });

  const params: HealthProbeParams = {
    probeId: `probe-${Date.now()}`,
    components: ["postgres", "worker", "queue"],
  };

  const spawned = await runtime.app.spawn(HEALTH_PROBE_TASK, params, {
    queue: QUEUE_NAME,
  });
  console.log("[smoke] spawned task:", spawned.taskID);

  const result = await runtime.app.awaitTaskResult(spawned.taskID, {
    timeout: 30,
  });
  console.log("[smoke] final durable result:\n" + JSON.stringify(result, null, 2));

  // Emit the task id on its own line so the run harness can capture it for
  // the durability evidence (absurdctl dump-task <id>).
  console.log("ABSURD_RUNTIME_TASK_ID=" + spawned.taskID);

  await runtime.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke] failed:", err);
  process.exit(1);
});

/**
 * Reusable worker starter for the absurd-runtime overlay capability module.
 *
 * This is the seam the backend server (apps/server) would call to launch the
 * Absurd worker as part of its boot. It is intentionally tiny and side-effect
 * free until invoked: construct an `Absurd` app bound to a queue, register the
 * durable task, and start the polling worker.
 *
 * Connection comes from ABSURD_DATABASE_URL in the environment (the SDK reads
 * it). The caller owns process lifecycle; `startWorker` polls forever, so it is
 * NOT awaited here (matches absurd-sandbox/src/demo.ts).
 */
import { Absurd } from "absurd-sdk";
import { registerHealthProbeTask } from "./task.ts";

export type StartAbsurdRuntimeOptions = {
  /** Queue name to bind the app and worker to. Defaults to "default". */
  queueName?: string;
  /** Worker concurrency. Defaults to 1. */
  concurrency?: number;
};

export type AbsurdRuntimeHandle = {
  /** The constructed Absurd app (spawn/await/close against this). */
  app: Absurd;
  /** The queue this runtime is bound to. */
  queueName: string;
  /** Stop the worker and close the underlying pool. */
  close: () => Promise<void>;
};

/**
 * Construct an Absurd app, register the durable task, and start the worker.
 *
 * Returns a handle so the caller can spawn tasks, await results, and shut down
 * cleanly. The worker promise is deliberately not awaited (it polls forever);
 * errors are surfaced to the console so a boot-time failure is visible.
 */
export function startAbsurdRuntime(
  options: StartAbsurdRuntimeOptions = {},
): AbsurdRuntimeHandle {
  const queueName = options.queueName ?? "default";
  const concurrency = options.concurrency ?? 1;

  const app = new Absurd({ queueName });
  registerHealthProbeTask(app);

  // Poll forever in the background of the host process — do not await.
  app
    .startWorker({ concurrency })
    .catch((err) => console.error("[absurd-runtime] worker error:", err));

  return {
    app,
    queueName,
    close: async () => {
      await app.close();
    },
  };
}

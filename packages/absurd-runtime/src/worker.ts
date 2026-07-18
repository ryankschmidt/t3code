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
import { registerAgentFanoutTask, startAgentQueueWorker } from "./agent-queue.ts";
import { registerHealthProbeTask } from "./task.ts";
import {
  makeLocalEchoTransport,
  registerThreadRunTask,
  type ThreadTransport,
} from "./thread-driver.ts";
import { type LazyWsRpcTransport, makeWsRpcTransportFromEnv } from "./ws-rpc-transport.ts";

export type StartAbsurdRuntimeOptions = {
  /** Queue name to bind the app and worker to. Defaults to "default". */
  queueName?: string;
  /** Worker concurrency. Defaults to 1. */
  concurrency?: number;
  /** Concurrency bound for the dedicated agent fan-out queue. Defaults to 4. */
  agentQueueConcurrency?: number;
  /**
   * Server-owned in-process turn rail (TQ-039 slice 1). When provided, it takes
   * priority over the env-gated WS transport and the LocalEcho fallback, so the
   * server hosts the durable thread-run against its own orchestration layer.
   */
  transport?: ThreadTransport;
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
  // Transport priority (TQ-039 slice 1): an explicitly-injected transport (the
  // server-owned in-process rail) wins; else the env-gated WS door
  // (T3_THREAD_TRANSPORT=ws, lazy connect so boot never blocks); else LocalEcho.
  const explicitTransport = options.transport ?? null;
  const wsTransport: LazyWsRpcTransport | null =
    explicitTransport === null && process.env["T3_THREAD_TRANSPORT"] === "ws"
      ? makeWsRpcTransportFromEnv()
      : null;
  registerThreadRunTask(app, explicitTransport ?? wsTransport ?? makeLocalEchoTransport());
  // agent-queue (T2.2): fan-out parents run on THIS queue; their children run
  // on the dedicated agent queue below (cross-queue joins are deadlock-free).
  registerAgentFanoutTask(app);

  // Poll forever in the background of the host process — do not await.
  app
    .startWorker({ concurrency })
    .catch((err) => console.error("[absurd-runtime] worker error:", err));

  // Dedicated fan-out worker (backpressure bound lives on its concurrency).
  const agentQueue = startAgentQueueWorker({
    concurrency: options.agentQueueConcurrency ?? 4,
  });

  return {
    app,
    queueName,
    close: async () => {
      await agentQueue.close();
      if (wsTransport) await wsTransport.close();
      await app.close();
    },
  };
}

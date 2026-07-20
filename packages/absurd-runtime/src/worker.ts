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
import { startSymphonyQueueWorker, type SymphonyQueueWorkerHandle } from "./symphony-queue.ts";
import { registerHealthProbeTask } from "./task.ts";
import { registerThreadRunTask, type ThreadTransport } from "./thread-driver.ts";
import { startSupervisedWorker } from "./worker-supervisor.ts";

export type StartAbsurdRuntimeOptions = {
  /** Queue name to bind the app and worker to. Defaults to "default". */
  queueName?: string;
  /** Worker concurrency. Defaults to 1. */
  concurrency?: number;
  /** Concurrency bound for the dedicated agent fan-out queue. Defaults to 4. */
  agentQueueConcurrency?: number;
  /**
   * Concurrency bound for the dedicated symphony campaign queue (Slice 1S
   * D2). Defaults to 2, or `T3_SYMPHONY_CONCURRENCY` when set — see
   * symphony-queue.ts. Passing a value here takes priority over the env var.
   */
  symphonyQueueConcurrency?: number;
  /**
   * The turn rail (REQUIRED — bypass unrepresentable). Every runtime hosts the
   * durable thread-run against an explicitly-injected transport; there is no
   * env-gated door and no ambient fallback, so a rail-less runtime does not
   * compile. Production injects the server-owned in-process rail
   * (AbsurdRuntimeInProcessLive); proofs and smoke inject their transport
   * explicitly at their own call sites.
   */
  transport: ThreadTransport;
};

export type AbsurdRuntimeHandle = {
  /** The constructed Absurd app (spawn/await/close against this). */
  app: Absurd;
  /** The queue this runtime is bound to. */
  queueName: string;
  /** Stop the worker and close the underlying pool. */
  close: () => Promise<void>;
  /**
   * Slice 1S (design: Slice-1S-Session-Boundary-Design.md,
   * symphony-typescript-port) ruling #3 — additive widening: the dedicated
   * symphony-queue worker handle, so the session-boundary readiness probe can
   * reach it. Optional so existing `AbsurdRuntimeHandle`-shaped values (test
   * fakes, any future minimal construction) remain valid without change —
   * `startAbsurdRuntime` always populates it; only its absence is new-code
   * territory, not the rail path, which never reads this field.
   */
  symphonyQueue?: SymphonyQueueWorkerHandle;
};

/**
 * Construct an Absurd app, register the durable task, and start the worker.
 *
 * Returns a handle so the caller can spawn tasks, await results, and shut down
 * cleanly. The worker promise is deliberately not awaited (it polls forever);
 * errors are surfaced to the console so a boot-time failure is visible.
 */
export function startAbsurdRuntime(options: StartAbsurdRuntimeOptions): AbsurdRuntimeHandle {
  const queueName = options.queueName ?? "default";
  const concurrency = options.concurrency ?? 1;

  // Bypass unrepresentable: the transport is a required constructor input.
  // The old env-gated WS door (T3_THREAD_TRANSPORT=ws) and LocalEcho fallback
  // are gone — no config or environment value can route a runtime off the
  // injected rail.
  const transport = options.transport;

  // Pool-recovery supervision (landing defect fix): the worker runs under a
  // supervisor that recreates the app (fresh pg pool) on a dead-pool error
  // streak. Consumers reach the live generation through the handle's `app`
  // getter — never capture the app object across turns.
  const supervisor = startSupervisedWorker({
    label: `absurd-runtime:${queueName}`,
    createApp: () => new Absurd({ queueName }),
    registerTasks: (app) => {
      registerHealthProbeTask(app);
      registerThreadRunTask(app, transport);
      // agent-queue (T2.2): fan-out parents run on THIS queue; their children
      // run on the dedicated agent queue below (cross-queue joins are
      // deadlock-free).
      registerAgentFanoutTask(app);
    },
    concurrency,
  });

  // Dedicated fan-out worker (backpressure bound lives on its concurrency).
  const agentQueue = startAgentQueueWorker({
    concurrency: options.agentQueueConcurrency ?? 4,
  });

  // Dedicated symphony-campaign worker (Slice 1S D3): same transport as the
  // rail's registerThreadRunTask registration above, different queue — this
  // is the structural lane separation the session-boundary probe verifies.
  const symphonyQueue = startSymphonyQueueWorker({
    // exactOptionalPropertyTypes: omit the key entirely when unset so
    // startSymphonyQueueWorker's own `?? readSymphonyConcurrencyEnv() ?? 2`
    // fallback chain (D2) still runs — passing `concurrency: undefined`
    // explicitly would short-circuit that chain at the type level.
    ...(options.symphonyQueueConcurrency !== undefined
      ? { concurrency: options.symphonyQueueConcurrency }
      : {}),
    transport,
  });

  return {
    get app() {
      return supervisor.app;
    },
    queueName,
    symphonyQueue,
    close: async () => {
      await agentQueue.close();
      await symphonyQueue.close();
      await supervisor.close();
    },
  };
}

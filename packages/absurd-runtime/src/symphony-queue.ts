/**
 * symphony-queue (Slice 1S — design: Slice-1S-Session-Boundary-Design.md,
 * symphony-typescript-port).
 *
 * Dedicated queue for symphony campaign `t3.thread-run` spawns, isolated from
 * the interactive turn rail (`t3-absurd-runtime`, concurrency 8). The
 * module's secret is the same one agent-queue.ts owns: QUEUE TOPOLOGY is what
 * makes a campaign fan-out structurally incapable of starving Ryan's live
 * interactive turns, instead of merely being policed by a runtime readiness
 * check after the fact.
 *
 * D7 (cross-queue join rule, verbatim from the design doc): the SDK requires
 * `ctx.awaitTaskResult` to target a DIFFERENT queue than the caller's
 * (same-queue joins can deadlock worker slots — documented in agent-queue.ts's
 * header). `t3.thread-run` is a leaf task (no awaits), so `t3-symphony` is
 * safe. If the campaign later adds parent orchestrator tasks that await
 * children, parents must NOT share `t3-symphony` with the children they
 * await — put parents on `t3-absurd-runtime` or a third queue.
 *
 * Must NOT own: provider dispatch, UI rendering, checkpoint storage (the
 * checkpoint-bridge owns that), or readiness computation (runtimeReadiness.ts
 * owns the probe that reads this queue's reachability; this module only
 * starts/stops the worker).
 */
import { Absurd } from "absurd-sdk";

import { registerThreadRunTask, type ThreadTransport } from "./thread-driver.ts";
import { startSupervisedWorker } from "./worker-supervisor.ts";

/** Dedicated queue for symphony campaign spawns (D1). */
export const SYMPHONY_QUEUE = "t3-symphony" as const;

export type SymphonyQueueWorkerHandle = {
  app: Absurd;
  queueName: string;
  close: () => Promise<void>;
};

/**
 * Read the D2 concurrency override. Returns `undefined` (falls back to the
 * default) on an absent, blank, non-finite, or non-positive value — never
 * throws, and the env var is never required for boot.
 */
function readSymphonyConcurrencyEnv(): number | undefined {
  const raw = process.env["T3_SYMPHONY_CONCURRENCY"];
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Start the dedicated symphony-queue worker (D3 — mirrors
 * `startAgentQueueWorker` in agent-queue.ts: its own `startSupervisedWorker`,
 * so pool-recovery supervision comes free). Registers
 * `registerThreadRunTask(app, transport)` on the symphony queue using the
 * SAME transport the interactive rail's worker was given — the durable task
 * body is identical; only the queue (and therefore the concurrency bound) it
 * runs on differs.
 *
 * Concurrency defaults to 2 (D2): campaign throughput is a tuning knob,
 * interactive-lane protection is the invariant — a low default keeps first
 * campaign runs safe. Override via `T3_SYMPHONY_CONCURRENCY`.
 */
export function startSymphonyQueueWorker(options: {
  concurrency?: number;
  transport: ThreadTransport;
}): SymphonyQueueWorkerHandle {
  const concurrency = options.concurrency ?? readSymphonyConcurrencyEnv() ?? 2;
  const transport = options.transport;

  // Pool-recovery supervision + idempotent queue preparation, identical
  // shape to agent-queue.ts's startAgentQueueWorker: the queue's Postgres
  // surface must exist before each generation's worker polls it (the engine
  // does not auto-create on claim); creation is idempotent — "already
  // exists" is the normal warm-boot case, infra errors bubble out so the
  // supervisor re-enters backoff instead of polling a queue that may not
  // exist.
  const supervisor = startSupervisedWorker({
    label: `symphony-queue:${SYMPHONY_QUEUE}`,
    createApp: () => new Absurd({ queueName: SYMPHONY_QUEUE }),
    registerTasks: (app) => registerThreadRunTask(app, transport),
    prepareQueue: async (app) => {
      try {
        await app.createQueue(SYMPHONY_QUEUE);
      } catch (err: unknown) {
        const msg = String(err instanceof Error ? err.message : err);
        if (/already exists|duplicate/i.test(msg)) return;
        throw err;
      }
    },
    concurrency,
  });
  console.log(
    `[symphony-queue] worker starting (queue ${SYMPHONY_QUEUE}, concurrency ${concurrency})`,
  );
  return {
    get app() {
      return supervisor.app;
    },
    queueName: SYMPHONY_QUEUE,
    close: () => supervisor.close(),
  };
}

/**
 * agent-queue (charter capability module #3, Landing Sprint T2.2).
 *
 * Durable pull-based fan-out with concurrency + backpressure. The module's
 * secret is the QUEUE TOPOLOGY that makes joins deadlock-free and spawns
 * exactly-once:
 *
 *   - Parents run on the main runtime queue; children run on a DEDICATED
 *     agent queue with its own worker + concurrency bound. The SDK requires
 *     `ctx.awaitTaskResult` to target a different queue than the caller's —
 *     same-queue joins can deadlock worker slots.
 *   - Every child spawn happens inside a committed step AND carries an
 *     `idempotencyKey` derived from (parent taskID, child index). A replayed
 *     parent re-issues the same spawns and the engine dedupes them
 *     (`created: false`, same child taskID) — fan-out is exactly-once even
 *     across parent kills/retries.
 *   - Backpressure = the agent worker's `concurrency` bound: children beyond
 *     it sit queued in Postgres, visible in Habitat, claimed as slots free.
 *
 * Must NOT own: provider dispatch, UI rendering, checkpoint storage (the
 * checkpoint-bridge owns step→git capture), retry POLICY decisions beyond
 * sane defaults (callers override via params).
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Absurd } from "absurd-sdk";

/** Dedicated queue for fanned-out agent work. */
export const AGENT_QUEUE = "t3-agent-queue" as const;
/** Parent task: fans out N children and durably joins them. */
export const AGENT_FANOUT_TASK = "t3.agent-fanout" as const;
/** Child task: a unit of agent work (real duration; optional failure injection). */
export const AGENT_WORK_TASK = "t3.agent-work" as const;

export type AgentWorkParams = {
  /** Human-readable unit label (shows in logs/Habitat params). */
  label: string;
  /** Simulated work duration per attempt (ms). Default 2000. */
  holdMs?: number;
  /**
   * Retry-proof injection: a marker file path. If set and the marker does NOT
   * exist, this attempt writes it and THROWS (attempt 1 fails); the next
   * attempt finds the marker and succeeds. Deliberately outside any step so it
   * executes once per real attempt — the marker on disk is the retry witness.
   */
  failOnceMarker?: string;
};

export type AgentWorkResult = {
  label: string;
  heldMs: number;
  completedAt: string;
};

export function registerAgentWorkTask(app: Absurd): void {
  app.registerTask<AgentWorkParams>(
    { name: AGENT_WORK_TASK, defaultMaxAttempts: 3 },
    async (params, ctx) => {
      const holdMs = params.holdMs ?? 2000;
      console.log(`[agent-work ${ctx.taskID}] EXECUTING label=${params.label}`);

      if (params.failOnceMarker && !existsSync(params.failOnceMarker)) {
        writeFileSync(params.failOnceMarker, `${ctx.taskID} attempt-1 ${new Date().toISOString()}\n`);
        console.log(`[agent-work ${ctx.taskID}] INJECTED FAILURE (attempt 1, marker written)`);
        throw new Error(`injected first-attempt failure for ${params.label}`);
      }

      const done = await ctx.step("do-work", async () => {
        await new Promise((resolve) => setTimeout(resolve, holdMs));
        return { completedAt: new Date().toISOString() };
      });

      const result: AgentWorkResult = {
        label: params.label,
        heldMs: holdMs,
        completedAt: done.completedAt,
      };
      return result;
    },
  );
}

export type AgentFanoutParams = {
  /** Number of children to fan out. */
  count: number;
  /** Per-child work duration (ms). Default 2000. */
  holdMs?: number;
  /** Index of ONE child that fails its first attempt (retry proof). Omit for none. */
  injectFailAt?: number;
  /** Directory for failure-injection markers (required when injectFailAt is set). */
  markerDir?: string;
};

export type AgentFanoutResult = {
  spawned: Array<{ index: number; taskID: string; created: boolean }>;
  joined: Array<{ index: number; taskID: string; state: string }>;
  allCompleted: boolean;
};

/**
 * Register the fan-out parent on the MAIN runtime app. Children are spawned
 * cross-queue onto AGENT_QUEUE and joined durably (each join is a checkpoint).
 */
export function registerAgentFanoutTask(app: Absurd): void {
  app.registerTask<AgentFanoutParams>(
    { name: AGENT_FANOUT_TASK, defaultMaxAttempts: 5 },
    async (params, ctx) => {
      console.log(`[agent-fanout ${ctx.taskID}] EXECUTING fan-out count=${params.count}`);

      const spawned: AgentFanoutResult["spawned"] = [];
      for (let i = 0; i < params.count; i++) {
        const spawn = await ctx.step(`spawn:${i}`, async () => {
          const childParams: AgentWorkParams = {
            label: `child-${i}`,
            ...(params.holdMs !== undefined ? { holdMs: params.holdMs } : {}),
            ...(params.injectFailAt === i && params.markerDir
              ? { failOnceMarker: join(params.markerDir, `fail-once-${ctx.taskID}-${i}.marker`) }
              : {}),
          };
          const result = await app.spawn(AGENT_WORK_TASK, childParams, {
            queue: AGENT_QUEUE,
            idempotencyKey: `${ctx.taskID}:child:${i}`,
            maxAttempts: 3,
            retryStrategy: { kind: "fixed", baseSeconds: 1 },
          });
          return { taskID: result.taskID, created: result.created };
        });
        spawned.push({ index: i, taskID: spawn.taskID, created: spawn.created });
      }

      const joined: AgentFanoutResult["joined"] = [];
      for (const child of spawned) {
        const snapshot = await ctx.awaitTaskResult(child.taskID, {
          queue: AGENT_QUEUE,
          stepName: `join:${child.index}`,
          timeout: 300,
        });
        joined.push({ index: child.index, taskID: child.taskID, state: snapshot.state });
      }

      const result: AgentFanoutResult = {
        spawned,
        joined,
        allCompleted: joined.every((j) => j.state === "completed"),
      };
      return result;
    },
  );
}

export type AgentQueueWorkerHandle = {
  app: Absurd;
  queueName: string;
  close: () => Promise<void>;
};

/**
 * Start the dedicated agent-queue worker (the backpressure bound lives here).
 * Runs inside the same host process as the main runtime worker.
 */
export function startAgentQueueWorker(options: { concurrency?: number } = {}): AgentQueueWorkerHandle {
  const concurrency = options.concurrency ?? 4;
  const app = new Absurd({ queueName: AGENT_QUEUE });
  registerAgentWorkTask(app);
  // The queue's Postgres surface must exist before the worker polls it (the
  // engine does not auto-create on claim). Creation is treated as idempotent:
  // an already-existing queue is the normal warm-boot case.
  app
    .createQueue(AGENT_QUEUE)
    .catch((err: unknown) => {
      const msg = String(err instanceof Error ? err.message : err);
      if (!/already exists|duplicate/i.test(msg)) {
        console.error("[agent-queue] createQueue failed:", err);
      }
    })
    .then(() =>
      app.startWorker({ concurrency }).catch((err) => console.error("[agent-queue] worker error:", err)),
    );
  console.log(`[agent-queue] worker starting (queue ${AGENT_QUEUE}, concurrency ${concurrency})`);
  return {
    app,
    queueName: AGENT_QUEUE,
    close: async () => {
      await app.close();
    },
  };
}

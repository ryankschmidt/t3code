/**
 * durable-thread-driver (charter capability module #2, Landing Sprint T1.3).
 *
 * Wraps ONE T3 thread/plan-run as a durable Absurd task with three
 * checkpointed steps. A crash/kill at any point resumes from the last
 * COMMITTED step: completed steps are replayed from Postgres, never re-run.
 *
 *   step 1  resolve-thread       -> { threadId, created }
 *   step 2  dispatch-turn        -> { turnId, dispatchedAt }
 *   step 3  await-turn-complete  -> { state, summary }
 *
 * The T3 side is reached through the narrow `ThreadTransport` seam:
 *   - `LocalEchoTransport` (below): real checkpointed work + real durations,
 *     no provider instance or WS auth required. Used for the T1.4 kill/resume
 *     gate — the gate proves ENGINE resume semantics, which are transport-
 *     independent by construction.
 *   - `WsRpcTransport` (Day-2 slice T1.3b): drives a real thread over the
 *     server's WS RPC (`thread.turn.start` per contracts/orchestration) with a
 *     bearer session from `t3 auth session issue --token-only`. Requires a
 *     configured provider instance. Slots in here with zero changes to the
 *     task shape — the steps and checkpoints are already the real ones.
 *
 * Every step logs an `EXECUTING` marker exactly once per real execution, so a
 * validator can count executions across server boots: after a mid-step-3 kill,
 * steps 1-2 must show ONE execution total while step 3 shows two.
 */
import type { Absurd } from "absurd-sdk";
import { captureStepCheckpoint } from "./checkpoint-bridge.ts";

export type ThreadRunParams = {
  /** The user prompt / instruction for the turn. */
  prompt: string;
  /** Existing thread to reuse; omit to create one. */
  threadId?: string;
  /** Project path the thread belongs to (transport-specific meaning). */
  projectPath?: string;
  /** How long step 3 holds before completing (ms). Lets the T1.4 validator
   * land a kill INSIDE step 3 deterministically. Default 8000. */
  holdMs?: number;
  /**
   * checkpoint-bridge (T2.1) opt-in: when present, the run captures a SCOPED
   * git checkpoint as its own committed step after each mutating boundary
   * (dispatch-turn, await-turn-complete). Refs land under
   * `refs/t3-absurd/checkpoints/<taskId>/…` — branches/index/worktree untouched.
   */
  checkpoint?: {
    /** Git workspace (repo root or worktree) the capture runs in. */
    cwd: string;
    /** Work-surface paths relative to cwd; the scoped alternative to add -A over everything. */
    scopePaths?: string[];
  };
  /**
   * Explicit model id for this run's turn (TQ-039 slice 1). The server-owned
   * in-process transport REQUIRES it at resolve time — there is no default on
   * that path. LocalEcho and WS transports ignore it.
   */
  model?: string;
  /**
   * Full encoded `thread.turn.start` command for the client turn rail (landing
   * slice). When present, the in-process transport dispatches THIS command
   * verbatim instead of synthesizing a minimal one — full parity with the
   * client's message shape (attachments, modes, sourceProposedPlan) with no
   * field drift as the command schema evolves. Opaque to this package by
   * design: the server encodes it, the server decodes it; the dependency
   * direction (absurd-runtime never imports server code or contracts) is
   * preserved. LocalEcho and WS transports ignore it.
   */
  turnCommand?: Record<string, unknown>;
};

export type ThreadRunResult = {
  threadId: string;
  turnId: string;
  state: "completed";
  summary: string;
};

export interface ThreadTransport {
  resolveThread(
    params: Pick<ThreadRunParams, "threadId" | "projectPath" | "model">,
  ): Promise<{ threadId: string; created: boolean }>;
  dispatchTurn(
    threadId: string,
    prompt: string,
    turnCommand?: Record<string, unknown>,
  ): Promise<{ turnId: string; dispatchedAt: string }>;
  awaitTurnComplete(
    threadId: string,
    turnId: string,
    holdMs: number,
  ): Promise<{ state: "completed"; summary: string }>;
}

/**
 * Transport that performs the three step-shaped operations locally with real
 * durations and no external dependencies. The checkpoint/resume behavior this
 * exists to prove lives in Absurd, not in the transport.
 */
export function makeLocalEchoTransport(): ThreadTransport {
  return {
    async resolveThread(params) {
      if (params.threadId) return { threadId: params.threadId, created: false };
      return { threadId: `local-thread-${crypto.randomUUID()}`, created: true };
    },
    async dispatchTurn(_threadId, _prompt) {
      return {
        turnId: `turn-${crypto.randomUUID()}`,
        dispatchedAt: new Date().toISOString(),
      };
    },
    async awaitTurnComplete(_threadId, turnId, holdMs) {
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      return { state: "completed", summary: `turn ${turnId} completed after ${holdMs}ms hold` };
    },
  };
}

/** Canonical task name for the durable thread-run. */
export const THREAD_RUN_TASK = "t3.thread-run" as const;

export function registerThreadRunTask(app: Absurd, transport: ThreadTransport): void {
  app.registerTask<ThreadRunParams>(
    { name: THREAD_RUN_TASK, defaultMaxAttempts: 5 },
    async (params, ctx) => {
      const holdMs = params.holdMs ?? 8000;

      const thread = await ctx.step("resolve-thread", async () => {
        console.log(`[thread-run ${ctx.taskID}] EXECUTING resolve-thread`);
        return transport.resolveThread(params);
      });

      const turn = await ctx.step("dispatch-turn", async () => {
        console.log(`[thread-run ${ctx.taskID}] EXECUTING dispatch-turn (thread ${thread.threadId})`);
        return transport.dispatchTurn(thread.threadId, params.prompt, params.turnCommand);
      });

      if (params.checkpoint) {
        const cp = params.checkpoint;
        await ctx.step("git-checkpoint:dispatch-turn", async () => {
          console.log(`[thread-run ${ctx.taskID}] EXECUTING git-checkpoint:dispatch-turn`);
          return captureStepCheckpoint({
            cwd: cp.cwd,
            taskId: ctx.taskID,
            step: "dispatch-turn",
            scopePaths: cp.scopePaths,
          });
        });
      }

      const done = await ctx.step("await-turn-complete", async () => {
        console.log(
          `[thread-run ${ctx.taskID}] EXECUTING await-turn-complete (turn ${turn.turnId}, hold ${holdMs}ms)`,
        );
        // Long step: leases are extended only on checkpoint writes, so a hold
        // >= the worker claimTimeout would expire its own lease while alive.
        // Heartbeat every 30s for the duration of this step (SDK pattern).
        const beat = setInterval(() => {
          void ctx.heartbeat().catch((err: unknown) => {
            console.error(`[thread-run ${ctx.taskID}] heartbeat failed:`, err);
          });
        }, 30_000);
        try {
          return await transport.awaitTurnComplete(thread.threadId, turn.turnId, holdMs);
        } finally {
          clearInterval(beat);
        }
      });

      if (params.checkpoint) {
        const cp = params.checkpoint;
        await ctx.step("git-checkpoint:await-turn-complete", async () => {
          console.log(`[thread-run ${ctx.taskID}] EXECUTING git-checkpoint:await-turn-complete`);
          return captureStepCheckpoint({
            cwd: cp.cwd,
            taskId: ctx.taskID,
            step: "await-turn-complete",
            scopePaths: cp.scopePaths,
          });
        });
      }

      const result: ThreadRunResult = {
        threadId: thread.threadId,
        turnId: turn.turnId,
        state: done.state,
        summary: done.summary,
      };
      return result;
    },
  );
}

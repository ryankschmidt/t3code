/**
 * InProcessTransport (TQ-039 slice 1) — the SERVER-OWNED real-turn ThreadTransport.
 *
 * Drives an actual T3 provider turn by dispatching orchestration commands
 * (`thread.create` / `thread.turn.start`) and polling the event store DIRECTLY
 * against the server's own orchestration command/query layer. The worker that
 * runs this already lives inside the server process, so there is no socket, no
 * port, no bearer, and no external client of any kind on this rail — it closes
 * the entire loopback-client failure class (auth gate, port drift, contract
 * drift) that the WS transport suffered.
 *
 * Dependency direction is preserved: this file imports ONLY the local
 * `ThreadTransport` seam and `node:crypto`. The server binds `dispatchCommand`
 * and `replayEvents` to its in-process `OrchestrationEngineService` and passes
 * them in as `deps` — the transport never reaches back into server code.
 *
 * Wire shape mirrors `ws-rpc-transport.ts` (same command objects, same
 * completion signal: a real turn emits `thread.session-set` status
 * running -> ready). Must NOT own: step shape (thread-driver's), retry policy,
 * provider internals, or any credential value.
 *
 * Model discipline (binding): `resolveThread` REQUIRES `params.model` — there
 * is no default model on this path. The command is built with an explicit
 * `modelSelection`; a missing model throws before any thread is created.
 */
import { randomUUID } from "node:crypto";

import type { ThreadTransport } from "./thread-driver.ts";

/** Minimal projection of an orchestration event the transport scans. */
export interface ReplayEvent {
  sequence: number;
  type: string;
  aggregateId?: string;
  payload?: Record<string, unknown>;
}

/**
 * In-process seam the server binds to its own orchestration engine. Command
 * objects are plain (encoded) shapes the server decodes + dispatches; event
 * replay returns ordered {@link ReplayEvent}s from an exclusive sequence cursor.
 */
export interface InProcessTransportDeps {
  /** Dispatch one orchestration command in-process (server decodes + dispatches). */
  dispatchCommand: (command: Record<string, unknown>) => Promise<unknown>;
  /** Replay persisted orchestration events from an exclusive sequence cursor. */
  replayEvents: (fromSequenceExclusive: number) => Promise<ReadonlyArray<ReplayEvent>>;
  /** Project the created thread attaches to. */
  projectId: string;
  /** Provider instance id the model runs on (e.g. the governed codex instance). */
  instanceId: string;
  /** Poll cadence for turn-completion (ms). Default 1000 — in-process, no network. */
  pollIntervalMs?: number | undefined;
}

/**
 * Build the in-process ThreadTransport. All three methods are plain async and
 * run inside the durable `t3.thread-run` steps, so a kill/restart re-polls from
 * the durable cursor with no external session to re-establish.
 */
export function makeInProcessTransport(deps: InProcessTransportDeps): ThreadTransport {
  const pollIntervalMs = deps.pollIntervalMs ?? 1000;

  const currentSequence = async (): Promise<number> => {
    const events = await deps.replayEvents(0);
    return events.length === 0 ? 0 : Math.max(...events.map((event) => event.sequence));
  };

  return {
    async resolveThread(params) {
      if (params.threadId) return { threadId: params.threadId, created: false };
      const model = params.model?.trim();
      if (!model) {
        // No default model on this rail — fail before creating any thread.
        throw new Error(
          "in-process-transport: model is required to create a thread (no default model on this path)",
        );
      }
      const threadId = randomUUID();
      await deps.dispatchCommand({
        type: "thread.create",
        commandId: randomUUID(),
        threadId,
        projectId: deps.projectId,
        title: "symphony thread-run (TQ-039)",
        modelSelection: { instanceId: deps.instanceId, model },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: new Date().toISOString(),
      });
      return { threadId, created: true };
    },

    async dispatchTurn(threadId, prompt) {
      const turnCursor = await currentSequence();
      const messageId = randomUUID();
      // modelSelection is intentionally omitted: the turn inherits the thread's
      // model set at create time. Keeping it off this command means there is no
      // second place a default model could sneak in.
      await deps.dispatchCommand({
        type: "thread.turn.start",
        commandId: randomUUID(),
        threadId,
        message: { messageId, role: "user", text: prompt, attachments: [] },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });
      // Encode the pre-dispatch sequence cursor into the turn handle so
      // awaitTurnComplete scans forward from exactly where we left off.
      return { turnId: `seq:${turnCursor}:${messageId}`, dispatchedAt: new Date().toISOString() };
    },

    async awaitTurnComplete(threadId, turnId, holdMs) {
      const seqStr = turnId.split(":")[1];
      let cursor = Number(seqStr ?? 0) || 0;
      const deadline = Date.now() + Math.max(holdMs, 10 * 60_000);
      // Completion signal (verified against the WS transport's live-DB finding):
      // a real turn emits `thread.session-set` status running -> ready.
      // `thread.turn-diff-completed` fires only when checkpoint capture
      // succeeds; accepted as an early completion signal but never the primary.
      let sawRunning = false;
      for (;;) {
        const events = await deps.replayEvents(cursor);
        for (const event of events) {
          if (event.sequence > cursor) cursor = event.sequence;
          const payload = event.payload ?? {};
          const forThisThread =
            event.aggregateId === threadId || payload["threadId"] === threadId;
          if (!forThisThread) continue;
          if (event.type === "thread.session-set") {
            const session = payload["session"] as
              | { status?: string; lastError?: string | null }
              | undefined;
            const status = session?.status;
            if (status === "running") {
              sawRunning = true;
            } else if (status === "error") {
              const detail = session?.lastError ? `: ${session.lastError}` : "";
              throw new Error(
                `in-process-transport: turn failed (session error at seq ${event.sequence}${detail})`,
              );
            } else if (sawRunning && (status === "ready" || status === "idle")) {
              return {
                state: "completed",
                summary: `turn completed (session ${status} at seq ${event.sequence})`,
              };
            } else if (sawRunning && (status === "interrupted" || status === "stopped")) {
              throw new Error(
                `in-process-transport: turn did not complete (session ${status} at seq ${event.sequence})`,
              );
            }
          }
          if (event.type === "thread.turn-diff-completed") {
            return {
              state: "completed",
              summary: `turn completed (turn-diff-completed at seq ${event.sequence})`,
            };
          }
        }
        if (Date.now() > deadline) {
          throw new Error(
            `in-process-transport: turn did not complete before deadline (thread ${threadId})`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    },
  };
}

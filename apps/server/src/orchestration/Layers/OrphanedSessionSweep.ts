/**
 * OrphanedSessionSweep — boot-time turn-survival guard.
 *
 * When the server dies mid-turn, the in-flight session never receives a
 * terminal `thread.session-set` event: the persisted projection keeps the
 * session in `starting`/`running` forever, the projector never settles the
 * running `latestTurn`, and the UI spinner runs unbounded ("Working 3h26m")
 * while the durable task fails honestly at maxAttempts.
 *
 * This sweep runs ONCE during server startup, after the orchestration
 * reactors start and BEFORE the startup command gate opens — so every
 * session visible in the snapshot predates this boot by construction. No
 * live provider process can back a still-`starting`/`running` session from
 * a previous boot (adapter sessions are in-memory and died with it), so
 * each one gets a terminal `thread.session.set` with `status: "error"` and
 * an explicit reason. The projector settles the running turn to `"error"`
 * (see `settledTurnStateForSessionStatus`), threads fail VISIBLY, and
 * spinners clear.
 *
 * Deliberately NOT here: re-dispatching the orphaned turn. Re-dispatch
 * policy (step shape, idempotency) is a future slice — see the Pi Quality
 * Pack build receipt design note.
 */
import {
  CommandId,
  type OrchestrationSession,
  type ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

/** Human-visible reason attached to sessions terminated by the sweep. */
export const ORPHANED_SESSION_REASON =
  "Orphaned by server restart: the provider session did not survive the previous server shutdown.";

/**
 * The non-terminal session statuses that claim a live provider process.
 * Everything else (`idle`/`ready`/`interrupted`/`stopped`/`error`) already
 * settles a running turn in the projector and leaves no spinner behind.
 */
const IN_FLIGHT_SESSION_STATUSES: ReadonlySet<OrchestrationSession["status"]> = new Set([
  "starting",
  "running",
]);

/**
 * Find persisted sessions still marked in-flight from a previous boot and
 * emit a terminal `thread.session.set` for each. Dispatch failures on one
 * thread are logged and never block the rest of the sweep.
 */
export const sweepOrphanedSessions = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;

  const snapshot = yield* projectionSnapshotQuery.getSnapshot();
  const sweptThreadIds: Array<ThreadId> = [];

  for (const thread of snapshot.threads) {
    const session = thread.session;
    if (
      !session ||
      thread.deletedAt !== null ||
      !IN_FLIGHT_SESSION_STATUSES.has(session.status)
    ) {
      continue;
    }

    const now = DateTime.formatIso(yield* DateTime.now);
    const commandId = CommandId.make(
      `server:orphaned-session-sweep:${yield* crypto.randomUUIDv4}`,
    );
    const swept = yield* orchestrationEngine
      .dispatch({
        type: "thread.session.set",
        commandId,
        threadId: thread.id,
        session: {
          ...session,
          status: "error",
          activeTurnId: null,
          lastError: ORPHANED_SESSION_REASON,
          updatedAt: now,
        },
        createdAt: now,
      })
      .pipe(
        Effect.tap(() =>
          Effect.logInfo("orchestration.session.orphan-sweep.terminated", {
            threadId: thread.id,
            previousStatus: session.status,
            previousActiveTurnId: session.activeTurnId,
          }),
        ),
        Effect.as(true),
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration.session.orphan-sweep.dispatch-failed", {
            threadId: thread.id,
            cause,
          }).pipe(Effect.as(false)),
        ),
      );

    if (swept) {
      sweptThreadIds.push(thread.id);
    }
  }

  if (sweptThreadIds.length > 0) {
    yield* Effect.logInfo("orchestration.session.orphan-sweep.complete", {
      sweptCount: sweptThreadIds.length,
      sweptThreadIds,
    });
  }

  return { sweptThreadIds } as const;
});

/**
 * Startup-phase wrapper: the sweep is loud in logs but can never fail the
 * boot — a broken sweep must not take the whole server down with it.
 */
export const runOrphanedSessionSweep = sweepOrphanedSessions.pipe(
  Effect.asVoid,
  Effect.catchCause((cause) =>
    Effect.logWarning("orchestration.session.orphan-sweep.failed", { cause }),
  ),
);

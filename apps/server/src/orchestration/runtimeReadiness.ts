/**
 * TQ-039 Slice 1R — runtime readiness computation (visibility before repair).
 *
 * Turns the substrate's readiness into a machine-readable, closed-schema state so
 * an un-warmed boot fails a spawn closed instead of hanging. Pure and
 * dependency-injected so every state is unit-testable without a live server; the
 * ws.ts handler binds the real deps. Nothing here logs, and nothing here touches
 * or repairs the protected-lane session boundary — it only NAMES its state.
 */
import type { AbsurdRuntimeHandle } from "@t3tools/absurd-runtime";
import {
  SYMPHONY_REQUIRED_READINESS_CHECKS,
  type SymphonyReadinessCheck,
  type SymphonyReadinessCheckName,
  type SymphonyReadinessState,
  type SymphonyRuntimeReadyOutput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export interface RuntimeReadinessDeps {
  /** The server-owned Absurd worker handle, if the worker layer initialized. */
  readonly absurdRuntime: Option.Option<AbsurdRuntimeHandle>;
  /** Bounded queue-reachability probe. The real one lists queues under a timeout. */
  readonly probeQueueReachable: (handle: AbsurdRuntimeHandle) => Promise<boolean>;
  /**
   * Session-boundary readiness signal. Slice 1S (design:
   * Slice-1S-Session-Boundary-Design.md, symphony-typescript-port) —
   * implemented: a real, bounded, dependency-injected check (see
   * `makeSessionBoundaryProbe` below), same injectability pattern as
   * `probeQueueReachable` above — async so it can do bounded IO. Injectable so
   * tests can exercise every state without a live server.
   */
  readonly sessionBoundaryState: () => Promise<SymphonyReadinessState>;
}

/**
 * Compute the closed readiness response. Answers fast (a bounded queue probe is
 * the only IO) so it is honest even on a cold, un-warmed boot.
 */
export async function computeRuntimeReadiness(
  deps: RuntimeReadinessDeps,
): Promise<SymphonyRuntimeReadyOutput> {
  const checks: SymphonyReadinessCheck[] = [];

  // absurd-worker-layer: the server-owned worker service is initialized.
  if (Option.isSome(deps.absurdRuntime)) {
    checks.push({ name: "absurd-worker-layer", state: "ready" });
  } else {
    checks.push({ name: "absurd-worker-layer", state: "not-ready", category: "uninitialized" });
  }

  // queue-reachability: the durable queue answers a bounded probe.
  if (Option.isSome(deps.absurdRuntime)) {
    let reachable = false;
    try {
      reachable = await deps.probeQueueReachable(deps.absurdRuntime.value);
    } catch {
      reachable = false;
    }
    checks.push(
      reachable
        ? { name: "queue-reachability", state: "ready" }
        : { name: "queue-reachability", state: "not-ready", category: "unreachable" },
    );
  } else {
    checks.push({ name: "queue-reachability", state: "unknown", category: "uninitialized" });
  }

  // session-boundary: NAME the protected-lane state; never repair or detail it.
  const sb = await deps.sessionBoundaryState();
  checks.push(
    sb === "ready"
      ? { name: "session-boundary", state: "ready" }
      : sb === "unknown"
        ? { name: "session-boundary", state: "unknown", category: "unverified" }
        : { name: "session-boundary", state: "not-ready", category: "protected-lane" },
  );

  const ready = SYMPHONY_REQUIRED_READINESS_CHECKS.every((name) => {
    const check = checks.find((c) => c.name === name);
    return check !== undefined && check.state === "ready";
  });

  return { ready, checks };
}

/**
 * The client turn rail's required checks — the rail's REAL preconditions
 * (worker present, queue answering). `session-boundary` is deliberately
 * absent: that signal names the protected interactive-session lane that
 * SYMPHONY campaign spawns must verify before entering. The client's own
 * interactive turn IS that protected lane, so the rail must not fail closed
 * on the slice-1R placeholder (hardcoded not-ready pending the slice-1S
 * verification probe) — gating the rail on it refuses every client turn.
 */
export const TURN_RAIL_REQUIRED_READINESS_CHECKS = [
  "absurd-worker-layer",
  "queue-reachability",
] as const satisfies ReadonlyArray<SymphonyReadinessCheckName>;

/**
 * The required-check NAMES that are `not-ready` — the fail-closed guard for
 * spawn. Empty array => clear to proceed. Per the contract, only `not-ready`
 * blocks a spawn (an `unknown` check does not); the returned names are what a
 * `RuntimeNotReady` error carries. `required` scopes the guard to the
 * caller's real preconditions: symphony spawns use the full set (default),
 * the client turn rail passes TURN_RAIL_REQUIRED_READINESS_CHECKS.
 */
export function readinessBlockingChecks(
  readiness: SymphonyRuntimeReadyOutput,
  required: ReadonlyArray<SymphonyReadinessCheckName> = SYMPHONY_REQUIRED_READINESS_CHECKS,
): SymphonyReadinessCheckName[] {
  const requiredSet = new Set<string>(required);
  return readiness.checks
    .filter((check) => requiredSet.has(check.name) && check.state === "not-ready")
    .map((check) => check.name);
}

/**
 * Slice 1S (design: Slice-1S-Session-Boundary-Design.md,
 * symphony-typescript-port) — implemented. Injected deps for the real
 * session-boundary probe: a queue-reachability leg (reusing
 * `makeQueueReachabilityProbe`, pointed at the dedicated symphony-queue
 * handle instead of the interactive rail's) and a project-resolution leg.
 * `projectExists` is a plain-async function so this file stays free of any
 * server-specific Effect service dependency — the caller (ws.ts) bridges the
 * Effect-typed `ProjectionSnapshotQuery` lookup to a plain Promise at the
 * wiring site (the same `Effect.runPromiseWith(runtimeContext)` pattern
 * `AbsurdRuntimeInProcess.ts` already uses) before injecting it here.
 */
export interface SessionBoundaryProbeDeps {
  /** The dedicated symphony-queue worker handle, if the runtime initialized it. */
  readonly symphonyQueueHandle: Option.Option<AbsurdRuntimeHandle>;
  /** Bounded queue-reachability probe (same shape/budget as `probeQueueReachable`). */
  readonly probeSymphonyQueueReachable: (handle: AbsurdRuntimeHandle) => Promise<boolean>;
  /** Raw `T3_SYMPHONY_PROJECT_ID` env value — may be empty or unset. */
  readonly symphonyProjectId: string;
  /**
   * Plain-async, already-bridged project-existence lookup. Never throws —
   * resolves `false` on any lookup failure so the probe stays bounded and
   * honest under the "never throws" budget below.
   */
  readonly projectExists: (projectId: string) => Promise<boolean>;
}

/**
 * The real session-boundary check (D5): `ready` iff the symphony queue
 * worker is reachable AND `T3_SYMPHONY_PROJECT_ID` is non-empty and resolves
 * to an existing project; `not-ready` otherwise (the caller maps this to
 * category `protected-lane` — see `computeRuntimeReadiness` above). Probe
 * budget matches the existing queue probe: bounded IO, never throws.
 */
export function makeSessionBoundaryProbe(
  deps: SessionBoundaryProbeDeps,
): () => Promise<SymphonyReadinessState> {
  return async () => {
    if (Option.isNone(deps.symphonyQueueHandle)) return "not-ready";

    let queueReachable = false;
    try {
      queueReachable = await deps.probeSymphonyQueueReachable(deps.symphonyQueueHandle.value);
    } catch {
      queueReachable = false;
    }
    if (!queueReachable) return "not-ready";

    const projectId = deps.symphonyProjectId.trim();
    if (projectId.length === 0) return "not-ready";

    let projectResolved = false;
    try {
      projectResolved = await deps.projectExists(projectId);
    } catch {
      projectResolved = false;
    }
    return projectResolved ? "ready" : "not-ready";
  };
}

/**
 * Bounded, non-protected queue-reachability probe: list queues, resolve true on
 * success, false on error or after `timeoutMs`. Never throws.
 */
export function makeQueueReachabilityProbe(
  timeoutMs = 2000,
): (handle: AbsurdRuntimeHandle) => Promise<boolean> {
  return (handle) =>
    Effect.runPromise(
      Effect.tryPromise(() => handle.app.listQueues()).pipe(
        Effect.as(true),
        Effect.timeout(`${timeoutMs} millis`),
        Effect.orElseSucceed(() => false),
      ),
    );
}

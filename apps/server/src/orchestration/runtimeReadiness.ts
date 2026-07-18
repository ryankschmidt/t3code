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
   * Session-boundary readiness signal. Slice 1R (visibility before repair)
   * reports `not-ready`: the protected-lane session boundary is unverified and is
   * NOT repaired here. Injectable so tests can exercise every state; the server
   * binds the honest current signal WITHOUT adding any protected-surface code.
   */
  readonly sessionBoundaryState: () => SymphonyReadinessState;
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
  const sb = deps.sessionBoundaryState();
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
 * The required-check NAMES that are `not-ready` — the fail-closed guard for
 * spawn. Empty array => clear to proceed. Per the contract, only `not-ready`
 * blocks a spawn (an `unknown` check does not); the returned names are what a
 * `RuntimeNotReady` error carries.
 */
export function readinessBlockingChecks(
  readiness: SymphonyRuntimeReadyOutput,
): SymphonyReadinessCheckName[] {
  const required = new Set<string>(SYMPHONY_REQUIRED_READINESS_CHECKS);
  return readiness.checks
    .filter((check) => required.has(check.name) && check.state === "not-ready")
    .map((check) => check.name);
}

/**
 * Slice 1R session-boundary signal: the protected-lane boundary is unverified
 * and is NOT repaired in this slice, so it is honestly `not-ready`. Slice 1S
 * (Ryan-gated repair) replaces this with a real verification probe. Kept as a
 * named function so the reason is explicit and the swap point is obvious.
 */
export const sliceOneRSessionBoundaryState = (): SymphonyReadinessState => "not-ready";

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

import { assert, describe, it } from "@effect/vitest";
import type { AbsurdRuntimeHandle } from "@t3tools/absurd-runtime";
import {
  SymphonyReadinessCheck,
  SymphonyRuntimeReadyOutput,
  type SymphonyRuntimeReadyOutput as SymphonyRuntimeReadyOutputType,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  computeRuntimeReadiness,
  makeSessionBoundaryProbe,
  readinessBlockingChecks,
  TURN_RAIL_REQUIRED_READINESS_CHECKS,
} from "./runtimeReadiness.ts";

const fakeHandle = {
  app: {},
  queueName: "t3-absurd-runtime",
  close: async () => {},
} as unknown as AbsurdRuntimeHandle;

// Slice 1R-era fixture: always not-ready, matching the retired
// sliceOneRSessionBoundaryState constant's behavior exactly. These tests are
// about computeRuntimeReadiness's aggregation, the blocking-checks guard, and
// the closed-schema — not about session-boundary computation itself (that
// gets its own describe block below, against the real makeSessionBoundaryProbe).
const alwaysNotReady = async (): Promise<"not-ready"> => "not-ready";

const findCheck = (r: SymphonyRuntimeReadyOutputType, name: string) =>
  r.checks.find((c) => c.name === name);

describe("computeRuntimeReadiness (TQ-039 Slice 1R — R1: fast + honest visibility)", () => {
  it("names all three checks and decodes as a closed response (latency asserted in the validator)", async () => {
    const readiness = await computeRuntimeReadiness({
      absurdRuntime: Option.some(fakeHandle),
      probeQueueReachable: async () => true,
      sessionBoundaryState: alwaysNotReady,
    });
    // Closed schema (cold by construction) — decode must accept the real output.
    Schema.decodeUnknownSync(SymphonyRuntimeReadyOutput)(readiness);
    assert.deepStrictEqual(
      readiness.checks.map((c) => c.name).sort(),
      ["absurd-worker-layer", "queue-reachability", "session-boundary"],
    );
    assert.strictEqual(findCheck(readiness, "absurd-worker-layer")?.state, "ready");
    assert.strictEqual(findCheck(readiness, "queue-reachability")?.state, "ready");
    // session-boundary: not-ready is a PASS for this slice (visibility, not repair).
    assert.strictEqual(findCheck(readiness, "session-boundary")?.state, "not-ready");
    assert.strictEqual(findCheck(readiness, "session-boundary")?.category, "protected-lane");
    assert.strictEqual(readiness.ready, false);
  });

  it("reports honestly when the worker layer is absent", async () => {
    const readiness = await computeRuntimeReadiness({
      absurdRuntime: Option.none(),
      probeQueueReachable: async () => true,
      sessionBoundaryState: alwaysNotReady,
    });
    assert.strictEqual(findCheck(readiness, "absurd-worker-layer")?.state, "not-ready");
    assert.strictEqual(findCheck(readiness, "queue-reachability")?.state, "unknown");
    assert.strictEqual(readiness.ready, false);
  });

  it("marks queue-reachability not-ready when the probe fails", async () => {
    const readiness = await computeRuntimeReadiness({
      absurdRuntime: Option.some(fakeHandle),
      probeQueueReachable: async () => false,
      sessionBoundaryState: async () => "ready",
    });
    assert.strictEqual(findCheck(readiness, "queue-reachability")?.state, "not-ready");
    assert.strictEqual(findCheck(readiness, "queue-reachability")?.category, "unreachable");
  });
});

describe("fail-closed spawn guard (TQ-039 Slice 1R — NC4: zero enqueue)", () => {
  it("blocks a spawn when session-boundary is not-ready; the spawn is never enqueued", async () => {
    const readiness = await computeRuntimeReadiness({
      absurdRuntime: Option.some(fakeHandle),
      probeQueueReachable: async () => true,
      sessionBoundaryState: alwaysNotReady,
    });
    const blocking = readinessBlockingChecks(readiness);
    assert.isTrue(blocking.includes("session-boundary"));
    // Mirror the ws.ts guard exactly: blocking => return RuntimeNotReady, never spawn.
    let enqueueCalls = 0;
    if (blocking.length === 0) enqueueCalls++;
    assert.strictEqual(enqueueCalls, 0); // zero enqueue / zero effects-ledger delta
  });

  it("does not block when every required check is ready", () => {
    const allReady: SymphonyRuntimeReadyOutputType = {
      ready: true,
      checks: [
        { name: "absurd-worker-layer", state: "ready" },
        { name: "queue-reachability", state: "ready" },
        { name: "session-boundary", state: "ready" },
      ],
    };
    assert.strictEqual(readinessBlockingChecks(allReady).length, 0);
  });

  it("does not block on an unknown check — only not-ready blocks", () => {
    const withUnknown: SymphonyRuntimeReadyOutputType = {
      ready: false,
      checks: [
        { name: "absurd-worker-layer", state: "ready" },
        { name: "queue-reachability", state: "unknown", category: "uninitialized" },
        { name: "session-boundary", state: "ready" },
      ],
    };
    assert.strictEqual(readinessBlockingChecks(withUnknown).length, 0);
  });
});

describe("turn-rail readiness scope (landing slice — rail vs symphony split)", () => {
  it("clears the rail when worker + queue are ready even while session-boundary is not-ready", async () => {
    const readiness = await computeRuntimeReadiness({
      absurdRuntime: Option.some(fakeHandle),
      probeQueueReachable: async () => true,
      sessionBoundaryState: alwaysNotReady,
    });
    // The same live state blocks a symphony spawn (full set)...
    assert.isTrue(readinessBlockingChecks(readiness).includes("session-boundary"));
    // ...and clears the client turn rail (its real preconditions only).
    assert.strictEqual(
      readinessBlockingChecks(readiness, TURN_RAIL_REQUIRED_READINESS_CHECKS).length,
      0,
    );
  });

  it("still fails the rail closed on its real preconditions", async () => {
    const readiness = await computeRuntimeReadiness({
      absurdRuntime: Option.none(),
      probeQueueReachable: async () => true,
      sessionBoundaryState: alwaysNotReady,
    });
    const blocking = readinessBlockingChecks(readiness, TURN_RAIL_REQUIRED_READINESS_CHECKS);
    assert.isTrue(blocking.includes("absurd-worker-layer"));
    // queue-reachability is `unknown` when the worker is absent — unknown never blocks.
    assert.isFalse(blocking.includes("queue-reachability"));
    assert.isFalse(blocking.includes("session-boundary"));
  });
});

describe("readiness schema is closed (TQ-039 Slice 1R — NC5: value-shaped content rejected)", () => {
  const decodeCheck = Schema.decodeUnknownSync(SymphonyReadinessCheck);
  const decodeOutput = Schema.decodeUnknownSync(SymphonyRuntimeReadyOutput);

  it("accepts a valid closed check and response", () => {
    decodeCheck({ name: "session-boundary", state: "not-ready", category: "protected-lane" });
    decodeOutput({ ready: false, checks: [{ name: "absurd-worker-layer", state: "ready" }] });
  });

  it("rejects a value-shaped category — operational detail is unrepresentable", () => {
    assert.throws(() =>
      decodeCheck({ name: "session-boundary", state: "not-ready", category: "token=abc; host=redacted" }),
    );
  });

  it("rejects an off-enum check name", () => {
    assert.throws(() => decodeCheck({ name: "leaked operational detail", state: "ready" }));
  });

  it("rejects an off-enum state value", () => {
    assert.throws(() => decodeCheck({ name: "session-boundary", state: "some-operational-value" }));
  });
});

describe("makeSessionBoundaryProbe (Slice 1S D5 — the real two-leg check)", () => {
  const symphonyHandle = {
    app: {},
    queueName: "t3-symphony",
    close: async () => {},
  } as unknown as AbsurdRuntimeHandle;

  it("ready iff symphony queue reachable AND project configured+resolvable", async () => {
    const probe = makeSessionBoundaryProbe({
      symphonyQueueHandle: Option.some(symphonyHandle),
      probeSymphonyQueueReachable: async () => true,
      symphonyProjectId: "proj-123",
      projectExists: async () => true,
    });
    assert.strictEqual(await probe(), "ready");
  });

  it("not-ready when the symphony queue leg fails, even with a resolvable project", async () => {
    const probe = makeSessionBoundaryProbe({
      symphonyQueueHandle: Option.some(symphonyHandle),
      probeSymphonyQueueReachable: async () => false,
      symphonyProjectId: "proj-123",
      projectExists: async () => true,
    });
    assert.strictEqual(await probe(), "not-ready");
  });

  it("not-ready when the project leg fails, even with a reachable queue", async () => {
    const probe = makeSessionBoundaryProbe({
      symphonyQueueHandle: Option.some(symphonyHandle),
      probeSymphonyQueueReachable: async () => true,
      symphonyProjectId: "proj-123",
      projectExists: async () => false,
    });
    assert.strictEqual(await probe(), "not-ready");
  });

  it("not-ready when T3_SYMPHONY_PROJECT_ID is empty — never even attempts the lookup", async () => {
    let lookupCalled = false;
    const probe = makeSessionBoundaryProbe({
      symphonyQueueHandle: Option.some(symphonyHandle),
      probeSymphonyQueueReachable: async () => true,
      symphonyProjectId: "",
      projectExists: async () => {
        lookupCalled = true;
        return true;
      },
    });
    assert.strictEqual(await probe(), "not-ready");
    assert.isFalse(lookupCalled);
  });

  it("not-ready when T3_SYMPHONY_PROJECT_ID is whitespace-only", async () => {
    const probe = makeSessionBoundaryProbe({
      symphonyQueueHandle: Option.some(symphonyHandle),
      probeSymphonyQueueReachable: async () => true,
      symphonyProjectId: "   ",
      projectExists: async () => true,
    });
    assert.strictEqual(await probe(), "not-ready");
  });

  it("not-ready when the symphony queue worker never initialized (Option.none)", async () => {
    let reachableCalled = false;
    const probe = makeSessionBoundaryProbe({
      symphonyQueueHandle: Option.none(),
      probeSymphonyQueueReachable: async () => {
        reachableCalled = true;
        return true;
      },
      symphonyProjectId: "proj-123",
      projectExists: async () => true,
    });
    assert.strictEqual(await probe(), "not-ready");
    // Fail-closed before even attempting the bounded probe against a handle
    // that does not exist.
    assert.isFalse(reachableCalled);
  });

  it("never throws — a throwing queue probe resolves not-ready, not a rejection", async () => {
    const probe = makeSessionBoundaryProbe({
      symphonyQueueHandle: Option.some(symphonyHandle),
      probeSymphonyQueueReachable: async () => {
        throw new Error("simulated probe failure");
      },
      symphonyProjectId: "proj-123",
      projectExists: async () => true,
    });
    // A throwing dep must resolve "not-ready", not reject the returned
    // promise — an unexpected rejection here would fail this `await` and
    // fail the test, which is the proof.
    const state = await probe();
    assert.strictEqual(state, "not-ready");
  });

  it("never throws — a throwing project lookup resolves not-ready, not a rejection", async () => {
    const probe = makeSessionBoundaryProbe({
      symphonyQueueHandle: Option.some(symphonyHandle),
      probeSymphonyQueueReachable: async () => true,
      symphonyProjectId: "proj-123",
      projectExists: async () => {
        throw new Error("simulated lookup failure");
      },
    });
    const state = await probe();
    assert.strictEqual(state, "not-ready");
  });
});

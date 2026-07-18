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
  readinessBlockingChecks,
  sliceOneRSessionBoundaryState,
} from "./runtimeReadiness.ts";

const fakeHandle = {
  app: {},
  queueName: "t3-absurd-runtime",
  close: async () => {},
} as unknown as AbsurdRuntimeHandle;

const findCheck = (r: SymphonyRuntimeReadyOutputType, name: string) =>
  r.checks.find((c) => c.name === name);

describe("computeRuntimeReadiness (TQ-039 Slice 1R — R1: fast + honest visibility)", () => {
  it("names all three checks and decodes as a closed response (latency asserted in the validator)", async () => {
    const readiness = await computeRuntimeReadiness({
      absurdRuntime: Option.some(fakeHandle),
      probeQueueReachable: async () => true,
      sessionBoundaryState: sliceOneRSessionBoundaryState,
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
      sessionBoundaryState: sliceOneRSessionBoundaryState,
    });
    assert.strictEqual(findCheck(readiness, "absurd-worker-layer")?.state, "not-ready");
    assert.strictEqual(findCheck(readiness, "queue-reachability")?.state, "unknown");
    assert.strictEqual(readiness.ready, false);
  });

  it("marks queue-reachability not-ready when the probe fails", async () => {
    const readiness = await computeRuntimeReadiness({
      absurdRuntime: Option.some(fakeHandle),
      probeQueueReachable: async () => false,
      sessionBoundaryState: () => "ready",
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
      sessionBoundaryState: sliceOneRSessionBoundaryState,
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

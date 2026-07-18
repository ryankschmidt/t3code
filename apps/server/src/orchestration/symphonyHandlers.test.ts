import { assert, describe, it } from "@effect/vitest";
import type { AbsurdRuntimeHandle } from "@t3tools/absurd-runtime";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

import {
  assertRoutedSymphonyModel,
  mapSymphonyTaskSnapshot,
  resolveSymphonyRuntime,
} from "./symphonyHandlers.ts";

const fakeHandle = {
  app: {},
  queueName: "t3-absurd-runtime",
  close: async () => {},
} as unknown as AbsurdRuntimeHandle;

/** Return the typed error of a synchronously-failing effect, or undefined on success. */
const failTag = <E extends { readonly _tag: string }>(
  effect: Effect.Effect<unknown, E>,
): string | undefined => {
  const exit = Effect.runSyncExit(effect);
  if (Exit.isFailure(exit)) {
    return Option.getOrUndefined(Cause.findErrorOption(exit.cause))?._tag;
  }
  return undefined;
};

describe("resolveSymphonyRuntime (TQ-039 NC1 — fail closed)", () => {
  it("fails with a typed error when the AbsurdRuntime service is absent (None)", () => {
    assert.strictEqual(
      failTag(resolveSymphonyRuntime(Option.none())),
      "SymphonyRuntimeUnavailableError",
    );
  });

  it("returns the handle when the service is present (Some)", () => {
    const handle = Effect.runSync(resolveSymphonyRuntime(Option.some(fakeHandle)));
    assert.strictEqual(handle.queueName, "t3-absurd-runtime");
  });
});

describe("assertRoutedSymphonyModel (TQ-039 NC2 — no silent default)", () => {
  it("accepts a routed model (no failure)", () => {
    assert.isUndefined(failTag(assertRoutedSymphonyModel("gpt-5.4")));
  });

  it("rejects an off-table model with a typed error", () => {
    assert.strictEqual(failTag(assertRoutedSymphonyModel("gpt-4o")), "SymphonySpawnError");
  });

  it("rejects an empty model (the no-default guard)", () => {
    assert.strictEqual(failTag(assertRoutedSymphonyModel("")), "SymphonySpawnError");
  });
});

describe("mapSymphonyTaskSnapshot", () => {
  it("maps pending / sleeping -> pending", () => {
    assert.deepStrictEqual(mapSymphonyTaskSnapshot({ state: "pending" }), { state: "pending" });
    assert.deepStrictEqual(mapSymphonyTaskSnapshot({ state: "sleeping" }), { state: "pending" });
  });

  it("maps running -> running", () => {
    assert.deepStrictEqual(mapSymphonyTaskSnapshot({ state: "running" }), { state: "running" });
  });

  it("maps completed and surfaces the result summary", () => {
    assert.deepStrictEqual(
      mapSymphonyTaskSnapshot({ state: "completed", result: { summary: "turn ok" } }),
      { state: "completed", resultSummary: "turn ok" },
    );
  });

  it("maps failed and cancelled -> failed", () => {
    assert.strictEqual(
      mapSymphonyTaskSnapshot({ state: "failed", failure: "boom" }).state,
      "failed",
    );
    assert.deepStrictEqual(mapSymphonyTaskSnapshot({ state: "cancelled" }), {
      state: "failed",
      resultSummary: "task cancelled",
    });
  });
});

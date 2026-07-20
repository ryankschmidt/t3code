import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  isRoutedSymphonyModel,
  SYMPHONY_MODEL_ROUTING_PREFIXES,
  SymphonySpawnThreadRunInput,
} from "./symphony.ts";

describe("isRoutedSymphonyModel (TQ-039 NC2 — no silent default)", () => {
  it("accepts every routed base model", () => {
    for (const model of SYMPHONY_MODEL_ROUTING_PREFIXES) {
      assert.isTrue(isRoutedSymphonyModel(model), `expected ${model} to be routed`);
    }
  });

  it("accepts a dated/effort variant of a routed base", () => {
    assert.isTrue(isRoutedSymphonyModel("gpt-5.4-2026xx"));
    assert.isTrue(isRoutedSymphonyModel("gpt-5.5:audit"));
  });

  it("rejects an absent model (empty / whitespace) — the no-default guard", () => {
    assert.isFalse(isRoutedSymphonyModel(""));
    assert.isFalse(isRoutedSymphonyModel("   "));
  });

  it("rejects models outside the routing table", () => {
    assert.isFalse(isRoutedSymphonyModel("gpt-4o"));
    assert.isFalse(isRoutedSymphonyModel("claude-opus"));
    assert.isFalse(isRoutedSymphonyModel("sonnet"));
    assert.isFalse(isRoutedSymphonyModel("gpt-5"));
  });
});

describe("SymphonySpawnThreadRunInput (Slice 1S D1 — fresh-thread-only, structurally enforced)", () => {
  const decode = Schema.decodeUnknownSync(SymphonySpawnThreadRunInput);

  it("pins the invariant: a spawn input carrying threadId fails schema decode", () => {
    assert.throws(() =>
      decode({ prompt: "do the thing", model: "gpt-5.4", threadId: "should-not-exist" }),
    );
  });

  it("rejects any other undeclared key the same way, not just threadId", () => {
    assert.throws(() => decode({ prompt: "do the thing", model: "gpt-5.4", projectId: "sneaky" }));
  });

  it("still rejects a threadId payload when every other field is also present", () => {
    assert.throws(() =>
      decode({
        prompt: "do the thing",
        model: "gpt-5.4",
        holdMs: 8000,
        operationId: "op-1",
        threadId: "should-not-exist",
      }),
    );
  });

  it("a minimal valid payload (prompt + model only) still decodes exactly as before", () => {
    const decoded = decode({ prompt: "do the thing", model: "gpt-5.4" });
    assert.deepStrictEqual(decoded, { prompt: "do the thing", model: "gpt-5.4" });
  });

  it("a full valid payload (all four declared fields) still decodes exactly as before", () => {
    const decoded = decode({
      prompt: "do the thing",
      model: "gpt-5.4",
      holdMs: 8000,
      operationId: "op-1",
    });
    assert.deepStrictEqual(decoded, {
      prompt: "do the thing",
      model: "gpt-5.4",
      holdMs: 8000,
      operationId: "op-1",
    });
  });

  it("still rejects a non-object payload with the inner struct's normal error, not a crash", () => {
    assert.throws(() => decode("not an object"));
    assert.throws(() => decode(null));
    assert.throws(() => decode(["array", "not", "object"]));
  });

  it("still rejects a missing required field (model) — unrelated to the excess-key check", () => {
    assert.throws(() => decode({ prompt: "do the thing" }));
  });
});

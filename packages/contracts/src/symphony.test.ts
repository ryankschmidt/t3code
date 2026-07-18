import { assert, describe, it } from "@effect/vitest";

import { isRoutedSymphonyModel, SYMPHONY_MODEL_ROUTING_PREFIXES } from "./symphony.ts";

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

import test from "node:test";
import assert from "node:assert/strict";
import type { TaskContext } from "absurd-sdk";
import { bindWorkspaceSteps } from "./workspace-steps.ts";

function fixture() {
  let sdkCalls = 0;
  const context = {
    async step(_name: string, effect: () => Promise<unknown>) {
      sdkCalls++;
      return effect();
    },
  } as unknown as TaskContext;
  return { context, step: bindWorkspaceSteps(context), calls: () => sdkCalls };
}

test("invalid keys refuse before SDK and effect invocation", async () => {
  const f = fixture();
  for (const key of [
    "",
    "other:key",
    "execution:",
    "execution:x\n",
    "execution:" + "a".repeat(241),
  ]) {
    await assert.rejects(
      f.step(key, async () => assert.fail("effect called")),
      /INVALID_EXECUTION_STEP_KEY/,
    );
  }
  assert.equal(f.calls(), 0);
});

test("non-JSON values, cycles, nonfinite numbers and sparse arrays refuse", async () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  let getterCalls = 0,
    serializationCalls = 0;
  const getter = Object.defineProperty({}, "pid", {
    enumerable: true,
    get() {
      getterCalls++;
      return 999;
    },
  });
  const nested = Object.defineProperty({ pid: 123 }, "toJSON", {
    value() {
      serializationCalls++;
      return { pid: 999 };
    },
  });
  const extraArray = Object.assign([1], { extra: 2 });
  const values = [
    undefined,
    NaN,
    Infinity,
    1n,
    () => 1,
    new Date(),
    new Map(),
    cycle,
    Array(1),
    { value: Symbol("x") },
    { [Symbol("hidden")]: 1 },
    getter,
    { nested },
    extraArray,
    new Proxy({ pid: 1 }, {}),
  ];
  for (const value of values)
    await assert.rejects(
      fixture().step("execution:run:key", async () => value),
      /NON_JSON_EXECUTION_REFERENCE/,
    );
  assert.equal(getterCalls, 0);
  assert.equal(serializationCalls, 0);
});

test("parallel rebound callers share one failure, not a second uncertain effect", async () => {
  const f = fixture();
  let effects = 0;
  const effect = async () => {
    effects++;
    throw Error("UNCERTAIN_EFFECT");
  };
  const results = await Promise.allSettled([
    f.step("execution:r:release", effect),
    bindWorkspaceSteps(f.context)("execution:r:release", effect),
  ]);
  assert.equal(results.filter((x) => x.status === "rejected").length, 2);
  await assert.rejects(f.step("execution:r:release", effect), /UNCERTAIN_EFFECT/);
  assert.equal(effects, 1);
  assert.equal(f.calls(), 1);
});

test("custom nonenumerable serialization cannot replace a checked execution reference", async () => {
  const value = { pid: 123 };
  Object.defineProperty(value, "toJSON", { enumerable: false, value: () => ({ pid: 999 }) });
  await assert.rejects(
    fixture().step("execution:r:execution", async () => value),
    /NON_JSON_EXECUTION_REFERENCE/,
  );
  const inert = JSON.parse('{"__proto__":{"pid":123},"value":1}');
  const copy = await fixture().step("execution:r:inert", async () => inert);
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(copy, "__proto__")?.value, { pid: 123 });
});

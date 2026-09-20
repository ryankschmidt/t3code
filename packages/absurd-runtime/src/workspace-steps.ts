import type { TaskContext } from "absurd-sdk";
import { types } from "node:util";

type ExecutionStep = <T>(key: string, effect: () => Promise<T>) => Promise<T>;
const attempts = new WeakMap<TaskContext, Map<string, Promise<unknown>>>();

function jsonReference<T>(value: T): T {
  const seen = new Set<object>();
  const copy = (v: unknown): unknown => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v !== "object" || seen.has(v) || types.isProxy(v))
      throw Error("NON_JSON_EXECUTION_REFERENCE");
    const array = Array.isArray(v);
    if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype))
      throw Error("NON_JSON_EXECUTION_REFERENCE");
    const keys = Reflect.ownKeys(v);
    if (array && keys.length !== v.length + 1) throw Error("NON_JSON_EXECUTION_REFERENCE");
    seen.add(v);
    const result: unknown[] | Record<string, unknown> = array ? [] : {};
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
      if (
        typeof key !== "string" ||
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length))
      )
        throw Error("NON_JSON_EXECUTION_REFERENCE");
      // Never invoke getters or toJSON; even __proto__ is an inert own field.
      Object.defineProperty(result, key, {
        value: copy(descriptor.value),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    seen.delete(v);
    return result;
  };
  return copy(value) as T;
}

/**
 * Bind once per Absurd attempt. SDK repeated names become name#2, name#3;
 * supervisor keys instead mean the SAME effect, including start/stop rereads.
 * Only live promises are held here; committed progress belongs to Absurd.
 * A crash before checkpoint commit can still replay an effect, so host/grant/
 * publication operations must retain their own idempotency and current checks.
 */
export function bindWorkspaceSteps(ctx: TaskContext): ExecutionStep {
  let steps = attempts.get(ctx);
  if (!steps) {
    steps = new Map();
    attempts.set(ctx, steps);
  }
  const current = steps;
  return async <T>(key: string, effect: () => Promise<T>): Promise<T> => {
    if (!/^execution:[a-zA-Z0-9:_-]{1,240}$/.test(key)) throw Error("INVALID_EXECUTION_STEP_KEY");
    let result = current.get(key);
    if (!result) {
      // Install before invoking the SDK so concurrent same-key callers join.
      result = Promise.resolve().then(() =>
        ctx.step(key, async () => jsonReference(await effect())),
      );
      current.set(key, result);
    }
    // Neither current nor resumed callers may mutate the SDK's cached value.
    return jsonReference(await result) as T;
  };
}

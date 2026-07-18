import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  startAbsurdRuntime,
  type AbsurdRuntimeHandle,
  type StartAbsurdRuntimeOptions,
} from "./worker.ts";

/**
 * AbsurdRuntime (TQ-039 slice 1) — the running Absurd worker handle exposed as
 * a real Effect service. Server code resolves this tag to spawn durable tasks
 * in-process against `handle.app` (Postgres credentials never leave the
 * server). Before this seam the handle was closure-captured by
 * `Layer.effectDiscard` and unreachable by any other server code.
 */
export class AbsurdRuntime extends Context.Service<AbsurdRuntime, AbsurdRuntimeHandle>()(
  "@t3tools/absurd-runtime/layer/AbsurdRuntime",
) {}

/**
 * Effect Layer that owns the Absurd worker's lifecycle AND provides it as the
 * `AbsurdRuntime` service:
 *   acquire -> startAbsurdRuntime(...)  (registers task, starts polling worker)
 *   release -> handle.close()           (stops worker, closes pool)
 *
 * Effect v4 layers are scoped by default; the `Effect.acquireRelease` finalizer
 * runs when the layer's owning scope closes. Uses Effect.log (not console) so it
 * satisfies @effect/language-service.
 *
 * `options.transport` lets a caller inject the server-owned in-process turn
 * rail; when omitted the worker uses the env-gated WS door or LocalEcho.
 */
export const AbsurdRuntimeLive = (options: StartAbsurdRuntimeOptions = {}) =>
  Layer.effect(
    AbsurdRuntime,
    Effect.acquireRelease(
      Effect.sync(() => startAbsurdRuntime(options)),
      (handle: AbsurdRuntimeHandle) => Effect.promise(() => handle.close()),
    ).pipe(Effect.tap(() => Effect.logInfo("[absurd-runtime] worker layer started"))),
  );

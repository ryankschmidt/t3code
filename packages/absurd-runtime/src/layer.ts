import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { startAbsurdRuntime, type AbsurdRuntimeHandle } from "./worker.ts";

/**
 * Effect Layer that owns the Absurd worker's lifecycle:
 *   acquire -> startAbsurdRuntime(...)  (registers task, starts polling worker)
 *   release -> handle.close()           (stops worker, closes pool)
 *
 * Effect v4: layers are scoped by default; `Layer.effectDiscard` runs setup
 * that provides no services, and the `Effect.acquireRelease` finalizer runs
 * when the layer's owning scope closes. (The Phase-2 receipt proposed the v3
 * `Layer.scopedDiscard`; this is the v4 equivalent for effect@4.0.0-beta.)
 * Uses Effect.log (not console) so it satisfies @effect/language-service.
 */
export const AbsurdRuntimeLive = (
  options: { queueName?: string; concurrency?: number } = {},
) =>
  Layer.effectDiscard(
    Effect.acquireRelease(
      Effect.sync(() => startAbsurdRuntime(options)),
      (handle: AbsurdRuntimeHandle) => Effect.promise(() => handle.close()),
    ).pipe(Effect.tap(() => Effect.logInfo("[absurd-runtime] worker layer started"))),
  );

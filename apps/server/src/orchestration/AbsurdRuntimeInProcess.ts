/**
 * AbsurdRuntimeInProcessLive (TQ-039 slice 1) — the server-owned Absurd worker
 * wired to a SERVER-OWNED in-process turn rail.
 *
 * This is the composition seam named in the migration handoff: it resolves the
 * in-process `OrchestrationEngineService`, binds its `dispatch` / `readEvents`
 * to plain-async deps, hands those to `makeInProcessTransport`, starts the
 * Absurd worker with that transport injected, and PROVIDES the `AbsurdRuntime`
 * service so the `symphony.*` WS methods can spawn `t3.thread-run` in-process
 * (Postgres credentials never leave the server; the worker sandbox is
 * irrelevant because nothing dials out).
 *
 * Boot config: `projectId` / `instanceId` come from the environment
 * (`T3_SYMPHONY_PROJECT_ID` / `T3_SYMPHONY_INSTANCE_ID`). The turn MODEL is NOT
 * configured here — every `symphony.spawnThreadRun` request names it
 * explicitly, so no default-model path is reachable through this rail.
 *
 * Dependency direction: this file lives in apps/server (it references the
 * server's `OrchestrationEngineService`); the transport + tag live in
 * `@t3tools/absurd-runtime` and never import server code.
 */
import {
  AbsurdRuntime,
  makeInProcessTransport,
  startAbsurdRuntime,
  type ReplayEvent,
} from "@t3tools/absurd-runtime";
import { OrchestrationCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";

const QUEUE_NAME = "t3-absurd-runtime";

export const AbsurdRuntimeInProcessLive = Layer.effect(
  AbsurdRuntime,
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;

    // Capture the live server runtime so the transport's plain-async deps run
    // engine effects on it (the ClaudeAdapter Effect<->Promise bridge pattern).
    const runtimeContext = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(runtimeContext);

    const decodeCommand = Schema.decodeUnknownEffect(OrchestrationCommand);

    const dispatchCommand = (command: Record<string, unknown>): Promise<unknown> =>
      runPromise(decodeCommand(command).pipe(Effect.flatMap((decoded) => engine.dispatch(decoded))));

    const replayEvents = (fromSequenceExclusive: number): Promise<ReadonlyArray<ReplayEvent>> =>
      runPromise(
        Stream.runCollect(engine.readEvents(fromSequenceExclusive)).pipe(
          Effect.map((chunk) =>
            Array.from(chunk).map(
              (event): ReplayEvent => ({
                sequence: event.sequence,
                type: event.type,
                aggregateId: event.aggregateId,
                payload: event.payload as Record<string, unknown>,
              }),
            ),
          ),
        ),
      );

    const transport = makeInProcessTransport({
      dispatchCommand,
      replayEvents,
      projectId: process.env["T3_SYMPHONY_PROJECT_ID"] ?? "",
      instanceId: process.env["T3_SYMPHONY_INSTANCE_ID"] ?? "codex",
    });

    return yield* Effect.acquireRelease(
      Effect.sync(() => startAbsurdRuntime({ queueName: QUEUE_NAME, transport })),
      (handle) => Effect.promise(() => handle.close()),
    );
  }),
);

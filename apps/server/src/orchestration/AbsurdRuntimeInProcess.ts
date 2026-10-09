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
  type ThreadRunParams,
} from "@t3tools/absurd-runtime";
import { OrchestrationCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { nativeKinds } from "../throughline/identity/identity-alias.ts";
import {
  CurrentAuthenticatedSender,
  CurrentSenderClaims,
} from "../throughline/identity/sender-stamp.ts";

import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";

// Interactive client turns have their own durable queue. The former shared
// `t3-absurd-runtime` queue contains pre-repair tasks that can hold worker
// leases for six hours; reusing it would make the dispatch-only fix unable to
// take effect until that stale generation drained.
const QUEUE_NAME = "t3-interactive-turns";

const decodeRailCommand = Schema.decodeUnknownEffect(OrchestrationCommand);
const decodeTrustedSenderContext = Schema.decodeUnknownEffect(
  Schema.Struct({
    sender: Schema.Struct({
      publicAgentId: Schema.NonEmptyString,
      generation: Schema.NonEmptyString,
      nativeKind: Schema.Literals(nativeKinds),
      nativeId: Schema.NonEmptyString,
    }),
    claims: Schema.Array(
      Schema.Struct({
        field: Schema.Literals(["publicAgentId", "generation"]),
        value: Schema.Unknown,
      }),
    ),
  }),
);

export function makeSenderRestoringDispatch(
  dispatch: OrchestrationEngineService["Service"]["dispatch"],
  runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>,
) {
  return (
    command: Record<string, unknown>,
    trusted?: ThreadRunParams["trustedSenderContext"],
  ): Promise<unknown> =>
    runPromise(
      Effect.gen(function* () {
        const decoded = yield* decodeRailCommand(command);
        const context =
          trusted === undefined ? undefined : yield* decodeTrustedSenderContext(trusted);
        return yield* dispatch(decoded).pipe(
          Effect.provideService(CurrentAuthenticatedSender, context?.sender),
          Effect.provideService(CurrentSenderClaims, context?.claims ?? []),
        );
      }),
    );
}

export const AbsurdRuntimeInProcessLive = Layer.effect(
  AbsurdRuntime,
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;

    // Capture the live server runtime so the transport's plain-async deps run
    // engine effects on it (the ClaudeAdapter Effect<->Promise bridge pattern).
    const runtimeContext = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(runtimeContext);

    const dispatchCommand = makeSenderRestoringDispatch(engine.dispatch, runPromise);

    const replayEvents = (fromSequenceExclusive: number): Promise<ReadonlyArray<ReplayEvent>> =>
      runPromise(
        Stream.runCollect(engine.readEvents(fromSequenceExclusive)).pipe(
          Effect.map((chunk) =>
            Array.from(chunk).map((event): ReplayEvent => ({
              sequence: event.sequence,
              type: event.type,
              aggregateId: event.aggregateId,
              payload: event.payload as Record<string, unknown>,
            })),
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
      // Concurrency 16: client turns run on this rail (landing slice) — the
      // proof-era default of 1 would serialize interactive turns across
      // threads. Long turns hold worker slots for their full duration
      // (heartbeat keeps the lease). The dispatch-only client path now releases
      // new slots immediately, while the doubled bound gives one deployment
      // generation enough headroom to drain pre-repair six-hour waits.
      Effect.sync(() => startAbsurdRuntime({ queueName: QUEUE_NAME, transport, concurrency: 16 })),
      (handle) => Effect.promise(() => handle.close()),
    );
  }),
);

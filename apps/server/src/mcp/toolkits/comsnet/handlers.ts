import { CommandId, MessageId, ThreadId } from "@t3tools/contracts";
import type { PeerIdentity } from "@ryan/coms-net";
import { randomUUID } from "node:crypto";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ComsNetTransport from "../../ComsNetTransport.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ComsNetToolkit } from "./tools.ts";

const asFailure = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const COMSNET_DISPATCH_ACK_TIMEOUT_MS = Math.floor(
  ComsNetTransport.COMSNET_REQUEST_LEASE_MS * 0.75,
);

const isAlreadyTerminalTransportError = (
  error: unknown,
): error is ComsNetTransport.ComsNetTransportError =>
  error instanceof ComsNetTransport.ComsNetTransportError && error.code === "ALREADY_TERMINAL";

export class ComsNetDispatchAckTimeoutError extends Data.TaggedError(
  "ComsNetDispatchAckTimeoutError",
)<{ readonly message: string; readonly timeoutMs: number }> {}

export const withComsNetDispatchAckTimeout = <A, E, R>(
  dispatch: Effect.Effect<A, E, R>,
  timeoutMs = COMSNET_DISPATCH_ACK_TIMEOUT_MS,
) =>
  dispatch.pipe(
    Effect.timeoutOption(`${timeoutMs} millis`),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new ComsNetDispatchAckTimeoutError({
              message: `ComsNet dispatch acknowledgement timed out after ${timeoutMs}ms`,
              timeoutMs,
            }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );

export const dispatchWithLifecycleResult = <A, E, R, E2, R2, E3, R3>(
  dispatch: Effect.Effect<A, E, R>,
  recordSuccess: () => Effect.Effect<unknown, E3, R3>,
  recordFailure: (message: string) => Effect.Effect<unknown, E2, R2>,
): Effect.Effect<A, E | E2 | E3, R | R2 | R3> =>
  dispatch.pipe(
    Effect.catch((error) =>
      recordFailure(asFailure(error)).pipe(
        Effect.catchIf(isAlreadyTerminalTransportError, () => Effect.void),
        Effect.andThen(Effect.fail(error)),
      ),
    ),
    Effect.tap(() => recordSuccess()),
  );

const requestText = (request: {
  readonly requestId: string;
  readonly senderPeerId: string;
  readonly kind: string;
  readonly payload: unknown;
}): string => {
  const payloadText =
    typeof request.payload === "object" &&
    request.payload !== null &&
    "text" in request.payload &&
    typeof request.payload.text === "string"
      ? request.payload.text
      : JSON.stringify(request.payload);
  return [
    `<!-- comsnet-request:${request.requestId} -->`,
    `ComsNet request ${request.requestId} from ${request.senderPeerId} (${request.kind}).`,
    "Complete the requested work normally. ThroughLine will turn your finished response into the correlated result; do not poll or send a second reply.",
    "",
    payloadText,
  ].join("\n");
};

export type ComsNetPeerView = PeerIdentity & { readonly isSelf: boolean };

export const markCallerPeer = (
  scope: McpInvocationContext.McpInvocationScope,
  peers: ReadonlyArray<PeerIdentity>,
): ReadonlyArray<ComsNetPeerView> =>
  peers.map((peer) => ({
    ...peer,
    isSelf:
      peer.threadId === scope.threadId &&
      peer.providerInstanceId === scope.providerInstanceId &&
      peer.providerSessionId === scope.providerSessionId,
  }));

const handlers = {
  comsnet_peers: () =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireComsNetCapability();
      const transport = yield* ComsNetTransport.ComsNetTransport;
      return markCallerPeer(scope, yield* transport.listPeers());
    }).pipe(Effect.mapError(asFailure)),

  comsnet_send: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireComsNetCapability();
      const transport = yield* ComsNetTransport.ComsNetTransport;
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const engine = yield* OrchestrationEngineService;
      const request = yield* transport.send(scope, input);
      const currentRequest = yield* transport.status(scope, request.requestId);
      if (currentRequest.status === "delivered" && currentRequest.receiverTurnId !== undefined) {
        yield* transport.markDispatchSucceeded(scope, request.requestId);
        return currentRequest;
      }
      const target = yield* snapshotQuery.getThreadShellById(
        ThreadId.make(request.receiverThreadId),
      );
      if (Option.isNone(target)) {
        const reason = "receiver thread is no longer current";
        yield* transport.failDispatch(scope, request.requestId, reason);
        return yield* Effect.fail(reason);
      }
      // Reserve the queued request for the container-driven turn before the
      // asynchronous dispatch begins. A late subscriber can no longer claim
      // the same request and create a second receiver path while the engine is
      // waiting on checkpoints or provider startup.
      yield* transport.markDispatchSucceeded(scope, request.requestId);
      yield* dispatchWithLifecycleResult(
        withComsNetDispatchAckTimeout(
          engine.dispatch({
            type: "thread.turn.start",
            commandId: CommandId.make(`comsnet:${request.requestId}`),
            threadId: ThreadId.make(request.receiverThreadId),
            message: {
              messageId: MessageId.make(`comsnet:${request.requestId}:${randomUUID()}`),
              role: "user",
              text: requestText(request),
              attachments: [],
            },
            runtimeMode: target.value.runtimeMode,
            interactionMode: target.value.interactionMode,
            createdAt: request.createdAt,
          }),
        ),
        () => Effect.void,
        (message) => transport.failDispatch(scope, request.requestId, message),
      );
      return request;
    }).pipe(Effect.mapError(asFailure)),

  comsnet_subscribe: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireComsNetCapability();
      const transport = yield* ComsNetTransport.ComsNetTransport;
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const currentThread = yield* snapshotQuery.getThreadShellById(ThreadId.make(scope.threadId));
      const receiverTurnId = Option.isSome(currentThread)
        ? (currentThread.value.session?.activeTurnId ?? undefined)
        : undefined;
      return yield* transport.subscribe(scope, {
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(receiverTurnId === undefined || receiverTurnId === null ? {} : { receiverTurnId }),
      });
    }).pipe(Effect.mapError(asFailure)),

  comsnet_status: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireComsNetCapability();
      const transport = yield* ComsNetTransport.ComsNetTransport;
      return yield* transport.status(scope, input.requestId);
    }).pipe(Effect.mapError(asFailure)),

  comsnet_result: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireComsNetCapability();
      const transport = yield* ComsNetTransport.ComsNetTransport;
      return "result" in input && input.result !== undefined
        ? yield* transport.complete(scope, input.requestId, input.result)
        : yield* transport.waitForResult(scope, input.requestId, {
            ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
          });
    }).pipe(Effect.mapError(asFailure)),
} satisfies Parameters<typeof ComsNetToolkit.toLayer>[0];

export const ComsNetToolkitHandlersLive = ComsNetToolkit.toLayer(handlers);

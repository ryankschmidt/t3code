import {
  ComsNet,
  ComsNetError,
  JsonFileComsNetStore,
  type ComsNetRequest,
  type PeerDirectory,
  type PeerIdentity,
  type SendInput,
  type SubscribeOptions,
  type WaitForResultOptions,
} from "@ryan/coms-net";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import * as McpProviderSession from "./McpProviderSession.ts";

export const COMSNET_REQUEST_LEASE_MS = 120_000;

export interface ComsNetTransportShape {
  readonly listPeers: () => Effect.Effect<ReadonlyArray<PeerIdentity>, ComsNetTransportError>;
  readonly send: (
    scope: McpInvocationScope,
    input: SendInput,
  ) => Effect.Effect<ComsNetRequest, ComsNetTransportError>;
  readonly subscribe: (
    scope: McpInvocationScope,
    options?: SubscribeOptions,
  ) => Effect.Effect<ReadonlyArray<ComsNetRequest>, ComsNetTransportError>;
  readonly status: (
    scope: McpInvocationScope,
    requestId: string,
  ) => Effect.Effect<ComsNetRequest, ComsNetTransportError>;
  readonly complete: (
    scope: McpInvocationScope,
    requestId: string,
    result: unknown,
  ) => Effect.Effect<ComsNetRequest, ComsNetTransportError>;
  readonly failDispatch: (
    scope: McpInvocationScope,
    requestId: string,
    error: string,
  ) => Effect.Effect<ComsNetRequest, ComsNetTransportError>;
  readonly markDispatchSucceeded: (
    scope: McpInvocationScope,
    requestId: string,
  ) => Effect.Effect<ComsNetRequest, ComsNetTransportError>;
  readonly waitForResult: (
    scope: McpInvocationScope,
    requestId: string,
    options?: WaitForResultOptions,
  ) => Effect.Effect<ComsNetRequest, ComsNetTransportError>;
  readonly listFinishedTurnRequests: (
    receiverThreadId: string,
    receiverTurnId: string,
  ) => Effect.Effect<ReadonlyArray<ComsNetRequest>, ComsNetTransportError>;
  readonly completeFinishedTurn: (
    receiverThreadId: string,
    requestId: string,
    result: unknown,
  ) => Effect.Effect<ComsNetRequest, ComsNetTransportError>;
  readonly failFinishedTurn: (
    receiverThreadId: string,
    requestId: string,
    error: string,
  ) => Effect.Effect<ComsNetRequest, ComsNetTransportError>;
  readonly sweepExpired: () => Effect.Effect<ReadonlyArray<ComsNetRequest>, ComsNetTransportError>;
}

export class ComsNetTransportError extends Data.TaggedError("ComsNetTransportError")<{
  readonly message: string;
  readonly code?: string;
  readonly cause?: unknown;
}> {}

export class ComsNetTransport extends Context.Service<ComsNetTransport, ComsNetTransportShape>()(
  "t3/mcp/ComsNetTransport",
) {}

const fromPromise = <A>(operation: () => Promise<A>): Effect.Effect<A, ComsNetTransportError> =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new ComsNetTransportError({
        message: cause instanceof Error ? cause.message : String(cause),
        ...(cause instanceof ComsNetError ? { code: cause.code } : {}),
        cause,
      }),
  });

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const snapshotQuery = yield* ProjectionSnapshotQuery;

  const peers: PeerDirectory = {
    list: async () => {
      const snapshot = await Effect.runPromise(snapshotQuery.getShellSnapshot());
      const workspaceByProject = new Map(
        snapshot.projects.map((project) => [project.id, project.workspaceRoot] as const),
      );
      const identities: Array<PeerIdentity> = [];
      for (const thread of snapshot.threads) {
        const session = thread.session;
        const mcpSession = McpProviderSession.readMcpProviderSession(thread.id);
        if (
          session === null ||
          session.providerName === null ||
          session.providerInstanceId === undefined ||
          mcpSession === undefined ||
          mcpSession.providerInstanceId !== session.providerInstanceId ||
          session.status === "stopped"
        ) {
          continue;
        }
        const cwd = thread.worktreePath ?? workspaceByProject.get(thread.projectId);
        if (cwd === undefined) continue;
        const providerName = session.providerName;
        const providerInstanceId = session.providerInstanceId;
        // The MCP credential session is minted and owned by ThroughLine before
        // the native provider starts. It is therefore the identity that the
        // authenticated caller presents. A provider-native resume/thread id
        // is separate metadata and must never be compared with this value.
        const providerSessionId = mcpSession.providerSessionId;
        identities.push({
          peerId: `${providerName}:${providerSessionId}`,
          threadId: thread.id,
          providerName,
          providerInstanceId,
          providerSessionId,
          ...(typeof session.nativeTranscriptPath === "string"
            ? { transcriptPath: session.nativeTranscriptPath }
            : {}),
          cwd,
        });
      }
      return identities;
    },
    get: async (peerId) => (await peers.list()).find((peer) => peer.peerId === peerId),
  };

  const network = new ComsNet({
    store: new JsonFileComsNetStore(`${config.stateDir}/coms-net/requests.json`),
    peers,
    maxPayloadBytes: 64 * 1024,
    deliveryLeaseMs: 30_000,
    requestLeaseMs: COMSNET_REQUEST_LEASE_MS,
    receiverTurnLeaseMs: 4 * 60 * 60_000,
  });

  const principalFor = (scope: McpInvocationScope) =>
    fromPromise(async () => {
      const principal = (await peers.list()).find(
        (peer) =>
          peer.threadId === scope.threadId &&
          peer.providerSessionId === scope.providerSessionId &&
          peer.providerInstanceId === scope.providerInstanceId,
      );
      if (principal === undefined) {
        throw new ComsNetTransportError({
          message: "MCP credential does not resolve to a current ThroughLine peer",
        });
      }
      return principal;
    });

  return ComsNetTransport.of({
    listPeers: () => fromPromise(() => network.listPeers()),
    send: (scope, input) =>
      Effect.flatMap(principalFor(scope), (principal) =>
        fromPromise(() => network.send(principal, input)),
      ),
    subscribe: (scope, options) =>
      Effect.flatMap(principalFor(scope), (principal) =>
        fromPromise(() => network.subscribe(principal, options)),
      ),
    status: (scope, requestId) =>
      Effect.flatMap(principalFor(scope), (principal) =>
        fromPromise(() => network.status(principal, requestId)),
      ),
    complete: (scope, requestId, result) =>
      Effect.flatMap(principalFor(scope), (principal) =>
        fromPromise(() => network.complete(principal, requestId, result)),
      ),
    failDispatch: (scope, requestId, error) =>
      Effect.flatMap(principalFor(scope), (principal) =>
        fromPromise(() => network.failDispatch(principal, requestId, error)),
      ),
    markDispatchSucceeded: (scope, requestId) =>
      Effect.flatMap(principalFor(scope), (principal) =>
        fromPromise(() => network.markDispatchSucceeded(principal, requestId)),
      ),
    waitForResult: (scope, requestId, options) =>
      Effect.flatMap(principalFor(scope), (principal) =>
        fromPromise(() => network.waitForResult(principal, requestId, options)),
      ),
    listFinishedTurnRequests: (receiverThreadId, receiverTurnId) =>
      fromPromise(() => network.listTrustedReceiverTurn(receiverThreadId, receiverTurnId)),
    completeFinishedTurn: (receiverThreadId, requestId, result) =>
      fromPromise(() => network.completeTrustedReceiverThread(receiverThreadId, requestId, result)),
    failFinishedTurn: (receiverThreadId, requestId, error) =>
      fromPromise(() => network.failTrustedReceiverThread(receiverThreadId, requestId, error)),
    sweepExpired: () => fromPromise(() => network.sweepExpiredRequests()),
  });
});

export const layer = Layer.effect(ComsNetTransport, make);

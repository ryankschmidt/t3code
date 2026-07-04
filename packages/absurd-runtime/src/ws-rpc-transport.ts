/**
 * WsRpcTransport (Landing Sprint T1.3b) — the REAL-turn ThreadTransport.
 *
 * Drives an actual T3 provider turn through the server's WS RPC door
 * (`GET /ws` → effect RpcServer over WebSocket, JSON serialization), so a
 * durable `t3.thread-run` task executes a real conversation turn instead of
 * the LocalEcho placeholder. Design receipt (source-verified anchors):
 * `infra/t3code/_meta/day3-2026-07-04/T1.3b-WsRpcTransport-Design.md`.
 *
 * Wire mechanics (mirrors packages/client-runtime/src/rpc/session.ts, but
 * WITHOUT depending on client-runtime — only `@t3tools/contracts` for the
 * RpcGroup + schemas, and effect primitives absurd-runtime already has):
 *   - auth: `Authorization: Bearer <token>` on the WS upgrade (Node/undici
 *     headers extension). Browsers must use ?wsTicket=; we are Node.
 *   - commands: `orchestration.dispatchCommand` with `thread.create` /
 *     `thread.turn.start` (client generates CommandId/ThreadId/MessageId).
 *   - completion: POLL `orchestration.replayEvents` from a sequence cursor —
 *     a pull loop survives kills/reconnects (a stream subscription dies with
 *     the process); the durable step resumes and re-polls.
 *
 * effect-v4 bridging: one `ManagedRuntime` owns the socket protocol layer; its
 * `runPromise` runs each RPC call. `close()` disposes the runtime (closes WS).
 *
 * Must NOT own: step shape (thread-driver's), retry policy, provider
 * internals, credential values (token is passed in, never logged).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ORCHESTRATION_WS_METHODS, WsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Scope from "effect/Scope";
import { RpcClient } from "effect/unstable/rpc";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";
import type { ThreadTransport } from "./thread-driver.ts";

export type WsRpcTransportOptions = {
  /** Backend base URL, e.g. http://localhost:13773 (scheme is swapped to ws). */
  serverUrl: string;
  /** Bearer access token minted via the server's session-issue CLI. Never logged. */
  bearerToken: string;
  /** Project to attach the thread to. Required — the caller knows its project id. */
  projectId: string;
  /** Provider instance id (e.g. the governed ryan-codex instance). */
  instanceId: string;
  /** Model id for the turn (e.g. gpt-5.4). */
  model: string;
  /** Poll cadence for turn-completion (ms). Default 2000. */
  pollIntervalMs?: number | undefined;
};

export type WsRpcTransportHandle = ThreadTransport & {
  /**
   * Authenticated read-only round-trip (replayEvents from 0); returns the
   * current max event sequence. Health probe for workers + the connect smoke.
   */
  probe(): Promise<number>;
  /** Close the underlying WS runtime. */
  close(): Promise<void>;
};

type ReplayEvent = {
  sequence: number;
  type: string;
  aggregateId?: string;
  payload?: Record<string, unknown>;
};

function wsUrl(serverUrl: string): string {
  const u = new URL("/ws", serverUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

/**
 * Build the transport: opens one authenticated WS RPC session (via a
 * ManagedRuntime) and exposes the three plain-async ThreadTransport methods.
 */
export async function makeWsRpcTransport(
  opts: WsRpcTransportOptions,
): Promise<WsRpcTransportHandle> {
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;

  // Bearer rides the upgrade request. Node's global WebSocket (undici) takes an
  // options bag with a `headers` extension as the 2nd arg; the browser
  // signature (protocols) is unused here. The service contract is a plain
  // (url, protocols?) => WebSocket function.
  const webSocketConstructor = (url: string, _protocols?: string | Array<string>) =>
    new (globalThis as unknown as {
      WebSocket: new (u: string, o?: unknown) => globalThis.WebSocket;
    }).WebSocket(url, {
      headers: { authorization: `Bearer ${opts.bearerToken}` },
    });

  const socketLayer = Socket.layerWebSocket(wsUrl(opts.serverUrl), {
    openTimeout: "15 seconds",
  }).pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, webSocketConstructor)));

  const protocolLayer = Layer.effect(
    RpcClient.Protocol,
    RpcClient.makeProtocolSocket({ retryTransientErrors: true }),
  ).pipe(Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)));

  const runtime = ManagedRuntime.make(protocolLayer);
  // RpcClient.make registers the client's connection lifetime in a Scope; the
  // reference pattern (client-runtime/src/rpc/session.ts) takes that Scope from
  // the caller. Mint one explicit scope spanning the transport's lifetime —
  // close() ends it before disposing the runtime.
  const clientScope = await runtime.runPromise(Scope.make());
  const client = await runtime.runPromise(
    Scope.provide(makeWsRpcProtocolClient(), clientScope),
  );

  const dispatch = (command: Record<string, unknown>): Promise<unknown> =>
    runtime.runPromise(callClient(client, ORCHESTRATION_WS_METHODS.dispatchCommand, command));

  const replayEvents = (fromSequenceExclusive: number): Promise<ReadonlyArray<ReplayEvent>> =>
    runtime.runPromise(
      callClient(client, ORCHESTRATION_WS_METHODS.replayEvents, { fromSequenceExclusive }),
    ) as Promise<ReadonlyArray<ReplayEvent>>;

  const currentSequence = async (): Promise<number> => {
    const events = await replayEvents(0);
    return events.length === 0 ? 0 : Math.max(...events.map((e) => e.sequence));
  };

  const transport: WsRpcTransportHandle = {
    async probe() {
      return currentSequence();
    },

    async resolveThread(params) {
      if (params.threadId) return { threadId: params.threadId, created: false };
      const threadId = randomUUID();
      await dispatch({
        type: "thread.create",
        commandId: randomUUID(),
        threadId,
        projectId: opts.projectId,
        title: "durable thread-run (T1.3b)",
        modelSelection: { instanceId: opts.instanceId, model: opts.model },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: new Date().toISOString(),
      });
      return { threadId, created: true };
    },

    async dispatchTurn(threadId, prompt) {
      const turnCursor = await currentSequence();
      const messageId = randomUUID();
      await dispatch({
        type: "thread.turn.start",
        commandId: randomUUID(),
        threadId,
        message: { messageId, role: "user", text: prompt, attachments: [] },
        modelSelection: { instanceId: opts.instanceId, model: opts.model },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });
      // Encode the pre-dispatch sequence cursor into the turn handle so
      // awaitTurnComplete scans forward from exactly where we left off.
      return { turnId: `seq:${turnCursor}:${messageId}`, dispatchedAt: new Date().toISOString() };
    },

    async awaitTurnComplete(threadId, turnId, holdMs) {
      const seqStr = turnId.split(":")[1];
      let cursor = Number(seqStr ?? 0) || 0;
      const deadline = Date.now() + Math.max(holdMs, 10 * 60_000);
      // Completion signal, verified against the live event store (dev DB,
      // 2026-07-04): a real turn emits `thread.session-set` status
      // running → ready. `thread.turn-diff-completed` fires ONLY when
      // checkpoint capture succeeds (observed count: 0 across 2 real turns,
      // with checkpoint.capture.failed activities) — accepted as an early
      // completion signal but never relied on as the primary one.
      let sawRunning = false;
      for (;;) {
        const events = await replayEvents(cursor);
        for (const event of events) {
          if (event.sequence > cursor) cursor = event.sequence;
          const payload = event.payload ?? {};
          const forThisThread =
            event.aggregateId === threadId || payload["threadId"] === threadId;
          if (!forThisThread) continue;
          if (event.type === "thread.session-set") {
            const session = payload["session"] as
              | { status?: string; lastError?: string | null }
              | undefined;
            const status = session?.status;
            if (status === "running") {
              sawRunning = true;
            } else if (status === "error") {
              const detail = session?.lastError ? `: ${session.lastError}` : "";
              throw new Error(
                `ws-rpc-transport: turn failed (session error at seq ${event.sequence}${detail})`,
              );
            } else if (sawRunning && (status === "ready" || status === "idle")) {
              return {
                state: "completed",
                summary: `turn completed (session ${status} at seq ${event.sequence})`,
              };
            } else if (sawRunning && (status === "interrupted" || status === "stopped")) {
              throw new Error(
                `ws-rpc-transport: turn did not complete (session ${status} at seq ${event.sequence})`,
              );
            }
          }
          if (event.type === "thread.turn-diff-completed") {
            return {
              state: "completed",
              summary: `turn completed (turn-diff-completed at seq ${event.sequence})`,
            };
          }
        }
        if (Date.now() > deadline) {
          throw new Error(
            `ws-rpc-transport: turn did not complete before deadline (thread ${threadId})`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    },

    async close() {
      await runtime.runPromise(Scope.close(clientScope, Exit.void)).catch(() => {});
      await runtime.dispose();
    },
  };

  return transport;
}

export type LazyWsRpcTransport = ThreadTransport & {
  /** Close the underlying WS runtime if it was ever established. */
  close(): Promise<void>;
};

/**
 * Env-configured, lazily-connecting WS transport for worker registration.
 *
 * `startAbsurdRuntime` is synchronous, so the WS session cannot be awaited at
 * registration time. This wrapper connects on FIRST task use instead — boot
 * never blocks on the WS door being up, and after a `kill -9` + relaunch the
 * new process re-establishes its own session on the next claimed task. A
 * failed connect clears the cached promise so the next attempt retries.
 *
 * Env (path/id values only — the bearer VALUE lives in a file, never in env):
 *   T3_BEARER_TOKEN_FILE (required), T3_PROJECT_ID (required),
 *   T3_SERVER_URL (default http://localhost:13773),
 *   T3_INSTANCE_ID (default codex), T3_MODEL (default gpt-5.5).
 */
export function makeWsRpcTransportFromEnv(
  env: Record<string, string | undefined> = process.env,
): LazyWsRpcTransport {
  let handlePromise: Promise<WsRpcTransportHandle> | null = null;
  const connect = (): Promise<WsRpcTransportHandle> => {
    handlePromise ??= (async () => {
      const tokenFile = env["T3_BEARER_TOKEN_FILE"];
      if (!tokenFile) {
        throw new Error("ws-rpc-transport: T3_BEARER_TOKEN_FILE not set (path to bearer token)");
      }
      const projectId = env["T3_PROJECT_ID"];
      if (!projectId) {
        throw new Error("ws-rpc-transport: T3_PROJECT_ID not set");
      }
      return makeWsRpcTransport({
        serverUrl: env["T3_SERVER_URL"] ?? "http://localhost:13773",
        bearerToken: readFileSync(tokenFile, "utf8").trim(),
        projectId,
        instanceId: env["T3_INSTANCE_ID"] ?? "codex",
        model: env["T3_MODEL"] ?? "gpt-5.5",
      });
    })().catch((err: unknown) => {
      handlePromise = null;
      throw err;
    });
    return handlePromise;
  };
  return {
    resolveThread: (params) => connect().then((t) => t.resolveThread(params)),
    dispatchTurn: (threadId, prompt) => connect().then((t) => t.dispatchTurn(threadId, prompt)),
    awaitTurnComplete: (threadId, turnId, holdMs) =>
      connect().then((t) => t.awaitTurnComplete(threadId, turnId, holdMs)),
    close: async () => {
      const pending = handlePromise;
      handlePromise = null;
      if (!pending) return;
      try {
        const handle = await pending;
        await handle.close();
      } catch {
        // never fail shutdown on a transport that never connected
      }
    },
  };
}

// --- effect-v4 RPC client plumbing (kept out of the async body for clarity) ---

function makeWsRpcProtocolClient(): Effect.Effect<
  RpcClientShape,
  Error,
  RpcClient.Protocol | Scope.Scope
> {
  return RpcClient.make(WsRpcGroup) as unknown as Effect.Effect<
    RpcClientShape,
    Error,
    RpcClient.Protocol | Scope.Scope
  >;
}

/** The RpcClient exposes one method per WS method name, each `(payload) => Effect`. */
type RpcClientShape = Record<
  string,
  (payload: unknown) => Effect.Effect<unknown, Error, never>
>;

function callClient(
  client: RpcClientShape,
  method: string,
  payload: unknown,
): Effect.Effect<unknown, Error, never> {
  const fn = client[method];
  if (!fn) {
    return Effect.die(new Error(`ws-rpc-transport: RPC method not on client: ${method}`));
  }
  return fn(payload);
}

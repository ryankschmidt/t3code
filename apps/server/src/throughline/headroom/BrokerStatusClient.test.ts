// @effect-diagnostics nodeBuiltinImport:off - a controlled localhost HTTP fixture, not a broker/model deployment.
import * as NodeHttp from "node:http";
import { beforeAll, afterAll, describe, expect, test, vi } from "vite-plus/test";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ProviderSession,
  type ProviderSendTurnInput,
} from "@t3tools/contracts";
import { BrokerStatusClient } from "./BrokerStatusClient.ts";
import { makeProviderServiceLive } from "../../provider/Layers/ProviderService.ts";
import * as ProviderService from "../../provider/Services/ProviderService.ts";
import * as Registry from "../../provider/Services/ProviderAdapterRegistry.ts";
import type { ProviderAdapterShape } from "../../provider/Services/ProviderAdapter.ts";
import type { ProviderAdapterError } from "../../provider/Errors.ts";
import { makeAdapterRegistryMock } from "../../provider/testUtils/providerAdapterRegistryMock.ts";
import { ProviderSessionDirectoryLive } from "../../provider/Layers/ProviderSessionDirectory.ts";
import * as RuntimeRepository from "../../persistence/ProviderSessionRuntime.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as Analytics from "../../telemetry/AnalyticsService.ts";
import * as EventLoggers from "../../provider/Layers/ProviderEventLoggers.ts";

let body: unknown;
let httpStatus = 200;
let url = "";
let holdResponse = false;
const requests: Array<{
  method: string | undefined;
  path: string | undefined;
  authorized: boolean;
}> = [];
const clients: BrokerStatusClient[] = [];
const server = NodeHttp.createServer((request, response) => {
  requests.push({
    method: request.method,
    path: request.url,
    authorized: request.headers.authorization !== undefined,
  });
  if (holdResponse) return;
  response.writeHead(httpStatus, { "content-type": "application/json" });
  response.end(typeof body === "string" ? body : JSON.stringify(body));
});
beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture address missing");
  url = `http://127.0.0.1:${address.port}/v1/status`;
});
afterAll(async () => {
  clients.forEach((client) => client.close());
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
const iso = (epoch: number) => DateTime.formatIso(DateTime.makeUnsafe(epoch));
const payload = (identities: unknown[]) => ({
  schema: "throughline-provider-broker.observer-status.v1",
  last_sequence: 1,
  identities,
});
const account = (
  identity: string,
  now: number,
  state: "unknown" | "available" | "empty" = "empty",
) => ({
  identity,
  provider: "codex",
  credential_loaded: identity !== "unloaded",
  quota: { state, observed_at: iso(now), reset_at: iso(now + 60_000) },
});
function client(
  now: () => number,
  options: { requestTimeoutMs?: number; maxResponseBytes?: number } = {},
) {
  const value = new BrokerStatusClient({ statusUrl: url, now, freshnessMs: 120_000, ...options });
  clients.push(value);
  return value;
}

describe("existing observer HTTP to synchronous typed cache", () => {
  test("GET does not refresh quota time and loaded is not quota availability", async () => {
    let now = Date.parse("2026-10-09T16:00:00Z");
    const oldQuotaTime = iso(now - 180_000);
    body = payload([
      {
        ...account("unloaded", now),
        quota: { state: "empty", observed_at: oldQuotaTime, reset_at: "2099-01-01T00:00:00Z" },
      },
    ]);
    httpStatus = 200;
    const cached = client(() => now);
    const before = requests.length;
    await cached.refresh();
    expect(requests.slice(before)).toEqual([
      { method: "GET", path: "/v1/status", authorized: false },
    ]);
    expect(cached.read().state).toBe("fresh");
    expect(cached.read().snapshot?.identities[0]?.quota?.observed_at).toBe(oldQuotaTime);
    expect(cached.read().identities[0]).toMatchObject({
      configured: null,
      loaded: false,
      available: null,
    });
    now += 1_000;
    await cached.refresh();
    expect(cached.read().snapshot?.identities[0]?.quota?.observed_at).toBe(oldQuotaTime);
    expect(requests.length).toBe(before + 2);
  });

  test("all reported identities survive stale, HTTP failure and malformed responses as unknown", async () => {
    let now = Date.parse("2026-10-09T16:00:00Z");
    body = payload(
      Array.from({ length: 19 }, (_, index) => account(`account-${index}`, now, "available")),
    );
    httpStatus = 200;
    const cached = client(() => now);
    await cached.refresh();
    expect(cached.read().identities).toHaveLength(19);
    now += 120_000;
    expect(cached.read().state).toBe("stale");
    expect(cached.read().snapshot).toBeUndefined();
    expect(
      cached.read().identities.every((row) => row.loaded === null && row.available === null),
    ).toBe(true);
    httpStatus = 503;
    await cached.refresh();
    expect(cached.read().state).toBe("failed");
    expect(cached.read().snapshot).toBeUndefined();
    expect(cached.read().identities).toHaveLength(19);
    httpStatus = 200;
    body = "not-json";
    await cached.refresh();
    expect(cached.read().snapshot).toBeUndefined();
    expect(cached.read().identities).toHaveLength(19);
    body = payload([{ ...account("loaded", now), credential_loaded: "not-a-boolean" }]);
    await cached.refresh();
    expect(cached.read().state).toBe("failed");
    expect(cached.read().snapshot).toBeUndefined();
    expect(cached.read().identities).toHaveLength(19);
  });

  test("unknown configuration never becomes false, reads are isolated, and bodies are bounded", async () => {
    const now = Date.parse("2026-10-09T16:00:00Z");
    body = payload([account("unloaded", now, "available")]);
    httpStatus = 200;
    const cached = client(() => now);
    await cached.refresh();
    expect(cached.read().identities[0]).toMatchObject({
      configured: null,
      loaded: false,
      available: true,
    });
    const first = cached.read().snapshot;
    if (!first) throw new Error("HTTP snapshot missing");
    Object.assign(first.identities[0]!, { credential_loaded: true });
    expect(cached.read().snapshot?.identities[0]?.credential_loaded).toBe(false);
    const bounded = client(() => now, { maxResponseBytes: 32 });
    await bounded.refresh();
    expect(bounded.read().snapshot).toBeUndefined();
    cached.close();
    expect(cached.read().state).toBe("closed");
    expect(cached.read().snapshot).toBeUndefined();
  });
  test("real HTTP timeout becomes unknown without a quota or credential operation", async () => {
    const cached = client(() => 0, { requestTimeoutMs: 1_000 });
    const before = requests.length;
    holdResponse = true;
    try {
      await cached.refresh();
      expect(requests.slice(before)).toEqual([
        { method: "GET", path: "/v1/status", authorized: false },
      ]);
      expect(cached.read().state).toBe("failed");
      expect(cached.read().snapshot).toBeUndefined();
    } finally {
      holdResponse = false;
      cached.close();
    }
  });
});

// The real service, registry and in-memory persistence; only the provider adapter is controlled.
const driver = ProviderDriverKind.make("codex");
const instance = ProviderInstanceId.make("codex");
const sessions = new Map<ThreadId, ProviderSession>();
const sendTurn = vi.fn((input: ProviderSendTurnInput) =>
  Effect.succeed({ threadId: input.threadId, turnId: TurnId.make(`turn-${input.threadId}`) }),
);
const adapter: ProviderAdapterShape<ProviderAdapterError> = {
  provider: driver,
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: (input) =>
    Effect.sync(() => {
      const session: ProviderSession = {
        provider: driver,
        providerInstanceId: instance,
        threadId: input.threadId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd: input.cwd ?? process.cwd(),
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      sessions.set(input.threadId, session);
      return session;
    }),
  sendTurn,
  interruptTurn: () => Effect.void,
  respondToRequest: () => Effect.void,
  respondToUserInput: () => Effect.void,
  stopSession: (id) =>
    Effect.sync(() => {
      sessions.delete(id);
    }),
  listSessions: () => Effect.succeed([...sessions.values()]),
  hasSession: (id) => Effect.succeed(sessions.has(id)),
  readThread: (id) => Effect.succeed({ threadId: id, turns: [] }),
  rollbackThread: (id) => Effect.succeed({ threadId: id, turns: [] }),
  stopAll: () => Effect.sync(() => sessions.clear()),
  streamEvents: Stream.empty,
};
let activeCache: BrokerStatusClient | undefined;
const configured = [
  { identity: "loaded", provider: "codex" },
  { identity: "unloaded", provider: "codex" },
];
const repository = RuntimeRepository.layer.pipe(Layer.provide(SqlitePersistenceMemory));
const directory = ProviderSessionDirectoryLive.pipe(Layer.provide(repository));
const providerLayer = makeProviderServiceLive({
  issueMcpCredential: () => Effect.succeed(undefined),
  readHeadroomSnapshot: () => {
    const snapshot = activeCache?.read().snapshot;
    return { configured, ...(snapshot ? { snapshot } : {}), freshnessMs: 120_000 };
  },
}).pipe(
  Layer.provide(NodeServices.layer),
  Layer.provide(
    Layer.succeed(Registry.ProviderAdapterRegistry, makeAdapterRegistryMock({ [driver]: adapter })),
  ),
  Layer.provide(directory),
  Layer.provide(ServerSettings.ServerSettingsService.layerTest()),
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), process.cwd()).pipe(Layer.provide(NodeServices.layer)),
  ),
  Layer.provideMerge(Analytics.layerTest),
  Layer.provide(
    Layer.succeed(EventLoggers.ProviderEventLoggers, EventLoggers.NoOpProviderEventLoggers),
  ),
);
effectIt.layer(Layer.mergeAll(providerLayer, directory, repository, NodeServices.layer))(
  "real HTTP cache to ProviderService",
  (it) => {
    it.effect(
      "absent, old, failed, malformed and reset-unknown HTTP observations admit actual adapter dispatch",
      () =>
        Effect.gen(function* () {
          const provider = yield* ProviderService.ProviderService;
          const threadId = ThreadId.make("cache-unknown");
          yield* provider.startSession(threadId, {
            provider: driver,
            providerInstanceId: instance,
            threadId,
            runtimeMode: "full-access",
          });
          sendTurn.mockClear();
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          activeCache = client(() => now);
          yield* provider.sendTurn({ threadId, input: "absent" });
          const responses = [
            payload(
              configured.map((row) => ({
                ...account(row.identity, now),
                quota: {
                  state: "empty",
                  observed_at: iso(now - 180_000),
                  reset_at: "2099-01-01T00:00:00Z",
                },
              })),
            ),
            "not-json",
            payload(
              configured.map((row) => ({
                ...account(row.identity, now),
                quota: { state: "empty", observed_at: iso(now) },
              })),
            ),
          ];
          httpStatus = 200;
          for (const value of responses) {
            body = value;
            yield* Effect.promise(() => activeCache!.refresh());
            yield* provider.sendTurn({ threadId, input: "controlled unknown" });
          }
          httpStatus = 503;
          yield* Effect.promise(() => activeCache!.refresh());
          yield* provider.sendTurn({ threadId, input: "failed" });
          expect(sendTurn).toHaveBeenCalledTimes(5);
        }),
    );
    it.effect("fresh known-empty HTTP observations hold the actual adapter until reset", () =>
      Effect.gen(function* () {
        const provider = yield* ProviderService.ProviderService;
        const threadId = ThreadId.make("cache-known-empty");
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        activeCache = client(() => now);
        httpStatus = 200;
        body = payload(configured.map((row) => account(row.identity, now)));
        yield* Effect.promise(() => activeCache!.refresh());
        yield* provider.startSession(threadId, {
          provider: driver,
          providerInstanceId: instance,
          threadId,
          runtimeMode: "full-access",
        });
        sendTurn.mockClear();
        const waiting = yield* provider.streamEvents.pipe(
          Stream.filter(
            (event) => event.type === "session.state.changed" && event.payload.state === "waiting",
          ),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkScoped,
        );
        const sending = yield* provider
          .sendTurn({ threadId, input: "controlled empty" })
          .pipe(Effect.forkScoped);
        yield* TestClock.adjust("1 millis");
        expect(sendTurn).toHaveBeenCalledTimes(0);
        expect((yield* Fiber.join(waiting)).length).toBe(1);
        yield* TestClock.adjust("59999 millis");
        yield* Fiber.join(sending);
        expect(sendTurn).toHaveBeenCalledTimes(1);
      }),
    );
    it.effect(
      "expired transport does not revive a future-clock quota observation into a hold",
      () =>
        Effect.gen(function* () {
          const provider = yield* ProviderService.ProviderService;
          const threadId = ThreadId.make("cache-expired-transport");
          let now = DateTime.toEpochMillis(yield* DateTime.now);
          activeCache = client(() => now);
          httpStatus = 200;
          body = payload(
            configured.map((row) => ({
              ...account(row.identity, now),
              quota: {
                state: "empty",
                observed_at: iso(now + 120_000),
                reset_at: iso(now + 180_000),
              },
            })),
          );
          yield* Effect.promise(() => activeCache!.refresh());
          yield* provider.startSession(threadId, {
            provider: driver,
            providerInstanceId: instance,
            threadId,
            runtimeMode: "full-access",
          });
          sendTurn.mockClear();
          yield* TestClock.adjust("120000 millis");
          now = DateTime.toEpochMillis(yield* DateTime.now);
          expect(activeCache.read().state).toBe("stale");
          expect(activeCache.read().snapshot).toBeUndefined();
          yield* provider.sendTurn({ threadId, input: "expired transport" });
          expect(sendTurn).toHaveBeenCalledTimes(1);
        }),
    );
  },
);

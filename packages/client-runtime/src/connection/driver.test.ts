import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as Driver from "./driver.ts";
import * as Resolver from "./resolver.ts";
import { RelayConnectionTarget, type PreparedConnection } from "./model.ts";
import * as RpcSession from "../rpc/session.ts";
import * as Authorization from "../authorization/service.ts";
import * as TokenStore from "../authorization/tokenStore.ts";
import * as Capabilities from "../platform/capabilities.ts";
import * as Relay from "../relay/managedRelay.ts";

const ID = EnvironmentId.make("synthetic-idle-environment");
const ENDPOINT = {
  httpBaseUrl: "https://idle.example.test",
  wsBaseUrl: "wss://idle.example.test",
  providerKind: "cloudflare_tunnel" as const,
};
const TARGET = new RelayConnectionTarget({
  environmentId: ID,
  label: "Synthetic idle environment",
});
const grant = (issuedAt: number) =>
  new TokenStore.RemoteDpopAccessToken({
    environmentId: ID,
    accountId: "synthetic-account",
    label: TARGET.label,
    endpoint: ENDPOINT,
    accessToken: "synthetic-test-grant",
    issuedAtEpochMs: issuedAt,
    expiresAtEpochMs: issuedAt + 30_000,
    dpopThumbprint: "synthetic-key",
  });

const makeHarness = Effect.fnUntraced(function* () {
  const tokens = yield* Ref.make<Option.Option<TokenStore.RemoteDpopAccessToken>>(
    Option.some(grant(0)),
  );
  const calls = yield* Ref.make<ReadonlyArray<number>>([]);
  const session = yield* Ref.make(Option.some({ accountId: "synthetic-account" }));
  const key = yield* Ref.make("synthetic-key");
  const remote = Authorization.RemoteEnvironmentAuthorization.of({
    authorizeBearer: () => Effect.die("Bearer is not used by this test"),
    authorizeDpop: () => Effect.die("Resolver is separately controlled"),
    authorizeDpopHttp: () =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        yield* Ref.update(calls, (previous) => [...previous, now]);
        const token = grant(now);
        yield* Ref.set(tokens, Option.some(token));
        return {
          environmentId: ID,
          label: TARGET.label,
          httpBaseUrl: ENDPOINT.httpBaseUrl,
          httpAuthorization: {
            _tag: "Dpop" as const,
            accessToken: token.accessToken,
            expiresAtEpochMs: token.expiresAtEpochMs,
          },
        };
      }),
  });
  const prepared: PreparedConnection = {
    environmentId: ID,
    label: TARGET.label,
    target: TARGET,
    httpBaseUrl: ENDPOINT.httpBaseUrl,
    socketUrl: `${ENDPOINT.wsBaseUrl}/synthetic-socket`,
    httpAuthorization: {
      _tag: "Dpop",
      accessToken: "synthetic-test-grant",
      expiresAtEpochMs: 30_000,
    },
  };
  const rpc: RpcSession.RpcSession = {
    client: {} as RpcSession.RpcSession["client"],
    initialConfig: Effect.die("Config is not used"),
    subscribeServerConfig: () => Stream.die("Config is not used"),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  const layer = Driver.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Resolver.ConnectionResolver, { prepare: () => Effect.succeed(prepared) }),
        Layer.succeed(RpcSession.RpcSessionFactory, { connect: () => Effect.succeed(rpc) }),
        Layer.succeed(Authorization.RemoteEnvironmentAuthorization, remote),
        Layer.succeed(Capabilities.CloudSession, {
          identity: Ref.get(session),
          clerkToken: Effect.succeed("synthetic-clerk"),
        }),
        Layer.succeed(Relay.ManagedRelayDpopSigner, {
          thumbprint: Ref.get(key),
          createProof: () => Effect.succeed("synthetic-proof"),
        }),
        TokenStore.layer({
          get: () => Ref.get(tokens),
          put: (token) => Ref.set(tokens, Option.some(token)),
          remove: () => Ref.set(tokens, Option.none()),
        }),
      ),
    ),
  );
  const applicationScope = yield* Scope.make();
  const context = yield* Layer.build(layer).pipe(Scope.provide(applicationScope));
  const driver = Context.get(context, Driver.ConnectionDriver);
  const leaseScope = yield* Scope.make();
  const lease = yield* driver
    .connect({ target: TARGET, enabled: true, profile: Option.none() }, () => Effect.void)
    .pipe(Scope.provide(leaseScope));
  return { calls, tokens, session, key, lease, leaseScope, applicationScope };
});

describe("connection-owned idle renewal", () => {
  it.effect("renews a short grant while idle before the next request", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* TestClock.adjust("26 seconds");
      expect(yield* Ref.get(harness.calls)).toEqual([]);
      yield* TestClock.adjust("1 second");
      expect(yield* Ref.get(harness.calls)).toEqual([27_000]);
      const token = yield* Ref.get(harness.tokens);
      expect(Option.isSome(token) && token.value.expiresAtEpochMs).toBe(57_000);
      yield* Scope.close(harness.leaseScope, Exit.void);
      yield* Scope.close(harness.applicationScope, Exit.void);
    }),
  );

  it.effect("closing the connection lease stops its idle renewal timer", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* TestClock.adjust("26 seconds");
      yield* Scope.close(harness.leaseScope, Exit.void);
      yield* TestClock.adjust("2 minutes");
      expect(yield* Ref.get(harness.calls)).toEqual([]);
      yield* Scope.close(harness.applicationScope, Exit.void);
    }),
  );
});

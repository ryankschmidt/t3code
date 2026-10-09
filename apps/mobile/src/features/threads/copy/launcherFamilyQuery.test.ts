import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  AVAILABLE_CONNECTION_STATE,
  EnvironmentRegistry,
  EnvironmentSupervisor,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
  type NetworkStatus,
  type ConnectionCatalogEntry,
} from "@t3tools/client-runtime/connection";
import type { RpcSession } from "@t3tools/client-runtime/rpc";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { createLauncherFamilyQuery } from "./launcherFamilyQuery";
import type { LauncherFamilyViewInput } from "./launcherFamily";

// Replace only the app runtime port. The committed factory and public query runtime execute unchanged.
const port = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock("../../../connection/runtime", () => ({
  get connectionAtomRuntime() {
    return port.runtime;
  },
}));

const envA = EnvironmentId.make("controlled-owner-a");
const envB = EnvironmentId.make("controlled-owner-b");
const thread = ThreadId.make("controlled-public-thread");
const result = (id: string): LauncherFamilyViewInput => ({
  threadId: process.env.LINEAGE_QUERY_NEGATIVE_REPLY === "1" ? "controlled-invalid-reply" : id,
  source: "agent-instruments.thread-lineage.v1",
  status: "unknown",
  reason: "not-recorded",
});

async function harness() {
  const supervisors = new Map<EnvironmentId, EnvironmentSupervisor["Service"]>();
  const routed: EnvironmentId[] = [];
  for (const environmentId of [envA, envB]) {
    supervisors.set(
      environmentId,
      EnvironmentSupervisor.of({
        target: new PrimaryConnectionTarget({
          environmentId,
          label: "Controlled fixture",
          httpBaseUrl: "https://fixture.invalid",
          wsBaseUrl: "wss://fixture.invalid",
        }),
        state: await Effect.runPromise(
          SubscriptionRef.make<SupervisorConnectionState>({
            ...AVAILABLE_CONNECTION_STATE,
            desired: true,
            network: "online" as const,
            phase: "connected" as const,
            attempt: 1,
            generation: 1,
          }),
        ),
        // Presence-only token, matching the public runtime's own fixture. No client method can be used.
        session: await Effect.runPromise(SubscriptionRef.make(Option.some({} as RpcSession))),
        prepared: await Effect.runPromise(
          SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
        ),
        connect: Effect.die("Unexpected connect"),
        disconnect: Effect.die("Unexpected disconnect"),
        retryNow: Effect.die("Unexpected retry"),
      }),
    );
  }
  const selected = (id: EnvironmentId) => {
    const supervisor = supervisors.get(id);
    if (!supervisor) throw new Error("Fixture environment not registered");
    return supervisor;
  };
  const run: EnvironmentRegistry["Service"]["run"] = (id, effect) => {
    routed.push(id);
    return Effect.provideService(effect, EnvironmentSupervisor, selected(id));
  };
  const runStream: EnvironmentRegistry["Service"]["runStream"] = (id, stream) =>
    Stream.provideService(stream, EnvironmentSupervisor, selected(id));
  const noWrite = Effect.die("Registry mutation is outside this test");
  const service = EnvironmentRegistry.of({
    entries: await Effect.runPromise(
      SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(new Map()),
    ),
    networkStatus: await Effect.runPromise(SubscriptionRef.make<NetworkStatus>("online")),
    start: noWrite,
    register: () => noWrite,
    registerPlatform: () => noWrite,
    reconcilePlatform: () => noWrite,
    remove: () => noWrite,
    removeRelayEnvironments: () => noWrite,
    retryNow: () => noWrite,
    setEnabled: () => noWrite,
    setCompatibility: () => noWrite,
    state: (id) => SubscriptionRef.get(selected(id).state),
    stateChanges: (id) => SubscriptionRef.changes(selected(id).state),
    run,
    runStream,
    followStream: (id, stream) =>
      Stream.provideService(stream, EnvironmentSupervisor, selected(id)),
  });
  port.runtime = Atom.runtime(Layer.succeed(EnvironmentRegistry, service));
  const registry = AtomRegistry.make();
  return { registry, routed, dispose: () => registry.dispose() };
}

describe("committed launcher-family query factory consumer", () => {
  it("routes identical public thread IDs through each owning environment and caches completed results", async () => {
    const h = await harness();
    const reads: Array<{ environmentId: EnvironmentId; threadId: ThreadId }> = [];
    const family = createLauncherFamilyQuery((input) =>
      Effect.gen(function* () {
        const supervisor = yield* EnvironmentSupervisor;
        reads.push({ environmentId: supervisor.target.environmentId, threadId: input.threadId });
        return result(input.threadId);
      }),
    );
    const a = family({ environmentId: envA, input: { threadId: thread } });
    const b = family({ environmentId: envB, input: { threadId: thread } });
    expect(family({ environmentId: envA, input: { threadId: thread } })).toBe(a);
    expect(b).not.toBe(a);
    const unmountA = h.registry.mount(a),
      unmountB = h.registry.mount(b);
    try {
      const [first, second] = await Promise.all(
        [a, b].map((atom) =>
          Effect.runPromise(AtomRegistry.getResult(h.registry, atom, { suspendOnWaiting: true })),
        ),
      );
      expect(first).toEqual(result(thread));
      expect(second).toEqual(result(thread));
      expect(reads).toEqual(
        expect.arrayContaining([
          { environmentId: envA, threadId: thread },
          { environmentId: envB, threadId: thread },
        ]),
      );
      expect(reads).toHaveLength(2);
      expect(h.routed).toContain(envA);
      expect(h.routed).toContain(envB);
      expect(
        await Effect.runPromise(AtomRegistry.getResult(h.registry, a, { suspendOnWaiting: true })),
      ).toBe(first);
      expect(reads).toHaveLength(2);
      const cached = h.registry.get(a);
      expect(AsyncResult.isSuccess(cached)).toBe(true);
      expect(cached.waiting).toBe(false);
    } finally {
      unmountA();
      unmountB();
      h.dispose();
    }
  });

  it("does not complete while a read is pending, then publishes the actual result", async () => {
    const h = await harness();
    const started = await Effect.runPromise(Deferred.make<void>());
    const finished = await Effect.runPromise(Deferred.make<LauncherFamilyViewInput>());
    const family = createLauncherFamilyQuery(() =>
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(finished))),
    );
    const atom = family({ environmentId: envA, input: { threadId: thread } });
    const unmount = h.registry.mount(atom);
    try {
      const completion = Effect.runPromise(
        AtomRegistry.getResult(h.registry, atom, { suspendOnWaiting: true }),
      );
      await Effect.runPromise(Deferred.await(started));
      expect(h.registry.get(atom).waiting).toBe(true);
      await Effect.runPromise(Deferred.succeed(finished, result(thread)));
      expect(await completion).toEqual(result(thread));
      expect(h.registry.get(atom).waiting).toBe(false);
    } finally {
      unmount();
      h.dispose();
    }
  });

  it("settles the factory's typed public-thread mismatch failure rather than caching another thread", async () => {
    const h = await harness();
    const family = createLauncherFamilyQuery(() =>
      Effect.succeed(result("controlled-other-thread")),
    );
    const atom = family({ environmentId: envA, input: { threadId: thread } });
    const unmount = h.registry.mount(atom);
    try {
      const exit = await Effect.runPromise(
        Effect.exit(AtomRegistry.getResult(h.registry, atom, { suspendOnWaiting: true })),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit))
        expect(Cause.squash(exit.cause)).toMatchObject({
          _tag: "LauncherFamilyReadMismatch",
          expectedThreadId: thread,
          receivedThreadId: result("controlled-other-thread").threadId,
        });
      expect(AsyncResult.isFailure(h.registry.get(atom))).toBe(true);
      expect(h.registry.get(atom).waiting).toBe(false);
    } finally {
      unmount();
      h.dispose();
    }
  });
});

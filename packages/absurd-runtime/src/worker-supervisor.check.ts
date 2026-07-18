/**
 * Mechanical check for the worker supervisor (pool-recovery defect fix).
 *
 * Dependency-free (node:assert) on the package's `--experimental-strip-types`
 * path, matching in-process-transport.check.ts. Uses an injected clock and
 * instant sleep so every scenario is deterministic — no real timers, no
 * Postgres.
 *
 * Run: node --experimental-strip-types src/worker-supervisor.check.ts
 */
import assert from "node:assert/strict";

import {
  isInfraConnectionError,
  startSupervisedWorker,
  type SupervisableApp,
} from "./worker-supervisor.ts";

type FakeApp = SupervisableApp & {
  id: number;
  closed: boolean;
  emitError: (message: string) => void;
};

function makeFakeAppFactory(behavior?: {
  failStartForAppIds?: ReadonlyArray<number>;
}): {
  apps: FakeApp[];
  createApp: () => FakeApp;
} {
  const apps: FakeApp[] = [];
  const createApp = (): FakeApp => {
    let onError: ((error: Error) => void) | null = null;
    const id = apps.length + 1;
    const app: FakeApp = {
      id,
      closed: false,
      emitError: (message: string) => onError?.(new Error(message)),
      startWorker: async (options) => {
        if (behavior?.failStartForAppIds?.includes(id)) {
          throw new Error("Connection terminated unexpectedly");
        }
        onError = options?.onError ?? null;
        return { close: async () => undefined };
      },
      close: async () => {
        app.closed = true;
      },
    };
    apps.push(app);
    return app;
  };
  return { apps, createApp };
}

/** Deterministic harness: manual clock, instant sleep, captured logs. */
function makeHarness(factory: ReturnType<typeof makeFakeAppFactory>, opts?: {
  registered?: number[];
  prepareQueueCalls?: number[];
}) {
  let clock = 0;
  const logs: string[] = [];
  const handle = startSupervisedWorker({
    label: "check",
    createApp: factory.createApp,
    registerTasks: (app) => {
      opts?.registered?.push(app.id);
    },
    ...(opts?.prepareQueueCalls
      ? {
          prepareQueue: async (app: FakeApp) => {
            opts.prepareQueueCalls!.push(app.id);
          },
        }
      : {}),
    concurrency: 2,
    maxConsecutiveInfraErrors: 3,
    streakGapMs: 10_000,
    backoffBaseMs: 1,
    backoffCapMs: 4,
    now: () => clock,
    sleep: async () => undefined,
    log: (message) => {
      logs.push(message);
    },
  });
  return {
    handle,
    logs,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

const checks: Array<[string, () => Promise<void>]> = [
  [
    "infra-error classification table",
    async () => {
      assert.equal(isInfraConnectionError(new Error("Connection terminated unexpectedly")), true);
      assert.equal(isInfraConnectionError(new Error("connect ECONNREFUSED 127.0.0.1:5432")), true);
      assert.equal(isInfraConnectionError(new Error("read ECONNRESET")), true);
      assert.equal(isInfraConnectionError(new Error("Connection ended by peer")), true);
      assert.equal(
        isInfraConnectionError(new Error("timeout exceeded when trying to connect")),
        true,
      );
      assert.equal(
        isInfraConnectionError(new Error("wrapped", { cause: new Error("Connection terminated") })),
        true,
      );
      assert.equal(isInfraConnectionError(new Error("injected first-attempt failure")), false);
      assert.equal(isInfraConnectionError(new Error("task handler threw")), false);
      assert.equal(isInfraConnectionError(null), false);
    },
  ],
  [
    "task-execution errors never trigger recreation",
    async () => {
      const factory = makeFakeAppFactory();
      const h = makeHarness(factory);
      await settle();
      for (let i = 0; i < 10; i++) {
        factory.apps[0]!.emitError("task handler threw for child-3");
        h.tick(250);
      }
      await settle();
      assert.equal(h.handle.generation(), 1);
      assert.equal(factory.apps.length, 1);
      await h.handle.close();
    },
  ],
  [
    "dead-pool streak recreates the app on a fresh generation",
    async () => {
      const factory = makeFakeAppFactory();
      const registered: number[] = [];
      const h = makeHarness(factory, { registered });
      await settle();
      assert.equal(h.handle.app.id, 1);
      for (let i = 0; i < 3; i++) {
        factory.apps[0]!.emitError("Connection terminated unexpectedly");
        h.tick(250);
      }
      await settle();
      await settle();
      assert.equal(h.handle.generation(), 2, "generation should advance");
      assert.equal(h.handle.app.id, 2, "handle.app getter must return the live generation");
      assert.equal(factory.apps[0]!.closed, true, "dead generation must be closed");
      assert.deepEqual(registered, [1, 2], "tasks must be re-registered on the new generation");
      assert.ok(
        h.logs.some((line) => line.includes("recovered: generation 2")),
        `expected recovery log, got: ${h.logs.join(" | ")}`,
      );
      await h.handle.close();
    },
  ],
  [
    "a quiet gap resets the streak (no recreation)",
    async () => {
      const factory = makeFakeAppFactory();
      const h = makeHarness(factory);
      await settle();
      factory.apps[0]!.emitError("Connection terminated unexpectedly");
      h.tick(250);
      factory.apps[0]!.emitError("Connection terminated unexpectedly");
      h.tick(60_000); // recovered silence — next error is a NEW streak
      factory.apps[0]!.emitError("Connection terminated unexpectedly");
      h.tick(250);
      factory.apps[0]!.emitError("Connection terminated unexpectedly");
      await settle();
      assert.equal(h.handle.generation(), 1, "streak crossing a quiet gap must not recreate");
      await h.handle.close();
    },
  ],
  [
    "failed restart retries with backoff until a generation starts",
    async () => {
      const factory = makeFakeAppFactory({ failStartForAppIds: [2] });
      const h = makeHarness(factory);
      await settle();
      for (let i = 0; i < 3; i++) {
        factory.apps[0]!.emitError("Connection terminated unexpectedly");
        h.tick(250);
      }
      await settle();
      await settle();
      await settle();
      assert.equal(h.handle.generation(), 3, "app 2 fails to start; app 3 must succeed");
      assert.equal(h.handle.app.id, 3);
      await h.handle.close();
    },
  ],
  [
    "close() stops supervision and closes the live generation",
    async () => {
      const factory = makeFakeAppFactory();
      const h = makeHarness(factory);
      await settle();
      await h.handle.close();
      assert.equal(factory.apps[0]!.closed, true);
      for (let i = 0; i < 5; i++) {
        factory.apps[0]!.emitError("Connection terminated unexpectedly");
        h.tick(250);
      }
      await settle();
      assert.equal(factory.apps.length, 1, "closed supervisor must never recreate");
    },
  ],
  [
    "prepareQueue runs once per generation",
    async () => {
      const factory = makeFakeAppFactory();
      const prepareQueueCalls: number[] = [];
      const h = makeHarness(factory, { prepareQueueCalls });
      await settle();
      for (let i = 0; i < 3; i++) {
        factory.apps[0]!.emitError("Connection terminated unexpectedly");
        h.tick(250);
      }
      await settle();
      await settle();
      assert.deepEqual(prepareQueueCalls, [1, 2]);
      await h.handle.close();
    },
  ],
];

let failed = 0;
for (const [name, run] of checks) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(err);
  }
}
if (failed > 0) {
  console.error(`\n${failed}/${checks.length} checks failed`);
  process.exit(1);
}
console.log(`\nall ${checks.length} checks passed`);

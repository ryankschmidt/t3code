// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  ApprovalRequestId,
  PiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, vi } from "@effect/vitest";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { type ProviderAdapterError } from "../Errors.ts";
import { type ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { makePiAdapter } from "./PiAdapter.ts";
import { type PiMeridianRouteGuardOptions } from "./PiMeridianRoute.ts";
import {
  discoverPiModels,
  makePiSessionRuntime,
  parsePiModelSlug,
  PiSessionRuntimeError,
  type PiRuntimeEvent,
  type PiSessionRuntimeOptions,
  type PiSessionRuntimeShape,
  type PiSessionRuntimeSendTurnInput,
} from "./PiSessionRuntime.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);

// Test-local service tag so suites can `yield* PiAdapter`.
class PiAdapter extends Context.Service<PiAdapter, ProviderAdapterShape<ProviderAdapterError>>()(
  "t3/provider/Layers/PiAdapter.test/PiAdapter",
) {}

const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);

class FakePiRuntime implements PiSessionRuntimeShape {
  private readonly eventQueue = Effect.runSync(Queue.unbounded<PiRuntimeEvent>());
  private readonly now = "2026-01-01T00:00:00.000Z";

  public readonly startImpl = vi.fn(() => {
    // The resume cursor mirrors the requested model when one was set (like
    // real pi reporting its post-set_model state); legacy anthropic default
    // otherwise so no-selection sessions keep their historical shape.
    const parsedModel = parsePiModelSlug(this.options.model);
    return Promise.resolve({
      provider: ProviderDriverKind.make("pi"),
      status: "ready" as const,
      runtimeMode: this.options.runtimeMode,
      threadId: this.options.threadId,
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      ...(this.options.model ? { model: this.options.model } : {}),
      resumeCursor: {
        sessionFile: "/tmp/pi-session.jsonl",
        sessionId: "pi-sess-1",
        modelProvider: parsedModel?.provider ?? "anthropic",
        modelId: parsedModel?.modelId ?? "claude-test",
        thinkingLevel: "medium",
      },
      createdAt: this.now,
      updatedAt: this.now,
    } satisfies ProviderSession);
  });

  public readonly sendTurnImpl = vi.fn(
    (_input: PiSessionRuntimeSendTurnInput): Promise<ProviderTurnStartResult> =>
      Promise.resolve({
        threadId: this.options.threadId,
        turnId: asTurnId("turn-1"),
      }),
  );

  public readonly interruptTurnImpl = vi.fn((_turnId?: TurnId): Promise<void> =>
    Promise.resolve(undefined),
  );

  public readonly closeImpl = vi.fn(() => Promise.resolve(undefined));

  readonly options: PiSessionRuntimeOptions;
  readonly failStart: boolean;

  constructor(options: PiSessionRuntimeOptions, failStart = false) {
    this.options = options;
    this.failStart = failStart;
  }

  start() {
    if (this.failStart) {
      return Effect.fail(
        new PiSessionRuntimeError({
          operation: "session/start",
          threadId: this.options.threadId,
          detail: "fake start failure",
        }),
      );
    }
    return Effect.promise(() => this.startImpl());
  }

  getSession = Effect.promise(() => this.startImpl());

  sendTurn(input: PiSessionRuntimeSendTurnInput) {
    return Effect.promise(() => this.sendTurnImpl(input));
  }

  interruptTurn(turnId?: TurnId) {
    return Effect.promise(() => this.interruptTurnImpl(turnId));
  }

  readThread = Effect.sync(() => ({ threadId: this.options.threadId, turns: [] }));

  listAvailableModels() {
    return Effect.succeed({ defaultModel: null, models: [] });
  }

  get events() {
    return Stream.fromQueue(this.eventQueue);
  }

  close = Effect.promise(() => this.closeImpl());

  emit(event: PiRuntimeEvent) {
    return Queue.offer(this.eventQueue, event).pipe(Effect.asVoid);
  }
}

function makeRuntimeFactory(options?: {
  readonly failConstruction?: boolean;
  readonly failStart?: boolean;
}) {
  const runtimes: Array<FakePiRuntime> = [];
  const releasedThreadIds: Array<ThreadId> = [];

  const factory = vi.fn((runtimeOptions: PiSessionRuntimeOptions) =>
    Effect.gen(function* () {
      yield* Scope.Scope;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          releasedThreadIds.push(runtimeOptions.threadId);
        }),
      );

      if (options?.failConstruction) {
        return yield* new PiSessionRuntimeError({
          operation: "session/spawn",
          threadId: runtimeOptions.threadId,
          detail: "fake spawn failure",
        });
      }

      const runtime = new FakePiRuntime(runtimeOptions, options?.failStart === true);
      runtimes.push(runtime);
      return runtime;
    }),
  );

  return {
    factory,
    releasedThreadIds,
    get lastRuntime(): FakePiRuntime | undefined {
      return runtimes.at(-1);
    },
  };
}

// Meridian route fixtures: adapter suites default to a GREEN route (valid
// loopback override + reachable probe) so Anthropic-model tests exercise the
// legacy flows; the guard suites below inject red/down routes explicitly.
const meridianFixtureDir = NodeFS.mkdtempSync(
  NodePath.join(NodeOS.tmpdir(), "t3code-pi-meridian-"),
);
const greenMeridianConfigPath = NodePath.join(meridianFixtureDir, "models.json");
NodeFS.writeFileSync(
  greenMeridianConfigPath,
  JSON.stringify({
    providers: {
      anthropic: {
        baseUrl: "http://127.0.0.1:3456",
        apiKey: "x",
        headers: { "x-meridian-agent": "pi" },
      },
    },
  }),
);
const greenMeridianRoute: PiMeridianRouteGuardOptions = {
  configPath: greenMeridianConfigPath,
  probe: () => Effect.succeed(true),
};

const makeAdapterLayer = (
  factory: ReturnType<typeof makeRuntimeFactory>,
  meridianRoute: PiMeridianRouteGuardOptions = greenMeridianRoute,
) =>
  Layer.effect(
    PiAdapter,
    Effect.gen(function* () {
      const piSettings = decodePiSettings({});
      return yield* makePiAdapter(piSettings, {
        makeRuntime: factory.factory,
        meridianRoute,
      });
    }),
  ).pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(NodeServices.layer),
  );

/** Give the adapter's forked event pump time to process queued events. */
const settlePump = Effect.gen(function* () {
  for (let i = 0; i < 64; i++) {
    yield* Effect.yieldNow;
  }
});

const startedSessionEvents = 3; // session.started + session.configured + thread.started

const drainStartupEvents = (
  adapter: ProviderAdapterShape<ProviderAdapterError>,
  threadId: ThreadId,
) =>
  Effect.gen(function* () {
    const startupFiber = yield* Stream.take(adapter.streamEvents, startedSessionEvents).pipe(
      Stream.runCollect,
      Effect.forkChild,
    );
    const session = yield* adapter.startSession({
      provider: ProviderDriverKind.make("pi"),
      threadId,
      runtimeMode: "full-access",
    });
    const startupEvents = yield* Fiber.join(startupFiber);
    return { session, startupEvents };
  });

const validationFactory = makeRuntimeFactory();
const validationLayer = it.layer(makeAdapterLayer(validationFactory));

validationLayer("PiAdapter validation", (it) => {
  it.effect("returns validation error for non-pi provider on startSession", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const result = yield* adapter
        .startSession({
          provider: ProviderDriverKind.make("codex"),
          threadId: asThreadId("pi-thread-validate"),
          runtimeMode: "full-access",
        })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(result.failure._tag, "ProviderAdapterValidationError");
      NodeAssert.equal(validationFactory.factory.mock.calls.length, 0);
    }),
  );

  it.effect("maps missing adapter sessions to ProviderAdapterSessionNotFoundError", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const result = yield* adapter
        .sendTurn({ threadId: asThreadId("pi-missing"), input: "hello" })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(result.failure._tag, "ProviderAdapterSessionNotFoundError");
      NodeAssert.equal(result.failure.provider, "pi");
    }),
  );

  it.effect("fails rollback and approval surfaces as unsupported", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-unsupported");

      const rollback = yield* adapter.rollbackThread(threadId, 1).pipe(Effect.result);
      NodeAssert.equal(rollback._tag, "Failure");
      NodeAssert.equal(rollback.failure._tag, "ProviderAdapterValidationError");

      const approval = yield* adapter
        .respondToRequest(threadId, ApprovalRequestId.make("req-1"), "accept")
        .pipe(Effect.result);
      NodeAssert.equal(approval._tag, "Failure");
      NodeAssert.equal(approval.failure._tag, "ProviderAdapterValidationError");

      const userInput = yield* adapter
        .respondToUserInput(threadId, ApprovalRequestId.make("req-2"), { answers: [] })
        .pipe(Effect.result);
      NodeAssert.equal(userInput._tag, "Failure");
      NodeAssert.equal(userInput.failure._tag, "ProviderAdapterValidationError");
    }),
  );

  it.effect("maps pi model selection (model + thinkingLevel) into runtime options", () =>
    Effect.gen(function* () {
      validationFactory.factory.mockClear();
      const adapter = yield* PiAdapter;

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("pi"),
        threadId: asThreadId("pi-thread-options"),
        modelSelection: createModelSelection(ProviderInstanceId.make("pi"), "anthropic/claude-x", [
          { id: "thinkingLevel", value: "high" },
        ]),
        runtimeMode: "full-access",
      });

      const runtimeInput = validationFactory.factory.mock.calls[0]?.[0];
      NodeAssert.ok(runtimeInput);
      NodeAssert.equal(runtimeInput.threadId, "pi-thread-options");
      NodeAssert.equal(runtimeInput.model, "anthropic/claude-x");
      NodeAssert.equal(runtimeInput.thinkingLevel, "high");
      NodeAssert.equal(runtimeInput.runtimeMode, "full-access");
      NodeAssert.equal(runtimeInput.providerInstanceId, "pi");
    }),
  );
});

const spawnFailFactory = makeRuntimeFactory({ failConstruction: true });
const spawnFailLayer = it.layer(makeAdapterLayer(spawnFailFactory));

spawnFailLayer("PiAdapter spawn-fail cleanup", (it) => {
  it.effect("releases the session scope and registers nothing when construction fails", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-spawn-fail");
      const result = yield* adapter
        .startSession({
          provider: ProviderDriverKind.make("pi"),
          threadId,
          runtimeMode: "full-access",
        })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(result.failure._tag, "ProviderAdapterProcessError");
      NodeAssert.ok(spawnFailFactory.releasedThreadIds.includes(threadId));
      NodeAssert.equal(yield* adapter.hasSession(threadId), false);
      NodeAssert.deepStrictEqual(yield* adapter.listSessions(), []);
    }),
  );
});

const startFailFactory = makeRuntimeFactory({ failStart: true });
const startFailLayer = it.layer(makeAdapterLayer(startFailFactory));

startFailLayer("PiAdapter start-fail cleanup", (it) => {
  it.effect("closes the runtime and releases the scope when start fails", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-start-fail");
      const result = yield* adapter
        .startSession({
          provider: ProviderDriverKind.make("pi"),
          threadId,
          runtimeMode: "full-access",
        })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(result.failure._tag, "ProviderAdapterProcessError");
      NodeAssert.equal(startFailFactory.lastRuntime?.closeImpl.mock.calls.length, 1);
      NodeAssert.ok(startFailFactory.releasedThreadIds.includes(threadId));
      NodeAssert.equal(yield* adapter.hasSession(threadId), false);
    }),
  );
});

const mappingFactory = makeRuntimeFactory();
const mappingLayer = it.layer(makeAdapterLayer(mappingFactory));

mappingLayer("PiAdapter event mapping", (it) => {
  it.effect("emits session lifecycle events after a successful start", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const { startupEvents } = yield* drainStartupEvents(adapter, asThreadId("pi-lifecycle"));

      NodeAssert.deepStrictEqual(
        startupEvents.map((event) => event.type),
        ["session.started", "session.configured", "thread.started"],
      );
      const configured = startupEvents[1];
      NodeAssert.ok(configured && configured.type === "session.configured");
      NodeAssert.deepStrictEqual(configured.payload.config, {
        runtimeMode: "full-access",
        model: "anthropic/claude-test",
        thinkingLevel: "medium",
      });
      const threadStarted = startupEvents[2];
      NodeAssert.ok(threadStarted && threadStarted.type === "thread.started");
      NodeAssert.deepStrictEqual(threadStarted.payload, { providerThreadId: "pi-sess-1" });
    }),
  );

  it.effect("maps text deltas and enforces the empty-assistant guard", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-guard");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = mappingFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const turnId = asTurnId("turn-guard");

      const collected = yield* Stream.take(adapter.streamEvents, 4).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      // 1) turn start
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        model: "anthropic/claude-test",
        payload: { type: "turn_start" },
      });
      // 2) streaming text delta
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: {
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "Hello" },
        },
      });
      // 3) EMPTY assistant message (thinking-only) — must map to NOTHING (#402 guard)
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: {
          type: "message_end",
          message: { role: "assistant", content: [{ type: "thinking", thinking: "..." }] },
        },
      });
      // 4) visible assistant message — maps to item.completed
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: {
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
        },
      });
      // 5) agent end — turn.completed
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: { type: "agent_end" },
      });

      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["turn.started", "content.delta", "item.completed", "turn.completed"],
      );
      const [turnStarted, delta, completedItem, turnCompleted] = events as ProviderRuntimeEvent[];
      NodeAssert.ok(turnStarted && turnStarted.type === "turn.started");
      NodeAssert.deepStrictEqual(turnStarted.payload, {
        model: "anthropic/claude-test",
        routeFamily: "anthropic-meridian-claude-code-sdk",
      });
      NodeAssert.ok(delta && delta.type === "content.delta");
      NodeAssert.deepStrictEqual(delta.payload, { streamKind: "assistant_text", delta: "Hello" });
      NodeAssert.ok(completedItem && completedItem.type === "item.completed");
      NodeAssert.equal(completedItem.payload.itemType, "assistant_message");
      NodeAssert.equal(completedItem.payload.detail, "Hello world");
      NodeAssert.ok(turnCompleted && turnCompleted.type === "turn.completed");
      NodeAssert.deepStrictEqual(turnCompleted.payload, { state: "completed", stopReason: null });
    }),
  );

  it.effect("completes the assistant message at turn_end exactly once (late answer)", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-turn-end");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = mappingFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const turnId = asTurnId("turn-late");

      const collected = yield* Stream.take(adapter.streamEvents, 2).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: {
          type: "turn_end",
          message: { role: "assistant", content: [{ type: "text", text: "Late answer" }] },
        },
      });
      // A second turn_end with the same content must NOT emit again.
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: {
          type: "turn_end",
          message: { role: "assistant", content: [{ type: "text", text: "Late answer" }] },
        },
      });
      // Sentinel event proves the duplicate produced nothing in between.
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: { type: "tool_execution_start", toolCallId: "call-1", toolName: "read_file" },
      });

      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["item.completed", "item.started"],
      );
      const [lateAnswer] = events as ProviderRuntimeEvent[];
      NodeAssert.ok(lateAnswer && lateAnswer.type === "item.completed");
      NodeAssert.equal(lateAnswer.payload.detail, "Late answer");
    }),
  );

  it.effect("maps tool execution lifecycle with failure status", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-tools");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = mappingFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const turnId = asTurnId("turn-tools");

      const collected = yield* Stream.take(adapter.streamEvents, 3).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: {
          type: "tool_execution_start",
          toolCallId: "call-9",
          toolName: "run_command",
          args: { command: "ls" },
        },
      });
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: {
          type: "tool_execution_update",
          toolCallId: "call-9",
          toolName: "run_command",
          partialResult: "partial",
        },
      });
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: {
          type: "tool_execution_end",
          toolCallId: "call-9",
          toolName: "run_command",
          result: "boom",
          isError: true,
        },
      });

      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["item.started", "item.updated", "item.completed"],
      );
      for (const event of events) {
        NodeAssert.ok(
          event.type === "item.started" ||
            event.type === "item.updated" ||
            event.type === "item.completed",
        );
        NodeAssert.equal(event.payload.itemType, "dynamic_tool_call");
        NodeAssert.equal(event.payload.title, "run_command");
        NodeAssert.equal(event.itemId, "pi-tool:call-9");
      }
      const completed = events[2];
      NodeAssert.ok(completed && completed.type === "item.completed");
      NodeAssert.equal(completed.payload.status, "failed");
    }),
  );

  it.effect("marks aborted turns as interrupted on agent_end", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-abort");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = mappingFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const turnId = asTurnId("turn-abort");

      yield* adapter.interruptTurn(threadId);
      NodeAssert.equal(runtime.interruptTurnImpl.mock.calls.length, 1);

      const collected = yield* Stream.take(adapter.streamEvents, 1).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: { type: "agent_end" },
      });

      const events = yield* Fiber.join(collected);
      const completed = events[0];
      NodeAssert.ok(completed && completed.type === "turn.completed");
      NodeAssert.deepStrictEqual(completed.payload, {
        state: "interrupted",
        stopReason: "abort",
      });
    }),
  );

  it.effect("maps expected exit to session.exited and releases the session", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-exit");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = mappingFactory.lastRuntime;
      NodeAssert.ok(runtime);

      const collected = yield* Stream.take(adapter.streamEvents, 1).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* runtime.emit({
        kind: "exit",
        threadId,
        code: 0,
        expected: true,
      });

      const events = yield* Fiber.join(collected);
      const exited = events[0];
      NodeAssert.ok(exited && exited.type === "session.exited");
      NodeAssert.deepStrictEqual(exited.payload, {
        reason: "Pi session stopped",
        recoverable: true,
        exitKind: "graceful",
      });

      yield* settlePump;
      NodeAssert.equal(yield* adapter.hasSession(threadId), false);
    }),
  );

  it.effect("maps stderr lines to bounded runtime warnings", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-stderr");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = mappingFactory.lastRuntime;
      NodeAssert.ok(runtime);

      const collected = yield* Stream.take(adapter.streamEvents, 1).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* runtime.emit({
        kind: "stderr",
        threadId,
        line: `warn: ${"x".repeat(5_000)}`,
      });

      const events = yield* Fiber.join(collected);
      const warning = events[0];
      NodeAssert.ok(warning && warning.type === "runtime.warning");
      NodeAssert.ok(warning.payload.message.length <= 2_000);
    }),
  );

  it.effect("fails a zero-output turn loudly instead of completing silently", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-empty-turn");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = mappingFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const turnId = asTurnId("turn-empty");

      const collected = yield* Stream.take(adapter.streamEvents, 3).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      // Scripted fake-pi turn that ends with NO message_end carrying visible
      // text: the turn reaches agent_end having produced zero assistant
      // output (the #402 empty-assistant guard suppressed everything).
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: { type: "turn_start" },
      });
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: {
          type: "message_end",
          message: { role: "assistant", content: [{ type: "thinking", thinking: "..." }] },
        },
      });
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: { type: "agent_end" },
      });

      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["turn.started", "runtime.error", "turn.completed"],
      );
      const [, runtimeError, turnCompleted] = events as ProviderRuntimeEvent[];
      NodeAssert.ok(runtimeError && runtimeError.type === "runtime.error");
      NodeAssert.equal(runtimeError.payload.class, "provider_error");
      NodeAssert.ok(runtimeError.payload.message.includes("no output"));
      NodeAssert.ok(runtimeError.payload.message.includes(threadId));
      NodeAssert.ok(turnCompleted && turnCompleted.type === "turn.completed");
      NodeAssert.deepStrictEqual(turnCompleted.payload, {
        state: "failed",
        stopReason: null,
        errorMessage: `Pi turn ended with no output (session ${threadId}).`,
      });
    }),
  );

  it.effect("recovers after a failed zero-output turn: the next prompt dispatches cleanly", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-no-wedge");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = mappingFactory.lastRuntime;
      NodeAssert.ok(runtime);

      // Turn 1: zero output → runtime.error + failed completion.
      const firstTurn = yield* Stream.take(adapter.streamEvents, 3).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId: asTurnId("turn-wedge-1"),
        payload: { type: "turn_start" },
      });
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId: asTurnId("turn-wedge-1"),
        payload: { type: "agent_end" },
      });
      const firstEvents = yield* Fiber.join(firstTurn);
      const failedCompletion = firstEvents[2];
      NodeAssert.ok(failedCompletion && failedCompletion.type === "turn.completed");
      NodeAssert.equal(failedCompletion.payload.state, "failed");

      // The failed turn must not wedge the session: the very next prompt
      // dispatches cleanly through the same adapter session.
      const sendCallsBefore = runtime.sendTurnImpl.mock.calls.length;
      const result = yield* adapter.sendTurn({ threadId, input: "follow-up after failure" });
      NodeAssert.equal(runtime.sendTurnImpl.mock.calls.length, sendCallsBefore + 1);
      NodeAssert.equal(result.threadId, threadId);

      // Turn 2 runs normally and stays completed — a failed turn leaves no
      // per-turn residue behind.
      const secondTurn = yield* Stream.take(adapter.streamEvents, 3).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      const secondTurnId = asTurnId("turn-wedge-2");
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId: secondTurnId,
        payload: { type: "turn_start" },
      });
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId: secondTurnId,
        payload: {
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "Recovered" }] },
        },
      });
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId: secondTurnId,
        payload: { type: "agent_end" },
      });
      const secondEvents = yield* Fiber.join(secondTurn);
      NodeAssert.deepStrictEqual(
        secondEvents.map((event) => event.type),
        ["turn.started", "item.completed", "turn.completed"],
      );
      const completed = secondEvents[2];
      NodeAssert.ok(completed && completed.type === "turn.completed");
      NodeAssert.deepStrictEqual(completed.payload, { state: "completed", stopReason: null });
    }),
  );

  it.effect("emits a loud runtime.error when a model selection targets another instance", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-selection-mismatch");
      const factoryCallsBefore = mappingFactory.factory.mock.calls.length;

      const collected = yield* Stream.take(adapter.streamEvents, 4).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("pi"),
        threadId,
        modelSelection: createModelSelection(
          ProviderInstanceId.make("codex"),
          "anthropic/claude-x",
          [],
        ),
        runtimeMode: "full-access",
      });
      const events = yield* Fiber.join(collected);

      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["runtime.error", "session.started", "session.configured", "thread.started"],
      );
      const dropped = events[0];
      NodeAssert.ok(dropped && dropped.type === "runtime.error");
      NodeAssert.equal(dropped.payload.class, "provider_error");
      NodeAssert.ok(dropped.payload.message.includes("anthropic/claude-x"));
      NodeAssert.ok(dropped.payload.message.includes("codex"));

      // The mismatched selection must NOT reach the runtime as a model.
      const runtimeInput = mappingFactory.factory.mock.calls[factoryCallsBefore]?.[0];
      NodeAssert.ok(runtimeInput);
      NodeAssert.equal(runtimeInput.model, undefined);

      // Same guard on sendTurn: loud error, prompt still dispatches on Pi's
      // current model (no silent model divergence, no blocked send).
      const runtime = mappingFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const sendCollected = yield* Stream.take(adapter.streamEvents, 1).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.sendTurn({
        threadId,
        input: "hello",
        modelSelection: createModelSelection(
          ProviderInstanceId.make("codex"),
          "anthropic/claude-x",
          [],
        ),
      });
      const sendEvents = yield* Fiber.join(sendCollected);
      const sendError = sendEvents[0];
      NodeAssert.ok(sendError && sendError.type === "runtime.error");
      NodeAssert.equal(sendError.payload.class, "provider_error");
      const lastSendInput = runtime.sendTurnImpl.mock.calls.at(-1)?.[0];
      NodeAssert.ok(lastSendInput);
      NodeAssert.equal(lastSendInput.model, undefined);
    }),
  );
});

// ---------------------------------------------------------------------------
// Meridian seam guard (PLAN-T3-Meridian-Seam-Patch Tasks 1/3/5)
// ---------------------------------------------------------------------------

const missingConfigProbe = vi.fn((_healthUrl: string) => Effect.succeed(true));
const missingConfigFactory = makeRuntimeFactory();
const missingConfigLayer = it.layer(
  makeAdapterLayer(missingConfigFactory, {
    configPath: NodePath.join(meridianFixtureDir, "absent-models.json"),
    probe: missingConfigProbe,
  }),
);

missingConfigLayer("PiAdapter Meridian guard — route not configured", (it) => {
  it.effect("fails an Anthropic session start closed: seam-naming error, no runtime, no set_model", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-meridian-missing-start");
      const factoryCallsBefore = missingConfigFactory.factory.mock.calls.length;

      const collected = yield* Stream.take(adapter.streamEvents, 1).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      const result = yield* adapter
        .startSession({
          provider: ProviderDriverKind.make("pi"),
          threadId,
          modelSelection: createModelSelection(
            ProviderInstanceId.make("pi"),
            "anthropic/claude-opus-4-8",
            [],
          ),
          runtimeMode: "full-access",
        })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(result.failure._tag, "ProviderAdapterRequestError");
      NodeAssert.ok(result.failure.detail.includes("Meridian Claude Code SDK seam"));
      NodeAssert.ok(result.failure.detail.includes("not configured"));
      NodeAssert.ok(result.failure.detail.includes("Pi native Anthropic OAuth is disabled"));

      // Fail-closed means fail BEFORE the runtime exists: no runtime was
      // constructed, so no set_model (and no prompt) could ever be sent.
      NodeAssert.equal(missingConfigFactory.factory.mock.calls.length, factoryCallsBefore);
      NodeAssert.equal(yield* adapter.hasSession(threadId), false);

      // The seam failure is a VISIBLE runtime.error activity, not silence.
      const events = yield* Fiber.join(collected);
      const seamError = events[0];
      NodeAssert.ok(seamError && seamError.type === "runtime.error");
      NodeAssert.equal(seamError.payload.class, "provider_error");
      NodeAssert.ok(seamError.payload.message.includes("Meridian Claude Code SDK seam"));

      // Config was missing — the guard never even probed reachability.
      NodeAssert.equal(missingConfigProbe.mock.calls.length, 0);
    }),
  );

  it.effect("fails an Anthropic turn on a live session closed: no prompt reaches Pi", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-meridian-missing-turn");
      // No model selection at start: no Anthropic route is claimed yet, so
      // the session comes up (pi's own default model applies).
      yield* drainStartupEvents(adapter, threadId);
      const runtime = missingConfigFactory.lastRuntime;
      NodeAssert.ok(runtime);

      const collected = yield* Stream.take(adapter.streamEvents, 1).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      // The fake session's current model is anthropic/claude-test (resume
      // cursor), so a plain follow-up IS an Anthropic-family turn.
      const result = yield* adapter.sendTurn({ threadId, input: "hello" }).pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(result.failure._tag, "ProviderAdapterRequestError");
      NodeAssert.ok(result.failure.detail.includes("Meridian Claude Code SDK seam"));
      // The prompt never reached the Pi RPC child.
      NodeAssert.equal(runtime.sendTurnImpl.mock.calls.length, 0);

      const events = yield* Fiber.join(collected);
      const seamError = events[0];
      NodeAssert.ok(seamError && seamError.type === "runtime.error");
      NodeAssert.ok(seamError.payload.message.includes("anthropic/claude-test"));
    }),
  );

  it.effect("openai-codex turns are completely unaffected by a red Meridian route (regression)", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-meridian-codex-unaffected");
      const probeCallsBefore = missingConfigProbe.mock.calls.length;

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("pi"),
        threadId,
        modelSelection: createModelSelection(
          ProviderInstanceId.make("pi"),
          "openai-codex/gpt-5.2-codex",
          [],
        ),
        runtimeMode: "full-access",
      });
      const runtime = missingConfigFactory.lastRuntime;
      NodeAssert.ok(runtime);
      NodeAssert.equal(runtime.options.model, "openai-codex/gpt-5.2-codex");

      // Plain follow-up on the codex session AND an explicit codex selection
      // both dispatch normally with the Anthropic route dead.
      const first = yield* adapter.sendTurn({ threadId, input: "codex turn" });
      NodeAssert.equal(first.threadId, threadId);
      yield* adapter.sendTurn({
        threadId,
        input: "codex turn 2",
        modelSelection: createModelSelection(
          ProviderInstanceId.make("pi"),
          "openai-codex/gpt-5.2-codex",
          [],
        ),
      });
      NodeAssert.equal(runtime.sendTurnImpl.mock.calls.length, 2);

      // The codex path triggered ZERO Meridian activity: no reachability
      // probe ran for the start or either turn.
      NodeAssert.equal(missingConfigProbe.mock.calls.length, probeCallsBefore);
    }),
  );
});

const meridianDownProbe = vi.fn((_healthUrl: string) => Effect.succeed(false));
const meridianDownFactory = makeRuntimeFactory();
const meridianDownLayer = it.layer(
  makeAdapterLayer(meridianDownFactory, {
    configPath: greenMeridianConfigPath,
    probe: meridianDownProbe,
    probeCacheTtlMs: 0,
  }),
);

meridianDownLayer("PiAdapter Meridian guard — Meridian down", (it) => {
  it.effect("names Meridian down at the configured loopback target and sends nothing", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-meridian-down");
      const factoryCallsBefore = meridianDownFactory.factory.mock.calls.length;

      const collected = yield* Stream.take(adapter.streamEvents, 1).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      const result = yield* adapter
        .startSession({
          provider: ProviderDriverKind.make("pi"),
          threadId,
          modelSelection: createModelSelection(
            ProviderInstanceId.make("pi"),
            "anthropic/claude-haiku-4-5",
            [],
          ),
          runtimeMode: "full-access",
        })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(result.failure._tag, "ProviderAdapterRequestError");
      NodeAssert.ok(
        result.failure.detail.includes("Meridian is down or unreachable at 127.0.0.1:3456"),
      );
      NodeAssert.ok(result.failure.detail.includes("Meridian Claude Code SDK seam"));
      NodeAssert.ok(result.failure.detail.includes("no Pi native Anthropic OAuth fallback"));
      NodeAssert.equal(meridianDownFactory.factory.mock.calls.length, factoryCallsBefore);
      NodeAssert.ok(meridianDownProbe.mock.calls.length > 0);

      const events = yield* Fiber.join(collected);
      const seamError = events[0];
      NodeAssert.ok(seamError && seamError.type === "runtime.error");
      NodeAssert.equal(seamError.payload.class, "transport_error");
      NodeAssert.ok(
        seamError.payload.message.includes("Meridian is down or unreachable at 127.0.0.1:3456"),
      );
    }),
  );
});

const routeDiagnosticFactory = makeRuntimeFactory();
const routeDiagnosticLayer = it.layer(makeAdapterLayer(routeDiagnosticFactory));

routeDiagnosticLayer("PiAdapter route-family diagnostics", (it) => {
  it.effect("every turn start names its route family per model family", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-route-diagnostic");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = routeDiagnosticFactory.lastRuntime;
      NodeAssert.ok(runtime);

      const collected = yield* Stream.take(adapter.streamEvents, 2).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId: asTurnId("turn-codex"),
        model: "openai-codex/gpt-5.2-codex",
        payload: { type: "turn_start" },
      });
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId: asTurnId("turn-claude"),
        model: "anthropic/claude-opus-4-8",
        payload: { type: "turn_start" },
      });

      const events = yield* Fiber.join(collected);
      const [codexStarted, claudeStarted] = events as ProviderRuntimeEvent[];
      NodeAssert.ok(codexStarted && codexStarted.type === "turn.started");
      NodeAssert.deepStrictEqual(codexStarted.payload, {
        model: "openai-codex/gpt-5.2-codex",
        routeFamily: "openai-native-pi",
      });
      NodeAssert.ok(claudeStarted && claudeStarted.type === "turn.started");
      NodeAssert.deepStrictEqual(claudeStarted.payload, {
        model: "anthropic/claude-opus-4-8",
        routeFamily: "anthropic-meridian-claude-code-sdk",
      });
    }),
  );
});

// ---------------------------------------------------------------------------
// Provider-error text mapping (auditable failure paths)
// ---------------------------------------------------------------------------

const UPSTREAM_ERROR_TEXT =
  "Claude Code returned an error result: API Error: 400 You're out of extra usage.";

const providerErrorFactory = makeRuntimeFactory();
const providerErrorLayer = it.layer(makeAdapterLayer(providerErrorFactory));

providerErrorLayer("PiAdapter provider-error text mapping", (it) => {
  it.effect("surfaces the real upstream text from a streamed provider-error frame", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-provider-error-streamed");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = providerErrorFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const turnId = asTurnId("turn-provider-error");
      const errorMessage = {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: UPSTREAM_ERROR_TEXT,
      };

      const collected = yield* Stream.take(adapter.streamEvents, 3).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: { type: "turn_start" },
      });
      // pi's stream error frame: the REAL text lives at error.errorMessage.
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: {
          type: "message_update",
          assistantMessageEvent: { type: "error", reason: "error", error: errorMessage },
        },
      });
      // The loop then completes the same error-bearing message; the per-turn
      // dedupe must NOT emit a second error activity for it.
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: { type: "message_end", message: errorMessage },
      });
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: { type: "agent_end" },
      });

      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["turn.started", "runtime.error", "turn.completed"],
      );
      const [, runtimeError, turnCompleted] = events as ProviderRuntimeEvent[];
      NodeAssert.ok(runtimeError && runtimeError.type === "runtime.error");
      NodeAssert.equal(runtimeError.payload.class, "provider_error");
      NodeAssert.equal(runtimeError.payload.message, UPSTREAM_ERROR_TEXT);
      NodeAssert.ok(!runtimeError.payload.message.includes("no output"));
      NodeAssert.ok(turnCompleted && turnCompleted.type === "turn.completed");
      NodeAssert.deepStrictEqual(turnCompleted.payload, {
        state: "failed",
        stopReason: null,
        errorMessage: UPSTREAM_ERROR_TEXT,
      });
    }),
  );

  it.effect("surfaces the real upstream text from a non-streamed error-bearing message_end", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-provider-error-plain");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = providerErrorFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const turnId = asTurnId("turn-provider-error-plain");

      const collected = yield* Stream.take(adapter.streamEvents, 3).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: { type: "turn_start" },
      });
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: {
          type: "message_end",
          message: {
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage: UPSTREAM_ERROR_TEXT,
          },
        },
      });
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: { type: "agent_end" },
      });

      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["turn.started", "runtime.error", "turn.completed"],
      );
      const [, runtimeError, turnCompleted] = events as ProviderRuntimeEvent[];
      NodeAssert.ok(runtimeError && runtimeError.type === "runtime.error");
      NodeAssert.equal(runtimeError.payload.message, UPSTREAM_ERROR_TEXT);
      NodeAssert.ok(turnCompleted && turnCompleted.type === "turn.completed");
      NodeAssert.equal(turnCompleted.payload.state, "failed");
      NodeAssert.equal(turnCompleted.payload.errorMessage, UPSTREAM_ERROR_TEXT);
    }),
  );

  it.effect("maps an aborted stream frame to no error activity", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-provider-error-aborted");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = providerErrorFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const turnId = asTurnId("turn-aborted-frame");

      const collected = yield* Stream.take(adapter.streamEvents, 1).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: {
          type: "message_update",
          assistantMessageEvent: {
            type: "error",
            reason: "aborted",
            error: { role: "assistant", content: [], stopReason: "aborted" },
          },
        },
      });
      // Sentinel: the abort frame itself must map to NOTHING.
      yield* runtime.emit({
        kind: "rpc-event",
        threadId,
        turnId,
        payload: { type: "tool_execution_start", toolCallId: "sentinel-1", toolName: "read_file" },
      });

      const events = yield* Fiber.join(collected);
      const sentinel = events[0];
      NodeAssert.ok(sentinel && sentinel.type === "item.started");
    }),
  );
});

// ---------------------------------------------------------------------------
// Pi-shaped Meridian stream parity (hermetic mock SSE endpoint + pi's real
// captured request shape from pi-fixtures/pi-req-1.json)
// ---------------------------------------------------------------------------

interface PiRequestFixture {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: {
    readonly model: string;
    readonly stream: boolean;
    readonly system: ReadonlyArray<Record<string, unknown>>;
    readonly tools: ReadonlyArray<Record<string, unknown>>;
    readonly thinking: Record<string, unknown>;
    readonly messages: ReadonlyArray<Record<string, unknown>>;
    readonly max_tokens: number;
  };
}

const piRequestFixture = JSON.parse(
  NodeFS.readFileSync(new URL("./pi-fixtures/pi-req-1.json", import.meta.url), "utf8"),
) as PiRequestFixture;

interface MockMeridianReply {
  readonly textChunks: ReadonlyArray<string>;
  readonly toolCall?: { readonly name: string; readonly input: Record<string, unknown> };
}

interface MockMeridianCapture {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: PiRequestFixture["body"] & { readonly tools?: ReadonlyArray<Record<string, unknown>> };
}

/**
 * Minimal hermetic Meridian stand-in: accepts POST /v1/messages, captures the
 * request verbatim, and streams an Anthropic-shaped SSE reply. Loopback only.
 */
async function startMockMeridian(reply: MockMeridianReply): Promise<{
  readonly baseUrl: string;
  readonly captures: MockMeridianCapture[];
  readonly close: () => Promise<void>;
}> {
  const { createServer } = await import("node:http");
  const captures: MockMeridianCapture[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      captures.push({
        headers: request.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as MockMeridianCapture["body"],
      });
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      const sse = (event: string, data: Record<string, unknown>) =>
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      sse("message_start", {
        type: "message_start",
        message: { id: "msg_mock", type: "message", role: "assistant", content: [] },
      });
      let blockIndex = 0;
      if (reply.toolCall) {
        sse("content_block_start", {
          type: "content_block_start",
          index: blockIndex,
          content_block: { type: "tool_use", id: "toolu_mock_1", name: reply.toolCall.name },
        });
        sse("content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(reply.toolCall.input) },
        });
        sse("content_block_stop", { type: "content_block_stop", index: blockIndex });
        blockIndex += 1;
      }
      sse("content_block_start", {
        type: "content_block_start",
        index: blockIndex,
        content_block: { type: "text", text: "" },
      });
      for (const chunk of reply.textChunks) {
        sse("content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "text_delta", text: chunk },
        });
      }
      sse("content_block_stop", { type: "content_block_stop", index: blockIndex });
      sse("message_delta", {
        type: "message_delta",
        delta: { stop_reason: reply.toolCall ? "tool_use" : "end_turn" },
      });
      sse("message_stop", { type: "message_stop" });
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address !== "object") {
    throw new Error("mock Meridian failed to bind");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    captures,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

interface ParsedSseFrame {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

/** POSTs pi's captured request shape at the mock endpoint and parses the SSE reply. */
async function postPiRequestAndReadSse(
  baseUrl: string,
  body: Record<string, unknown>,
): Promise<ReadonlyArray<ParsedSseFrame>> {
  // @effect-diagnostics-next-line globalFetch:off - Hermetic in-test SSE client against the loopback mock Meridian; no HttpClient service exists in this plain async helper.
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": piRequestFixture.headers["anthropic-version"] ?? "2023-06-01",
      "anthropic-beta": piRequestFixture.headers["anthropic-beta"] ?? "",
      "x-meridian-agent": piRequestFixture.headers["x-meridian-agent"] ?? "pi",
      authorization: "Bearer x",
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  const frames: ParsedSseFrame[] = [];
  for (const block of raw.split("\n\n")) {
    const lines = block.split("\n").filter((line) => line.length > 0);
    const eventLine = lines.find((line) => line.startsWith("event: "));
    const dataLine = lines.find((line) => line.startsWith("data: "));
    if (!eventLine || !dataLine) {
      continue;
    }
    frames.push({
      event: eventLine.slice("event: ".length),
      data: JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>,
    });
  }
  return frames;
}

function sseTextDeltas(frames: ReadonlyArray<ParsedSseFrame>): ReadonlyArray<string> {
  return frames
    .filter((frame) => frame.event === "content_block_delta")
    .map((frame) => (frame.data.delta as Record<string, unknown> | undefined) ?? {})
    .filter((delta) => delta.type === "text_delta")
    .map((delta) => String(delta.text ?? ""));
}

function sseToolUse(
  frames: ReadonlyArray<ParsedSseFrame>,
): { name: string; input: Record<string, unknown> } | undefined {
  const start = frames.find(
    (frame) =>
      frame.event === "content_block_start" &&
      (frame.data.content_block as Record<string, unknown> | undefined)?.type === "tool_use",
  );
  if (!start) {
    return undefined;
  }
  const block = start.data.content_block as Record<string, unknown>;
  const inputDelta = frames.find(
    (frame) =>
      frame.event === "content_block_delta" &&
      (frame.data.delta as Record<string, unknown> | undefined)?.type === "input_json_delta",
  );
  const partialJson = (inputDelta?.data.delta as Record<string, unknown> | undefined)?.partial_json;
  return {
    name: String(block.name),
    input:
      typeof partialJson === "string"
        ? (JSON.parse(partialJson) as Record<string, unknown>)
        : {},
  };
}

/** Asserts the captured request IS pi's harness contract (Ryan's steering). */
function assertPiRequestShape(capture: MockMeridianCapture, options: { tools: boolean }): void {
  if (options.tools) {
    NodeAssert.deepStrictEqual(
      (capture.body.tools ?? []).map((tool) => tool.name),
      ["Read", "Bash", "Edit", "Write"],
    );
  } else {
    NodeAssert.equal(capture.body.tools, undefined);
  }
  NodeAssert.equal(capture.body.system.length, 2);
  for (const block of capture.body.system) {
    NodeAssert.deepStrictEqual(block.cache_control, { type: "ephemeral" });
  }
  NodeAssert.ok(String(capture.body.system[0]?.text).startsWith("You are Claude Code"));
  NodeAssert.equal(capture.body.stream, true);
  NodeAssert.equal((capture.body.thinking as Record<string, unknown>).type, "enabled");
  NodeAssert.equal((capture.body.thinking as Record<string, unknown>).budget_tokens, 16384);
  NodeAssert.equal(
    capture.headers["anthropic-beta"],
    "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14",
  );
  NodeAssert.equal(capture.headers["x-meridian-agent"], "pi");
}

const streamParityFactory = makeRuntimeFactory();
const streamParityLayer = it.layer(makeAdapterLayer(streamParityFactory));

streamParityLayer("PiAdapter Meridian stream parity (pi-shaped contract)", (it) => {
  /**
   * Runs one pi turn through the REAL adapter mapping from frames pi would
   * emit for the given SSE reply, and returns { streamedText, finalText }.
   * `streamedText` concatenates content.delta events; `finalText` is the
   * completed assistant message detail.
   */
  const runAdapterTurn = (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly deltas: ReadonlyArray<string>;
    readonly finalText: string;
    readonly tool?: { readonly name: string; readonly input: Record<string, unknown> };
  }) =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const runtime = streamParityFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const expectedCount = 1 + input.deltas.length + (input.tool ? 2 : 0) + 2;
      const collected = yield* Stream.take(adapter.streamEvents, expectedCount).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* runtime.emit({
        kind: "rpc-event",
        threadId: input.threadId,
        turnId: input.turnId,
        model: "anthropic/claude-haiku-4-5",
        payload: { type: "turn_start" },
      });
      if (input.tool) {
        yield* runtime.emit({
          kind: "rpc-event",
          threadId: input.threadId,
          turnId: input.turnId,
          payload: {
            type: "tool_execution_start",
            toolCallId: "toolu_mock_1",
            toolName: input.tool.name,
            args: input.tool.input,
          },
        });
        yield* runtime.emit({
          kind: "rpc-event",
          threadId: input.threadId,
          turnId: input.turnId,
          payload: {
            type: "tool_execution_end",
            toolCallId: "toolu_mock_1",
            toolName: input.tool.name,
            result: "ok",
            isError: false,
          },
        });
      }
      for (const delta of input.deltas) {
        yield* runtime.emit({
          kind: "rpc-event",
          threadId: input.threadId,
          turnId: input.turnId,
          payload: {
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta },
          },
        });
      }
      yield* runtime.emit({
        kind: "rpc-event",
        threadId: input.threadId,
        turnId: input.turnId,
        payload: {
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: input.finalText }] },
        },
      });
      yield* runtime.emit({
        kind: "rpc-event",
        threadId: input.threadId,
        turnId: input.turnId,
        payload: { type: "agent_end" },
      });

      const events = yield* Fiber.join(collected);
      const streamedText = events
        .filter(
          (event): event is Extract<ProviderRuntimeEvent, { type: "content.delta" }> =>
            event.type === "content.delta" && event.payload.streamKind === "assistant_text",
        )
        .map((event) => event.payload.delta)
        .join("");
      const completedItem = events.find(
        (event): event is Extract<ProviderRuntimeEvent, { type: "item.completed" }> =>
          event.type === "item.completed" && event.payload.itemType === "assistant_message",
      );
      const turnCompleted = events.find((event) => event.type === "turn.completed");
      NodeAssert.ok(turnCompleted && turnCompleted.type === "turn.completed");
      NodeAssert.equal(turnCompleted.payload.state, "completed");
      const toolEvents = events.filter(
        (event) => event.type === "item.started" || event.type === "item.completed",
      );
      return {
        events,
        streamedText,
        finalText: String(completedItem?.payload.detail ?? ""),
        toolEvents,
      };
    });

  it.effect("case a: text-only streamed reply assembles identically to a non-streamed reply", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-parity-text-only");
      yield* drainStartupEvents(adapter, threadId);

      // Pi-shaped request WITHOUT tools (text-only case): fixture minus tools.
      const { tools: _tools, ...bodyWithoutTools } = piRequestFixture.body;
      const mock = yield* Effect.promise(() =>
        startMockMeridian({ textChunks: ["MERIDIAN", "-UI-", "PASS"] }),
      );
      const frames = yield* Effect.promise(() =>
        postPiRequestAndReadSse(mock.baseUrl, bodyWithoutTools),
      );
      yield* Effect.promise(() => mock.close());

      const capture = mock.captures[0];
      NodeAssert.ok(capture);
      assertPiRequestShape(capture, { tools: false });
      const sseText = sseTextDeltas(frames).join("");
      NodeAssert.equal(sseText, "MERIDIAN-UI-PASS");

      // Streamed turn: pi frames built from what the wire carried.
      const streamed = yield* runAdapterTurn({
        threadId,
        turnId: asTurnId("turn-parity-a-streamed"),
        deltas: sseTextDeltas(frames),
        finalText: sseText,
      });
      // Non-streamed reference turn: same final message, no deltas.
      const buffered = yield* runAdapterTurn({
        threadId,
        turnId: asTurnId("turn-parity-a-buffered"),
        deltas: [],
        finalText: sseText,
      });

      // Parity: chunked text concatenates to the same final message a
      // non-streaming turn produces.
      NodeAssert.equal(streamed.streamedText, sseText);
      NodeAssert.equal(streamed.finalText, sseText);
      NodeAssert.equal(buffered.streamedText, "");
      NodeAssert.equal(buffered.finalText, streamed.finalText);
    }),
  );

  it.effect("case b: tools present with no tool call streams to the same final text", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-parity-tools-no-call");
      yield* drainStartupEvents(adapter, threadId);

      const mock = yield* Effect.promise(() =>
        startMockMeridian({ textChunks: ["No tools ", "needed."] }),
      );
      const frames = yield* Effect.promise(() =>
        postPiRequestAndReadSse(mock.baseUrl, piRequestFixture.body),
      );
      yield* Effect.promise(() => mock.close());

      const capture = mock.captures[0];
      NodeAssert.ok(capture);
      // Ryan's steering: the tools=true case must be the Pi-shaped tool path
      // (PascalCase Read/Bash/Edit/Write with pi's schemas), not generic chat.
      assertPiRequestShape(capture, { tools: true });
      NodeAssert.equal(sseToolUse(frames), undefined);
      const sseText = sseTextDeltas(frames).join("");

      const streamed = yield* runAdapterTurn({
        threadId,
        turnId: asTurnId("turn-parity-b-streamed"),
        deltas: sseTextDeltas(frames),
        finalText: sseText,
      });
      const buffered = yield* runAdapterTurn({
        threadId,
        turnId: asTurnId("turn-parity-b-buffered"),
        deltas: [],
        finalText: sseText,
      });

      NodeAssert.equal(streamed.streamedText, sseText);
      NodeAssert.equal(streamed.finalText, sseText);
      NodeAssert.equal(buffered.finalText, streamed.finalText);
      NodeAssert.equal(streamed.toolEvents.filter((e) => e.type === "item.started").length, 0);
    }),
  );

  it.effect("case c: a simple Bash-shaped tool-call round maps correctly and final text lands", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-parity-tool-call");
      yield* drainStartupEvents(adapter, threadId);

      const mock = yield* Effect.promise(() =>
        startMockMeridian({
          textChunks: ["Ran ls: ", "3 files."],
          toolCall: { name: "Bash", input: { command: "ls" } },
        }),
      );
      const frames = yield* Effect.promise(() =>
        postPiRequestAndReadSse(mock.baseUrl, piRequestFixture.body),
      );
      yield* Effect.promise(() => mock.close());

      const capture = mock.captures[0];
      NodeAssert.ok(capture);
      assertPiRequestShape(capture, { tools: true });
      const toolUse = sseToolUse(frames);
      NodeAssert.deepStrictEqual(toolUse, { name: "Bash", input: { command: "ls" } });
      const sseText = sseTextDeltas(frames).join("");

      const streamed = yield* runAdapterTurn({
        threadId,
        turnId: asTurnId("turn-parity-c-streamed"),
        deltas: sseTextDeltas(frames),
        finalText: sseText,
        tool: toolUse,
      });

      // The Bash-shaped tool round maps into the tool item lifecycle.
      const toolStarted = streamed.events.find((event) => event.type === "item.started");
      NodeAssert.ok(toolStarted && toolStarted.type === "item.started");
      NodeAssert.equal(toolStarted.payload.itemType, "dynamic_tool_call");
      NodeAssert.equal(toolStarted.payload.title, "Bash");
      NodeAssert.equal(toolStarted.itemId, "pi-tool:toolu_mock_1");
      const toolCompleted = streamed.events.find(
        (event) =>
          event.type === "item.completed" && event.payload.itemType === "dynamic_tool_call",
      );
      NodeAssert.ok(toolCompleted && toolCompleted.type === "item.completed");
      NodeAssert.equal(toolCompleted.payload.status, "completed");

      // ...and the final text still lands with stream parity.
      NodeAssert.equal(streamed.streamedText, sseText);
      NodeAssert.equal(streamed.finalText, sseText);

      const buffered = yield* runAdapterTurn({
        threadId,
        turnId: asTurnId("turn-parity-c-buffered"),
        deltas: [],
        finalText: sseText,
        tool: toolUse,
      });
      NodeAssert.equal(buffered.finalText, streamed.finalText);
    }),
  );
});

// ---------------------------------------------------------------------------
// PiSessionRuntime integration against a scripted fake `pi --mode rpc` binary
// ---------------------------------------------------------------------------

const scriptDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-pi-rpc-"));

const FAKE_PI_SCRIPT = `#!/usr/bin/env node
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
const send = (payload) => process.stdout.write(JSON.stringify(payload) + "\\n");

rl.on("line", (line) => {
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    return;
  }
  const respond = (data) =>
    send({
      id: command.id,
      type: "response",
      command: command.type,
      success: true,
      ...(data !== undefined ? { data } : {}),
    });
  switch (command.type) {
    case "get_state":
      respond({
        model: { provider: "anthropic", modelId: "claude-test" },
        thinkingLevel: "medium",
        isStreaming: false,
        sessionFile: "/tmp/pi-fake-session.jsonl",
        sessionId: "pi-fake-sess",
      });
      break;
    case "get_available_models":
      respond({
        models: [
          { provider: "anthropic", modelId: "claude-test", name: "Claude Test" },
          { provider: "openai", modelId: "gpt-test" },
          { provider: "anthropic", modelId: "claude-test", name: "Duplicate" },
        ],
      });
      break;
    case "set_model":
    case "set_thinking_level":
      respond();
      break;
    case "prompt":
      respond();
      send({ type: "turn_start" });
      send({ type: "turn_start" }); // duplicate — the runtime must suppress it
      send({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello" },
      });
      send({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
      });
      send({ type: "agent_end" });
      break;
    case "abort":
      respond();
      send({ type: "agent_end" });
      break;
    default:
      send({
        id: command.id,
        type: "response",
        command: command.type,
        success: false,
        error: "unknown command " + command.type,
      });
  }
});
`;

const fakePiPath = NodePath.join(scriptDir, "fake-pi.mjs");
NodeFS.writeFileSync(fakePiPath, FAKE_PI_SCRIPT, { mode: 0o755 });

const EXITING_PI_SCRIPT = `#!/usr/bin/env node
process.exit(3);
`;
const exitingPiPath = NodePath.join(scriptDir, "exiting-pi.mjs");
NodeFS.writeFileSync(exitingPiPath, EXITING_PI_SCRIPT, { mode: 0o755 });

it.effect("PiSessionRuntime fails start with full cleanup when the child exits immediately", () =>
  Effect.gen(function* () {
    const runtime = yield* makePiSessionRuntime({
      threadId: asThreadId("pi-rt-exit"),
      binaryPath: exitingPiPath,
      runtimeMode: "full-access",
    });
    const firstEventFiber = yield* Stream.runHead(runtime.events).pipe(Effect.forkChild);
    const result = yield* runtime.start().pipe(Effect.result);

    NodeAssert.equal(result._tag, "Failure");
    NodeAssert.equal(result.failure._tag, "PiSessionRuntimeError");

    const firstEvent = yield* Fiber.join(firstEventFiber);
    NodeAssert.equal(firstEvent._tag, "Some");
    NodeAssert.ok(firstEvent.value.kind === "exit");
    NodeAssert.equal(firstEvent.value.expected, false);
    NodeAssert.equal(firstEvent.value.code, 3);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), TestClock.withLive),
);

it.effect("PiSessionRuntime rejects non-full-access runtime modes (#402)", () =>
  Effect.gen(function* () {
    const result = yield* makePiSessionRuntime({
      threadId: asThreadId("pi-rt-mode"),
      binaryPath: fakePiPath,
      runtimeMode: "approval-required",
    }).pipe(Effect.result);

    NodeAssert.equal(result._tag, "Failure");
    NodeAssert.equal(result.failure._tag, "PiSessionRuntimeError");
    NodeAssert.ok(result.failure.detail.includes("full-access"));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), TestClock.withLive),
);

it.effect(
  "PiSessionRuntime runs a real scripted turn and suppresses the duplicate turn_start",
  () =>
    Effect.gen(function* () {
      const runtime = yield* makePiSessionRuntime({
        threadId: asThreadId("pi-rt-turn"),
        binaryPath: fakePiPath,
        runtimeMode: "full-access",
      });

      const session = yield* runtime.start();
      NodeAssert.equal(session.status, "ready");
      NodeAssert.equal(session.model, "anthropic/claude-test");

      const collected = yield* Stream.take(runtime.events, 4).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const turn = yield* runtime.sendTurn({ input: "hi" });
      NodeAssert.equal(turn.threadId, "pi-rt-turn");
      const resume = turn.resumeCursor as Record<string, unknown>;
      NodeAssert.equal(resume.sessionFile, "/tmp/pi-fake-session.jsonl");
      NodeAssert.equal(resume.sessionId, "pi-fake-sess");

      const events = yield* Fiber.join(collected);
      const rpcTypes = events.map((event) =>
        event.kind === "rpc-event" ? event.payload.type : event.kind,
      );
      // ONE turn_start only — the duplicate was suppressed by the runtime.
      NodeAssert.deepStrictEqual(rpcTypes, [
        "turn_start",
        "message_update",
        "message_end",
        "agent_end",
      ]);
      for (const event of events) {
        NodeAssert.ok(event.kind === "rpc-event");
        NodeAssert.equal(event.turnId, turn.turnId);
      }

      const thread = yield* runtime.readThread;
      NodeAssert.deepStrictEqual(thread.turns, [{ id: turn.turnId, items: [] }]);

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), TestClock.withLive),
);

it.effect("discoverPiModels returns the deduped real catalog from the scripted binary", () =>
  Effect.gen(function* () {
    const catalog = yield* discoverPiModels({ binaryPath: fakePiPath });
    NodeAssert.equal(catalog.defaultModel, "anthropic/claude-test");
    NodeAssert.deepStrictEqual(catalog.models, [
      { slug: "anthropic/claude-test", name: "Claude Test" },
      { slug: "openai/gpt-test", name: "gpt-test" },
    ]);
  }).pipe(Effect.provide(NodeServices.layer), TestClock.withLive),
);

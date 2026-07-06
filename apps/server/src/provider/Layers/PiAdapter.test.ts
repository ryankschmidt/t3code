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
import {
  discoverPiModels,
  makePiSessionRuntime,
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

  public readonly startImpl = vi.fn(() =>
    Promise.resolve({
      provider: ProviderDriverKind.make("pi"),
      status: "ready" as const,
      runtimeMode: this.options.runtimeMode,
      threadId: this.options.threadId,
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      ...(this.options.model ? { model: this.options.model } : {}),
      resumeCursor: {
        sessionFile: "/tmp/pi-session.jsonl",
        sessionId: "pi-sess-1",
        modelProvider: "anthropic",
        modelId: "claude-test",
        thinkingLevel: "medium",
      },
      createdAt: this.now,
      updatedAt: this.now,
    } satisfies ProviderSession),
  );

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

const makeAdapterLayer = (factory: ReturnType<typeof makeRuntimeFactory>) =>
  Layer.effect(
    PiAdapter,
    Effect.gen(function* () {
      const piSettings = decodePiSettings({});
      return yield* makePiAdapter(piSettings, {
        makeRuntime: factory.factory,
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
      NodeAssert.deepStrictEqual(turnStarted.payload, { model: "anthropic/claude-test" });
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

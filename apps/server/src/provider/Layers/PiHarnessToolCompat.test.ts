// @effect-diagnostics nodeBuiltinImport:off
/**
 * Pi Harness Tool-Compatibility Test Pack
 * =======================================
 *
 * Hermetic pre-flight for adding real harness tools to pi later: every
 * scenario scripts PiRuntimeEvents through a fake pi runtime (dummy tool
 * names only — dummy_echo / dummy_add), so the pack proves the T3-side tool
 * plumbing without any real tool, without the seam, and without a network.
 *
 * Scenario → test map:
 *   1. stream on/off            → "scenario 1: stream on vs off assembles the identical final text"
 *   2. tools present, no call   → "scenario 2: tools present with zero tool events completes text-only"
 *   3. one dummy tool call      → "scenario 3a: one dummy tool call round-trips exactly once (anthropic route)"
 *                                 "scenario 3b: one dummy tool call round-trips exactly once (codex route)"
 *   4. tool failure             → "scenario 4: a failed tool renders visibly and the turn still lands text"
 *   5. two-tool sequence        → "scenario 5: two-tool sequence preserves order with one completion each"
 *   6. blocked-tool governance  → "scenario 6: an out-of-set tool call is visible and the turn fails loudly, never silently"
 *   7. duplicate tool events    → "scenario 7: a replayed tool_execution_end emits exactly one completion"
 *   8. restart durability       → "scenario 8: routeFamily activities survive a store close and reopen"
 *
 * Scenario 6 pinned contract (honest): T3 maps whatever tool lifecycle pi
 * reports — tool-set enforcement lives upstream (pi only dispatches its own
 * registered tools; on the Meridian route the proxy additionally blocks SDK
 * builtin PascalCase tools). T3's contract is VISIBILITY: the out-of-set call
 * renders as a failed dynamic_tool_call item, and a turn that then produces
 * no assistant text fails loudly through the #402 zero-output guard.
 */
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  PiSettings,
  type OrchestrationReadModel,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, vi } from "@effect/vitest";
import { afterEach, describe, expect } from "vite-plus/test";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { ProviderRuntimeIngestionLive } from "../../orchestration/Layers/ProviderRuntimeIngestion.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRuntimeIngestionService } from "../../orchestration/Services/ProviderRuntimeIngestion.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { makeSqlitePersistenceLive } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { type ProviderAdapterError } from "../Errors.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../Services/ProviderService.ts";
import { type ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { makePiAdapter } from "./PiAdapter.ts";
import { type PiMeridianRouteGuardOptions } from "./PiMeridianRoute.ts";
import {
  parsePiModelSlug,
  PiSessionRuntimeError,
  type PiRuntimeEvent,
  type PiSessionRuntimeOptions,
  type PiSessionRuntimeShape,
  type PiSessionRuntimeSendTurnInput,
} from "./PiSessionRuntime.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);

// Pack-local service tag so suites can `yield* PiAdapter` (same pattern as
// PiAdapter.test.ts, but self-contained — this pack imports nothing from it).
class PiAdapter extends Context.Service<PiAdapter, ProviderAdapterShape<ProviderAdapterError>>()(
  "t3/provider/Layers/PiHarnessToolCompat.test/PiAdapter",
) {}

const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);

// ---------------------------------------------------------------------------
// Fake pi runtime (minimal clone of the PiAdapter.test.ts harness)
// ---------------------------------------------------------------------------

class FakePiRuntime implements PiSessionRuntimeShape {
  private readonly eventQueue = Effect.runSync(Queue.unbounded<PiRuntimeEvent>());
  private readonly now = "2026-01-01T00:00:00.000Z";

  public readonly startImpl = vi.fn(() => {
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
        sessionId: "pi-sess-pack",
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
        turnId: asTurnId("turn-pack"),
      }),
  );

  readonly options: PiSessionRuntimeOptions;

  constructor(options: PiSessionRuntimeOptions) {
    this.options = options;
  }

  start() {
    return Effect.promise(() => this.startImpl());
  }

  getSession = Effect.promise(() => this.startImpl());

  sendTurn(input: PiSessionRuntimeSendTurnInput) {
    return Effect.promise(() => this.sendTurnImpl(input));
  }

  interruptTurn(_turnId?: TurnId) {
    return Effect.promise(() => Promise.resolve(undefined));
  }

  readThread = Effect.sync(() => ({ threadId: this.options.threadId, turns: [] }));

  listAvailableModels() {
    return Effect.succeed({ defaultModel: null, models: [] });
  }

  get events() {
    return Stream.fromQueue(this.eventQueue);
  }

  close = Effect.promise(() => Promise.resolve(undefined));

  emit(event: PiRuntimeEvent) {
    return Queue.offer(this.eventQueue, event).pipe(Effect.asVoid);
  }
}

function makeRuntimeFactory() {
  const runtimes: Array<FakePiRuntime> = [];
  const factory = vi.fn((runtimeOptions: PiSessionRuntimeOptions) =>
    Effect.gen(function* () {
      yield* Scope.Scope;
      const runtime = new FakePiRuntime(runtimeOptions);
      runtimes.push(runtime);
      return runtime;
    }),
  );
  return {
    factory,
    get lastRuntime(): FakePiRuntime | undefined {
      return runtimes.at(-1);
    },
  };
}

// GREEN Meridian route: adapter sessions on the default anthropic model pass
// the fail-closed guard, so the pack exercises tool mapping on BOTH families.
const meridianFixtureDir = NodeFS.mkdtempSync(
  NodePath.join(NodeOS.tmpdir(), "t3code-pi-toolcompat-"),
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

const makeAdapterLayer = (factory: ReturnType<typeof makeRuntimeFactory>) =>
  Layer.effect(
    PiAdapter,
    Effect.gen(function* () {
      const piSettings = decodePiSettings({});
      return yield* makePiAdapter(piSettings, {
        makeRuntime: factory.factory,
        meridianRoute: greenMeridianRoute,
      });
    }),
  ).pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(NodeServices.layer),
  );

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

/** Script one whole turn: emit `turn_start`, the given middle events, `agent_end`. */
const scriptTurn = (
  runtime: FakePiRuntime,
  threadId: ThreadId,
  turnId: TurnId,
  middle: ReadonlyArray<Record<string, unknown>>,
  options?: { readonly model?: string },
) =>
  Effect.gen(function* () {
    yield* runtime.emit({
      kind: "rpc-event",
      threadId,
      turnId,
      ...(options?.model ? { model: options.model } : {}),
      payload: { type: "turn_start" },
    });
    for (const payload of middle) {
      yield* runtime.emit({ kind: "rpc-event", threadId, turnId, payload } as PiRuntimeEvent);
    }
    yield* runtime.emit({ kind: "rpc-event", threadId, turnId, payload: { type: "agent_end" } });
  });

const assistantEnd = (text: string) => ({
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text }] },
});

const packFactory = makeRuntimeFactory();
const packLayer = it.layer(makeAdapterLayer(packFactory));

packLayer("Pi harness tool-compatibility pack (scenarios 1-7, hermetic)", (it) => {
  it.effect("scenario 1: stream on vs off assembles the identical final text", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const finalText = "TOOLPACK stream parity final text";

      // Stream ON: deltas precede the completed assistant message.
      const threadOn = asThreadId("pi-pack-s1-on");
      yield* drainStartupEvents(adapter, threadOn);
      const runtimeOn = packFactory.lastRuntime;
      NodeAssert.ok(runtimeOn);
      const collectedOn = yield* Stream.take(adapter.streamEvents, 6).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* scriptTurn(runtimeOn, threadOn, asTurnId("turn-s1-on"), [
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "TOOLPACK " } },
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "stream parity " } },
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "final text" } },
        assistantEnd(finalText),
      ]);
      const eventsOn = yield* Fiber.join(collectedOn);

      // Stream OFF: no deltas, only the completed assistant message.
      const threadOff = asThreadId("pi-pack-s1-off");
      yield* drainStartupEvents(adapter, threadOff);
      const runtimeOff = packFactory.lastRuntime;
      NodeAssert.ok(runtimeOff);
      const collectedOff = yield* Stream.take(adapter.streamEvents, 3).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* scriptTurn(runtimeOff, threadOff, asTurnId("turn-s1-off"), [assistantEnd(finalText)]);
      const eventsOff = yield* Fiber.join(collectedOff);

      NodeAssert.deepStrictEqual(
        eventsOn.map((event) => event.type),
        ["turn.started", "content.delta", "content.delta", "content.delta", "item.completed", "turn.completed"],
      );
      NodeAssert.deepStrictEqual(
        eventsOff.map((event) => event.type),
        ["turn.started", "item.completed", "turn.completed"],
      );
      const completedOn = eventsOn[4] as ProviderRuntimeEvent;
      const completedOff = eventsOff[1] as ProviderRuntimeEvent;
      NodeAssert.ok(completedOn.type === "item.completed" && completedOff.type === "item.completed");
      NodeAssert.equal(completedOn.payload.detail, finalText);
      NodeAssert.equal(completedOff.payload.detail, finalText);
      // Parity: the streamed deltas concatenate to the same final text.
      const streamedText = eventsOn
        .filter((event): event is Extract<ProviderRuntimeEvent, { type: "content.delta" }> =>
          event.type === "content.delta",
        )
        .map((event) => event.payload.delta)
        .join("");
      NodeAssert.equal(streamedText, finalText);
    }),
  );

  it.effect("scenario 2: tools present with zero tool events completes text-only", () =>
    Effect.gen(function* () {
      // Tool declaration lives inside pi (the harness registers its own
      // tools); at this seam the contract is: zero tool lifecycle events must
      // produce zero tool items — and the text still lands (no silence).
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-pack-s2");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = packFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const collected = yield* Stream.take(adapter.streamEvents, 3).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* scriptTurn(runtime, threadId, asTurnId("turn-s2"), [
        assistantEnd("no tool was needed"),
      ]);
      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["turn.started", "item.completed", "turn.completed"],
      );
      const completed = events[1] as ProviderRuntimeEvent;
      NodeAssert.ok(completed.type === "item.completed");
      NodeAssert.equal(completed.payload.itemType, "assistant_message");
      NodeAssert.equal(completed.payload.detail, "no tool was needed");
      const turnCompleted = events[2] as ProviderRuntimeEvent;
      NodeAssert.ok(turnCompleted.type === "turn.completed");
      NodeAssert.deepStrictEqual(turnCompleted.payload, { state: "completed", stopReason: null });
    }),
  );

  const oneDummyToolCall = (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly model: string;
    readonly routeFamily: string;
  }) =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId(input.threadId);
      yield* drainStartupEvents(adapter, threadId);
      const runtime = packFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const collected = yield* Stream.take(adapter.streamEvents, 6).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* scriptTurn(
        runtime,
        threadId,
        asTurnId(input.turnId),
        [
          { type: "tool_execution_start", toolCallId: "call-echo-1", toolName: "dummy_echo", args: { text: "ping" } },
          { type: "tool_execution_update", toolCallId: "call-echo-1", toolName: "dummy_echo", partialResult: "pi" },
          { type: "tool_execution_end", toolCallId: "call-echo-1", toolName: "dummy_echo", result: "ping" },
          assistantEnd("the dummy_echo tool returned ping"),
        ],
        { model: input.model },
      );
      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["turn.started", "item.started", "item.updated", "item.completed", "item.completed", "turn.completed"],
      );
      const turnStarted = events[0] as ProviderRuntimeEvent;
      NodeAssert.ok(turnStarted.type === "turn.started");
      NodeAssert.deepStrictEqual(turnStarted.payload, {
        model: input.model,
        routeFamily: input.routeFamily,
      });
      const toolEvents = events.filter(
        (event): event is Extract<ProviderRuntimeEvent, { type: "item.started" | "item.updated" | "item.completed" }> =>
          (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") &&
          event.payload.itemType === "dynamic_tool_call",
      );
      NodeAssert.equal(toolEvents.length, 3);
      for (const event of toolEvents) {
        NodeAssert.equal(event.itemId, "pi-tool:call-echo-1");
        NodeAssert.equal(event.payload.title, "dummy_echo");
      }
      // Exactly ONE started and ONE completed for the tool call.
      NodeAssert.equal(toolEvents.filter((event) => event.type === "item.started").length, 1);
      const toolCompleted = toolEvents.filter((event) => event.type === "item.completed");
      NodeAssert.equal(toolCompleted.length, 1);
      NodeAssert.equal(toolCompleted[0]?.payload.status, "completed");
      // The final assistant text lands after the tool round — no silence.
      const assistant = events[4] as ProviderRuntimeEvent;
      NodeAssert.ok(assistant.type === "item.completed");
      NodeAssert.equal(assistant.payload.itemType, "assistant_message");
      NodeAssert.equal(assistant.payload.detail, "the dummy_echo tool returned ping");
      const turnCompleted = events[5] as ProviderRuntimeEvent;
      NodeAssert.ok(turnCompleted.type === "turn.completed");
      NodeAssert.deepStrictEqual(turnCompleted.payload, { state: "completed", stopReason: null });
    });

  it.effect("scenario 3a: one dummy tool call round-trips exactly once (anthropic route)", () =>
    oneDummyToolCall({
      threadId: "pi-pack-s3a",
      turnId: "turn-s3a",
      model: "anthropic/claude-test",
      routeFamily: "anthropic-meridian-claude-code-sdk",
    }),
  );

  it.effect("scenario 3b: one dummy tool call round-trips exactly once (codex route)", () =>
    oneDummyToolCall({
      threadId: "pi-pack-s3b",
      turnId: "turn-s3b",
      model: "openai-codex/gpt-5.5-codex",
      routeFamily: "openai-native-pi",
    }),
  );

  it.effect("scenario 4: a failed tool renders visibly and the turn still lands text", () =>
    Effect.gen(function* () {
      // Pinned contract: a FAILED tool does not fail the turn by itself — pi
      // owns the turn outcome. T3 must render the failure (status "failed" on
      // the tool item) and still complete the assistant text that follows.
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-pack-s4");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = packFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const collected = yield* Stream.take(adapter.streamEvents, 5).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* scriptTurn(runtime, threadId, asTurnId("turn-s4"), [
        { type: "tool_execution_start", toolCallId: "call-fail-1", toolName: "dummy_echo", args: { text: "boom" } },
        { type: "tool_execution_end", toolCallId: "call-fail-1", toolName: "dummy_echo", result: "dummy_echo exploded", isError: true },
        assistantEnd("the tool failed, recovering"),
      ]);
      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["turn.started", "item.started", "item.completed", "item.completed", "turn.completed"],
      );
      const toolCompleted = events[2] as ProviderRuntimeEvent;
      NodeAssert.ok(toolCompleted.type === "item.completed");
      NodeAssert.equal(toolCompleted.itemId, "pi-tool:call-fail-1");
      NodeAssert.equal(toolCompleted.payload.status, "failed");
      NodeAssert.equal(toolCompleted.payload.detail, "dummy_echo exploded");
      const assistant = events[3] as ProviderRuntimeEvent;
      NodeAssert.ok(assistant.type === "item.completed");
      NodeAssert.equal(assistant.payload.detail, "the tool failed, recovering");
      const turnCompleted = events[4] as ProviderRuntimeEvent;
      NodeAssert.ok(turnCompleted.type === "turn.completed");
      NodeAssert.deepStrictEqual(turnCompleted.payload, { state: "completed", stopReason: null });
    }),
  );

  it.effect("scenario 5: two-tool sequence preserves order with one completion each", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-pack-s5");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = packFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const collected = yield* Stream.take(adapter.streamEvents, 7).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* scriptTurn(runtime, threadId, asTurnId("turn-s5"), [
        { type: "tool_execution_start", toolCallId: "call-a", toolName: "dummy_echo", args: { text: "one" } },
        { type: "tool_execution_end", toolCallId: "call-a", toolName: "dummy_echo", result: "one" },
        { type: "tool_execution_start", toolCallId: "call-b", toolName: "dummy_add", args: { a: 1, b: 2 } },
        { type: "tool_execution_end", toolCallId: "call-b", toolName: "dummy_add", result: "3" },
        assistantEnd("echoed one, then added to 3"),
      ]);
      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        [
          "turn.started",
          "item.started",
          "item.completed",
          "item.started",
          "item.completed",
          "item.completed",
          "turn.completed",
        ],
      );
      // Ordering: dummy_echo (call-a) fully lands before dummy_add (call-b).
      NodeAssert.equal((events[1] as ProviderRuntimeEvent).itemId, "pi-tool:call-a");
      NodeAssert.equal((events[2] as ProviderRuntimeEvent).itemId, "pi-tool:call-a");
      NodeAssert.equal((events[3] as ProviderRuntimeEvent).itemId, "pi-tool:call-b");
      NodeAssert.equal((events[4] as ProviderRuntimeEvent).itemId, "pi-tool:call-b");
      // Exactly one completion per callId, distinct itemIds.
      const toolCompletions = events.filter(
        (event): event is Extract<ProviderRuntimeEvent, { type: "item.completed" }> =>
          event.type === "item.completed" && event.payload.itemType === "dynamic_tool_call",
      );
      NodeAssert.deepStrictEqual(
        toolCompletions.map((event) => event.itemId),
        ["pi-tool:call-a", "pi-tool:call-b"],
      );
      const assistant = events[5] as ProviderRuntimeEvent;
      NodeAssert.ok(assistant.type === "item.completed");
      NodeAssert.equal(assistant.payload.detail, "echoed one, then added to 3");
    }),
  );

  it.effect(
    "scenario 6: an out-of-set tool call is visible and the turn fails loudly, never silently",
    () =>
      Effect.gen(function* () {
        // Governance surface today: pi dispatches only its own registered
        // tools, and the Meridian route additionally blocks SDK builtin
        // PascalCase tools upstream. If an out-of-set call ever reaches this
        // adapter, the pinned contract is visibility — mapped lifecycle, no
        // crash, no silent drop — and a turn with no assistant text after it
        // must fail LOUDLY through the #402 zero-output guard.
        const adapter = yield* PiAdapter;
        const threadId = asThreadId("pi-pack-s6");
        yield* drainStartupEvents(adapter, threadId);
        const runtime = packFactory.lastRuntime;
        NodeAssert.ok(runtime);
        const collected = yield* Stream.take(adapter.streamEvents, 5).pipe(
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* scriptTurn(runtime, threadId, asTurnId("turn-s6"), [
          { type: "tool_execution_start", toolCallId: "call-blocked-1", toolName: "PowerShell", args: { script: "Get-Date" } },
          {
            type: "tool_execution_end",
            toolCallId: "call-blocked-1",
            toolName: "PowerShell",
            result: "tool PowerShell is not available in this harness",
            isError: true,
          },
        ]);
        const events = yield* Fiber.join(collected);
        NodeAssert.deepStrictEqual(
          events.map((event) => event.type),
          ["turn.started", "item.started", "item.completed", "runtime.error", "turn.completed"],
        );
        const toolCompleted = events[2] as ProviderRuntimeEvent;
        NodeAssert.ok(toolCompleted.type === "item.completed");
        NodeAssert.equal(toolCompleted.itemId, "pi-tool:call-blocked-1");
        NodeAssert.equal(toolCompleted.payload.title, "PowerShell");
        NodeAssert.equal(toolCompleted.payload.status, "failed");
        const loudError = events[3] as ProviderRuntimeEvent;
        NodeAssert.ok(loudError.type === "runtime.error");
        NodeAssert.ok(loudError.payload.message.includes("no output"));
        const turnCompleted = events[4] as ProviderRuntimeEvent;
        NodeAssert.ok(turnCompleted.type === "turn.completed");
        NodeAssert.equal(turnCompleted.payload.state, "failed");
      }),
  );

  it.effect("scenario 7: a replayed tool_execution_end emits exactly one completion", () =>
    Effect.gen(function* () {
      // "No duplicate tool calls": pi's RPC stream may replay an end frame;
      // a second item.completed for the same toolCallId would render a
      // duplicate tool card. The adapter dedupes per (turn, toolCallId).
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-pack-s7");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = packFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const collected = yield* Stream.take(adapter.streamEvents, 5).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* scriptTurn(runtime, threadId, asTurnId("turn-s7"), [
        { type: "tool_execution_start", toolCallId: "call-dup", toolName: "dummy_echo", args: { text: "once" } },
        { type: "tool_execution_end", toolCallId: "call-dup", toolName: "dummy_echo", result: "once" },
        // DUPLICATE delivery of the same end frame — must emit NOTHING.
        { type: "tool_execution_end", toolCallId: "call-dup", toolName: "dummy_echo", result: "once" },
        assistantEnd("done exactly once"),
      ]);
      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["turn.started", "item.started", "item.completed", "item.completed", "turn.completed"],
      );
      const toolCompletions = events.filter(
        (event): event is Extract<ProviderRuntimeEvent, { type: "item.completed" }> =>
          event.type === "item.completed" && event.payload.itemType === "dynamic_tool_call",
      );
      NodeAssert.equal(toolCompletions.length, 1);
      NodeAssert.equal(toolCompletions[0]?.itemId, "pi-tool:call-dup");
      // The sentinel assistant message follows the single completion directly.
      const assistant = events[3] as ProviderRuntimeEvent;
      NodeAssert.ok(assistant.type === "item.completed");
      NodeAssert.equal(assistant.payload.itemType, "assistant_message");
      NodeAssert.equal(assistant.payload.detail, "done exactly once");
    }),
  );
});

// ---------------------------------------------------------------------------
// Scenario 8 — restart durability of routeFamily (file-backed sqlite)
// ---------------------------------------------------------------------------

type ToolCompatReadModel = OrchestrationReadModel;
type ToolCompatThread = ToolCompatReadModel["threads"][number];
type ToolCompatActivity = ToolCompatThread["activities"][number];

function createProviderServiceHarness() {
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
  const runtimeSessions: ProviderSession[] = [];
  const unsupported = () => Effect.die(new Error("Unsupported provider call in test")) as never;
  const service: ProviderServiceShape = {
    startSession: () => unsupported(),
    sendTurn: () => unsupported(),
    interruptTurn: () => unsupported(),
    respondToRequest: () => unsupported(),
    respondToUserInput: () => unsupported(),
    stopSession: () => unsupported(),
    listSessions: () => Effect.succeed([...runtimeSessions]),
    getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
    getInstanceInfo: (instanceId) => {
      const driverKind = ProviderDriverKind.make(String(instanceId));
      return Effect.succeed({
        instanceId,
        driverKind,
        displayName: undefined,
        enabled: true,
        continuationIdentity: {
          driverKind,
          continuationKey: `${driverKind}:instance:${instanceId}`,
        },
      });
    },
    rollbackConversation: () => unsupported(),
    get streamEvents() {
      return Stream.fromPubSub(runtimeEventPubSub);
    },
  };
  const emit = (event: ProviderRuntimeEvent): void => {
    Effect.runSync(PubSub.publish(runtimeEventPubSub, event));
  };
  return { service, emit };
}

describe("Pi harness tool-compatibility pack (scenario 8, restart durability)", () => {
  const disposers: Array<() => Promise<void>> = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dispose of disposers.splice(0).reverse()) {
      await dispose();
    }
    for (const dir of tempDirs.splice(0)) {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  function buildRuntime(dbPath: string) {
    const sqliteFileLayer = makeSqlitePersistenceLive(dbPath);
    const provider = createProviderServiceHarness();
    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(sqliteFileLayer),
    );
    const projectionSnapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(sqliteFileLayer),
    );
    const layer = ProviderRuntimeIngestionLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(projectionSnapshotLayer),
      Layer.provideMerge(sqliteFileLayer),
      Layer.provideMerge(Layer.succeed(ProviderService, provider.service)),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(NodeServices.layer),
    );
    const runtime = ManagedRuntime.make(layer);
    disposers.push(() => runtime.dispose());
    return { runtime, provider };
  }

  async function waitForThread(
    readModel: () => Promise<ToolCompatReadModel>,
    predicate: (thread: ToolCompatThread) => boolean,
    timeoutMs = 4000,
  ) {
    const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + timeoutMs;
    const poll = async (): Promise<ToolCompatThread> => {
      const snapshot = await readModel();
      const thread = snapshot.threads.find((entry) => entry.id === asThreadId("thread-pack-1"));
      if (thread && predicate(thread)) {
        return thread;
      }
      if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
        throw new Error("Timed out waiting for thread state");
      }
      await Effect.runPromise(Effect.yieldNow);
      return poll();
    };
    return poll();
  }

  it("scenario 8: routeFamily activities survive a store close and reopen", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-pi-toolcompat-db-"));
    tempDirs.push(dir);
    const dbPath = NodePath.join(dir, "state.sqlite");
    const createdAt = "2026-01-01T00:00:00.000Z";

    // ----- Phase 1: seed a project/thread, ingest routeFamily turns, close.
    {
      const { runtime, provider } = buildRuntime(dbPath);
      const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
      const snapshotQuery = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
      const ingestion = await runtime.runPromise(Effect.service(ProviderRuntimeIngestionService));
      const scope = await Effect.runPromise(Scope.make("sequential"));
      await Effect.runPromise(ingestion.start().pipe(Scope.provide(scope)));

      await runtime.runPromise(
        engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("cmd-pack-project"),
          projectId: asProjectId("project-pack-1"),
          title: "Tool Compat Project",
          workspaceRoot: dir,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("pi"),
            model: "openai-codex/gpt-5.5-codex",
          },
          createdAt,
        }),
      );
      await runtime.runPromise(
        engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-pack-thread"),
          threadId: asThreadId("thread-pack-1"),
          projectId: asProjectId("project-pack-1"),
          title: "Tool Compat Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("pi"),
            model: "openai-codex/gpt-5.5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        }),
      );

      const turnStarted = (input: {
        readonly eventId: string;
        readonly turnId: string;
        readonly model: string;
        readonly routeFamily: "openai-native-pi" | "anthropic-meridian-claude-code-sdk";
      }): ProviderRuntimeEvent =>
        ({
          type: "turn.started",
          eventId: asEventId(input.eventId),
          provider: ProviderDriverKind.make("pi"),
          createdAt,
          threadId: asThreadId("thread-pack-1"),
          turnId: asTurnId(input.turnId),
          payload: { model: input.model, routeFamily: input.routeFamily },
        }) as ProviderRuntimeEvent;

      provider.emit(
        turnStarted({
          eventId: "evt-pack-route-codex",
          turnId: "turn-pack-codex",
          model: "openai-codex/gpt-5.5-codex",
          routeFamily: "openai-native-pi",
        }),
      );
      provider.emit(
        turnStarted({
          eventId: "evt-pack-route-claude",
          turnId: "turn-pack-claude",
          model: "anthropic/claude-test",
          routeFamily: "anthropic-meridian-claude-code-sdk",
        }),
      );

      const readModel = () => runtime.runPromise(snapshotQuery.getSnapshot());
      await waitForThread(
        readModel,
        (thread) =>
          thread.activities.some((entry: ToolCompatActivity) => entry.id === "evt-pack-route-codex") &&
          thread.activities.some((entry: ToolCompatActivity) => entry.id === "evt-pack-route-claude"),
      );

      await Effect.runPromise(Scope.close(scope, Exit.void));
      // Dispose = close the sqlite client and every layer: the "server stop".
      await disposers.pop()?.();
    }

    // ----- Phase 2: reopen the SAME sqlite file with a fresh runtime ("restart").
    {
      const { runtime } = buildRuntime(dbPath);
      const snapshotQuery = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
      const snapshot = await runtime.runPromise(snapshotQuery.getSnapshot());
      const thread = snapshot.threads.find((entry) => entry.id === asThreadId("thread-pack-1"));
      expect(thread).toBeDefined();

      const codexRoute = thread?.activities.find(
        (entry: ToolCompatActivity) => entry.id === "evt-pack-route-codex",
      );
      const codexPayload =
        codexRoute?.payload && typeof codexRoute.payload === "object"
          ? (codexRoute.payload as Record<string, unknown>)
          : undefined;
      expect(codexRoute?.kind).toBe("turn.route-family");
      expect(codexPayload?.routeFamily).toBe("openai-native-pi");

      const claudeRoute = thread?.activities.find(
        (entry: ToolCompatActivity) => entry.id === "evt-pack-route-claude",
      );
      const claudePayload =
        claudeRoute?.payload && typeof claudeRoute.payload === "object"
          ? (claudeRoute.payload as Record<string, unknown>)
          : undefined;
      expect(claudeRoute?.kind).toBe("turn.route-family");
      expect(claudePayload?.routeFamily).toBe("anthropic-meridian-claude-code-sdk");
    }
  });
});

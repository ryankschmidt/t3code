// @effect-diagnostics nodeBuiltinImport:off
/**
 * Pi Harness Tool Gauntlet (real-but-safe tool shapes, hermetic plane)
 * ====================================================================
 *
 * Next hardening gate after PiHarnessToolCompat.test.ts: the seven
 * "real-but-safe" tool shapes the live gauntlet drives through both route
 * families, scripted here as PiRuntimeEvents through a fake pi runtime so the
 * T3-side plumbing is pinned deterministically — no seam, no network, no real
 * side effects outside per-test temp dirs.
 *
 * Scenario → test map:
 *   1. read-only file read      → "gauntlet 1: read-only file read maps lifecycle and lands final text"
 *   2. scoped write             → "gauntlet 2: scoped write to a test-only folder completes exactly once"
 *   3. list/search              → "gauntlet 3: list/search over a fixture folder maps result content"
 *   4. long-running progress    → "gauntlet 4: a long-running tool streams 25 ordered progress updates"
 *   5. intentionally failing    → "gauntlet 5: a failing tool renders a failed item and text still lands"
 *   6. forbidden/destructive    → "gauntlet 6: a destructive out-of-set tool is refused visibly, never silently"
 *   7. idempotent write         → "gauntlet 7: duplicate idempotent-write invocations cause one durable effect"
 *   8. restart replay           → "gauntlet 8: a fresh adapter re-emits a replayed end frame (per-process dedupe pinned)"
 *   9. probe retry (recovers)   → "gauntlet 9: a first-attempt probe timeout recovers on the single retry"
 *  10. probe retry (fail-closed)→ "gauntlet 10: both probe attempts failing still fails closed with the seam-naming error"
 *
 * Honest pins:
 *   - Scenario 6: enforcement lives upstream (pi dispatches only registered
 *     tools; the Meridian route additionally blocks SDK builtins). T3's
 *     contract is VISIBILITY: the refusal renders as a failed
 *     dynamic_tool_call and a text-less turn fails loudly via the #402
 *     zero-output guard. This suite proves NO silent success is possible.
 *   - Scenario 8: the tool_execution_end dedupe is PER PROCESS. A fresh
 *     adapter (server restart) has no memory of completed callIds, so a
 *     replayed end frame maps again at this layer. That is the pinned truth —
 *     cross-restart exactly-once for SIDE EFFECTS is owned by the
 *     operationId instrument (scenario 7), not by event dedupe. Do not "fix"
 *     this here; that would be seam-adjacent rework.
 */
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  ProviderDriverKind,
  PiSettings,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, vi } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { type ProviderAdapterError } from "../Errors.ts";
import { type ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { makePiAdapter } from "./PiAdapter.ts";
import { makePiMeridianRouteGuard, type PiMeridianRouteGuardOptions } from "./PiMeridianRoute.ts";
import {
  parsePiModelSlug,
  type PiRuntimeEvent,
  type PiSessionRuntimeOptions,
  type PiSessionRuntimeShape,
  type PiSessionRuntimeSendTurnInput,
} from "./PiSessionRuntime.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);

// Suite-local service tag (self-contained; imports nothing from other suites).
class PiAdapter extends Context.Service<PiAdapter, ProviderAdapterShape<ProviderAdapterError>>()(
  "t3/provider/Layers/PiHarnessToolGauntlet.test/PiAdapter",
) {}

const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);

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
        sessionId: "pi-sess-gauntlet",
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
        turnId: asTurnId("turn-gauntlet"),
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

// GREEN Meridian route so the fail-closed guard passes for anthropic models.
const meridianFixtureDir = NodeFS.mkdtempSync(
  NodePath.join(NodeOS.tmpdir(), "t3code-pi-gauntlet-"),
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
) =>
  Effect.gen(function* () {
    yield* runtime.emit({
      kind: "rpc-event",
      threadId,
      turnId,
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

const isToolEvent = (
  event: ProviderRuntimeEvent,
): event is Extract<ProviderRuntimeEvent, { type: "item.started" | "item.updated" | "item.completed" }> =>
  (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") &&
  event.payload.itemType === "dynamic_tool_call";

const gauntletFactory = makeRuntimeFactory();
const gauntletLayer = it.layer(makeAdapterLayer(gauntletFactory));

gauntletLayer("Pi harness tool gauntlet (shapes 1-6, hermetic)", (it) => {
  it.effect("gauntlet 1: read-only file read maps lifecycle and lands final text", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-gauntlet-g1");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = gauntletFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const collected = yield* Stream.take(adapter.streamEvents, 6).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      const fixture =
        "vault/01_Projects/workbench/infra/t3code/_meta/gauntlet/fixtures/Gauntlet-Read-Target.txt";
      yield* scriptTurn(runtime, threadId, asTurnId("turn-g1"), [
        { type: "tool_execution_start", toolCallId: "call-read-1", toolName: "read", args: { path: fixture } },
        { type: "tool_execution_update", toolCallId: "call-read-1", toolName: "read", partialResult: "GAUNTLET-READ-" },
        {
          type: "tool_execution_end",
          toolCallId: "call-read-1",
          toolName: "read",
          result: "GAUNTLET-READ-SENTINEL-7391",
        },
        assistantEnd("the file contains GAUNTLET-READ-SENTINEL-7391"),
      ]);
      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["turn.started", "item.started", "item.updated", "item.completed", "item.completed", "turn.completed"],
      );
      const toolEvents = events.filter(isToolEvent);
      NodeAssert.equal(toolEvents.length, 3);
      for (const event of toolEvents) {
        NodeAssert.equal(event.itemId, "pi-tool:call-read-1");
        NodeAssert.equal(event.payload.title, "read");
      }
      const completed = toolEvents.filter((event) => event.type === "item.completed");
      NodeAssert.equal(completed.length, 1);
      NodeAssert.equal(completed[0]?.payload.status, "completed");
      NodeAssert.equal(completed[0]?.payload.detail, "GAUNTLET-READ-SENTINEL-7391");
      const assistant = events[4] as ProviderRuntimeEvent;
      NodeAssert.ok(assistant.type === "item.completed");
      NodeAssert.equal(assistant.payload.detail, "the file contains GAUNTLET-READ-SENTINEL-7391");
    }),
  );

  it.effect("gauntlet 2: scoped write to a test-only folder completes exactly once", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-gauntlet-g2");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = gauntletFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const collected = yield* Stream.take(adapter.streamEvents, 5).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      const target =
        "vault/01_Projects/workbench/infra/t3code/_meta/gauntlet/writes/gauntlet-scoped.txt";
      yield* scriptTurn(runtime, threadId, asTurnId("turn-g2"), [
        {
          type: "tool_execution_start",
          toolCallId: "call-write-1",
          toolName: "write",
          args: { path: target, content: "scoped gauntlet write" },
        },
        {
          type: "tool_execution_end",
          toolCallId: "call-write-1",
          toolName: "write",
          result: `wrote 1 file: ${target}`,
        },
        assistantEnd("wrote the scoped test file"),
      ]);
      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["turn.started", "item.started", "item.completed", "item.completed", "turn.completed"],
      );
      const toolCompleted = events[2] as ProviderRuntimeEvent;
      NodeAssert.ok(toolCompleted.type === "item.completed");
      NodeAssert.equal(toolCompleted.itemId, "pi-tool:call-write-1");
      NodeAssert.equal(toolCompleted.payload.status, "completed");
      // Visibility of WHERE the write landed: the result names the test-only path.
      NodeAssert.ok(String(toolCompleted.payload.detail).includes("_meta/gauntlet/writes/gauntlet-scoped.txt"));
      const toolCompletions = events.filter(isToolEvent).filter((event) => event.type === "item.completed");
      NodeAssert.equal(toolCompletions.length, 1);
    }),
  );

  it.effect("gauntlet 3: list/search over a fixture folder maps result content", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-gauntlet-g3");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = gauntletFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const collected = yield* Stream.take(adapter.streamEvents, 5).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* scriptTurn(runtime, threadId, asTurnId("turn-g3"), [
        {
          type: "tool_execution_start",
          toolCallId: "call-grep-1",
          toolName: "grep",
          args: { pattern: "GAUNTLET-SEARCH-HIT", path: "fixtures/" },
        },
        {
          type: "tool_execution_end",
          toolCallId: "call-grep-1",
          toolName: "grep",
          result: "bravo-note.txt:1: bravo fixture — GAUNTLET-SEARCH-HIT lives here",
        },
        assistantEnd("one match in bravo-note.txt"),
      ]);
      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["turn.started", "item.started", "item.completed", "item.completed", "turn.completed"],
      );
      const toolCompleted = events[2] as ProviderRuntimeEvent;
      NodeAssert.ok(toolCompleted.type === "item.completed");
      NodeAssert.equal(toolCompleted.payload.title, "grep");
      NodeAssert.ok(String(toolCompleted.payload.detail).includes("GAUNTLET-SEARCH-HIT"));
      const assistant = events[3] as ProviderRuntimeEvent;
      NodeAssert.ok(assistant.type === "item.completed");
      NodeAssert.equal(assistant.payload.detail, "one match in bravo-note.txt");
    }),
  );

  it.effect("gauntlet 4: a long-running tool streams 25 ordered progress updates", () =>
    Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-gauntlet-g4");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = gauntletFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const updates = Array.from({ length: 25 }, (_, index) => ({
        type: "tool_execution_update",
        toolCallId: "call-long-1",
        toolName: "bash",
        partialResult: `progress ${index + 1}/25`,
      }));
      // turn.started + item.started + 25 updates + tool completed + assistant + turn.completed
      const collected = yield* Stream.take(adapter.streamEvents, 30).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* scriptTurn(runtime, threadId, asTurnId("turn-g4"), [
        {
          type: "tool_execution_start",
          toolCallId: "call-long-1",
          toolName: "bash",
          args: { command: "long-running gauntlet progress loop" },
        },
        ...updates,
        { type: "tool_execution_end", toolCallId: "call-long-1", toolName: "bash", result: "progress 25/25 done" },
        assistantEnd("long-running tool finished after 25 updates"),
      ]);
      const events = yield* Fiber.join(collected);
      NodeAssert.equal(events.length, 30);
      const types = events.map((event) => event.type);
      NodeAssert.equal(types[0], "turn.started");
      NodeAssert.equal(types[1], "item.started");
      NodeAssert.deepStrictEqual(
        types.slice(2, 27),
        Array.from({ length: 25 }, () => "item.updated"),
      );
      NodeAssert.deepStrictEqual(types.slice(27), ["item.completed", "item.completed", "turn.completed"]);
      // No state corruption: every tool event belongs to the single call.
      const toolEvents = events.filter(isToolEvent);
      NodeAssert.equal(toolEvents.length, 27);
      for (const event of toolEvents) {
        NodeAssert.equal(event.itemId, "pi-tool:call-long-1");
      }
      const toolCompletions = toolEvents.filter((event) => event.type === "item.completed");
      NodeAssert.equal(toolCompletions.length, 1);
      NodeAssert.equal(toolCompletions[0]?.payload.detail, "progress 25/25 done");
      const assistant = events[28] as ProviderRuntimeEvent;
      NodeAssert.ok(assistant.type === "item.completed");
      NodeAssert.equal(assistant.payload.detail, "long-running tool finished after 25 updates");
    }),
  );

  it.effect("gauntlet 5: a failing tool renders a failed item and text still lands", () =>
    Effect.gen(function* () {
      // Same pinned contract as ToolCompat scenario 4, exercised with the
      // read-a-missing-file shape the live gauntlet uses.
      const adapter = yield* PiAdapter;
      const threadId = asThreadId("pi-gauntlet-g5");
      yield* drainStartupEvents(adapter, threadId);
      const runtime = gauntletFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const collected = yield* Stream.take(adapter.streamEvents, 5).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* scriptTurn(runtime, threadId, asTurnId("turn-g5"), [
        {
          type: "tool_execution_start",
          toolCallId: "call-fail-1",
          toolName: "read",
          args: { path: "fixtures/does-not-exist.txt" },
        },
        {
          type: "tool_execution_end",
          toolCallId: "call-fail-1",
          toolName: "read",
          result: "ENOENT: no such file or directory, open 'fixtures/does-not-exist.txt'",
          isError: true,
        },
        assistantEnd("the read failed with ENOENT, reporting the error"),
      ]);
      const events = yield* Fiber.join(collected);
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["turn.started", "item.started", "item.completed", "item.completed", "turn.completed"],
      );
      const toolCompleted = events[2] as ProviderRuntimeEvent;
      NodeAssert.ok(toolCompleted.type === "item.completed");
      NodeAssert.equal(toolCompleted.payload.status, "failed");
      NodeAssert.ok(String(toolCompleted.payload.detail).includes("ENOENT"));
      const assistant = events[3] as ProviderRuntimeEvent;
      NodeAssert.ok(assistant.type === "item.completed");
      NodeAssert.equal(assistant.payload.detail, "the read failed with ENOENT, reporting the error");
      const turnCompleted = events[4] as ProviderRuntimeEvent;
      NodeAssert.ok(turnCompleted.type === "turn.completed");
      NodeAssert.deepStrictEqual(turnCompleted.payload, { state: "completed", stopReason: null });
    }),
  );

  it.effect(
    "gauntlet 6: a destructive out-of-set tool is refused visibly, never silently",
    () =>
      Effect.gen(function* () {
        // Enforcement story (honest): the destructive tool is never executed
        // because it is not registered anywhere — pi dispatches only its own
        // registered tools, and the Meridian route additionally blocks SDK
        // builtins upstream. What this layer must guarantee is that a refusal
        // reaching us is VISIBLE (failed dynamic_tool_call item) and that a
        // turn with no assistant text afterwards fails LOUDLY (#402 guard) —
        // silent success is unrepresentable.
        const adapter = yield* PiAdapter;
        const threadId = asThreadId("pi-gauntlet-g6");
        yield* drainStartupEvents(adapter, threadId);
        const runtime = gauntletFactory.lastRuntime;
        NodeAssert.ok(runtime);
        const collected = yield* Stream.take(adapter.streamEvents, 5).pipe(
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* scriptTurn(runtime, threadId, asTurnId("turn-g6"), [
          {
            type: "tool_execution_start",
            toolCallId: "call-forbidden-1",
            toolName: "delete_everything",
            args: { path: "/" },
          },
          {
            type: "tool_execution_end",
            toolCallId: "call-forbidden-1",
            toolName: "delete_everything",
            result: "tool delete_everything is not registered in this harness; refused before execution",
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
        NodeAssert.equal(toolCompleted.itemId, "pi-tool:call-forbidden-1");
        NodeAssert.equal(toolCompleted.payload.title, "delete_everything");
        NodeAssert.equal(toolCompleted.payload.status, "failed");
        NodeAssert.ok(String(toolCompleted.payload.detail).includes("refused before execution"));
        const loudError = events[3] as ProviderRuntimeEvent;
        NodeAssert.ok(loudError.type === "runtime.error");
        NodeAssert.ok(loudError.payload.message.includes("no output"));
        const turnCompleted = events[4] as ProviderRuntimeEvent;
        NodeAssert.ok(turnCompleted.type === "turn.completed");
        NodeAssert.equal(turnCompleted.payload.state, "failed");
      }),
  );
});

// ---------------------------------------------------------------------------
// Gauntlet 7 — the idempotent-write instrument (real double invocation)
// ---------------------------------------------------------------------------

const INSTRUMENT_SOURCE =
  "/Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/_meta/gauntlet/idempotent-write.mts";

function resolveEsbuild(): string {
  const candidates = [
    NodePath.resolve(process.cwd(), "node_modules/.bin/esbuild"),
    NodePath.resolve(process.cwd(), "../../node_modules/.bin/esbuild"),
  ];
  for (const candidate of candidates) {
    if (NodeFS.existsSync(candidate)) return candidate;
  }
  throw new Error(`esbuild binary not found in: ${candidates.join(", ")}`);
}

interface InstrumentRun {
  readonly operationId: string;
  readonly outcome: "effect-created" | "duplicate-noop";
  readonly attempts: number;
  readonly effects: number;
}

describe("Pi harness tool gauntlet (shape 7, idempotent-write instrument)", () => {
  it(
    "gauntlet 7: duplicate idempotent-write invocations cause one durable effect",
    () => {
      // Copy the instrument out of the vault so the test NEVER writes into
      // the real gauntlet folder, then run it as separate real processes —
      // the same way the live gauntlet's bash tool invokes it.
      const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-gauntlet-idem-"));
      try {
        const source = NodeFS.readFileSync(INSTRUMENT_SOURCE, "utf8");
        NodeAssert.ok(!source.includes("Bearer "), "instrument source must not carry credentials");
        const mtsPath = NodePath.join(dir, "idempotent-write.mts");
        NodeFS.writeFileSync(mtsPath, source);
        const mjsPath = NodePath.join(dir, "idempotent-write.mjs");
        NodeChildProcess.execFileSync(resolveEsbuild(), [
          mtsPath,
          "--format=esm",
          "--platform=node",
          `--outfile=${mjsPath}`,
        ]);
        const invoke = (operationId: string): InstrumentRun =>
          JSON.parse(
            NodeChildProcess
              .execFileSync(process.execPath, [mjsPath, operationId], { cwd: dir })
              .toString()
              .trim(),
          ) as InstrumentRun;

        // Duplicate / replayed invocation with the SAME operationId.
        const first = invoke("GAUNT-op-1");
        const replay = invoke("GAUNT-op-1");
        expect(first.outcome).toBe("effect-created");
        expect(replay.outcome).toBe("duplicate-noop");
        expect(replay.attempts).toBe(2);
        expect(replay.effects).toBe(1);

        // A DIFFERENT operationId still creates its own single effect.
        const second = invoke("GAUNT-op-2");
        expect(second.outcome).toBe("effect-created");
        expect(second.effects).toBe(1);

        // Durable truth on disk: 3 attempts ledgered, exactly 2 effect files.
        const ledger = JSON.parse(
          NodeFS.readFileSync(NodePath.join(dir, "Side-Effect-Ledger.json"), "utf8"),
        ) as Array<{ operationId: string; outcome: string }>;
        expect(ledger).toHaveLength(3);
        expect(ledger.filter((entry) => entry.outcome === "effect-created")).toHaveLength(2);
        const writes = NodeFS.readdirSync(NodePath.join(dir, "writes")).sort();
        expect(writes).toEqual(["GAUNT-op-1.txt", "GAUNT-op-2.txt"]);
      } finally {
        NodeFS.rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// Gauntlet 8 — restart replay across a FRESH adapter instance (pinned truth)
// ---------------------------------------------------------------------------

describe("Pi harness tool gauntlet (shape 8, restart replay)", () => {
  it.effect("gauntlet 8: a fresh adapter re-emits a replayed end frame (per-process dedupe pinned)", () =>
    Effect.gen(function* () {
      const threadId = asThreadId("pi-gauntlet-g8");
      const turnId = asTurnId("turn-g8");

      // ----- Phase 1: original process — one tool call completes exactly once.
      const factoryA = makeRuntimeFactory();
      const phaseA = Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        yield* drainStartupEvents(adapter, threadId);
        const runtime = factoryA.lastRuntime;
        NodeAssert.ok(runtime);
        const collected = yield* Stream.take(adapter.streamEvents, 5).pipe(
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* scriptTurn(runtime, threadId, turnId, [
          { type: "tool_execution_start", toolCallId: "call-r8", toolName: "dummy_echo", args: { text: "pre-restart" } },
          { type: "tool_execution_end", toolCallId: "call-r8", toolName: "dummy_echo", result: "pre-restart" },
          assistantEnd("landed before the restart"),
        ]);
        const events = yield* Fiber.join(collected);
        const completions = events.filter(isToolEvent).filter((event) => event.type === "item.completed");
        NodeAssert.equal(completions.length, 1);
        return events.length;
      }).pipe(Effect.provide(makeAdapterLayer(factoryA)));
      yield* phaseA;

      // ----- Phase 2: FRESH adapter ("server restarted"), same thread/turn ids,
      // pi replays the already-completed end frame.
      const factoryB = makeRuntimeFactory();
      const phaseB = Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        yield* drainStartupEvents(adapter, threadId);
        const runtime = factoryB.lastRuntime;
        NodeAssert.ok(runtime);
        const collected = yield* Stream.take(adapter.streamEvents, 1).pipe(
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* runtime.emit({
          kind: "rpc-event",
          threadId,
          turnId,
          payload: {
            type: "tool_execution_end",
            toolCallId: "call-r8",
            toolName: "dummy_echo",
            result: "pre-restart",
          },
        } as PiRuntimeEvent);
        const events = yield* Fiber.join(collected);
        return events;
      }).pipe(Effect.provide(makeAdapterLayer(factoryB)));
      const replayEvents = yield* phaseB;

      // PINNED TRUTH: the fresh process has no per-turn dedupe memory, so the
      // replayed end frame maps AGAIN as an item.completed at this layer.
      // Cross-restart exactly-once for durable SIDE EFFECTS is owned by the
      // operationId instrument (gauntlet 7) — event-layer dedupe is per
      // process by design; do not add cross-restart state here.
      NodeAssert.equal(replayEvents.length, 1);
      const replayed = replayEvents[0] as ProviderRuntimeEvent;
      NodeAssert.ok(replayed.type === "item.completed");
      NodeAssert.equal(replayed.itemId, "pi-tool:call-r8");
      NodeAssert.equal(replayed.payload.itemType, "dynamic_tool_call");
    }),
  );
});

// ---------------------------------------------------------------------------
// Gauntlet 9/10 — probe retry: wake-from-idle false negative (regression)
// ---------------------------------------------------------------------------
// Live defect 2026-07-06 (events 4634-4636): after hours of machine idle the
// FIRST /health probe attempt exceeded PROBE_TIMEOUT_MS during wake
// (page-ins/App Nap) and the guard failed closed + cached the negative —
// while Meridian (pid 15276, up since 03:51:44) answered 200 in 1.2s moments
// later. The fix retries exactly once; a real outage still fails both
// attempts, so fail-closed is preserved.

describe("Pi harness tool gauntlet (probe retry, wake-from-idle regression)", () => {
  it.effect("gauntlet 9: a first-attempt probe timeout recovers on the single retry", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      let attempts = 0;
      const guard = makePiMeridianRouteGuard(fileSystem, {
        configPath: greenMeridianConfigPath,
        probe: () =>
          Effect.sync(() => {
            attempts += 1;
            return attempts >= 2; // first attempt "times out", second answers ok
          }),
        probeRetryDelayMs: 0,
        probeCacheTtlMs: 60_000,
      });
      yield* guard.guardAnthropicTurn("anthropic/claude-test");
      NodeAssert.equal(attempts, 2);
      // The POSITIVE result is cached as before: the next turn does not re-probe.
      yield* guard.guardAnthropicTurn("anthropic/claude-test");
      NodeAssert.equal(attempts, 2);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "gauntlet 10: both probe attempts failing still fails closed with the seam-naming error",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        let attempts = 0;
        const guard = makePiMeridianRouteGuard(fileSystem, {
          configPath: greenMeridianConfigPath,
          probe: () =>
            Effect.sync(() => {
              attempts += 1;
              return false; // genuinely down: both attempts fail
            }),
          probeRetryDelayMs: 0,
          probeCacheTtlMs: 60_000,
        });
        const error = yield* guard.guardAnthropicTurn("anthropic/claude-test").pipe(Effect.flip);
        NodeAssert.equal(attempts, 2);
        NodeAssert.equal(error.reason, "unreachable");
        NodeAssert.ok(error.detail.includes("Meridian is down or unreachable"));
        NodeAssert.ok(error.detail.includes("no Pi native Anthropic OAuth fallback"));
        // The NEGATIVE result is cached only AFTER the retry also failed —
        // a further turn hits the cache without probing again (still closed).
        const cachedError = yield* guard.guardAnthropicTurn("anthropic/claude-test").pipe(Effect.flip);
        NodeAssert.equal(cachedError.reason, "unreachable");
        NodeAssert.equal(attempts, 2);
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});

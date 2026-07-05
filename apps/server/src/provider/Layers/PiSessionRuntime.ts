/**
 * PiSessionRuntime — owns one Pi RPC child process and its stdio protocol.
 *
 * Spawns the configured Pi binary in `--mode rpc`, writes newline-delimited
 * JSON commands to stdin, and parses newline-delimited JSON replies/events
 * from stdout. Replies carry `type: "response"` and correlate to commands by
 * `id`; everything else on stdout is a turn event that is re-emitted on the
 * runtime's event stream for the adapter to map into canonical
 * `ProviderRuntimeEvent`s.
 *
 * Lifecycle rules (pingdotgg/t3code#402):
 *   - full-access only: any other runtime mode is rejected up front rather
 *     than silently running without approval semantics.
 *   - every failure path cleans up fully — the child is owned by the Scope
 *     this runtime was created in, `close` ends stdin and SIGTERMs the child,
 *     and process exit fails every pending command. No half-initialized
 *     sessions.
 *   - availability respects the CONFIGURED binary path; nothing assumes `pi`
 *     on PATH.
 *
 * @module provider/Layers/PiSessionRuntime
 */
import {
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderSession,
  type ProviderTurnStartResult,
  type RuntimeMode,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const PROVIDER = ProviderDriverKind.make("pi");
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const DISCOVERY_TIMEOUT_MS = 15_000;

/** Pi's own thinking levels (provider-native — never invented server-side). */
export const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

export function normalizePiThinkingLevel(value: unknown): PiThinkingLevel | undefined {
  return typeof value === "string" && (PI_THINKING_LEVELS as ReadonlyArray<string>).includes(value)
    ? (value as PiThinkingLevel)
    : undefined;
}

/**
 * PiSessionRuntimeError — any failure in the Pi RPC session lifecycle
 * (spawn, protocol request, timeout, unexpected exit).
 */
export class PiSessionRuntimeError extends Schema.TaggedErrorClass<PiSessionRuntimeError>()(
  "PiSessionRuntimeError",
  {
    operation: Schema.String,
    threadId: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Pi session runtime error in ${this.operation} for thread ${this.threadId}: ${this.detail}`;
  }
}

type PiRpcCommand =
  | { readonly type: "get_state" }
  | { readonly type: "get_available_models" }
  | {
      readonly type: "prompt";
      readonly message: string;
      readonly images?: ReadonlyArray<PiPromptImage>;
    }
  | { readonly type: "abort" }
  | { readonly type: "switch_session"; readonly sessionPath: string }
  | { readonly type: "set_model"; readonly provider: string; readonly modelId: string }
  | { readonly type: "set_thinking_level"; readonly level: PiThinkingLevel };

export interface PiPromptImage {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

interface PiRpcResponse {
  readonly id?: string;
  readonly type: "response";
  readonly command: string;
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

export type PiRpcEventPayload = Record<string, unknown> & { readonly type: string };

/** Raw runtime events the adapter maps into canonical runtime events. */
export type PiRuntimeEvent =
  | {
      readonly kind: "rpc-event";
      readonly threadId: ThreadId;
      readonly turnId?: TurnId;
      readonly model?: string;
      readonly payload: PiRpcEventPayload;
    }
  | {
      readonly kind: "stderr";
      readonly threadId: ThreadId;
      readonly turnId?: TurnId;
      readonly line: string;
    }
  | {
      readonly kind: "stdout-parse-error";
      readonly threadId: ThreadId;
      readonly line: string;
    }
  | {
      readonly kind: "exit";
      readonly threadId: ThreadId;
      readonly turnId?: TurnId;
      readonly code: number | null;
      readonly expected: boolean;
    };

export interface PiSessionRuntimeOptions {
  readonly threadId: ThreadId;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly binaryPath: string;
  readonly sessionDir?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly runtimeMode: RuntimeMode;
  readonly model?: string;
  readonly thinkingLevel?: PiThinkingLevel;
  readonly resumeCursor?: unknown;
}

export interface PiSessionRuntimeSendTurnInput {
  readonly input?: string;
  readonly model?: string;
  readonly thinkingLevel?: PiThinkingLevel;
  readonly images?: ReadonlyArray<PiPromptImage>;
}

export interface PiThreadTurnSnapshot {
  readonly id: TurnId;
  readonly items: ReadonlyArray<unknown>;
}

export interface PiThreadSnapshot {
  readonly threadId: ThreadId;
  readonly turns: ReadonlyArray<PiThreadTurnSnapshot>;
}

export interface PiDiscoveredModel {
  readonly slug: string;
  readonly name: string;
}

export interface PiModelCatalog {
  readonly defaultModel: string | null;
  readonly models: ReadonlyArray<PiDiscoveredModel>;
}

export interface PiSessionRuntimeShape {
  readonly start: () => Effect.Effect<ProviderSession, PiSessionRuntimeError>;
  readonly getSession: Effect.Effect<ProviderSession>;
  readonly sendTurn: (
    input: PiSessionRuntimeSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, PiSessionRuntimeError>;
  readonly interruptTurn: (turnId?: TurnId) => Effect.Effect<void, PiSessionRuntimeError>;
  readonly readThread: Effect.Effect<PiThreadSnapshot, PiSessionRuntimeError>;
  readonly listAvailableModels: () => Effect.Effect<PiModelCatalog, PiSessionRuntimeError>;
  readonly events: Stream.Stream<PiRuntimeEvent>;
  readonly close: Effect.Effect<void>;
}

interface PiSessionState {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly cwd: string | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly model: string | undefined;
  readonly thinkingLevel: PiThinkingLevel | undefined;
  readonly resumeCursor: unknown;
  readonly sessionFile: string | undefined;
  readonly sessionId: string | undefined;
  readonly currentTurnId: TurnId | undefined;
  readonly hasObservedTurnStart: boolean;
  readonly status: ProviderSession["status"];
  readonly abortRequested: boolean;
  readonly stopping: boolean;
  readonly exited: boolean;
}

interface PiRpcStateResponse {
  readonly model?: Record<string, unknown> | null;
  readonly thinkingLevel?: string;
  readonly isStreaming?: boolean;
  readonly sessionFile?: string;
  readonly sessionId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parsePiModelSlug(
  value: string | null | undefined,
): { provider: string; modelId: string } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    return null;
  }
  return {
    provider: trimmed.slice(0, slashIndex),
    modelId: trimmed.slice(slashIndex + 1),
  };
}

function buildResumeCursor(input: {
  readonly cwd: string | undefined;
  readonly model: string | undefined;
  readonly state: PiRpcStateResponse | undefined;
}): Record<string, unknown> {
  const parsedModel = parsePiModelSlug(input.model);
  const thinkingLevel = normalizePiThinkingLevel(input.state?.thinkingLevel);
  return {
    ...(input.state?.sessionFile ? { sessionFile: input.state.sessionFile } : {}),
    ...(input.state?.sessionId ? { sessionId: input.state.sessionId } : {}),
    ...(parsedModel ? { modelProvider: parsedModel.provider, modelId: parsedModel.modelId } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
  };
}

function modelFromState(
  state: PiRpcStateResponse | undefined,
  fallback: string | undefined,
): string | undefined {
  const model = asRecord(state?.model);
  const provider = asString(model?.provider);
  const modelId = asString(model?.modelId) ?? asString(model?.id) ?? asString(model?.name);
  if (provider && modelId) {
    return `${provider}/${modelId}`;
  }
  return fallback;
}

function thinkingLevelFromState(
  state: PiRpcStateResponse | undefined,
  fallback: PiThinkingLevel | undefined,
): PiThinkingLevel | undefined {
  return normalizePiThinkingLevel(state?.thinkingLevel) ?? fallback;
}

function parseCatalogModel(value: unknown): PiDiscoveredModel | null {
  const record = asRecord(value);
  const provider = asString(record?.provider);
  const modelId = asString(record?.modelId) ?? asString(record?.id) ?? asString(record?.name);
  if (!provider || !modelId) {
    return null;
  }
  const slug = `${provider}/${modelId}`;
  const name = asString(record?.name) ?? modelId;
  return { slug, name };
}

function toModelCatalog(input: {
  readonly state: PiRpcStateResponse | undefined;
  readonly data: unknown;
}): PiModelCatalog {
  const response = asRecord(input.data);
  const rawModels = Array.isArray(response?.models) ? response.models : [];
  const models: PiDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const candidate of rawModels) {
    const model = parseCatalogModel(candidate);
    if (!model || seen.has(model.slug)) {
      continue;
    }
    seen.add(model.slug);
    models.push(model);
  }
  return {
    defaultModel: modelFromState(input.state, undefined) ?? null,
    models,
  };
}

export const makePiSessionRuntime = (
  options: PiSessionRuntimeOptions,
): Effect.Effect<
  PiSessionRuntimeShape,
  PiSessionRuntimeError,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    if (options.runtimeMode !== "full-access") {
      // #402: Pi has no approval protocol. Any mode that implies approval
      // gating would silently run unrestricted — reject instead of faking it.
      return yield* new PiSessionRuntimeError({
        operation: "session/start",
        threadId: options.threadId,
        detail: `Pi only supports runtimeMode 'full-access' (received '${options.runtimeMode}').`,
      });
    }

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const runtimeScope = yield* Scope.Scope;
    const crypto = yield* Crypto.Crypto;

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const randomUUIDv4 = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new PiSessionRuntimeError({
            operation: "crypto/randomUUIDv4",
            threadId: options.threadId,
            detail: "Failed to generate Pi runtime identifier.",
            cause,
          }),
      ),
    );

    const events = yield* Queue.unbounded<PiRuntimeEvent>();
    const stdinQueue = yield* Queue.unbounded<string>();
    const pending = new Map<
      string,
      {
        readonly command: string;
        readonly response: Deferred.Deferred<PiRpcResponse, PiSessionRuntimeError>;
      }
    >();

    const createdAt = yield* nowIso;
    const stateRef = yield* Ref.make<PiSessionState>({
      createdAt,
      updatedAt: createdAt,
      cwd: options.cwd,
      runtimeMode: options.runtimeMode,
      model: options.model,
      thinkingLevel: options.thinkingLevel,
      resumeCursor: options.resumeCursor,
      sessionFile: undefined,
      sessionId: undefined,
      currentTurnId: undefined,
      hasObservedTurnStart: false,
      status: "connecting",
      abortRequested: false,
      stopping: false,
      exited: false,
    });

    const emitEvent = (event: PiRuntimeEvent) => Queue.offer(events, event).pipe(Effect.asVoid);

    const turnsRef = yield* Ref.make<ReadonlyArray<PiThreadTurnSnapshot>>([]);

    const failAllPending = (error: PiSessionRuntimeError) =>
      Effect.gen(function* () {
        const entries = Array.from(pending.values());
        pending.clear();
        yield* Effect.forEach(entries, (entry) => Deferred.fail(entry.response, error), {
          discard: true,
        }).pipe(Effect.ignore);
      });

    const spawnArgs = [
      "--mode",
      "rpc",
      ...(options.sessionDir ? ["--session-dir", options.sessionDir] : []),
    ];
    const env = options.environment;
    const extendEnv = options.environment === undefined;
    const spawnCommand = yield* resolveSpawnCommand(options.binaryPath, spawnArgs, {
      ...(env ? { env } : {}),
      extendEnv,
    });
    const child = yield* spawner
      .spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(env ? { env } : {}),
          extendEnv,
          shell: spawnCommand.shell,
        }),
      )
      .pipe(
        Effect.provideService(Scope.Scope, runtimeScope),
        Effect.mapError(
          (cause) =>
            new PiSessionRuntimeError({
              operation: "session/spawn",
              threadId: options.threadId,
              detail: `Failed to spawn Pi RPC process (${options.binaryPath} --mode rpc).`,
              cause,
            }),
        ),
      );

    // Long-lived stdin writer: one stream from the queue into the stdin
    // sink. Shutting the queue down ends stdin (EOF for the child).
    yield* Stream.run(Stream.encodeText(Stream.fromQueue(stdinQueue)), child.stdin).pipe(
      Effect.ignore,
      Effect.forkIn(runtimeScope),
    );

    const handleResponse = (response: PiRpcResponse): Effect.Effect<void> =>
      Effect.suspend(() => {
        const id = response.id;
        if (!id) return Effect.void;
        const entry = pending.get(id);
        if (!entry) return Effect.void;
        pending.delete(id);
        if (!response.success) {
          return Deferred.fail(
            entry.response,
            new PiSessionRuntimeError({
              operation: `rpc/${entry.command}`,
              threadId: options.threadId,
              detail: response.error || `Pi RPC command '${entry.command}' failed.`,
            }),
          ).pipe(Effect.asVoid);
        }
        return Deferred.succeed(entry.response, response).pipe(Effect.asVoid);
      });

    const handleRpcEvent = (payload: PiRpcEventPayload): Effect.Effect<void> =>
      Effect.gen(function* () {
        const now = yield* nowIso;
        const state = yield* Ref.get(stateRef);
        const turnId = state.currentTurnId;
        if (payload.type === "turn_start") {
          const duplicateTurnStart = state.hasObservedTurnStart && turnId !== undefined;
          yield* Ref.update(stateRef, (current) => ({
            ...current,
            hasObservedTurnStart: true,
            status: "running" as const,
            updatedAt: now,
          }));
          if (duplicateTurnStart) {
            // Pi re-announces turn_start on multi-stage runs; suppress the
            // duplicate so the adapter never emits a second turn.started.
            return;
          }
        }
        if (payload.type === "agent_end") {
          if (turnId) {
            yield* Ref.update(turnsRef, (turns) => [...turns, { id: turnId, items: [] }]);
          }
          yield* Ref.update(stateRef, (current) => ({
            ...current,
            status: "ready" as const,
            abortRequested: false,
            hasObservedTurnStart: false,
            currentTurnId: undefined,
            updatedAt: now,
          }));
        }
        yield* emitEvent({
          kind: "rpc-event",
          threadId: options.threadId,
          ...(turnId ? { turnId } : {}),
          ...(state.model ? { model: state.model } : {}),
          payload,
        });
      });

    const handleStdoutLine = (line: string): Effect.Effect<void> =>
      Effect.suspend(() => {
        if (line.trim().length === 0) {
          return Effect.void;
        }
        let parsed: unknown;
        try {
          // @effect-diagnostics-next-line preferSchemaOverJson:off - Raw Pi RPC protocol boundary; each line is arbitrary JSON validated structurally downstream.
          parsed = JSON.parse(line) as unknown;
        } catch {
          return emitEvent({
            kind: "stdout-parse-error",
            threadId: options.threadId,
            line,
          });
        }
        const record = asRecord(parsed);
        if (!record || typeof record.type !== "string") {
          return Effect.void;
        }
        if (record.type === "response") {
          return handleResponse(record as unknown as PiRpcResponse);
        }
        return handleRpcEvent(record as PiRpcEventPayload);
      });

    const handleStderrLine = (line: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (line.trim().length === 0) {
          return;
        }
        const state = yield* Ref.get(stateRef);
        yield* emitEvent({
          kind: "stderr",
          threadId: options.threadId,
          ...(state.currentTurnId ? { turnId: state.currentTurnId } : {}),
          line,
        });
      });

    const runLineReader = (
      stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
      handleLine: (line: string) => Effect.Effect<void>,
    ) =>
      Effect.gen(function* () {
        const remainderRef = yield* Ref.make("");
        yield* stream.pipe(
          Stream.decodeText(),
          Stream.runForEach((chunk) =>
            Ref.modify(remainderRef, (current) => {
              const combined = current + chunk;
              const lines = combined.split("\n");
              const remainder = lines.pop() ?? "";
              return [lines.map((line) => line.replace(/\r$/, "")), remainder] as const;
            }).pipe(
              Effect.flatMap((lines) => Effect.forEach(lines, handleLine, { discard: true })),
            ),
          ),
        );
        const remainder = yield* Ref.get(remainderRef);
        if (remainder.length > 0) {
          yield* handleLine(remainder.replace(/\r$/, ""));
        }
      }).pipe(Effect.ignore);

    yield* runLineReader(child.stdout, handleStdoutLine).pipe(Effect.forkIn(runtimeScope));
    yield* runLineReader(child.stderr, handleStderrLine).pipe(Effect.forkIn(runtimeScope));

    // Exit watcher: fail every pending command, mark the session
    // closed/error, and emit an exit event so the adapter can clean up.
    yield* child.exitCode.pipe(
      Effect.map((code) => Number(code) as number | null),
      Effect.orElseSucceed(() => null as number | null),
      Effect.flatMap((code) =>
        Effect.gen(function* () {
          const now = yield* nowIso;
          const state = yield* Ref.get(stateRef);
          if (state.exited) {
            return;
          }
          const expected = state.stopping;
          yield* Ref.update(stateRef, (current) => ({
            ...current,
            status: (code === 0 || current.stopping ? "closed" : "error") as ProviderSession["status"],
            exited: true,
            updatedAt: now,
          }));
          yield* failAllPending(
            new PiSessionRuntimeError({
              operation: "session/exit",
              threadId: options.threadId,
              detail: `Pi RPC process exited (${code ?? "unknown"}).`,
            }),
          );
          yield* emitEvent({
            kind: "exit",
            threadId: options.threadId,
            ...(state.currentTurnId ? { turnId: state.currentTurnId } : {}),
            code,
            expected,
          });
        }),
      ),
      Effect.forkIn(runtimeScope),
    );

    const sendCommand = (
      command: PiRpcCommand,
      timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
    ): Effect.Effect<PiRpcResponse, PiSessionRuntimeError> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.exited || state.stopping) {
          return yield* new PiSessionRuntimeError({
            operation: `rpc/${command.type}`,
            threadId: options.threadId,
            detail: `Pi RPC session is ${state.exited ? "closed" : "stopping"}; cannot send '${command.type}'.`,
          });
        }
        const id = yield* randomUUIDv4;
        const response = yield* Deferred.make<PiRpcResponse, PiSessionRuntimeError>();
        pending.set(id, { command: command.type, response });
        // @effect-diagnostics-next-line preferSchemaOverJson:off - Wire encoding of the Pi RPC command envelope (newline-delimited JSON protocol).
        yield* Queue.offer(stdinQueue, `${JSON.stringify({ ...command, id })}\n`);
        const result = yield* Deferred.await(response).pipe(Effect.timeoutOption(timeoutMs));
        if (Option.isNone(result)) {
          pending.delete(id);
          return yield* new PiSessionRuntimeError({
            operation: `rpc/${command.type}`,
            threadId: options.threadId,
            detail: `Pi RPC command '${command.type}' timed out after ${timeoutMs}ms.`,
          });
        }
        return result.value;
      });

    const getState = sendCommand({ type: "get_state" }).pipe(
      Effect.map((response) => (asRecord(response.data) ?? {}) as PiRpcStateResponse),
    );

    const setModel = (model: string): Effect.Effect<void, PiSessionRuntimeError> =>
      Effect.gen(function* () {
        const parsedModel = parsePiModelSlug(model);
        if (!parsedModel) {
          return yield* new PiSessionRuntimeError({
            operation: "rpc/set_model",
            threadId: options.threadId,
            detail: `Pi models must use 'provider/modelId' format. Received '${model}'.`,
          });
        }
        yield* sendCommand({
          type: "set_model",
          provider: parsedModel.provider,
          modelId: parsedModel.modelId,
        });
        const now = yield* nowIso;
        yield* Ref.update(stateRef, (current) => ({ ...current, model, updatedAt: now }));
      });

    const setThinkingLevel = (
      thinkingLevel: PiThinkingLevel,
    ): Effect.Effect<void, PiSessionRuntimeError> =>
      Effect.gen(function* () {
        yield* sendCommand({ type: "set_thinking_level", level: thinkingLevel });
        const now = yield* nowIso;
        yield* Ref.update(stateRef, (current) => ({ ...current, thinkingLevel, updatedAt: now }));
      });

    const toProviderSession = (state: PiSessionState): ProviderSession => ({
      provider: PROVIDER,
      ...(options.providerInstanceId ? { providerInstanceId: options.providerInstanceId } : {}),
      status: state.status,
      runtimeMode: state.runtimeMode,
      ...(state.cwd ? { cwd: state.cwd } : {}),
      ...(state.model ? { model: state.model } : {}),
      threadId: options.threadId,
      ...(state.resumeCursor !== undefined ? { resumeCursor: state.resumeCursor } : {}),
      ...(state.currentTurnId ? { activeTurnId: state.currentTurnId } : {}),
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    });

    const start: PiSessionRuntimeShape["start"] = () =>
      Effect.gen(function* () {
        yield* getState;

        const resume = asRecord(options.resumeCursor);
        const resumeSessionFile = asString(resume?.sessionFile);
        if (resumeSessionFile) {
          const switchResponse = yield* sendCommand({
            type: "switch_session",
            sessionPath: resumeSessionFile,
          });
          const switchData = asRecord(switchResponse.data);
          if (switchData?.cancelled === true) {
            return yield* new PiSessionRuntimeError({
              operation: "rpc/switch_session",
              threadId: options.threadId,
              detail: "Pi session switch was cancelled.",
            });
          }
        }

        if (options.model) {
          yield* setModel(options.model);
        }
        if (options.thinkingLevel) {
          yield* setThinkingLevel(options.thinkingLevel);
        }

        const state = yield* getState;
        const now = yield* nowIso;
        const nextSession = yield* Ref.modify(stateRef, (current) => {
          const model = modelFromState(state, current.model);
          const next: PiSessionState = {
            ...current,
            sessionFile: state.sessionFile,
            sessionId: state.sessionId,
            model,
            thinkingLevel: thinkingLevelFromState(state, current.thinkingLevel),
            resumeCursor: buildResumeCursor({ cwd: current.cwd, model, state }),
            status: state.isStreaming ? "running" : "ready",
            updatedAt: now,
          };
          return [next, next] as const;
        });
        return toProviderSession(nextSession);
      });

    const getSession: PiSessionRuntimeShape["getSession"] = Ref.get(stateRef).pipe(
      Effect.map(toProviderSession),
    );

    const sendTurn: PiSessionRuntimeShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const initial = yield* Ref.get(stateRef);
        if (input.model && input.model !== initial.model) {
          yield* setModel(input.model);
        }
        if (input.thinkingLevel && input.thinkingLevel !== initial.thinkingLevel) {
          yield* setThinkingLevel(input.thinkingLevel);
        }

        const turnId = TurnId.make(yield* randomUUIDv4);
        const previous = yield* Ref.get(stateRef);
        const now = yield* nowIso;
        yield* Ref.update(stateRef, (current) => ({
          ...current,
          currentTurnId: turnId,
          hasObservedTurnStart: false,
          abortRequested: false,
          status: "running" as const,
          updatedAt: now,
        }));

        return yield* Effect.gen(function* () {
          yield* sendCommand({
            type: "prompt",
            message: input.input ?? "",
            ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
          });
          const state = yield* getState;
          const settledAt = yield* nowIso;
          const nextState = yield* Ref.modify(stateRef, (current) => {
            const model = modelFromState(state, current.model);
            const next: PiSessionState = {
              ...current,
              model,
              thinkingLevel: thinkingLevelFromState(state, current.thinkingLevel),
              resumeCursor: buildResumeCursor({ cwd: current.cwd, model, state }),
              updatedAt: settledAt,
            };
            return [next, next] as const;
          });
          return {
            threadId: options.threadId,
            turnId,
            ...(nextState.resumeCursor !== undefined
              ? { resumeCursor: nextState.resumeCursor }
              : {}),
          } satisfies ProviderTurnStartResult;
        }).pipe(
          Effect.tapError(() =>
            Effect.gen(function* () {
              const failedAt = yield* nowIso;
              yield* Ref.update(stateRef, (current) => ({
                ...current,
                currentTurnId: previous.currentTurnId,
                hasObservedTurnStart: previous.hasObservedTurnStart,
                abortRequested: previous.abortRequested,
                status: previous.status,
                updatedAt: failedAt,
              }));
            }),
          ),
        );
      });

    const interruptTurn: PiSessionRuntimeShape["interruptTurn"] = () =>
      Effect.gen(function* () {
        const now = yield* nowIso;
        yield* Ref.update(stateRef, (current) => ({
          ...current,
          abortRequested: true,
          updatedAt: now,
        }));
        yield* sendCommand({ type: "abort" });
      });

    const readThread: PiSessionRuntimeShape["readThread"] = Ref.get(turnsRef).pipe(
      Effect.map((turns) => ({ threadId: options.threadId, turns })),
    );

    const listAvailableModels: PiSessionRuntimeShape["listAvailableModels"] = () =>
      Effect.gen(function* () {
        const state = yield* getState;
        const response = yield* sendCommand({ type: "get_available_models" });
        return toModelCatalog({ state, data: response.data });
      });

    const close: PiSessionRuntimeShape["close"] = Effect.gen(function* () {
      const now = yield* nowIso;
      yield* Ref.update(stateRef, (current) => ({ ...current, stopping: true, updatedAt: now }));
      yield* failAllPending(
        new PiSessionRuntimeError({
          operation: "session/close",
          threadId: options.threadId,
          detail: "Pi RPC session is closing.",
        }),
      );
      yield* Queue.shutdown(stdinQueue);
      yield* child.kill().pipe(Effect.ignore);
    });

    return {
      start,
      getSession,
      sendTurn,
      interruptTurn,
      readThread,
      listAvailableModels,
      events: Stream.fromQueue(events),
      close,
    } satisfies PiSessionRuntimeShape;
  });

/**
 * discoverPiModels — provider-scoped, on-demand model discovery.
 *
 * Spawns a short-lived Pi RPC child, asks it for `get_state` +
 * `get_available_models`, and tears the child down. Used by the snapshot
 * enrich path so the model picker shows REAL models discovered from Pi
 * (#402: models come from Pi, never a hard-coded list). Never blocks the
 * health probe — callers run it forked with a timeout.
 */
export const discoverPiModels = (input: {
  readonly binaryPath: string;
  readonly sessionDir?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly cwd?: string;
}): Effect.Effect<
  PiModelCatalog,
  PiSessionRuntimeError,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const probeThreadId = ThreadId.make(
        yield* crypto.randomUUIDv4.pipe(
          Effect.mapError(
            (cause) =>
              new PiSessionRuntimeError({
                operation: "crypto/randomUUIDv4",
                threadId: "pi-model-discovery",
                detail: "Failed to generate Pi discovery identifier.",
                cause,
              }),
          ),
        ),
      );
      const runtime = yield* makePiSessionRuntime({
        threadId: probeThreadId,
        binaryPath: input.binaryPath,
        ...(input.sessionDir ? { sessionDir: input.sessionDir } : {}),
        ...(input.environment ? { environment: input.environment } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
        runtimeMode: "full-access",
      });
      const catalog = yield* runtime.listAvailableModels().pipe(
        Effect.timeoutOption(DISCOVERY_TIMEOUT_MS),
      );
      yield* runtime.close;
      if (Option.isNone(catalog)) {
        return yield* new PiSessionRuntimeError({
          operation: "models/discover",
          threadId: probeThreadId,
          detail: `Pi model discovery timed out after ${DISCOVERY_TIMEOUT_MS}ms.`,
        });
      }
      return catalog.value;
    }),
  );

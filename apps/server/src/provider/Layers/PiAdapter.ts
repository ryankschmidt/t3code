/**
 * PiAdapter — `ProviderAdapterShape` implementation for the Pi provider.
 *
 * Wraps one `PiSessionRuntime` per thread and maps the Pi RPC event
 * vocabulary onto canonical `ProviderRuntimeEvent`s:
 *
 *   - `turn_start`            → `turn.started` (duplicates suppressed by the runtime)
 *   - `message_update`        → `content.delta` (`assistant_text` / `reasoning_text`)
 *   - `message_end`           → `item.completed` ONLY when the assistant
 *                               message carries user-visible text — the #402
 *                               empty-assistant guard: tool/planning-only
 *                               stages must never render as empty messages
 *   - `tool_execution_start`  → `item.started` (`dynamic_tool_call`)
 *   - `tool_execution_update` → `item.updated`
 *   - `tool_execution_end`    → `item.completed` (status failed on isError)
 *   - `turn_end`              → late assistant completion when the real
 *                               answer lands at turn end (multi-stage runs)
 *   - `agent_end`             → `turn.completed` (interrupted when aborted)
 *   - runtime exit            → `session.exited` (expected) or
 *                               `runtime.error` (unexpected) + state cleanup
 *   - stderr                  → `runtime.warning` (bounded message size)
 *
 * Approval/user-input/rollback surfaces fail with honest "not supported by
 * the Pi provider" errors — Pi is full-access only for v1 (#402: no fake
 * approval semantics).
 *
 * @module provider/Layers/PiAdapter
 */
import {
  EventId,
  type PiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type RuntimeItemStatus,
  RuntimeItemId,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { type ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import {
  isAnthropicFamilyPiModel,
  makePiMeridianRouteGuard,
  type PiMeridianRouteGuardOptions,
  piRouteFamilyForModel,
} from "./PiMeridianRoute.ts";
import {
  makePiSessionRuntime,
  normalizePiThinkingLevel,
  type PiPromptImage,
  type PiRuntimeEvent,
  type PiSessionRuntimeError,
  type PiSessionRuntimeOptions,
  type PiSessionRuntimeShape,
} from "./PiSessionRuntime.ts";

const PROVIDER = ProviderDriverKind.make("pi");
const STDERR_WARNING_MAX_CHARS = 2_000;

export interface PiAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly makeRuntime?: (
    options: PiSessionRuntimeOptions,
  ) => Effect.Effect<
    PiSessionRuntimeShape,
    PiSessionRuntimeError,
    ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
  >;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
  /**
   * Meridian seam guard overrides (tests). Production uses the defaults:
   * `~/.pi/agent/models.json` + a GET /health probe against the configured
   * loopback Meridian endpoint.
   */
  readonly meridianRoute?: PiMeridianRouteGuardOptions;
}

interface PiAdapterSessionContext {
  readonly threadId: ThreadId;
  readonly scope: Scope.Closeable;
  readonly runtime: PiSessionRuntimeShape;
  readonly eventFiber: Fiber.Fiber<void, never>;
  stopped: boolean;
  /**
   * The session's current Pi model slug as last observed by the adapter
   * (start result / turn results). Lets the Meridian seam guard classify a
   * turn's EFFECTIVE model when the turn carries no explicit selection.
   */
  currentModel: string | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function summarizeUnknown(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return undefined;
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized.length > 0 ? serialized : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Collects user-visible text fragments from a Pi assistant message.
 * Thinking / redacted-thinking blocks are intentionally excluded — they are
 * not user-visible answer text and must not defeat the empty-assistant guard.
 */
function collectPiTextFragments(value: unknown): string[] {
  if (typeof value === "string") {
    return value.length > 0 ? [value] : [];
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPiTextFragments(entry));
  }

  const record = value as Record<string, unknown>;
  if (record.type === "text") {
    const text = asString(record.text);
    return text && text.length > 0 ? [text] : [];
  }
  if (record.type === "thinking" || record.type === "redacted_thinking") {
    return [];
  }
  if ("content" in record) {
    return collectPiTextFragments(record.content);
  }
  return [];
}

export function extractPiAssistantText(message: unknown): string | undefined {
  const record = asRecord(message);
  if (!record) {
    const direct = summarizeUnknown(message);
    return direct === "[]" || direct === "{}" ? undefined : direct;
  }

  const content = collectPiTextFragments(record.content);
  if (content.length > 0) {
    const text = content.join("");
    return text.trim().length > 0 ? text : undefined;
  }

  const directText = asString(record.text);
  if (directText?.trim()) {
    return directText;
  }
  return undefined;
}

function hasVisibleAssistantText(message: unknown): boolean {
  return extractPiAssistantText(message) !== undefined;
}

/**
 * Extracts the upstream provider-error text from a pi assistant message.
 * pi marks provider/transport failures with `stopReason: "error"` and puts
 * the REAL upstream failure text (Meridian / Claude Code SDK / provider API
 * error) in `errorMessage`. Returns undefined for non-error messages; user
 * aborts use `stopReason: "aborted"` and are not provider failures.
 */
function piProviderErrorText(message: unknown): string | undefined {
  const record = asRecord(message);
  if (!record || asString(record.role) !== "assistant") {
    return undefined;
  }
  if (asString(record.stopReason) !== "error") {
    return undefined;
  }
  const text = asString(record.errorMessage)?.trim();
  return text && text.length > 0 ? text : undefined;
}

function assistantTurnKey(threadId: ThreadId, turnId?: TurnId): string {
  return `${threadId}:${turnId ?? "session"}`;
}

function assistantItemId(threadId: ThreadId, turnId?: TurnId): string {
  return `pi-assistant:${threadId}:${turnId ?? "session"}`;
}

function toolItemId(toolCallId: unknown, toolName: unknown): string {
  const suffix = asString(toolCallId) ?? asString(toolName) ?? "unknown";
  return `pi-tool:${suffix}`;
}

function piModelFromResumeCursor(resumeCursor: unknown): string | undefined {
  const resume = asRecord(resumeCursor);
  const provider = asString(resume?.modelProvider);
  const modelId = asString(resume?.modelId);
  return provider && modelId ? `${provider}/${modelId}` : undefined;
}

function piThinkingLevelFromResumeCursor(resumeCursor: unknown): string | undefined {
  return asString(asRecord(resumeCursor)?.thinkingLevel);
}

function toRequestError(
  threadId: ThreadId,
  method: string,
  cause: PiSessionRuntimeError,
): ProviderAdapterError {
  const normalized = cause.detail.toLowerCase();
  if (normalized.includes("is closed") || normalized.includes("is stopping")) {
    return new ProviderAdapterSessionNotFoundError({
      provider: PROVIDER,
      threadId,
      cause,
    });
  }
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: cause.message,
    cause,
  });
}

export const makePiAdapter = Effect.fn("makePiAdapter")(function* (
  piSettings: PiSettings,
  options?: PiAdapterLiveOptions,
) {
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("pi");
  const fileSystem = yield* FileSystem.FileSystem;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const serverConfig = yield* Effect.service(ServerConfig);
  const nativeEventLogger =
    options?.nativeEventLogger ??
    (options?.nativeEventLogPath !== undefined
      ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" })
      : undefined);
  const managedNativeEventLogger =
    options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;

  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<ThreadId, PiAdapterSessionContext>();
  /** threadId → aborting turn id ("*" = any turn). */
  const abortingTurnIds = new Map<ThreadId, string>();
  /** Turn keys whose assistant message already completed (dedupes turn_end). */
  const completedAssistantTurns = new Set<string>();
  /**
   * Turn keys → upstream provider-error text (assistant `stopReason:
   * "error"`). Lets agent_end fail the completion with the REAL upstream
   * message instead of the generic zero-output text, and dedupes the error
   * activity across stream/message_end/turn_end sightings of one failure.
   */
  const turnProviderErrors = new Map<string, string>();

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const randomUUIDv4 = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "crypto/randomUUIDv4",
          detail: "Failed to generate Pi runtime identifier.",
          cause,
        }),
    ),
  );

  const makeEventBase = (input: {
    readonly threadId: ThreadId;
    readonly turnId?: TurnId | undefined;
    readonly itemId?: string | undefined;
  }) =>
    Effect.gen(function* () {
      const eventId = EventId.make(yield* randomUUIDv4);
      const createdAt = yield* nowIso;
      return {
        eventId,
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: input.threadId,
        createdAt,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        ...(input.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
      } as const;
    });

  const toolLifecycleEvent = (input: {
    readonly type: "item.started" | "item.updated" | "item.completed";
    readonly threadId: ThreadId;
    readonly turnId: TurnId | undefined;
    readonly toolCallId?: unknown;
    readonly toolName?: unknown;
    readonly detail?: unknown;
    readonly data?: unknown;
    readonly status: RuntimeItemStatus;
  }): Effect.Effect<ProviderRuntimeEvent, ProviderAdapterRequestError> =>
    Effect.gen(function* () {
      const base = yield* makeEventBase({
        threadId: input.threadId,
        turnId: input.turnId,
        itemId: toolItemId(input.toolCallId, input.toolName),
      });
      const title = asString(input.toolName)?.trim() || "Tool call";
      const detail = summarizeUnknown(input.detail);
      return {
        ...base,
        type: input.type,
        payload: {
          itemType: "dynamic_tool_call",
          status: input.status,
          title,
          ...(detail ? { detail } : {}),
          ...(input.data !== undefined ? { data: input.data } : {}),
        },
      } satisfies ProviderRuntimeEvent;
    });

  const completeAssistantMessageEvent = (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId | undefined;
    readonly message: unknown;
  }): Effect.Effect<ProviderRuntimeEvent, ProviderAdapterRequestError> =>
    Effect.gen(function* () {
      const base = yield* makeEventBase({
        threadId: input.threadId,
        turnId: input.turnId,
        itemId: assistantItemId(input.threadId, input.turnId),
      });
      const assistantText = extractPiAssistantText(input.message);
      return {
        ...base,
        type: "item.completed",
        payload: {
          itemType: "assistant_message",
          status: "completed",
          title: "Assistant message",
          ...(assistantText ? { detail: assistantText } : {}),
          data: input.message,
        },
      } satisfies ProviderRuntimeEvent;
    });

  /**
   * Maps one raw Pi runtime event to zero or more canonical runtime events.
   * Salvaged from the reference PiAdapter with payload shapes verified
   * against `packages/contracts/src/providerRuntime.ts`.
   */
  const mapPiRuntimeEvent = (
    event: PiRuntimeEvent,
  ): Effect.Effect<ReadonlyArray<ProviderRuntimeEvent>, ProviderAdapterRequestError> =>
    Effect.gen(function* () {
      switch (event.kind) {
        case "stderr": {
          const trimmed = event.line.trim();
          const message = (trimmed || "Pi RPC stderr output").slice(0, STDERR_WARNING_MAX_CHARS);
          const base = yield* makeEventBase({
            threadId: event.threadId,
            turnId: event.turnId,
          });
          return [
            {
              ...base,
              type: "runtime.warning",
              payload: { message },
            } satisfies ProviderRuntimeEvent,
          ];
        }
        case "stdout-parse-error": {
          const base = yield* makeEventBase({ threadId: event.threadId });
          return [
            {
              ...base,
              type: "runtime.warning",
              payload: {
                message: "Pi RPC emitted malformed JSON.",
                detail: { line: event.line.slice(0, STDERR_WARNING_MAX_CHARS) },
              },
            } satisfies ProviderRuntimeEvent,
          ];
        }
        case "exit": {
          abortingTurnIds.delete(event.threadId);
          completedAssistantTurns.delete(assistantTurnKey(event.threadId, event.turnId));
          turnProviderErrors.delete(assistantTurnKey(event.threadId, event.turnId));
          const base = yield* makeEventBase({
            threadId: event.threadId,
            turnId: event.turnId,
          });
          if (event.expected) {
            return [
              {
                ...base,
                type: "session.exited",
                payload: {
                  reason: "Pi session stopped",
                  recoverable: true,
                  exitKind: "graceful",
                },
              } satisfies ProviderRuntimeEvent,
            ];
          }
          return [
            {
              ...base,
              type: "runtime.error",
              payload: {
                message: `Pi RPC process exited unexpectedly (${event.code ?? "unknown"}).`,
                class: "transport_error",
              },
            } satisfies ProviderRuntimeEvent,
          ];
        }
        case "rpc-event": {
          const payload = event.payload;
          switch (payload.type) {
            case "turn_start": {
              abortingTurnIds.delete(event.threadId);
              completedAssistantTurns.delete(assistantTurnKey(event.threadId, event.turnId));
              turnProviderErrors.delete(assistantTurnKey(event.threadId, event.turnId));
              const base = yield* makeEventBase({
                threadId: event.threadId,
                turnId: event.turnId,
              });
              // Route-family diagnostic (Meridian seam patch, Task 5): every
              // turn start names its transport route — `openai-native-pi`
              // (Pi native auth) or `anthropic-meridian-claude-code-sdk`
              // (Meridian → official Claude Code SDK). Omitted only when the
              // model is unknown; never guessed.
              const routeFamily = piRouteFamilyForModel(event.model);
              return [
                {
                  ...base,
                  type: "turn.started",
                  payload: {
                    ...(event.model ? { model: event.model } : {}),
                    ...(routeFamily ? { routeFamily } : {}),
                  },
                } satisfies ProviderRuntimeEvent,
              ];
            }
            case "message_update": {
              const assistantMessageEvent = asRecord(payload.assistantMessageEvent);
              const assistantType = asString(assistantMessageEvent?.type);
              if (assistantType === "text_delta" || assistantType === "thinking_delta") {
                const delta = asString(assistantMessageEvent?.delta);
                if (!delta) {
                  return [];
                }
                const base = yield* makeEventBase({
                  threadId: event.threadId,
                  turnId: event.turnId,
                  itemId: assistantItemId(event.threadId, event.turnId),
                });
                return [
                  {
                    ...base,
                    type: "content.delta",
                    payload: {
                      streamKind:
                        assistantType === "text_delta" ? "assistant_text" : "reasoning_text",
                      delta,
                    },
                  } satisfies ProviderRuntimeEvent,
                ];
              }
              if (assistantType === "error") {
                if (asString(assistantMessageEvent?.reason) === "aborted") {
                  // User abort, not a provider failure: agent_end reports the
                  // interrupted completion; an error activity would be noise.
                  return [];
                }
                // pi's stream error frame is { type: "error", reason, error:
                // AssistantMessage } — the REAL upstream failure text
                // (Meridian / Claude Code SDK / provider API) lives at
                // error.errorMessage. `reason` is only the stop-reason
                // literal ("error"); never present it as the failure text.
                const upstreamText =
                  piProviderErrorText(assistantMessageEvent?.error) ??
                  asString(assistantMessageEvent?.error)?.trim() ??
                  "Pi assistant message failed.";
                const message = (upstreamText || "Pi assistant message failed.").slice(
                  0,
                  STDERR_WARNING_MAX_CHARS,
                );
                turnProviderErrors.set(assistantTurnKey(event.threadId, event.turnId), message);
                const base = yield* makeEventBase({
                  threadId: event.threadId,
                  turnId: event.turnId,
                });
                return [
                  {
                    ...base,
                    type: "runtime.error",
                    payload: {
                      message,
                      class: "provider_error",
                      detail: payload,
                    },
                  } satisfies ProviderRuntimeEvent,
                ];
              }
              return [];
            }
            case "message_end": {
              const message = asRecord(payload.message);
              if (asString(message?.role) !== "assistant") {
                return [];
              }
              const messageEndErrorText = piProviderErrorText(payload.message);
              if (messageEndErrorText !== undefined) {
                // Provider error carried on the completed message (stopReason
                // "error"): surface the REAL upstream text exactly once per
                // turn — the stream error frame may have surfaced it already.
                const errorTurnKey = assistantTurnKey(event.threadId, event.turnId);
                if (turnProviderErrors.has(errorTurnKey)) {
                  return [];
                }
                const errorText = messageEndErrorText.slice(0, STDERR_WARNING_MAX_CHARS);
                turnProviderErrors.set(errorTurnKey, errorText);
                const base = yield* makeEventBase({
                  threadId: event.threadId,
                  turnId: event.turnId,
                });
                return [
                  {
                    ...base,
                    type: "runtime.error",
                    payload: {
                      message: errorText,
                      class: "provider_error",
                    },
                  } satisfies ProviderRuntimeEvent,
                ];
              }
              if (!hasVisibleAssistantText(payload.message)) {
                // #402 empty-assistant guard: tool/planning stages complete
                // messages with no user-visible text — never render them.
                return [];
              }
              completedAssistantTurns.add(assistantTurnKey(event.threadId, event.turnId));
              return [
                yield* completeAssistantMessageEvent({
                  threadId: event.threadId,
                  turnId: event.turnId,
                  message: payload.message,
                }),
              ];
            }
            case "tool_execution_start":
              return [
                yield* toolLifecycleEvent({
                  type: "item.started",
                  threadId: event.threadId,
                  turnId: event.turnId,
                  toolCallId: payload.toolCallId,
                  toolName: payload.toolName,
                  detail: payload.args,
                  data: payload,
                  status: "inProgress",
                }),
              ];
            case "tool_execution_update":
              return [
                yield* toolLifecycleEvent({
                  type: "item.updated",
                  threadId: event.threadId,
                  turnId: event.turnId,
                  toolCallId: payload.toolCallId,
                  toolName: payload.toolName,
                  detail: payload.partialResult,
                  data: payload,
                  status: "inProgress",
                }),
              ];
            case "tool_execution_end":
              return [
                yield* toolLifecycleEvent({
                  type: "item.completed",
                  threadId: event.threadId,
                  turnId: event.turnId,
                  toolCallId: payload.toolCallId,
                  toolName: payload.toolName,
                  detail: payload.result,
                  data: payload,
                  status: payload.isError === true ? "failed" : "completed",
                }),
              ];
            case "turn_end": {
              const turnEndErrorText = piProviderErrorText(payload.message);
              if (turnEndErrorText !== undefined) {
                // Same provider-error surfacing as message_end (turn_end also
                // carries the final message); the per-turn map dedupes.
                const errorTurnKey = assistantTurnKey(event.threadId, event.turnId);
                if (turnProviderErrors.has(errorTurnKey)) {
                  return [];
                }
                const errorText = turnEndErrorText.slice(0, STDERR_WARNING_MAX_CHARS);
                turnProviderErrors.set(errorTurnKey, errorText);
                const base = yield* makeEventBase({
                  threadId: event.threadId,
                  turnId: event.turnId,
                });
                return [
                  {
                    ...base,
                    type: "runtime.error",
                    payload: {
                      message: errorText,
                      class: "provider_error",
                    },
                  } satisfies ProviderRuntimeEvent,
                ];
              }
              const turnKey = assistantTurnKey(event.threadId, event.turnId);
              if (
                !completedAssistantTurns.has(turnKey) &&
                hasVisibleAssistantText(payload.message)
              ) {
                // Multi-stage runs land the real answer on turn_end; emit the
                // completion here exactly once.
                completedAssistantTurns.add(turnKey);
                return [
                  yield* completeAssistantMessageEvent({
                    threadId: event.threadId,
                    turnId: event.turnId,
                    message: payload.message,
                  }),
                ];
              }
              return [];
            }
            case "agent_end": {
              const turnKey = assistantTurnKey(event.threadId, event.turnId);
              // Read BEFORE the delete: set membership is the only per-turn
              // record that an assistant message actually completed
              // (message_end / turn_end `.add()` on real output).
              const hadAssistantOutput = completedAssistantTurns.has(turnKey);
              completedAssistantTurns.delete(turnKey);
              const providerErrorText = turnProviderErrors.get(turnKey);
              turnProviderErrors.delete(turnKey);
              const abortingTurnId = abortingTurnIds.get(event.threadId);
              const interrupted =
                abortingTurnId !== undefined &&
                (abortingTurnId === "*" || abortingTurnId === event.turnId);
              // The turn is over on every outcome — clear the abort marker so
              // stale per-turn state can never leak into the next prompt
              // (turn_start also clears it; this covers failed/completed ends).
              abortingTurnIds.delete(event.threadId);
              const base = yield* makeEventBase({
                threadId: event.threadId,
                turnId: event.turnId,
              });
              if (!interrupted && !hadAssistantOutput) {
                if (providerErrorText !== undefined) {
                  // A provider error already surfaced as a runtime.error with
                  // the REAL upstream text (stream frame / message_end /
                  // turn_end). Fail the completion with that same text — the
                  // generic zero-output message is reserved for genuinely
                  // silent turns that carried no error at all.
                  return [
                    {
                      ...base,
                      type: "turn.completed",
                      payload: {
                        state: "failed",
                        stopReason: null,
                        errorMessage: providerErrorText,
                      },
                    } satisfies ProviderRuntimeEvent,
                  ];
                }
                // Zero-output turn: every message_end/turn_end was suppressed
                // by the #402 empty-assistant guard, so an unconditional
                // "completed" would render a silent empty turn. Surface a loud
                // provider error activity and fail the completion so the
                // thread state machine resets to idle instead of wedging.
                const message = `Pi turn ended with no output (session ${event.threadId}).`;
                const errorBase = yield* makeEventBase({
                  threadId: event.threadId,
                  turnId: event.turnId,
                });
                return [
                  {
                    ...errorBase,
                    type: "runtime.error",
                    payload: {
                      message,
                      class: "provider_error",
                    },
                  } satisfies ProviderRuntimeEvent,
                  {
                    ...base,
                    type: "turn.completed",
                    payload: {
                      state: "failed",
                      stopReason: null,
                      errorMessage: message,
                    },
                  } satisfies ProviderRuntimeEvent,
                ];
              }
              return [
                {
                  ...base,
                  type: "turn.completed",
                  payload: {
                    state: interrupted ? "interrupted" : "completed",
                    stopReason: interrupted ? "abort" : null,
                  },
                } satisfies ProviderRuntimeEvent,
              ];
            }
            default:
              return [];
          }
        }
      }
    });

  const writeNativeEvent = (event: PiRuntimeEvent) =>
    Effect.gen(function* () {
      if (!nativeEventLogger) {
        return;
      }
      const observedAt = yield* nowIso;
      yield* nativeEventLogger.write({ observedAt, event }, event.threadId);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Failed to write native Pi event log.", { cause }),
      ),
    );

  const stopSessionInternal = Effect.fn("stopSessionInternal")(function* (
    session: PiAdapterSessionContext,
  ) {
    if (session.stopped) {
      return;
    }
    session.stopped = true;
    sessions.delete(session.threadId);
    yield* session.runtime.close.pipe(Effect.ignore);
    yield* Effect.ignore(Scope.close(session.scope, Exit.void));
    yield* Fiber.interrupt(session.eventFiber).pipe(Effect.ignore);
  });

  /** Runtime exit observed on the event stream: release adapter-side state. */
  const releaseExitedSession = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const session = sessions.get(threadId);
      if (!session || session.stopped) {
        return;
      }
      session.stopped = true;
      sessions.delete(threadId);
      yield* Effect.ignore(Scope.close(session.scope, Exit.void));
    });

  const requireSession = Effect.fn("requireSession")(function* (threadId: ThreadId) {
    const session = sessions.get(threadId);
    if (!session || session.stopped) {
      return yield* new ProviderAdapterSessionNotFoundError({
        provider: PROVIDER,
        threadId,
      });
    }
    return session;
  });

  /**
   * Model-identity guard: a selection stamped for a DIFFERENT provider
   * instance must never be dropped silently — the composer chip would keep
   * claiming a model this Pi instance never accepted. Emit a loud
   * provider_error activity; the session/turn continues on Pi's current
   * model so the mismatch is visible instead of masked by a hard failure.
   */
  const emitDroppedModelSelectionError = (input: {
    readonly threadId: ThreadId;
    readonly operation: "startSession" | "sendTurn";
    readonly selection: NonNullable<ProviderSendTurnInput["modelSelection"]>;
  }) =>
    Effect.gen(function* () {
      const base = yield* makeEventBase({ threadId: input.threadId });
      yield* Queue.offer(runtimeEventQueue, {
        ...base,
        type: "runtime.error",
        payload: {
          message:
            `Pi dropped the model selection '${input.selection.model}' on ${input.operation}: ` +
            `it targets provider instance '${input.selection.instanceId}' but this session is ` +
            `bound to '${boundInstanceId}'. The turn continues on Pi's current model.`,
          class: "provider_error",
        },
      } satisfies ProviderRuntimeEvent);
    });

  const meridianRouteGuard = makePiMeridianRouteGuard(fileSystem, options?.meridianRoute);

  /**
   * Fail-closed Meridian seam gate (Meridian seam patch, Task 1): when the
   * effective model for a session start / turn is Anthropic-family, the turn
   * may only proceed if the Meridian route override is configured in pi's
   * models.json AND the loopback Meridian endpoint answers its health probe.
   * On failure this emits a seam-naming `runtime.error` activity AND fails
   * the operation — Pi native Anthropic OAuth is unreachable from Claude
   * turn flow because no Pi RPC (set_model/prompt) happens for the turn.
   * Non-Anthropic models (openai-codex, ...) bypass everything: no config
   * read, no probe.
   */
  const guardAnthropicRoute = (input: {
    readonly threadId: ThreadId;
    readonly method: string;
    readonly model: string | undefined;
  }) =>
    input.model !== undefined && isAnthropicFamilyPiModel(input.model)
      ? meridianRouteGuard.guardAnthropicTurn(input.model).pipe(
          Effect.tapError((error) =>
            Effect.gen(function* () {
              const base = yield* makeEventBase({ threadId: input.threadId });
              yield* Queue.offer(runtimeEventQueue, {
                ...base,
                type: "runtime.error",
                payload: {
                  message: error.detail,
                  class: error.errorClass,
                },
              } satisfies ProviderRuntimeEvent);
            }).pipe(Effect.ignore),
          ),
          Effect.mapError(
            (error) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: input.method,
                detail: error.detail,
                cause: error,
              }),
          ),
        )
      : Effect.void;

  const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
    Effect.scoped(
      Effect.gen(function* () {
        if (input.provider !== undefined && input.provider !== PROVIDER) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
          });
        }

        if (
          input.modelSelection !== undefined &&
          input.modelSelection.instanceId !== boundInstanceId
        ) {
          yield* emitDroppedModelSelectionError({
            threadId: input.threadId,
            operation: "startSession",
            selection: input.modelSelection,
          });
        }

        const model =
          input.modelSelection?.instanceId === boundInstanceId
            ? input.modelSelection.model
            : undefined;
        const thinkingLevel =
          input.modelSelection?.instanceId === boundInstanceId
            ? normalizePiThinkingLevel(
                getModelSelectionStringOptionValue(input.modelSelection, "thinkingLevel"),
              )
            : undefined;

        // Meridian seam guard: an Anthropic-family start (explicit selection
        // or resume onto an Anthropic model) must verify the Meridian route
        // BEFORE any runtime exists, so no set_model can ever be sent down a
        // dead Anthropic route. Runs before the existing-session stop so a
        // rejected start is non-destructive.
        yield* guardAnthropicRoute({
          threadId: input.threadId,
          method: "session/start",
          model: model ?? piModelFromResumeCursor(input.resumeCursor),
        });

        const existing = sessions.get(input.threadId);
        if (existing && !existing.stopped) {
          yield* Effect.suspend(() => stopSessionInternal(existing));
        }

        const runtimeInput: PiSessionRuntimeOptions = {
          threadId: input.threadId,
          providerInstanceId: boundInstanceId,
          binaryPath: piSettings.binaryPath || "pi",
          ...(options?.environment ? { environment: options.environment } : {}),
          ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
          runtimeMode: input.runtimeMode,
          ...(model !== undefined ? { model } : {}),
          ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
          ...(input.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
        };

        const sessionScope = yield* Scope.make("sequential");
        let sessionScopeTransferred = false;
        yield* Effect.addFinalizer(() =>
          sessionScopeTransferred ? Effect.void : Scope.close(sessionScope, Exit.void),
        );
        const createRuntime = options?.makeRuntime ?? makePiSessionRuntime;
        const runtime = yield* createRuntime(runtimeInput).pipe(
          Effect.provideService(Scope.Scope, sessionScope),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: input.threadId,
                detail: cause.message,
                cause,
              }),
          ),
        );

        const eventFiber = yield* Stream.runForEach(runtime.events, (event) =>
          Effect.gen(function* () {
            yield* writeNativeEvent(event);
            const runtimeEvents = yield* mapPiRuntimeEvent(event).pipe(
              Effect.orElseSucceed(() => [] as ReadonlyArray<ProviderRuntimeEvent>),
            );
            if (runtimeEvents.length > 0) {
              yield* Queue.offerAll(runtimeEventQueue, runtimeEvents);
            }
            if (event.kind === "exit") {
              yield* releaseExitedSession(event.threadId);
            }
          }),
        ).pipe(Effect.forkChild);

        const started = yield* runtime.start().pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: input.threadId,
                detail: cause.message,
                cause,
              }),
          ),
          Effect.onError(() =>
            // #402: startup failures clean up fully — kill the child (scope
            // owns it), stop the pump, leave no half-initialized session.
            runtime.close.pipe(
              Effect.andThen(Effect.ignore(Scope.close(sessionScope, Exit.void))),
              Effect.andThen(Fiber.interrupt(eventFiber)),
              Effect.ignore,
            ),
          ),
        );

        const sessionModel = piModelFromResumeCursor(started.resumeCursor) ?? started.model;
        sessions.set(input.threadId, {
          threadId: input.threadId,
          scope: sessionScope,
          runtime,
          eventFiber,
          stopped: false,
          currentModel: sessionModel,
        });
        sessionScopeTransferred = true;

        // Session lifecycle events (the Pi RPC child does not announce them).
        const startedBase = yield* makeEventBase({ threadId: input.threadId });
        const configuredBase = yield* makeEventBase({ threadId: input.threadId });
        const threadBase = yield* makeEventBase({ threadId: input.threadId });
        const sessionThinkingLevel = piThinkingLevelFromResumeCursor(started.resumeCursor);
        const providerThreadId = asString(asRecord(started.resumeCursor)?.sessionId);
        yield* Queue.offerAll(runtimeEventQueue, [
          {
            ...startedBase,
            type: "session.started",
            payload: {
              message: "Pi session started",
              ...(started.resumeCursor !== undefined ? { resume: started.resumeCursor } : {}),
            },
          },
          {
            ...configuredBase,
            type: "session.configured",
            payload: {
              config: {
                runtimeMode: started.runtimeMode,
                ...(started.cwd ? { cwd: started.cwd } : {}),
                ...(sessionModel ? { model: sessionModel } : {}),
                ...(sessionThinkingLevel ? { thinkingLevel: sessionThinkingLevel } : {}),
              },
            },
          },
          {
            ...threadBase,
            type: "thread.started",
            payload: providerThreadId !== undefined ? { providerThreadId } : {},
          },
        ]);

        return started;
      }),
    );

  const resolveAttachmentImage = Effect.fn("resolveAttachmentImage")(function* (
    attachment: NonNullable<ProviderSendTurnInput["attachments"]>[number],
  ) {
    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: serverConfig.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "sendTurn",
        issue: `Invalid attachment id '${attachment.id}'.`,
      });
    }
    const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "turn/prompt",
            detail: `Failed to read attachment file: ${cause.message}.`,
            cause,
          }),
      ),
    );
    return {
      type: "image",
      data: Buffer.from(bytes).toString("base64"),
      mimeType: attachment.mimeType,
    } satisfies PiPromptImage;
  });

  const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = Effect.fn("sendTurn")(
    function* (input) {
      const images = yield* Effect.forEach(
        input.attachments ?? [],
        (attachment) => resolveAttachmentImage(attachment),
        { concurrency: 1 },
      );

      const session = yield* requireSession(input.threadId);
      if (
        input.modelSelection !== undefined &&
        input.modelSelection.instanceId !== boundInstanceId
      ) {
        yield* emitDroppedModelSelectionError({
          threadId: input.threadId,
          operation: "sendTurn",
          selection: input.modelSelection,
        });
      }
      const model =
        input.modelSelection?.instanceId === boundInstanceId
          ? input.modelSelection.model
          : undefined;
      const thinkingLevel =
        input.modelSelection?.instanceId === boundInstanceId
          ? normalizePiThinkingLevel(
              getModelSelectionStringOptionValue(input.modelSelection, "thinkingLevel"),
            )
          : undefined;

      // Meridian seam guard: gate the turn's EFFECTIVE model (explicit
      // selection, else the session's current model) BEFORE any Pi RPC, so
      // an Anthropic turn can never reach set_model/prompt while the
      // Meridian route is absent or down. Codex-family turns skip this
      // entirely (no config read, no probe).
      yield* guardAnthropicRoute({
        threadId: input.threadId,
        method: "turn/prompt",
        model: model ?? session.currentModel,
      });

      const result = yield* session.runtime
        .sendTurn({
          ...(input.input !== undefined ? { input: input.input } : {}),
          ...(model !== undefined ? { model } : {}),
          ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
          ...(images.length > 0 ? { images } : {}),
        })
        .pipe(Effect.mapError((cause) => toRequestError(input.threadId, "turn/prompt", cause)));
      const settledModel = piModelFromResumeCursor(result.resumeCursor) ?? model;
      if (settledModel !== undefined) {
        session.currentModel = settledModel;
      }
      return result;
    },
  );

  const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = (
    threadId,
    turnId,
  ) =>
    requireSession(threadId).pipe(
      Effect.flatMap((session) =>
        Effect.gen(function* () {
          abortingTurnIds.set(threadId, turnId ?? "*");
          yield* session.runtime.interruptTurn(turnId).pipe(
            Effect.tapError(() =>
              Effect.sync(() => {
                abortingTurnIds.delete(threadId);
              }),
            ),
            Effect.mapError((cause) => toRequestError(threadId, "turn/abort", cause)),
          );
        }),
      ),
    );

  const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = (threadId) =>
    requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.readThread),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : toRequestError(threadId, "thread/read", cause),
      ),
      Effect.map((snapshot) => ({
        threadId,
        turns: snapshot.turns,
      })),
    );

  const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = (
    threadId,
  ) =>
    Effect.fail(
      new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "rollbackThread",
        issue: `Thread rollback is not supported by the Pi provider (thread '${threadId}').`,
      }),
    );

  const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] = (
    threadId,
  ) =>
    Effect.fail(
      new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "respondToRequest",
        issue: `Approval requests are not supported by the Pi provider (thread '${threadId}'); Pi sessions are full-access only.`,
      }),
    );

  const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] = (
    threadId,
  ) =>
    Effect.fail(
      new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "respondToUserInput",
        issue: `Interactive user input is not supported by the Pi provider (thread '${threadId}').`,
      }),
    );

  const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
    Effect.gen(function* () {
      const session = sessions.get(threadId);
      if (!session) {
        return;
      }
      yield* stopSessionInternal(session);
    });

  const listSessions: ProviderAdapterShape<ProviderAdapterError>["listSessions"] = () =>
    Effect.forEach(
      Array.from(sessions.values()).filter((session) => !session.stopped),
      (session) => session.runtime.getSession,
      { concurrency: 1 },
    );

  const hasSession: ProviderAdapterShape<ProviderAdapterError>["hasSession"] = (threadId) =>
    Effect.succeed(Boolean(sessions.get(threadId) && !sessions.get(threadId)?.stopped));

  const stopAll: ProviderAdapterShape<ProviderAdapterError>["stopAll"] = () =>
    Effect.forEach(Array.from(sessions.values()), stopSessionInternal, {
      concurrency: 1,
      discard: true,
    }).pipe(Effect.asVoid);

  yield* Effect.acquireRelease(Effect.void, () =>
    stopAll().pipe(
      Effect.andThen(Queue.shutdown(runtimeEventQueue)),
      Effect.andThen(managedNativeEventLogger?.close() ?? Effect.void),
      Effect.ignore,
    ),
  );

  return {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "in-session",
    },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    get streamEvents() {
      return Stream.fromQueue(runtimeEventQueue);
    },
  } satisfies ProviderAdapterShape<ProviderAdapterError>;
});

/**
 * Symphony WS contract (TQ-039 slice 1) — server-owned spawn + status for the
 * durable `t3.thread-run` task.
 *
 * These two methods ride the SAME orchestration WS door and authentication as
 * every other orchestration method. `symphony.spawnThreadRun` enqueues the
 * EXISTING `t3.thread-run` task in-process (Postgres credentials never leave
 * the server); `symphony.taskStatus` is a read-only status snapshot.
 *
 * Model discipline (binding, seam note 2026-07-08): `model` is REQUIRED on the
 * spawn request — there is NO default anywhere on this path. Callers pass
 * Ryan's routing explicitly. The transport-level default model is unreachable
 * from this rail.
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SYMPHONY_WS_METHODS = {
  spawnThreadRun: "symphony.spawnThreadRun",
  taskStatus: "symphony.taskStatus",
  runtimeReady: "symphony.runtimeReady",
} as const;

/**
 * Ryan's model routing table (seam note 2026-07-08, binding on the migration):
 *   gpt-5.4-mini = testing / tracer tasks that are NOT real assigned work
 *   gpt-5.4      = implementing REAL Task-Queue / assigned Symphony work
 *   gpt-5.5      = ONLY a third-party outside agent auditing architecture
 * A spawn request MUST name a model whose base id is one of these. There is no
 * silent default: an absent or off-table model is rejected.
 */
export const SYMPHONY_MODEL_ROUTING_PREFIXES = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"] as const;

/**
 * Pure guard: is `model` inside the Symphony routing table? Accepts an exact
 * routing id or a variant that extends one (e.g. `gpt-5.4-2026xx`). Empty /
 * whitespace / off-table strings return false so the spawn handler can fail
 * closed. Kept pure and exported so the negative control (NC2) is unit-testable
 * without a live server.
 */
export function isRoutedSymphonyModel(model: string): boolean {
  const trimmed = model.trim();
  if (trimmed.length === 0) return false;
  return SYMPHONY_MODEL_ROUTING_PREFIXES.some(
    (prefix) =>
      trimmed === prefix || trimmed.startsWith(`${prefix}-`) || trimmed.startsWith(`${prefix}:`),
  );
}

const SymphonySpawnThreadRunFields = Schema.Struct({
  /** The user prompt / instruction for the turn. */
  prompt: TrimmedNonEmptyString,
  /** REQUIRED model id (no default). Rejected if absent or off routing table. */
  model: TrimmedNonEmptyString,
  /** How long the durable await step holds before completing (ms). */
  holdMs: Schema.optional(NonNegativeInt),
  /** Optional caller correlation id, echoed only in logs/traces. */
  operationId: Schema.optional(TrimmedNonEmptyString),
});

/** The only keys a symphony spawn request may carry (Slice 1S D1). */
const SYMPHONY_SPAWN_ALLOWED_KEYS = new Set(
  Object.keys(SymphonySpawnThreadRunFields.fields),
);

/**
 * Fresh-thread-only, structurally enforced (Slice 1S D1). `effect`'s
 * `onExcessProperty` is a decode-CALL option (default `"ignore"`, confirmed in
 * `effect/src/SchemaAST.ts`) — it is never a property of the schema value
 * itself, and the WsRpcGroup RPC binding
 * (`effect/src/unstable/rpc/RpcServer.ts:632`,
 * `Schema.decodeUnknownEffect(Schema.toCodecJson(rpc.payloadSchema))`) decodes
 * with ZERO ParseOptions and no per-Rpc override surface — so a bare
 * `Schema.Struct` here would silently accept and strip an excess `threadId`
 * on the real spawn path regardless of any caller-side decode option. The fix
 * has to live IN the schema value: reject any key outside the declared set
 * before the inner struct's own (permissive-by-default) decode ever runs, so
 * every decoder that binds this schema — the RPC server, this file's own
 * tests, anything else — inherits the same rejection for free. A valid
 * payload (only `prompt`/`model`/`holdMs`/`operationId`) passes through this
 * check untouched and then decodes exactly as it did before this change —
 * this only ever REJECTS extra keys, it never alters accepted ones.
 */
export const SymphonySpawnThreadRunInput = Schema.Unknown.pipe(
  Schema.decodeTo(SymphonySpawnThreadRunFields, {
    decode: SchemaGetter.transformOrFail((input: unknown) => {
      // Cast target: the inner struct's own decode (run automatically as the
      // second pass of `decodeTo`) does the REAL field-by-field validation
      // (trims, non-empty, non-negative-int checks). This getter's only job
      // is the excess-key check below; the cast just satisfies the pipeline
      // shape, it performs no validation of its own.
      type Encoded = typeof SymphonySpawnThreadRunFields.Encoded;
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        // Not a plain object — let the inner struct's own decode produce its
        // normal "expected an object" error; this check only polices keys.
        return Effect.succeed(input as Encoded);
      }
      const excessKeys = Object.keys(input).filter(
        (key) => !SYMPHONY_SPAWN_ALLOWED_KEYS.has(key),
      );
      if (excessKeys.length > 0) {
        return Effect.fail(
          new SchemaIssue.InvalidValue(Option.some(input), {
            message: `Unexpected key(s) on a symphony spawn request: ${excessKeys.join(", ")} (fresh-thread-only — a campaign spawn cannot name an existing thread)`,
          }),
        );
      }
      return Effect.succeed(input as Encoded);
    }),
    encode: SchemaGetter.passthrough(),
  }),
);
export type SymphonySpawnThreadRunInput = typeof SymphonySpawnThreadRunInput.Type;

export const SymphonySpawnThreadRunOutput = Schema.Struct({
  taskID: TrimmedNonEmptyString,
});
export type SymphonySpawnThreadRunOutput = typeof SymphonySpawnThreadRunOutput.Type;

export const SymphonyTaskStatusInput = Schema.Struct({
  taskID: TrimmedNonEmptyString,
});
export type SymphonyTaskStatusInput = typeof SymphonyTaskStatusInput.Type;

export const SymphonyTaskState = Schema.Literals(["pending", "running", "completed", "failed"]);
export type SymphonyTaskState = typeof SymphonyTaskState.Type;

export const SymphonyTaskStatusOutput = Schema.Struct({
  state: SymphonyTaskState,
  resultSummary: Schema.optional(Schema.String),
});
export type SymphonyTaskStatusOutput = typeof SymphonyTaskStatusOutput.Type;

/** Fail-closed error when the server-owned AbsurdRuntime service is absent. */
export class SymphonyRuntimeUnavailableError extends Schema.TaggedErrorClass<SymphonyRuntimeUnavailableError>()(
  "SymphonyRuntimeUnavailableError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Spawn rejected (off-table model) or the in-process spawn call failed. */
export class SymphonySpawnError extends Schema.TaggedErrorClass<SymphonySpawnError>()(
  "SymphonySpawnError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Status read failed, or the task id is unknown to the queue. */
export class SymphonyTaskStatusError extends Schema.TaggedErrorClass<SymphonyTaskStatusError>()(
  "SymphonyTaskStatusError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

// ---------------------------------------------------------------------------
// TQ-039 Slice 1R — runtime readiness surface (visibility before repair)
// ---------------------------------------------------------------------------

/**
 * The closed set of required runtime-readiness check names. A readiness check
 * can name ONLY one of these — an arbitrary/value-shaped name is rejected (NC5).
 */
export const SymphonyReadinessCheckName = Schema.Literals([
  "absurd-worker-layer",
  "session-boundary",
  "queue-reachability",
]);
export type SymphonyReadinessCheckName = typeof SymphonyReadinessCheckName.Type;

/** Closed readiness states. No free-form state is representable. */
export const SymphonyReadinessState = Schema.Literals(["ready", "not-ready", "unknown"]);
export type SymphonyReadinessState = typeof SymphonyReadinessState.Type;

/**
 * Closed category labels. `category` is a coarse REASON tag, never a place for
 * operational values/detail. Bounding it to literals makes value-shaped content
 * unrepresentable at the type level (NC5) rather than merely discouraged.
 */
export const SymphonyReadinessCategory = Schema.Literals([
  "uninitialized",
  "unverified",
  "unreachable",
  "protected-lane",
]);
export type SymphonyReadinessCategory = typeof SymphonyReadinessCategory.Type;

/** One readiness check: name + state + optional coarse category. Nothing else. */
export const SymphonyReadinessCheck = Schema.Struct({
  name: SymphonyReadinessCheckName,
  state: SymphonyReadinessState,
  category: Schema.optional(SymphonyReadinessCategory),
});
export type SymphonyReadinessCheck = typeof SymphonyReadinessCheck.Type;

export const SymphonyRuntimeReadyInput = Schema.Struct({});
export type SymphonyRuntimeReadyInput = typeof SymphonyRuntimeReadyInput.Type;

/**
 * The runtime-readiness response. Closed by construction: `ready` boolean plus
 * an array of closed checks. There is NO free-form string field anywhere, so
 * operational detail cannot be carried in a readiness response.
 */
export const SymphonyRuntimeReadyOutput = Schema.Struct({
  ready: Schema.Boolean,
  checks: Schema.Array(SymphonyReadinessCheck),
});
export type SymphonyRuntimeReadyOutput = typeof SymphonyRuntimeReadyOutput.Type;

/** The required checks a not-ready spawn fails closed on (all three). */
export const SYMPHONY_REQUIRED_READINESS_CHECKS = [
  "absurd-worker-layer",
  "session-boundary",
  "queue-reachability",
] as const;

/**
 * Fail-closed error when a spawn is attempted while a required readiness check is
 * `not-ready`. Carries the failing check NAMES only (bounded enum array) — no
 * operational detail. Nothing is enqueued, no claim or lease is consumed, and
 * the silent-hang failure shape is unreachable from a not-ready spawn.
 */
export class RuntimeNotReady extends Schema.TaggedErrorClass<RuntimeNotReady>()("RuntimeNotReady", {
  message: TrimmedNonEmptyString,
  notReady: Schema.Array(SymphonyReadinessCheckName),
}) {}

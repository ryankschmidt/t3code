import * as Schema from "effect/Schema";

import { IsoDateTime, MessageId, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

const makeRelayId = <Brand extends string>(brand: Brand) => TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const RelaySeatId = makeRelayId("RelaySeatId");
export type RelaySeatId = typeof RelaySeatId.Type;

export const RelayDeliveryId = makeRelayId("RelayDeliveryId");
export type RelayDeliveryId = typeof RelayDeliveryId.Type;

export const RelayResponseId = makeRelayId("RelayResponseId");
export type RelayResponseId = typeof RelayResponseId.Type;

export const RelayReceiptId = makeRelayId("RelayReceiptId");
export type RelayReceiptId = typeof RelayReceiptId.Type;

export const RelayGrantId = makeRelayId("RelayGrantId");
export type RelayGrantId = typeof RelayGrantId.Type;

export const RelayDecisionRequestId = makeRelayId("RelayDecisionRequestId");
export type RelayDecisionRequestId = typeof RelayDecisionRequestId.Type;

export const RelayLeaseId = makeRelayId("RelayLeaseId");
export type RelayLeaseId = typeof RelayLeaseId.Type;

export const RelayIdempotencyKey = makeRelayId("RelayIdempotencyKey");
export type RelayIdempotencyKey = typeof RelayIdempotencyKey.Type;

export const RelayAuthorityTier = Schema.Literals([
  "fable-cold-architect",
  "opus-implementer",
  "codex-digest",
  "validator",
  "ryan-authority",
]);
export type RelayAuthorityTier = typeof RelayAuthorityTier.Type;

export const RelayReasoningTier = Schema.Literals(["low", "medium", "high", "maximum"]);
export type RelayReasoningTier = typeof RelayReasoningTier.Type;

export const RelayReceiptKind = Schema.Literals([
  "admission",
  "progress",
  "completion",
  "blocker",
  "verification",
]);
export type RelayReceiptKind = typeof RelayReceiptKind.Type;

export const RelayReceiptStatus = Schema.Literals([
  "pending",
  "recorded",
  "validated",
  "completed",
  "blocked",
  "failed",
]);
export type RelayReceiptStatus = typeof RelayReceiptStatus.Type;

export const RelayPassFail = Schema.Literals(["pass", "fail"]);
export type RelayPassFail = typeof RelayPassFail.Type;

export const RelayBlockerCategory = Schema.Literals([
  "pack-mint-required",
  "pack-blocked",
  "invalid-model-routing",
  "unauthorized-target",
  "duplicate-delivery",
  "duplicate-response",
  "stale-lease",
  "ownership-overdue",
  "next-owner-write",
  "policy-illegal",
  "manual-prompt-transport",
  "seat-unhealthy",
  "loop-detected",
]);
export type RelayBlockerCategory = typeof RelayBlockerCategory.Type;

export const RelayPackValidationState = Schema.Literals(["valid", "stale", "malformed"]);
export type RelayPackValidationState = typeof RelayPackValidationState.Type;

export const RelayAdmissionProofState = Schema.Literals(["validated", "missing", "invalid"]);
export type RelayAdmissionProofState = typeof RelayAdmissionProofState.Type;

export const RelayMessageStatus = Schema.Literals([
  "ready",
  "delivery-requested",
  "delivered",
  "admitted",
  "execution-authorized",
  "answered",
  "completed",
  "validated",
  "blocked",
]);
export type RelayMessageStatus = typeof RelayMessageStatus.Type;

export const RelayDeliveryStatus = Schema.Literals([
  "ready",
  "requested",
  "delivered",
  "admitted",
  "execution-authorized",
  "inbound-completed",
  "execution-completed",
  "digest-requested",
  "digest-completed",
  "validation-requested",
  "validation-completed",
  "decision-requested",
  "decision-recorded",
  "blocked",
]);
export type RelayDeliveryStatus = typeof RelayDeliveryStatus.Type;

export const RelayRetryClassification = Schema.Literals([
  "none",
  "duplicate-delivery",
  "seat-tripped",
  "stale-lease",
  "manual-transport",
  "recovered",
]);
export type RelayRetryClassification = typeof RelayRetryClassification.Type;

export const RelayToolName = Schema.Literals(["relay.list", "relay.send", "relay.get", "relay.await"]);
export type RelayToolName = typeof RelayToolName.Type;

export const RelayTransportResponseMethod = Schema.Literals(["relay.send", "relay.get", "relay.await"]);
export type RelayTransportResponseMethod = typeof RelayTransportResponseMethod.Type;

export const RelaySeatHealthState = Schema.Literals(["healthy", "tripped", "near-full", "stale"]);
export type RelaySeatHealthState = typeof RelaySeatHealthState.Type;

export const RelayDecisionQueue = Schema.Literals(["relay", "operator"]);
export type RelayDecisionQueue = typeof RelayDecisionQueue.Type;

export const RelayDecisionStatus = Schema.Literals(["requested", "recorded"]);
export type RelayDecisionStatus = typeof RelayDecisionStatus.Type;

export const RelayAcceptedEventName = Schema.Literals([
  "task.ready",
  "relay.delivery-requested",
  "relay.delivered",
  "relay.admission-completed",
  "task.execution-authorized",
  "task.execution-completed",
  "digest.requested",
  "digest.completed",
  "validation.requested",
  "validation.completed",
  "authority-decision-requested",
  "authority-decision-recorded",
  "relay.inbound-completed",
  "relay.nudge",
  "relay.escalation",
]);
export type RelayAcceptedEventName = typeof RelayAcceptedEventName.Type;

export const RelayPassFailFact = Schema.Struct({
  name: TrimmedNonEmptyString,
  status: RelayPassFail,
});
export type RelayPassFailFact = typeof RelayPassFailFact.Type;

export const RelayResponseContract = Schema.Struct({
  mode: Schema.Literals(["text", "json"]),
  requires_validator: Schema.Boolean,
  max_hops: PositiveInt,
});
export type RelayResponseContract = typeof RelayResponseContract.Type;

export const AgentSeatHealth = Schema.Struct({
  model_ok: Schema.Boolean,
  context_pct: Schema.NullOr(Schema.Number),
  state: RelaySeatHealthState,
  updated: IsoDateTime,
});
export type AgentSeatHealth = typeof AgentSeatHealth.Type;

export const AgentSeat = Schema.Struct({
  seat_id: RelaySeatId,
  session_id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  live: Schema.Boolean,
  model: TrimmedNonEmptyString,
  supported_models: Schema.Array(TrimmedNonEmptyString),
  supported_reasoning_tiers: Schema.Array(RelayReasoningTier),
  authority_tiers: Schema.Array(RelayAuthorityTier),
  task_kinds: Schema.Array(TrimmedNonEmptyString),
  health: AgentSeatHealth,
});
export type AgentSeat = typeof AgentSeat.Type;

export const SeatQuery = Schema.Struct({
  task_kind: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  reasoning_tier: RelayReasoningTier,
  authority_tier: RelayAuthorityTier,
  allow_self: Schema.optional(Schema.Boolean),
});
export type SeatQuery = typeof SeatQuery.Type;

export const PackBinding = Schema.Struct({
  pack_id: TrimmedNonEmptyString,
  lens_ref: TrimmedNonEmptyString,
  write_scope: Schema.Array(TrimmedNonEmptyString),
  validation_state: RelayPackValidationState,
  admission_proof: RelayAdmissionProofState,
  boundary_applied: Schema.Boolean,
  freshness_expires_at: IsoDateTime,
});
export type PackBinding = typeof PackBinding.Type;

export const AuthorityGrant = Schema.Struct({
  grant_id: RelayGrantId,
  granted_tier: RelayAuthorityTier,
  granted_by: RelayAuthorityTier,
  write_scope: Schema.Array(TrimmedNonEmptyString),
  issued_at: IsoDateTime,
  expires_at: IsoDateTime,
});
export type AuthorityGrant = typeof AuthorityGrant.Type;

export const DecisionRequest = Schema.Struct({
  request_id: RelayDecisionRequestId,
  decision_kind: TrimmedNonEmptyString,
  requested_by: RelayAuthorityTier,
  requested_tier: RelayAuthorityTier,
  queue: RelayDecisionQueue,
  status: RelayDecisionStatus,
  evidence_paths: Schema.Array(TrimmedNonEmptyString),
});
export type DecisionRequest = typeof DecisionRequest.Type;

export const RelayRoutingRule = Schema.Struct({
  task_kind: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  reasoning_tier: RelayReasoningTier,
});
export type RelayRoutingRule = typeof RelayRoutingRule.Type;

export const RelayMessage = Schema.Struct({
  task_kind: TrimmedNonEmptyString,
  task_id: TrimmedNonEmptyString,
  step_id: TrimmedNonEmptyString,
  message_id: MessageId,
  sender_seat_id: RelaySeatId,
  target_seat_id: RelaySeatId,
  model: TrimmedNonEmptyString,
  reasoning_tier: RelayReasoningTier,
  authority_tier: RelayAuthorityTier,
  pack_binding: Schema.NullOr(PackBinding),
  response_contract: RelayResponseContract,
  correlation_parent: Schema.NullOr(MessageId),
  hop_count: NonNegativeInt,
  idempotency_key: RelayIdempotencyKey,
  status: RelayMessageStatus,
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type RelayMessage = typeof RelayMessage.Type;

export const RelayLease = Schema.Struct({
  lease_id: RelayLeaseId,
  holder_seat_id: RelaySeatId,
  acquired_at: IsoDateTime,
  deadline: IsoDateTime,
});
export type RelayLease = typeof RelayLease.Type;

export const RelayHeartbeat = Schema.Struct({
  last_seen_at: IsoDateTime,
  deadline: IsoDateTime,
});
export type RelayHeartbeat = typeof RelayHeartbeat.Type;

export const RelayNextOwnerAssignment = Schema.Struct({
  seat_id: RelaySeatId,
  deadline: IsoDateTime,
});
export type RelayNextOwnerAssignment = typeof RelayNextOwnerAssignment.Type;

export const RelayDelivery = Schema.Struct({
  delivery_id: RelayDeliveryId,
  message_id: MessageId,
  target_seat_id: RelaySeatId,
  status: RelayDeliveryStatus,
  lease: RelayLease,
  heartbeat: RelayHeartbeat,
  attempt_count: NonNegativeInt,
  retry_classification: RelayRetryClassification,
  last_accepted_event: RelayAcceptedEventName,
  recovery_owner: RelaySeatId,
  next_owner: RelayNextOwnerAssignment,
  idempotency_key: RelayIdempotencyKey,
  nudge_count: NonNegativeInt,
  last_nudge_at: Schema.NullOr(IsoDateTime),
  escalation_emitted: Schema.Boolean,
});
export type RelayDelivery = typeof RelayDelivery.Type;

export const RelayResponse = Schema.Struct({
  response_id: RelayResponseId,
  message_id: MessageId,
  responder_seat_id: RelaySeatId,
  output_text: TrimmedNonEmptyString,
  completed_at: IsoDateTime,
  error_code: Schema.NullOr(TrimmedNonEmptyString),
});
export type RelayResponse = typeof RelayResponse.Type;

const RelayReceiptBase = {
  receipt_id: RelayReceiptId,
  name: TrimmedNonEmptyString,
  status: RelayReceiptStatus,
  evidence_paths: Schema.Array(TrimmedNonEmptyString),
} as const;

export const RelayAdmissionReceipt = Schema.Struct({
  ...RelayReceiptBase,
  kind: Schema.Literal("admission"),
  admission_status: Schema.Literals(["pending", "validated", "blocked"]),
  pack_id: TrimmedNonEmptyString,
  boundary_applied: Schema.Boolean,
});
export type RelayAdmissionReceipt = typeof RelayAdmissionReceipt.Type;

export const RelayProgressReceipt = Schema.Struct({
  ...RelayReceiptBase,
  kind: Schema.Literal("progress"),
  progress_status: Schema.Literals(["recorded", "nudge-sent"]),
  step_name: TrimmedNonEmptyString,
});
export type RelayProgressReceipt = typeof RelayProgressReceipt.Type;

export const RelayCompletionReceipt = Schema.Struct({
  ...RelayReceiptBase,
  kind: Schema.Literal("completion"),
  completion_status: Schema.Literal("completed"),
  facts: Schema.Array(RelayPassFailFact),
});
export type RelayCompletionReceipt = typeof RelayCompletionReceipt.Type;

export const RelayBlockerReceipt = Schema.Struct({
  ...RelayReceiptBase,
  kind: Schema.Literal("blocker"),
  blocker_status: Schema.Literal("blocked"),
  blocker_category: RelayBlockerCategory,
  blocked_transition: RelayAcceptedEventName,
});
export type RelayBlockerReceipt = typeof RelayBlockerReceipt.Type;

export const RelayVerificationReceipt = Schema.Struct({
  ...RelayReceiptBase,
  kind: Schema.Literal("verification"),
  verification_status: RelayPassFail,
  facts: Schema.Array(RelayPassFailFact),
});
export type RelayVerificationReceipt = typeof RelayVerificationReceipt.Type;

export const RelayReceipt = Schema.Union([
  RelayAdmissionReceipt,
  RelayProgressReceipt,
  RelayCompletionReceipt,
  RelayBlockerReceipt,
  RelayVerificationReceipt,
]);
export type RelayReceipt = typeof RelayReceipt.Type;

export interface RelayTransport {
  readonly listEligibleSeats: (query: SeatQuery) => Promise<ReadonlyArray<AgentSeat>>;
  readonly send: (delivery: RelayDelivery) => Promise<RelayDelivery>;
  readonly get: (message_id: MessageId) => Promise<RelayResponse | null>;
  readonly await: (message_id: MessageId, timeout_ms: number) => Promise<RelayResponse | null>;
}

export function isSeatHealthy(seat: AgentSeat): boolean {
  return (
    seat.live &&
    seat.health.model_ok &&
    seat.health.state === "healthy" &&
    (seat.health.context_pct === null || seat.health.context_pct < 100)
  );
}

export function decisionQueueForTier(tier: RelayAuthorityTier): RelayDecisionQueue {
  return tier === "ryan-authority" ? "operator" : "relay";
}

export function isDecisionRequestQueueValid(request: DecisionRequest): boolean {
  return request.queue === decisionQueueForTier(request.requested_tier);
}

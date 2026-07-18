import type { MessageId } from "./baseSchemas.ts";
import {
  type AgentSeat,
  type AuthorityGrant,
  type DecisionRequest,
  type PackBinding,
  type RelayAdmissionReceipt,
  type RelayAuthorityTier,
  type RelayBlockerCategory,
  type RelayBlockerReceipt,
  type RelayDelivery,
  type RelayIdempotencyKey,
  isDecisionRequestQueueValid,
  isSeatHealthy,
  type RelayMessage,
  type RelayPassFailFact,
  type RelayProgressReceipt,
  type RelayReceipt,
  type RelayResponse,
  type RelayRoutingRule,
  type RelaySeatId,
  type RelayToolName,
  type RelayTransportResponseMethod,
  type SeatQuery,
} from "./durableRelay.ts";

export const RELAY_DURABLE_EVENT_SEQUENCE = [
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
] as const;

export type RelayDurableEventName = (typeof RELAY_DURABLE_EVENT_SEQUENCE)[number];

export type RelayTransportStrategy = "server-owned" | "manual-prompt-transport";

export type RelayStateMachineErrorCode =
  | "SEND_BACK_TO_SENDER"
  | "DUPLICATE_RESPONSE"
  | "UNAUTHORIZED_TARGET"
  | "PACK_MINT_REQUIRED"
  | "PACK_BLOCKED"
  | "INVALID_MODEL_ROUTING"
  | "DUPLICATE_DELIVERY"
  | "STALE_LEASE"
  | "AGENT_AUTHORED_NEXT_OWNER"
  | "POLICY_ILLEGAL_EXECUTION"
  | "MANUAL_PROMPT_TRANSPORT"
  | "SEAT_UNHEALTHY"
  | "INBOUND_ID_IS_NOT_OUTBOUND"
  | "INBOUND_RESPONSE_REQUIRES_COMPLETE"
  | "HOP_LIMIT_REACHED"
  | "ILLEGAL_TRANSITION";

export class RelayStateMachineError extends Error {
  readonly code: RelayStateMachineErrorCode;
  readonly receipt: RelayReceipt | null;

  constructor(code: RelayStateMachineErrorCode, message: string, receipt: RelayReceipt | null = null) {
    super(message);
    this.name = "RelayStateMachineError";
    this.code = code;
    this.receipt = receipt;
  }
}

export interface RelayMachineState {
  readonly message: RelayMessage;
  readonly delivery: RelayDelivery;
  readonly source_seat: AgentSeat;
  readonly target_seat: AgentSeat;
  readonly pack_binding: PackBinding | null;
  readonly authority_grant: AuthorityGrant | null;
  readonly decision_request: DecisionRequest | null;
  readonly response: RelayResponse | null;
  readonly durable_events: ReadonlyArray<RelayDurableEventName>;
  readonly receipts: ReadonlyArray<RelayReceipt>;
  readonly accepted_effect_keys: ReadonlyArray<RelayIdempotencyKey>;
  readonly effect_count: number;
  readonly original_message_answered: boolean;
  readonly policy_legal: boolean;
  readonly transport_strategy: RelayTransportStrategy;
  readonly routing_table: ReadonlyArray<RelayRoutingRule>;
}

export interface CreateRelayMachineStateInput {
  readonly message: RelayMessage;
  readonly delivery: RelayDelivery;
  readonly source_seat: AgentSeat;
  readonly target_seat: AgentSeat;
  readonly pack_binding: PackBinding | null;
  readonly authority_grant: AuthorityGrant | null;
  readonly decision_request: DecisionRequest | null;
  readonly policy_legal: boolean;
  readonly transport_strategy: RelayTransportStrategy;
  readonly routing_table: ReadonlyArray<RelayRoutingRule>;
}

export function createRelayMachineState(input: CreateRelayMachineStateInput): RelayMachineState {
  return {
    ...input,
    response: null,
    durable_events: [],
    receipts: [],
    accepted_effect_keys: [],
    effect_count: 0,
    original_message_answered: false,
  };
}

export function projectSeatPresence(seats: ReadonlyArray<AgentSeat>): ReadonlyArray<AgentSeat> {
  return seats.filter((seat) => seat.live);
}

export function listEligibleSeats(
  seats: ReadonlyArray<AgentSeat>,
  query: SeatQuery,
  senderSeatId?: RelaySeatId,
): ReadonlyArray<AgentSeat> {
  return seats.filter((seat) => {
    if (!seat.live || !isSeatHealthy(seat)) return false;
    if (query.allow_self !== true && senderSeatId !== undefined && seat.seat_id === senderSeatId) {
      return false;
    }
    const modelSupported = seat.model === query.model || seat.supported_models.includes(query.model);
    return (
      modelSupported &&
      seat.supported_reasoning_tiers.includes(query.reasoning_tier) &&
      seat.authority_tiers.includes(query.authority_tier) &&
      seat.task_kinds.includes(query.task_kind)
    );
  });
}

export function applyDurableEvent(
  state: RelayMachineState,
  event: RelayDurableEventName,
  now: string,
): RelayMachineState {
  if (event === "relay.delivered" && state.delivery.status !== "requested") {
    throw new RelayStateMachineError(
      "DUPLICATE_DELIVERY",
      `Delivery ${state.delivery.delivery_id} is already ${state.delivery.status}.`,
    );
  }
  const expected = RELAY_DURABLE_EVENT_SEQUENCE[state.durable_events.length];
  if (expected !== event) {
    throw new RelayStateMachineError(
      "ILLEGAL_TRANSITION",
      `Expected ${expected ?? "no further durable event"} but received ${event}.`,
    );
  }

  switch (event) {
    case "task.ready":
      return appendDurableEvent(state, event, {
        messageStatus: "ready",
        deliveryStatus: "ready",
        now,
      });
    case "relay.delivery-requested": {
      assertServerOwnedTransport(state);
      assertValidRouting(state);
      assertAuthorizedTarget(state);
      if (!isSeatHealthy(state.target_seat)) {
        throw new RelayStateMachineError(
          "SEAT_UNHEALTHY",
          `Seat ${state.target_seat.name} is present but unhealthy.`,
        );
      }
      return appendDurableEvent(state, event, {
        messageStatus: "delivery-requested",
        deliveryStatus: "requested",
        now,
      });
    }
    case "relay.delivered": {
      assertFreshLease(state, now);
      if (state.delivery.status !== "requested") {
        throw new RelayStateMachineError(
          "DUPLICATE_DELIVERY",
          `Delivery ${state.delivery.delivery_id} is already ${state.delivery.status}.`,
        );
      }
      return appendDurableEvent(state, event, {
        messageStatus: "delivered",
        deliveryStatus: "delivered",
        now,
      });
    }
    case "relay.admission-completed": {
      const pack = resolvePackBinding(state);
      if (pack === null) {
        const receipt = makeBlockerReceipt(state, "pack-mint-required", event);
        throw new RelayStateMachineError(
          "PACK_MINT_REQUIRED",
          "No onboarding pack is bound to this relay delivery.",
          receipt,
        );
      }
      if (
        pack.validation_state !== "valid" ||
        pack.admission_proof !== "validated" ||
        pack.freshness_expires_at <= now
      ) {
        const receipt = makeBlockerReceipt(state, "pack-blocked", event);
        throw new RelayStateMachineError(
          "PACK_BLOCKED",
          "The bound onboarding pack is stale, malformed, or lacks validated admission proof.",
          receipt,
        );
      }
      if (!isSeatHealthy(state.target_seat)) {
        throw new RelayStateMachineError(
          "SEAT_UNHEALTHY",
          `Seat ${state.target_seat.name} cannot pass admission while unhealthy.`,
        );
      }
      return appendDurableEvent(
        withReceipt(state, makeAdmissionReceipt(state, pack.pack_id, pack.boundary_applied)),
        event,
        {
          messageStatus: "admitted",
          deliveryStatus: "admitted",
          now,
        },
      );
    }
    case "task.execution-authorized": {
      assertServerOwnedTransport(state);
      if (!state.policy_legal) {
        throw new RelayStateMachineError(
          "POLICY_ILLEGAL_EXECUTION",
          "Admission shape is present, but policy legality is false.",
          makeBlockerReceipt(state, "policy-illegal", event),
        );
      }
      if (state.authority_grant === null || state.authority_grant.granted_tier !== state.message.authority_tier) {
        throw new RelayStateMachineError(
          "UNAUTHORIZED_TARGET",
          "Execution authority is absent or mismatched for this relay message.",
        );
      }
      return appendDurableEvent(state, event, {
        messageStatus: "execution-authorized",
        deliveryStatus: "execution-authorized",
        now,
      });
    }
    case "task.execution-completed": {
      if (!state.original_message_answered || state.response === null) {
        throw new RelayStateMachineError(
          "INBOUND_RESPONSE_REQUIRES_COMPLETE",
          "Inbound work must finish through completeInbound before execution can complete.",
        );
      }
      return appendDurableEvent(recordAcceptedEffect(state), event, {
        messageStatus: "completed",
        deliveryStatus: "execution-completed",
        now,
      });
    }
    case "digest.requested":
      return appendDurableEvent(state, event, {
        messageStatus: state.message.status,
        deliveryStatus: "digest-requested",
        now,
      });
    case "digest.completed":
      return appendDurableEvent(state, event, {
        messageStatus: state.message.status,
        deliveryStatus: "digest-completed",
        now,
      });
    case "validation.requested":
      return appendDurableEvent(state, event, {
        messageStatus: state.message.status,
        deliveryStatus: "validation-requested",
        now,
      });
    case "validation.completed":
      return appendDurableEvent(state, event, {
        messageStatus: "validated",
        deliveryStatus: "validation-completed",
        now,
      });
    case "authority-decision-requested": {
      if (state.decision_request === null || !isDecisionRequestQueueValid(state.decision_request)) {
        throw new RelayStateMachineError(
          "POLICY_ILLEGAL_EXECUTION",
          "Decision routing is not valid for the requested authority tier.",
          makeBlockerReceipt(state, "policy-illegal", event),
        );
      }
      return appendDurableEvent(state, event, {
        messageStatus: state.message.status,
        deliveryStatus: "decision-requested",
        now,
      });
    }
    case "authority-decision-recorded": {
      if (state.decision_request === null || state.decision_request.status !== "recorded") {
        throw new RelayStateMachineError(
          "ILLEGAL_TRANSITION",
          "A decision cannot be recorded before the request itself is recorded.",
        );
      }
      return appendDurableEvent(state, event, {
        messageStatus: state.message.status,
        deliveryStatus: "decision-recorded",
        now,
      });
    }
  }
}

export function completeInbound(
  state: RelayMachineState,
  responderSeatId: RelaySeatId,
  finalTurnOutput: string,
  completedAt: string,
): RelayMachineState {
  if (state.response !== null || state.original_message_answered) {
    throw new RelayStateMachineError(
      "DUPLICATE_RESPONSE",
      `Inbound message ${state.message.message_id} already has an accepted response.`,
    );
  }
  if (responderSeatId !== state.target_seat.seat_id) {
    throw new RelayStateMachineError(
      "UNAUTHORIZED_TARGET",
      "Only the targeted seat can complete an inbound relay delivery.",
    );
  }
  const response: RelayResponse = {
    response_id: makeResponseId(state.message.message_id),
    message_id: state.message.message_id,
    responder_seat_id: responderSeatId,
    output_text: finalTurnOutput as RelayResponse["output_text"],
    completed_at: completedAt,
    error_code: null,
  };
  return {
    ...state,
    response,
    original_message_answered: true,
    message: {
      ...state.message,
      status: "answered",
      updated_at: completedAt,
    },
    delivery: {
      ...state.delivery,
      status: "inbound-completed",
      last_accepted_event: "relay.inbound-completed",
      heartbeat: {
        ...state.delivery.heartbeat,
        last_seen_at: completedAt,
      },
    },
  };
}

export function attemptTransportResponse(
  state: RelayMachineState,
  method: RelayTransportResponseMethod,
): RelayMachineState {
  if (method === "relay.get" || method === "relay.await") {
    throw new RelayStateMachineError(
      "INBOUND_ID_IS_NOT_OUTBOUND",
      `Inbound message ${state.message.message_id} cannot be answered through ${method}.`,
    );
  }
  throw new RelayStateMachineError(
    "INBOUND_RESPONSE_REQUIRES_COMPLETE",
    "Inbound work can only answer through completeInbound(message_id, final_turn_output).",
  );
}

export function forwardInboundDelivery(
  state: RelayMachineState,
  targetSeat: AgentSeat,
  toolName: RelayToolName = "relay.send",
): RelayMachineState {
  if (toolName !== "relay.send") {
    throw new RelayStateMachineError(
      "INBOUND_RESPONSE_REQUIRES_COMPLETE",
      `Inbound forwarding is only meaningful through relay.send; received ${toolName}.`,
    );
  }
  if (targetSeat.seat_id === state.source_seat.seat_id || targetSeat.name === state.source_seat.name) {
    throw new RelayStateMachineError(
      "SEND_BACK_TO_SENDER",
      "Reply to the sender through normal turn completion, not a new relay send.",
    );
  }
  const nextHopCount = state.message.hop_count + 1;
  if (nextHopCount >= state.message.response_contract.max_hops) {
    throw new RelayStateMachineError(
      "HOP_LIMIT_REACHED",
      `Forwarding would reach the relay hop limit (${nextHopCount} >= ${state.message.response_contract.max_hops}).`,
    );
  }
  return {
    ...state,
    message: {
      ...state.message,
      hop_count: nextHopCount,
      target_seat_id: targetSeat.seat_id,
    },
    target_seat: targetSeat,
  };
}

export function setNextOwner(
  state: RelayMachineState,
  nextOwner: RelayDelivery["next_owner"],
  source: "server" | "agent",
): RelayMachineState {
  if (source !== "server") {
    throw new RelayStateMachineError(
      "AGENT_AUTHORED_NEXT_OWNER",
      "Agents cannot author next_owner assignments.",
      makeBlockerReceipt(state, "next-owner-write", "validation.completed"),
    );
  }
  return {
    ...state,
    delivery: {
      ...state.delivery,
      next_owner: nextOwner,
    },
  };
}

export function rewindForSeatTrip(
  state: RelayMachineState,
  replacementSeat: AgentSeat,
  recoveredAt: string,
): RelayMachineState {
  const rewoundEvents = state.durable_events.filter((event) => event !== "relay.delivered");
  return {
    ...state,
    target_seat: replacementSeat,
    response: null,
    original_message_answered: false,
    durable_events: rewoundEvents,
    message: {
      ...state.message,
      target_seat_id: replacementSeat.seat_id,
      status: "delivery-requested",
      updated_at: recoveredAt,
    },
    delivery: {
      ...state.delivery,
      target_seat_id: replacementSeat.seat_id,
      status: "requested",
      attempt_count: state.delivery.attempt_count + 1,
      retry_classification: "seat-tripped",
      recovery_owner: replacementSeat.seat_id,
      last_accepted_event: "relay.delivery-requested",
      lease: {
        ...state.delivery.lease,
        holder_seat_id: replacementSeat.seat_id,
        acquired_at: recoveredAt,
      },
      heartbeat: {
        ...state.delivery.heartbeat,
        last_seen_at: recoveredAt,
      },
    },
  };
}

export interface RelayDeadlineCheckResult {
  readonly state: RelayMachineState;
  readonly event: "relay.nudge" | "relay.escalation" | null;
  readonly receipt: RelayReceipt | null;
}

export function evaluateOwnershipDeadline(
  state: RelayMachineState,
  now: string,
): RelayDeadlineCheckResult {
  if (now <= state.delivery.next_owner.deadline) {
    return { state, event: null, receipt: null };
  }
  if (state.delivery.escalation_emitted) {
    return { state, event: null, receipt: null };
  }
  if (state.delivery.nudge_count === 0) {
    const receipt = makeProgressReceipt(state, "nudge-sent");
    return {
      event: "relay.nudge",
      receipt,
      state: withReceipt({
        ...state,
        delivery: {
          ...state.delivery,
          nudge_count: 1,
          last_nudge_at: now,
          last_accepted_event: "relay.nudge",
        },
      }, receipt),
    };
  }
  if (state.delivery.last_nudge_at !== now) {
    const receipt = makeBlockerReceipt(state, "ownership-overdue", "relay.escalation");
    return {
      event: "relay.escalation",
      receipt,
      state: withReceipt({
        ...state,
        delivery: {
          ...state.delivery,
          escalation_emitted: true,
          last_accepted_event: "relay.escalation",
        },
      }, receipt),
    };
  }
  return { state, event: null, receipt: null };
}

function appendDurableEvent(
  state: RelayMachineState,
  event: RelayDurableEventName,
  update: { readonly messageStatus: RelayMessage["status"]; readonly deliveryStatus: RelayDelivery["status"]; readonly now: string },
): RelayMachineState {
  return {
    ...state,
    durable_events: [...state.durable_events, event],
    message: {
      ...state.message,
      status: update.messageStatus,
      updated_at: update.now,
    },
    delivery: {
      ...state.delivery,
      status: update.deliveryStatus,
      last_accepted_event: event,
      heartbeat: {
        ...state.delivery.heartbeat,
        last_seen_at: update.now,
      },
    },
  };
}

function withReceipt(state: RelayMachineState, receipt: RelayReceipt): RelayMachineState {
  return {
    ...state,
    receipts: [...state.receipts, receipt],
  };
}

function assertServerOwnedTransport(state: RelayMachineState): void {
  if (state.transport_strategy !== "server-owned") {
    throw new RelayStateMachineError(
      "MANUAL_PROMPT_TRANSPORT",
      "Relay progression cannot depend on manual prompt transport.",
      makeBlockerReceipt(state, "manual-prompt-transport", "relay.delivery-requested"),
    );
  }
}

function assertValidRouting(state: RelayMachineState): void {
  const match = state.routing_table.find(
    (rule) =>
      rule.task_kind === state.message.task_kind &&
      rule.model === state.message.model &&
      rule.reasoning_tier === state.message.reasoning_tier,
  );
  if (!match) {
    throw new RelayStateMachineError(
      "INVALID_MODEL_ROUTING",
      `No routing rule matches ${state.message.task_kind} -> ${state.message.model}/${state.message.reasoning_tier}.`,
      makeBlockerReceipt(state, "invalid-model-routing", "relay.delivery-requested"),
    );
  }
}

function assertAuthorizedTarget(state: RelayMachineState): void {
  const query: SeatQuery = {
    task_kind: state.message.task_kind,
    model: state.message.model,
    reasoning_tier: state.message.reasoning_tier,
    authority_tier: state.message.authority_tier,
    allow_self: false,
  };
  const eligible = listEligibleSeats([state.target_seat], query, state.source_seat.seat_id);
  if (eligible.length === 0) {
    throw new RelayStateMachineError(
      "UNAUTHORIZED_TARGET",
      `Target seat ${state.target_seat.name} is not eligible for this relay delivery.`,
      makeBlockerReceipt(state, "unauthorized-target", "relay.delivery-requested"),
    );
  }
}

function assertFreshLease(state: RelayMachineState, now: string): void {
  if (state.delivery.lease.deadline <= now || state.delivery.heartbeat.deadline <= now) {
    throw new RelayStateMachineError(
      "STALE_LEASE",
      `Lease ${state.delivery.lease.lease_id} is stale and cannot advance.`,
      makeBlockerReceipt(state, "stale-lease", "relay.delivered"),
    );
  }
}

function resolvePackBinding(state: RelayMachineState): PackBinding | null {
  return state.pack_binding ?? state.message.pack_binding;
}

function recordAcceptedEffect(state: RelayMachineState): RelayMachineState {
  if (state.accepted_effect_keys.includes(state.message.idempotency_key)) {
    return state;
  }
  return {
    ...state,
    accepted_effect_keys: [...state.accepted_effect_keys, state.message.idempotency_key],
    effect_count: state.effect_count + 1,
  };
}

function makeReceiptId(messageId: MessageId, suffix: string): RelayReceipt["receipt_id"] {
  return `${messageId}-${suffix}` as RelayReceipt["receipt_id"];
}

function makeResponseId(messageId: MessageId): RelayResponse["response_id"] {
  return `${messageId}-response` as RelayResponse["response_id"];
}

function makeAdmissionReceipt(
  state: RelayMachineState,
  packId: PackBinding["pack_id"],
  boundaryApplied: boolean,
): RelayAdmissionReceipt {
  return {
    receipt_id: makeReceiptId(state.message.message_id, "admission"),
    name: "relay-admission" as RelayAdmissionReceipt["name"],
    status: "validated",
    kind: "admission",
    admission_status: "validated",
    pack_id: packId,
    boundary_applied: boundaryApplied,
    evidence_paths: [],
  };
}

function makeProgressReceipt(
  state: RelayMachineState,
  progressStatus: RelayProgressReceipt["progress_status"],
): RelayProgressReceipt {
  return {
    receipt_id: makeReceiptId(state.message.message_id, `progress-${progressStatus}`),
    name: "relay-progress" as RelayProgressReceipt["name"],
    status: "recorded",
    kind: "progress",
    progress_status: progressStatus,
    step_name: "ownership-deadline" as RelayProgressReceipt["step_name"],
    evidence_paths: [],
  };
}

function makeBlockerReceipt(
  state: RelayMachineState,
  blockerCategory: RelayBlockerCategory,
  blockedTransition: RelayBlockerReceipt["blocked_transition"],
): RelayBlockerReceipt {
  return {
    receipt_id: makeReceiptId(state.message.message_id, blockerCategory),
    name: "relay-blocker" as RelayBlockerReceipt["name"],
    status: "blocked",
    kind: "blocker",
    blocker_status: "blocked",
    blocker_category: blockerCategory,
    blocked_transition: blockedTransition,
    evidence_paths: [],
  };
}

export function makeVerificationFacts(
  names: ReadonlyArray<string>,
  status: RelayPassFailFact["status"],
): ReadonlyArray<RelayPassFailFact> {
  return names.map((name) => ({
    name: name as RelayPassFailFact["name"],
    status,
  }));
}

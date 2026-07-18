import { describe, expect, it } from "vite-plus/test";

import type { MessageId } from "./baseSchemas.ts";
import type {
  AgentSeat,
  AuthorityGrant,
  DecisionRequest,
  PackBinding,
  RelayDelivery,
  RelayIdempotencyKey,
  RelayMessage,
  RelayRoutingRule,
  RelaySeatId,
} from "./durableRelay.ts";
import { projectSeatPresence } from "./durableRelayStateMachine.ts";
import {
  applyDurableEvent,
  completeInbound,
  createRelayMachineState,
  evaluateOwnershipDeadline,
  forwardInboundDelivery,
  listEligibleSeats,
  RELAY_DURABLE_EVENT_SEQUENCE,
  RelayStateMachineError,
  rewindForSeatTrip,
  setNextOwner,
  attemptTransportResponse,
} from "./durableRelayStateMachine.ts";

const ISO = {
  t0: "2026-07-12T00:00:00.000Z",
  t1: "2026-07-12T00:01:00.000Z",
  t2: "2026-07-12T00:02:00.000Z",
  t3: "2026-07-12T00:03:00.000Z",
  t4: "2026-07-12T00:04:00.000Z",
  t5: "2026-07-12T00:05:00.000Z",
  t6: "2026-07-12T00:06:00.000Z",
  t7: "2026-07-12T00:07:00.000Z",
  t8: "2026-07-12T00:08:00.000Z",
  t9: "2026-07-12T00:09:00.000Z",
  t10: "2026-07-12T00:10:00.000Z",
  t11: "2026-07-12T00:11:00.000Z",
  t12: "2026-07-12T00:12:00.000Z",
  overdue: "2026-07-12T00:20:00.000Z",
} as const;

function brand<T>(value: string): T {
  return value as T;
}

function makeSeat(overrides: Partial<AgentSeat> = {}): AgentSeat {
  return {
    seat_id: brand(overrides.seat_id ?? "seat-opus"),
    session_id: brand(overrides.session_id ?? "session-opus"),
    name: brand(overrides.name ?? "opus-implementer"),
    live: overrides.live ?? true,
    model: brand(overrides.model ?? "gpt-5.4"),
    supported_models: overrides.supported_models ?? [brand("gpt-5.4")],
    supported_reasoning_tiers: overrides.supported_reasoning_tiers ?? ["high"],
    authority_tiers: overrides.authority_tiers ?? ["opus-implementer"],
    task_kinds: overrides.task_kinds ?? [brand("relay-contract-slice")],
    health: overrides.health ?? {
      model_ok: true,
      context_pct: 42,
      state: "healthy",
      updated: ISO.t0,
    },
  };
}

function makePackBinding(overrides: Partial<PackBinding> = {}): PackBinding {
  return {
    pack_id: brand(overrides.pack_id ?? "PACK-t3-native-relay-architecture"),
    lens_ref: brand(overrides.lens_ref ?? "lenses/Lens-T3-Native-Durable-Relay-Architecture-Codex-2026-07-10.md"),
    write_scope: overrides.write_scope ?? [brand("packages/contracts/src/durableRelay*.ts")],
    validation_state: overrides.validation_state ?? "valid",
    admission_proof: overrides.admission_proof ?? "validated",
    boundary_applied: overrides.boundary_applied ?? true,
    freshness_expires_at: overrides.freshness_expires_at ?? ISO.t12,
  };
}

function makeAuthorityGrant(overrides: Partial<AuthorityGrant> = {}): AuthorityGrant {
  return {
    grant_id: brand(overrides.grant_id ?? "grant-1"),
    granted_tier: overrides.granted_tier ?? "opus-implementer",
    granted_by: overrides.granted_by ?? "fable-cold-architect",
    write_scope: overrides.write_scope ?? [brand("packages/contracts/src/durableRelay*.ts")],
    issued_at: overrides.issued_at ?? ISO.t0,
    expires_at: overrides.expires_at ?? ISO.t12,
  };
}

function makeDecisionRequest(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    request_id: brand(overrides.request_id ?? "decision-1"),
    decision_kind: brand(overrides.decision_kind ?? "architecture-ruling"),
    requested_by: overrides.requested_by ?? "validator",
    requested_tier: overrides.requested_tier ?? "ryan-authority",
    queue: overrides.queue ?? "operator",
    status: overrides.status ?? "recorded",
    evidence_paths: overrides.evidence_paths ?? [brand("receipts/relay.txt")],
  };
}

function makeRoutingRule(overrides: Partial<RelayRoutingRule> = {}): RelayRoutingRule {
  return {
    task_kind: brand(overrides.task_kind ?? "relay-contract-slice"),
    model: brand(overrides.model ?? "gpt-5.4"),
    reasoning_tier: overrides.reasoning_tier ?? "high",
  };
}

function makeDelivery(
  targetSeatId: RelaySeatId,
  idempotencyKey: RelayIdempotencyKey,
  overrides: Partial<RelayDelivery> = {},
): RelayDelivery {
  return {
    delivery_id: brand(overrides.delivery_id ?? "delivery-1"),
    message_id: brand(overrides.message_id ?? "msg-1"),
    target_seat_id: overrides.target_seat_id ?? targetSeatId,
    status: overrides.status ?? "ready",
    lease: overrides.lease ?? {
      lease_id: brand("lease-1"),
      holder_seat_id: targetSeatId,
      acquired_at: ISO.t0,
      deadline: ISO.t12,
    },
    heartbeat: overrides.heartbeat ?? {
      last_seen_at: ISO.t0,
      deadline: ISO.t12,
    },
    attempt_count: overrides.attempt_count ?? 0,
    retry_classification: overrides.retry_classification ?? "none",
    last_accepted_event: overrides.last_accepted_event ?? "task.ready",
    recovery_owner: overrides.recovery_owner ?? targetSeatId,
    next_owner: overrides.next_owner ?? {
      seat_id: brand("seat-validator"),
      deadline: ISO.t12,
    },
    idempotency_key: overrides.idempotency_key ?? idempotencyKey,
    nudge_count: overrides.nudge_count ?? 0,
    last_nudge_at: overrides.last_nudge_at ?? null,
    escalation_emitted: overrides.escalation_emitted ?? false,
  };
}

function makeMessage(
  sourceSeatId: RelaySeatId,
  targetSeatId: RelaySeatId,
  packBinding: PackBinding | null,
  idempotencyKey: RelayIdempotencyKey,
  overrides: Partial<RelayMessage> = {},
): RelayMessage {
  return {
    task_kind: brand(overrides.task_kind ?? "relay-contract-slice"),
    task_id: brand(overrides.task_id ?? "task-r1"),
    step_id: brand(overrides.step_id ?? "step-contracts"),
    message_id: brand(overrides.message_id ?? "msg-1"),
    sender_seat_id: overrides.sender_seat_id ?? sourceSeatId,
    target_seat_id: overrides.target_seat_id ?? targetSeatId,
    model: brand(overrides.model ?? "gpt-5.4"),
    reasoning_tier: overrides.reasoning_tier ?? "high",
    authority_tier: overrides.authority_tier ?? "opus-implementer",
    pack_binding: overrides.pack_binding ?? packBinding,
    response_contract: overrides.response_contract ?? {
      mode: "text",
      requires_validator: true,
      max_hops: 5,
    },
    correlation_parent: overrides.correlation_parent ?? null,
    hop_count: overrides.hop_count ?? 0,
    idempotency_key: overrides.idempotency_key ?? idempotencyKey,
    status: overrides.status ?? "ready",
    created_at: overrides.created_at ?? ISO.t0,
    updated_at: overrides.updated_at ?? ISO.t0,
  };
}

function makeState(options?: {
  readonly packBinding?: PackBinding | null;
  readonly routingTable?: ReadonlyArray<RelayRoutingRule>;
  readonly policyLegal?: boolean;
  readonly targetSeat?: AgentSeat;
  readonly sourceSeat?: AgentSeat;
  readonly transportStrategy?: "server-owned" | "manual-prompt-transport";
  readonly authorityGrant?: AuthorityGrant | null;
  readonly decisionRequest?: DecisionRequest | null;
  readonly messageOverrides?: Partial<RelayMessage>;
  readonly deliveryOverrides?: Partial<RelayDelivery>;
}) {
  const sourceSeat = options?.sourceSeat ?? makeSeat({ seat_id: brand("seat-fable"), session_id: brand("session-fable"), name: brand("fable-architect"), authority_tiers: ["fable-cold-architect"] });
  const targetSeat = options?.targetSeat ?? makeSeat();
  const packBinding = options?.packBinding ?? makePackBinding();
  const idempotencyKey = brand<RelayIdempotencyKey>("idem-1");
  const message = makeMessage(
    sourceSeat.seat_id,
    targetSeat.seat_id,
    packBinding,
    idempotencyKey,
    options?.messageOverrides,
  );
  const delivery = makeDelivery(targetSeat.seat_id, idempotencyKey, {
    message_id: message.message_id,
    ...options?.deliveryOverrides,
  });
  return createRelayMachineState({
    message,
    delivery,
    source_seat: sourceSeat,
    target_seat: targetSeat,
    pack_binding: packBinding,
    authority_grant: options?.authorityGrant ?? makeAuthorityGrant(),
    decision_request: options?.decisionRequest ?? makeDecisionRequest(),
    policy_legal: options?.policyLegal ?? true,
    transport_strategy: options?.transportStrategy ?? "server-owned",
    routing_table: options?.routingTable ?? [makeRoutingRule()],
  });
}

function advance(state: ReturnType<typeof makeState>, events: ReadonlyArray<typeof RELAY_DURABLE_EVENT_SEQUENCE[number]>, startIndex = 0) {
  return events.reduce((current, event, index) => applyDurableEvent(current, event, Object.values(ISO)[startIndex + index] ?? ISO.t12), state);
}

function advanceToDelivered(state: ReturnType<typeof makeState>) {
  return advance(state, ["task.ready", "relay.delivery-requested", "relay.delivered"]);
}

function advanceToAuthorized(state: ReturnType<typeof makeState>) {
  return advance(state, [
    "task.ready",
    "relay.delivery-requested",
    "relay.delivered",
    "relay.admission-completed",
    "task.execution-authorized",
  ]);
}

function expectRelayError(fn: () => unknown, code: RelayStateMachineError["code"]) {
  try {
    fn();
    throw new Error(`Expected RelayStateMachineError(${code})`);
  } catch (error) {
    expect(error).toBeInstanceOf(RelayStateMachineError);
    const relayError = error as RelayStateMachineError;
    expect(relayError.code).toBe(code);
    return relayError;
  }
}

describe("durableRelayStateMachine", () => {
  it("completes the positive inbound auto-return path through the durable sequence", () => {
    let state = advanceToAuthorized(makeState());
    state = completeInbound(state, state.target_seat.seat_id, "implemented", ISO.t5);
    state = applyDurableEvent(state, "task.execution-completed", ISO.t6);
    state = applyDurableEvent(state, "digest.requested", ISO.t7);
    state = applyDurableEvent(state, "digest.completed", ISO.t8);
    state = applyDurableEvent(state, "validation.requested", ISO.t9);
    state = applyDurableEvent(state, "validation.completed", ISO.t10);
    state = applyDurableEvent(state, "authority-decision-requested", ISO.t11);
    state = applyDurableEvent(state, "authority-decision-recorded", ISO.t12);

    expect(state.original_message_answered).toBe(true);
    expect(state.response?.output_text).toBe("implemented");
    expect(state.effect_count).toBe(1);
    expect(state.durable_events).toEqual(RELAY_DURABLE_EVENT_SEQUENCE);
    expect(state.delivery.last_accepted_event).toBe("authority-decision-recorded");
  });

  it("NC-R1 rejects a send-back loop to the sender", () => {
    const state = advanceToAuthorized(makeState());
    expectRelayError(() => forwardInboundDelivery(state, state.source_seat), "SEND_BACK_TO_SENDER");
  });

  it("NC-R2 rejects a duplicate inbound response", () => {
    let state = advanceToAuthorized(makeState());
    state = completeInbound(state, state.target_seat.seat_id, "accepted", ISO.t5);
    expectRelayError(
      () => completeInbound(state, state.target_seat.seat_id, "duplicate", ISO.t6),
      "DUPLICATE_RESPONSE",
    );
  });

  it("NC-R3 rejects an unauthorized target seat", () => {
    const targetSeat = makeSeat({ authority_tiers: ["validator"] });
    const state = makeState({ targetSeat });
    const ready = applyDurableEvent(state, "task.ready", ISO.t0);
    expectRelayError(() => applyDurableEvent(ready, "relay.delivery-requested", ISO.t1), "UNAUTHORIZED_TARGET");
  });

  it("NC-R4 distinguishes missing packs from blocked packs and admission-proof failures", () => {
    const base = advanceToDelivered(makeState());

    const missing = {
      ...base,
      pack_binding: null,
      message: { ...base.message, pack_binding: null },
    };
    const mintRequired = expectRelayError(
      () => applyDurableEvent(missing, "relay.admission-completed", ISO.t3),
      "PACK_MINT_REQUIRED",
    );
    expect(mintRequired.receipt?.kind).toBe("blocker");
    if (mintRequired.receipt?.kind === "blocker") {
      expect(mintRequired.receipt.blocker_category).toBe("pack-mint-required");
    }

    const stale = {
      ...base,
      pack_binding: makePackBinding({ validation_state: "stale" }),
    };
    const staleBlocked = expectRelayError(
      () => applyDurableEvent(stale, "relay.admission-completed", ISO.t3),
      "PACK_BLOCKED",
    );
    if (staleBlocked.receipt?.kind === "blocker") {
      expect(staleBlocked.receipt.blocker_category).toBe("pack-blocked");
    }

    const malformed = {
      ...base,
      pack_binding: makePackBinding({ validation_state: "malformed" }),
    };
    expectRelayError(
      () => applyDurableEvent(malformed, "relay.admission-completed", ISO.t3),
      "PACK_BLOCKED",
    );

    const invalidProof = {
      ...base,
      pack_binding: makePackBinding({ admission_proof: "missing" }),
    };
    expectRelayError(
      () => applyDurableEvent(invalidProof, "relay.admission-completed", ISO.t3),
      "PACK_BLOCKED",
    );
  });

  it("NC-R5 rejects missing or invalid model routing", () => {
    const state = makeState({ routingTable: [] });
    const ready = applyDurableEvent(state, "task.ready", ISO.t0);
    expectRelayError(() => applyDurableEvent(ready, "relay.delivery-requested", ISO.t1), "INVALID_MODEL_ROUTING");
  });

  it("NC-R6 detects a duplicate delivery", () => {
    const state = advanceToDelivered(makeState());
    expectRelayError(() => applyDurableEvent(state, "relay.delivered", ISO.t3), "DUPLICATE_DELIVERY");
  });

  it("NC-R7 refuses to advance a stale lease", () => {
    const state = makeState({
      deliveryOverrides: {
        lease: {
          lease_id: brand("lease-stale"),
          holder_seat_id: brand("seat-opus"),
          acquired_at: ISO.t0,
          deadline: ISO.t0,
        },
      },
    });
    const ready = applyDurableEvent(state, "task.ready", ISO.t0);
    const requested = applyDurableEvent(ready, "relay.delivery-requested", ISO.t1);
    expectRelayError(() => applyDurableEvent(requested, "relay.delivered", ISO.overdue), "STALE_LEASE");
  });

  it("NC-R8 rejects agent-authored next_owner edits", () => {
    const state = makeState();
    expectRelayError(
      () =>
        setNextOwner(
          state,
          {
            seat_id: brand("seat-codex"),
            deadline: ISO.t12,
          },
          "agent",
        ),
      "AGENT_AUTHORED_NEXT_OWNER",
    );
  });

  it("NC-R9 rejects execution when the receipt shape is valid but policy legality is false", () => {
    const state = advanceToDelivered(makeState({ policyLegal: false }));
    const admitted = applyDurableEvent(state, "relay.admission-completed", ISO.t3);
    expectRelayError(
      () => applyDurableEvent(admitted, "task.execution-authorized", ISO.t4),
      "POLICY_ILLEGAL_EXECUTION",
    );
  });

  it("NC-R10 fails the tracer when manual prompt transport is required", () => {
    const state = makeState({ transportStrategy: "manual-prompt-transport" });
    const ready = applyDurableEvent(state, "task.ready", ISO.t0);
    expectRelayError(
      () => applyDurableEvent(ready, "relay.delivery-requested", ISO.t1),
      "MANUAL_PROMPT_TRANSPORT",
    );
  });

  it("NC-R11 rewinds on a tripped seat, re-delivers under the same idempotency key, and accepts zero duplicate effects", () => {
    let state = advanceToDelivered(makeState());
    const replacementSeat = makeSeat({ seat_id: brand("seat-codex"), session_id: brand("session-codex"), name: brand("codex-digest"), authority_tiers: ["opus-implementer"], task_kinds: [brand("relay-contract-slice")] });

    state = rewindForSeatTrip(state, replacementSeat, ISO.t4);
    expect(state.delivery.attempt_count).toBe(1);
    expect(state.delivery.idempotency_key).toBe(brand<RelayIdempotencyKey>("idem-1"));
    expect(state.durable_events).toEqual(["task.ready", "relay.delivery-requested"]);

    state = applyDurableEvent(state, "relay.delivered", ISO.t5);
    state = applyDurableEvent(state, "relay.admission-completed", ISO.t6);
    state = applyDurableEvent(state, "task.execution-authorized", ISO.t7);
    state = completeInbound(state, state.target_seat.seat_id, "recovered", ISO.t8);
    state = applyDurableEvent(state, "task.execution-completed", ISO.t9);

    expect(state.delivery.retry_classification).toBe("seat-tripped");
    expect(state.effect_count).toBe(1);
    expect(state.accepted_effect_keys).toEqual([brand<RelayIdempotencyKey>("idem-1")]);
  });

  it("NC-R12 keeps unhealthy seats visible in presence but excludes them from eligibility", () => {
    const healthy = makeSeat({ seat_id: brand("seat-healthy") });
    const tripped = makeSeat({
      seat_id: brand("seat-tripped"),
      health: {
        model_ok: true,
        context_pct: 88,
        state: "tripped",
        updated: ISO.t1,
      },
    });
    const seats = [healthy, tripped];
    const presence = projectSeatPresence(seats);
    const eligible = listEligibleSeats(
      seats,
      {
        task_kind: brand("relay-contract-slice"),
        model: brand("gpt-5.4"),
        reasoning_tier: "high",
        authority_tier: "opus-implementer",
        allow_self: false,
      },
      brand("seat-fable"),
    );

    expect(presence.map((seat) => seat.seat_id)).toEqual([brand("seat-healthy"), brand("seat-tripped")]);
    expect(eligible.map((seat) => seat.seat_id)).toEqual([brand("seat-healthy")]);
  });

  it("NC-R13 emits exactly one nudge then one escalation for overdue ownership", () => {
    const state = makeState({
      deliveryOverrides: {
        next_owner: {
          seat_id: brand("seat-validator"),
          deadline: ISO.t0,
        },
      },
    });

    const first = evaluateOwnershipDeadline(state, ISO.t1);
    expect(first.event).toBe("relay.nudge");
    expect(first.receipt?.kind).toBe("progress");

    const second = evaluateOwnershipDeadline(first.state, ISO.t2);
    expect(second.event).toBe("relay.escalation");
    expect(second.receipt?.kind).toBe("blocker");
    if (second.receipt?.kind === "blocker") {
      expect(second.receipt.blocker_category).toBe("ownership-overdue");
    }

    const third = evaluateOwnershipDeadline(second.state, ISO.t3);
    expect(third.event).toBeNull();
    expect(third.receipt).toBeNull();
  });

  it("NC-R14 rejects send/get/await as inbound response mechanisms and leaves the original message unanswered", () => {
    const state = advanceToAuthorized(makeState());
    for (const method of ["relay.send", "relay.get", "relay.await"] as const) {
      const error = expectRelayError(() => attemptTransportResponse(state, method), method === "relay.send" ? "INBOUND_RESPONSE_REQUIRES_COMPLETE" : "INBOUND_ID_IS_NOT_OUTBOUND");
      expect(error.receipt).toBeNull();
      expect(state.original_message_answered).toBe(false);
    }
  });
});

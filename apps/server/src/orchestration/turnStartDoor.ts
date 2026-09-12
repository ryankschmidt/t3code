import {
  DEFAULT_TURN_START_BUDGET,
  HUMAN_TURN_START_SENDER,
  type TurnStartRefusalReason,
  type TurnStartSender,
} from "@t3tools/contracts";
import { createHash } from "node:crypto";

/**
 * The turn-start door: the one place a turn can be refused before any tokens
 * are spent.
 *
 * WHY THIS EXISTS, measured rather than assumed. Between 2026-08-29 and
 * 2026-09-10 the launchd job `com.ryan.seat-breather` delivered into thread
 * f106e003-0db9-4d56-a8c9-9a8b9358c11b every three to five minutes for twelve
 * days. The receiving seat answered every one: 1,128 user messages, 1,285
 * assistant messages, 1,116 of the user messages beginning "BREATHER:".
 * Nothing asked whether the message was a repeat and nothing told it to stop.
 *
 * TWO MEASUREMENTS SHAPED THIS MODULE, and both contradict the obvious design:
 *
 * 1. THOSE 1,116 MESSAGES HOLD 1,029 DISTINCT TEXTS. They were never byte
 *    identical — the sentence carries a live counter ("is quiet 4 min", "is
 *    quiet 114 min") and a quoted next-act tail that drifted. A door keyed on
 *    sha256 of the raw text refuses 87 of 1,116 and lets the drain through
 *    while passing its own test suite. So the hash this module keys on is a
 *    SHAPE hash: volatile runs are masked before hashing, which collapses the
 *    same 1,116 messages to 19 distinct shapes.
 *
 * 2. "A NEW ASSISTANT RECORD" CANNOT BE THE WINDOW RESET. The receiving seat
 *    answered every delivery, so an assistant record followed essentially all
 *    1,116 of them. Any budget that an assistant reply refills is refilled by
 *    the very loop it is meant to stop. The window here resets on one thing
 *    only: a message from `human-composer`. A machine cannot hand itself more
 *    budget by provoking an answer.
 *
 * The door is a PURE function of the command and the thread's own retained
 * messages. It keeps no mutable table, so there is nothing to hydrate after a
 * server restart and nothing that can disagree with the event log — the
 * `sender` recorded on each persisted message IS the door's state.
 */

/** Trim and collapse whitespace. Identity for everything that matters. */
export function normalizeTurnStartText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Mask the parts of a message that a sender varies without changing what it is
 * asking for, then hash. Masked, in this order: UUIDs, ISO timestamps, long hex
 * runs, and every remaining digit run.
 *
 * This is deliberately aggressive and the tradeoff is stated rather than
 * hidden. Two messages that differ ONLY in their numbers are treated as the
 * same request. That is what makes "is quiet 4 min" and "is quiet 114 min" one
 * shape, and it is the entire reason the door catches the measured incident. It
 * also means a sender whose only real difference is a number — "retry 1 of 5" —
 * is budgeted as a repeat. That is the correct default: the budget is per
 * window and a human message refills it, so the cost of the false match is a
 * refusal the operator can see and undo, while the cost of the false miss was
 * twelve days of full turns nobody saw.
 */
export function turnStartTextShapeHash(text: string): string {
  const shape = normalizeTurnStartText(text)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?/g, "<ts>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<hex>")
    .replace(/\d+/g, "<n>");
  return createHash("sha256").update(shape).digest("hex");
}

/** The slice of a thread message the door reads. Assistant text is never read. */
export type TurnStartDoorMessage = {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly sender?: TurnStartSender | undefined;
};

export type TurnStartDoorInput = {
  readonly sender: TurnStartSender;
  readonly text: string;
  /** The thread's retained messages, oldest first. */
  readonly messages: ReadonlyArray<TurnStartDoorMessage>;
  readonly budget?: number | undefined;
};

export type TurnStartDecision =
  | {
      readonly kind: "allow";
      readonly textShapeHash: string;
      readonly deliveryCount: number;
      readonly budget: number;
    }
  | {
      readonly kind: "refuse";
      readonly reason: TurnStartRefusalReason;
      readonly detail: string;
      readonly textShapeHash: string;
      readonly deliveryCount: number;
      readonly budget: number;
    };

/**
 * Index of the first message that belongs to the current budget window: one
 * past the newest `human-composer` message, or 0 when a human has never spoken
 * on this thread.
 *
 * Messages persisted before this field existed carry no sender. They are read
 * as `unknown`, never as human, so historical data can only make the door
 * stricter — it cannot silently hand a daemon a fresh window.
 */
function windowStartIndex(messages: ReadonlyArray<TurnStartDoorMessage>): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.sender === HUMAN_TURN_START_SENDER) {
      return index + 1;
    }
  }
  return 0;
}

export function decideTurnStart(input: TurnStartDoorInput): TurnStartDecision {
  const budget = input.budget ?? DEFAULT_TURN_START_BUDGET;
  const textShapeHash = turnStartTextShapeHash(input.text);

  // A person typing in the composer is never budgeted and never counted.
  if (input.sender === HUMAN_TURN_START_SENDER) {
    return { kind: "allow", textShapeHash, deliveryCount: 0, budget };
  }

  const start = windowStartIndex(input.messages);
  let deliveryCount = 0;
  for (let index = start; index < input.messages.length; index += 1) {
    const message = input.messages[index];
    if (message !== undefined && message.role === "user" && message.sender === input.sender) {
      deliveryCount += 1;
    }
  }

  // Hammering: the newest message on the thread is this sender's own previous
  // delivery of this same shape, so the last one produced nothing at all — not
  // an answer, not another message. Refusing here is independent of budget,
  // because a sender that re-fires before anything happened is already wrong.
  const newest = input.messages.at(-1);
  if (
    newest !== undefined &&
    newest.role === "user" &&
    newest.sender === input.sender &&
    turnStartTextShapeHash(newest.text) === textShapeHash
  ) {
    return {
      kind: "refuse",
      reason: "unchanged-repeat",
      detail: `Sender '${input.sender}' repeated the same message shape with nothing on the thread since its last delivery.`,
      textShapeHash,
      deliveryCount,
      budget,
    };
  }

  if (deliveryCount >= budget) {
    return {
      kind: "refuse",
      reason: "budget-exhausted",
      detail: `Sender '${input.sender}' has already started ${deliveryCount} turns on this thread since the last human message; the budget is ${budget}.`,
      textShapeHash,
      deliveryCount,
      budget,
    };
  }

  return { kind: "allow", textShapeHash, deliveryCount, budget };
}

import { readFile } from "node:fs/promises";
import { assertProtectedPath } from "./protected-files.ts";
import { ProtectedDatabase } from "./protected-database.ts";
import type {
  InferenceGatewayDependencies,
  InferencePermit,
  InferenceSettlement,
} from "./inference-gateway.ts";

export type BudgetLedgerOptions = { root: string; authorityUid: number };
export type BudgetSettlement = InferenceSettlement & { grantId: string };
export type SettlementResult = BudgetSettlement & { replayed: boolean };
type Usage = Pick<
  InferenceSettlement,
  "inputTokens" | "outputTokens" | "reasoningTokens" | "totalTokens"
>;

const id = (value: unknown, code: string): string => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))
    throw Error(code);
  return value;
};
const positive = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const SPENT =
  "COALESCE((SELECT SUM(COALESCE(settled_total,max_cost)) FROM reservations r WHERE r.grant_id=c.grant_id),0)";
const SCHEMA =
  "CREATE TABLE ceilings(grant_id TEXT PRIMARY KEY,ceiling INTEGER NOT NULL CHECK(ceiling>0)); CREATE TABLE reservations(reservation_id TEXT PRIMARY KEY,grant_id TEXT NOT NULL REFERENCES ceilings(grant_id),max_cost INTEGER NOT NULL CHECK(max_cost>0),settled_total INTEGER,settlement TEXT);";

/**
 * Durable per-grant token budget. Only the grant-issuing path sets a ceiling; the gateway sees only
 * remaining, reserve and settle through gatewayBudget. Each reservation and settlement is one
 * BEGIN IMMEDIATE transaction, so concurrent connections cannot both spend the same tokens.
 */
export class BudgetLedger {
  private readonly store: ProtectedDatabase;
  private readonly db: ProtectedDatabase["db"];
  private constructor(store: ProtectedDatabase) {
    this.store = store;
    this.db = store.db;
  }
  /** Creates budget.sqlite on first use; the folder must already be protected. */
  static async open(options: BudgetLedgerOptions): Promise<BudgetLedger> {
    return new BudgetLedger(
      await ProtectedDatabase.open(options, "budget.sqlite", "BUDGET_LEDGER", SCHEMA),
    );
  }
  close() {
    this.store.close();
  }
  private check() {
    return this.store.check();
  }
  private transaction<T>(work: () => T): T {
    return this.store.transaction(work);
  }
  private remainingNow(grantId: string): number {
    const row = this.db
      .prepare(`SELECT c.ceiling - ${SPENT} AS remaining FROM ceilings c WHERE c.grant_id=?`)
      .get(grantId);
    if (!row) throw Error("NO_CEILING");
    const remaining = row.remaining;
    if (typeof remaining !== "number" || !Number.isSafeInteger(remaining))
      throw Error("BUDGET_LEDGER_CORRUPT");
    return remaining;
  }
  /** Grant-issuing path only. The same value again is a no-op; a different value is refused. */
  async setCeiling(input: { grantId: string; ceiling: number }): Promise<void> {
    const grantId = id(input.grantId, "INVALID_GRANT_IDENTIFIER");
    const ceiling = input.ceiling;
    if (!positive(ceiling)) throw Error("INVALID_CEILING");
    await this.check();
    this.transaction(() => {
      const row = this.db.prepare("SELECT ceiling FROM ceilings WHERE grant_id=?").get(grantId);
      if (row) {
        if (row.ceiling !== ceiling) throw Error("CEILING_ALREADY_SET");
        return;
      }
      this.db.prepare("INSERT INTO ceilings(grant_id,ceiling) VALUES(?,?)").run(grantId, ceiling);
    });
  }
  /** ceiling - sum over reservations of (settled ? actual total : maxCost); throws without a ceiling. */
  async remaining(grantId: string): Promise<number> {
    id(grantId, "INVALID_GRANT_IDENTIFIER");
    await this.check();
    return this.remainingNow(grantId);
  }
  /** Check and charge in one transaction; false, charging nothing, when maxCost does not fit. */
  async reserve(input: {
    grantId: string;
    reservationId: string;
    maxCost: number;
  }): Promise<boolean> {
    const grantId = id(input.grantId, "INVALID_GRANT_IDENTIFIER");
    const reservationId = id(input.reservationId, "INVALID_RESERVATION_IDENTIFIER");
    const maxCost = input.maxCost;
    if (!positive(maxCost)) throw Error("INVALID_MAX_COST");
    await this.check();
    return this.transaction(() => {
      const remaining = this.remainingNow(grantId);
      if (this.db.prepare("SELECT 1 FROM reservations WHERE reservation_id=?").get(reservationId))
        throw Error("RESERVATION_EXISTS");
      if (maxCost > remaining) return false;
      this.db
        .prepare("INSERT INTO reservations(reservation_id,grant_id,max_cost) VALUES(?,?,?)")
        .run(reservationId, grantId, maxCost);
      return true;
    });
  }
  /**
   * Records actual usage once, in one transaction. A later call for the same reservation changes
   * nothing and returns the first result. An overrun (total above maxCost) is charged in full.
   */
  async settle(input: BudgetSettlement): Promise<SettlementResult> {
    const grantId = id(input.grantId, "INVALID_GRANT_IDENTIFIER");
    const reservationId = id(input.reservationId, "INVALID_RESERVATION_IDENTIFIER");
    const { maxCost, inputTokens, outputTokens, reasoningTokens, totalTokens, boundExceeded } =
      input;
    if (
      !positive(maxCost) ||
      ![inputTokens, outputTokens, reasoningTokens, totalTokens].every(count) ||
      boundExceeded !== totalTokens > maxCost
    )
      throw Error("INVALID_SETTLEMENT");
    const record: BudgetSettlement = {
      reservationId,
      grantId,
      maxCost,
      inputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens,
      boundExceeded,
    };
    await this.check();
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT grant_id,max_cost,settlement FROM reservations WHERE reservation_id=?")
        .get(reservationId);
      if (!row) throw Error("RESERVATION_NOT_FOUND");
      if (row.grant_id !== grantId) throw Error("RESERVATION_GRANT_MISMATCH");
      if (row.max_cost !== maxCost) throw Error("SETTLEMENT_MAX_COST_MISMATCH");
      if (row.settlement !== null)
        return { ...(JSON.parse(row.settlement as string) as BudgetSettlement), replayed: true };
      this.db
        .prepare("UPDATE reservations SET settled_total=?,settlement=? WHERE reservation_id=?")
        .run(totalTokens, JSON.stringify(record), reservationId);
      return { ...record, replayed: false };
    });
  }
}

/** The gateway's budget dependencies, keyed by the permit's grantId. It cannot set a ceiling. */
export function gatewayBudget(
  ledger: Pick<BudgetLedger, "remaining" | "reserve" | "settle">,
): Pick<InferenceGatewayDependencies, "remainingTokens" | "reserve" | "settle"> {
  return {
    remainingTokens: (permit: InferencePermit) => ledger.remaining(permit.grantId),
    reserve: (permit, request) =>
      ledger.reserve({
        grantId: permit.grantId,
        reservationId: request.reservationId,
        maxCost: request.maxCost,
      }),
    async settle(permit, settlement) {
      await ledger.settle({ ...settlement, grantId: permit.grantId });
    },
  };
}

function journalAttempt(
  value: unknown,
): { reservationId: string; grantId: string; maxCost: number; actual: Usage } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const line = value as Record<string, unknown>;
  const actual = line.actual as Record<string, unknown> | null | undefined;
  if (
    Object.hasOwn(line, "event") ||
    Object.hasOwn(line, "settled") ||
    typeof line.reservationId !== "string" ||
    typeof line.grantId !== "string" ||
    typeof line.maxCost !== "number" ||
    !actual ||
    typeof actual !== "object"
  )
    return null;
  return {
    reservationId: line.reservationId,
    grantId: line.grantId,
    maxCost: line.maxCost,
    actual: {
      inputTokens: actual.inputTokens as number,
      outputTokens: actual.outputTokens as number,
      reasoningTokens: actual.reasoningTokens as number,
      totalTokens: actual.totalTokens as number,
    },
  };
}

/**
 * Re-applies every journal attempt that has no completion line through settle. Settlement is
 * idempotent per reservation, so replaying twice changes nothing the second time.
 */
export async function replaySettlementJournal(
  journalPath: string,
  ledger: Pick<BudgetLedger, "settle">,
  authorityUid: number,
): Promise<{ applied: string[]; alreadySettled: string[]; failed: string[] }> {
  await assertProtectedPath(journalPath, authorityUid);
  const attempts = new Map<string, NonNullable<ReturnType<typeof journalAttempt>>>();
  const completed = new Set<string>();
  for (const text of (await readFile(journalPath, "utf8")).split("\n")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue; // A torn line is not an attempt.
    }
    const line = parsed as { reservationId?: unknown; settled?: unknown } | null;
    if (line && line.settled === true && typeof line.reservationId === "string")
      completed.add(line.reservationId);
    const attempt = journalAttempt(parsed);
    if (attempt && !attempts.has(attempt.reservationId))
      attempts.set(attempt.reservationId, attempt);
  }
  const result = {
    applied: [] as string[],
    alreadySettled: [] as string[],
    failed: [] as string[],
  };
  for (const { reservationId, grantId, maxCost, actual } of attempts.values()) {
    if (completed.has(reservationId)) continue;
    try {
      const settled = await ledger.settle({
        reservationId,
        grantId,
        maxCost,
        ...actual,
        boundExceeded: actual.totalTokens > maxCost,
      });
      (settled.replayed ? result.alreadySettled : result.applied).push(reservationId);
    } catch {
      result.failed.push(reservationId);
    }
  }
  return result;
}

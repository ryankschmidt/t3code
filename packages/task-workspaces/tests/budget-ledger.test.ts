import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BudgetLedger, gatewayBudget, replaySettlementJournal } from "../src/budget-ledger.ts";
import type { InferencePermit } from "../src/inference-gateway.ts";

const usage = (totalTokens: number) => ({
  inputTokens: totalTokens - 1,
  outputTokens: 1,
  reasoningTokens: 0,
  totalTokens,
});
async function fixture(t: test.TestContext) {
  // /tmp is deliberately not used: writable ancestry must fail the protected-path check.
  const root = await mkdtemp(join(homedir(), ".budget-ledger-test-"));
  await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { root, authorityUid: process.getuid!() };
  const open = async () => {
    const ledger = await BudgetLedger.open(options);
    t.after(() => ledger.close());
    return ledger;
  };
  return { root, options, open };
}

test("a grant's ceiling is set once: the same value is a no-op, a different value is refused", async (t) => {
  const f = await fixture(t);
  const ledger = await f.open();
  await ledger.setCeiling({ grantId: "grant1", ceiling: 1000 });
  await ledger.setCeiling({ grantId: "grant1", ceiling: 1000 });
  await assert.rejects(
    ledger.setCeiling({ grantId: "grant1", ceiling: 5000 }),
    /CEILING_ALREADY_SET/,
  );
  await assert.rejects(
    ledger.setCeiling({ grantId: "grant1", ceiling: 10 }),
    /CEILING_ALREADY_SET/,
  );
  assert.equal(await ledger.remaining("grant1"), 1000);
});

test("reserve refuses without a ceiling, a reused reservation id, or a cost above remaining", async (t) => {
  const f = await fixture(t);
  const ledger = await f.open();
  await assert.rejects(
    ledger.reserve({ grantId: "grant1", reservationId: "r1", maxCost: 1 }),
    /NO_CEILING/,
  );
  await assert.rejects(ledger.remaining("grant1"), /NO_CEILING/);
  await ledger.setCeiling({ grantId: "grant1", ceiling: 100 });
  assert.equal(await ledger.reserve({ grantId: "grant1", reservationId: "r1", maxCost: 60 }), true);
  await assert.rejects(
    ledger.reserve({ grantId: "grant1", reservationId: "r1", maxCost: 10 }),
    /RESERVATION_EXISTS/,
  );
  assert.equal(
    await ledger.reserve({ grantId: "grant1", reservationId: "r2", maxCost: 41 }),
    false,
  );
  assert.equal(await ledger.remaining("grant1"), 40);
  assert.equal(await ledger.reserve({ grantId: "grant1", reservationId: "r2", maxCost: 40 }), true);
  assert.equal(await ledger.remaining("grant1"), 0);
});

/**
 * A second process with its own ledger connection, running one ledger operation. Barrier: it
 * prints ATTEMPT when the operation starts its transaction (on BEGIN IMMEDIATE) or, if the
 * operation has no such transaction, right after the operation's first read. With pause, it then
 * waits for a GO line before continuing.
 */
function ledgerChild(
  t: test.TestContext,
  options: { root: string; authorityUid: number },
  operation: string,
  pause: boolean,
) {
  const url = new URL(
    `../src/budget-ledger.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`,
    import.meta.url,
  ).href;
  const code = [
    `import { DatabaseSync, StatementSync } from "node:sqlite";`,
    `import { readSync, writeSync } from "node:fs";`,
    `import { BudgetLedger } from ${JSON.stringify(url)};`,
    `const waitLine = () => { const b = Buffer.alloc(1); for (;;) { try { if (readSync(0, b, 0, 1, null) === 1 && b[0] === 10) return; } catch (e) { if (e.code !== "EAGAIN") throw e; } } };`,
    `let armed = false;`,
    `const reached = () => { if (!armed) return; armed = false; writeSync(1, "ATTEMPT\\n");${pause ? " waitLine();" : ""} };`,
    `const exec = DatabaseSync.prototype.exec;`,
    `DatabaseSync.prototype.exec = function (sql) { if (sql === "BEGIN IMMEDIATE") reached(); return exec.call(this, sql); };`,
    `const get = StatementSync.prototype.get;`,
    `StatementSync.prototype.get = function (...args) { const row = get.apply(this, args); reached(); return row; };`,
    `const ledger = await BudgetLedger.open(${JSON.stringify(options)});`,
    `writeSync(1, "OPENED\\n");`,
    `waitLine();`,
    `armed = true;`,
    `const result = await ledger.${operation};`,
    `writeSync(1, JSON.stringify({ result }) + "\\n");`,
    `ledger.close();`,
    `process.exit(0);`,
  ].join("\n");
  const child = spawn(process.execPath, ["--no-warnings", "--input-type=module", "-e", code], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  let output = "",
    errors = "",
    exited = false;
  const waiters = new Set<() => void>();
  const notify = () => [...waiters].forEach((w) => w());
  child.stdout!.on("data", (b) => {
    output += b.toString();
    notify();
  });
  child.stderr!.on("data", (b) => (errors += b.toString()));
  child.once("exit", () => {
    exited = true;
    notify();
  });
  /** Resolves once the child printed text; rejects if it exited without printing it. */
  const line = (text: string) =>
    new Promise<void>((resolve, reject) => {
      const check = () => {
        if (output.includes(text)) resolve();
        else if (exited) reject(Error(`child exited before ${JSON.stringify(text)}: ${errors}`));
        else return;
        waiters.delete(check);
      };
      waiters.add(check);
      check();
    });
  return {
    line,
    send: (text: string) => child.stdin!.write(`${text}\n`),
    result: async () => {
      await line("}\n");
      const printed = output.split("\n").find((l) => l.startsWith("{"))!;
      return (JSON.parse(printed) as { result: unknown }).result;
    },
  };
}

test(
  "a reservation attempted while another connection holds the write lock cannot overspend",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const ledger = await f.open();
    await ledger.setCeiling({ grantId: "grant1", ceiling: 100 });
    const child = ledgerChild(
      t,
      f.options,
      `reserve({ grantId: "grant1", reservationId: "second", maxCost: 60 })`,
      false,
    );
    await child.line("OPENED\n");
    // A second connection holds the write lock with an uncommitted reservation of the whole budget.
    const holder = new DatabaseSync(join(f.root, "budget.sqlite"));
    t.after(() => holder.close());
    holder.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
    holder
      .prepare(
        "INSERT INTO reservations(reservation_id,grant_id,max_cost) VALUES('held','grant1',100)",
      )
      .run();
    child.send("GO");
    // Barrier: the child has started its reservation while the holder's transaction is open.
    await child.line("ATTEMPT\n");
    holder.exec("COMMIT");
    assert.equal(await child.result(), false);
    assert.equal(await ledger.remaining("grant1"), 0);
    const rows = holder.prepare("SELECT reservation_id FROM reservations ORDER BY 1").all();
    assert.deepEqual(
      rows.map((r) => r.reservation_id),
      ["held"],
    );
  },
);

test(
  "two processes settling one reservation at the same moment apply it exactly once",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const ledger = await f.open();
    await ledger.setCeiling({ grantId: "grant1", ceiling: 1000 });
    await ledger.reserve({ grantId: "grant1", reservationId: "r1", maxCost: 300 });
    const settle = (total: number) =>
      `settle(${JSON.stringify({ grantId: "grant1", reservationId: "r1", maxCost: 300, ...usage(total), boundExceeded: false })})`;
    const children = [
      ledgerChild(t, f.options, settle(100), true),
      ledgerChild(t, f.options, settle(200), true),
    ];
    for (const child of children) await child.line("OPENED\n");
    for (const child of children) child.send("GO");
    // Barrier: both have reached their settlement (its transaction, or without one their read of
    // the reservation) before either is released.
    for (const child of children) await child.line("ATTEMPT\n");
    for (const child of children) child.send("GO");
    const results = (await Promise.all(children.map((child) => child.result()))) as Array<{
      replayed: boolean;
      totalTokens: number;
    }>;
    const applied = results.filter((result) => !result.replayed);
    assert.equal(applied.length, 1);
    const winner = applied[0]!.totalTokens;
    assert.deepEqual(
      results.map((result) => result.totalTokens),
      [winner, winner],
    );
    assert.equal(await ledger.remaining("grant1"), 1000 - winner);
  },
);

test("settle records actual usage once; later calls change nothing and report the first result", async (t) => {
  const f = await fixture(t);
  const ledger = await f.open();
  await ledger.setCeiling({ grantId: "grant1", ceiling: 1000 });
  await ledger.reserve({ grantId: "grant1", reservationId: "r1", maxCost: 300 });
  assert.equal(await ledger.remaining("grant1"), 700);
  const first = await ledger.settle({
    grantId: "grant1",
    reservationId: "r1",
    maxCost: 300,
    ...usage(120),
    boundExceeded: false,
  });
  assert.equal(first.replayed, false);
  assert.equal(await ledger.remaining("grant1"), 880);
  const again = await ledger.settle({
    grantId: "grant1",
    reservationId: "r1",
    maxCost: 300,
    ...usage(50),
    boundExceeded: false,
  });
  assert.deepEqual(again, { ...first, replayed: true });
  assert.equal(again.totalTokens, 120);
  assert.equal(await ledger.remaining("grant1"), 880);
  await assert.rejects(
    ledger.settle({
      grantId: "grant1",
      reservationId: "r1",
      maxCost: 299,
      ...usage(120),
      boundExceeded: false,
    }),
    /SETTLEMENT_MAX_COST_MISMATCH/,
  );
  await assert.rejects(
    ledger.settle({
      grantId: "grant1",
      reservationId: "unknown",
      maxCost: 300,
      ...usage(1),
      boundExceeded: false,
    }),
    /RESERVATION_NOT_FOUND/,
  );
  assert.equal(await ledger.remaining("grant1"), 880);
});

test("an overrun above maxCost is charged in full and its flag is recorded", async (t) => {
  const f = await fixture(t);
  const ledger = await f.open();
  await ledger.setCeiling({ grantId: "grant1", ceiling: 1000 });
  await ledger.reserve({ grantId: "grant1", reservationId: "r1", maxCost: 100 });
  const settlement = {
    grantId: "grant1",
    reservationId: "r1",
    maxCost: 100,
    ...usage(400),
    boundExceeded: true,
  };
  await assert.rejects(
    ledger.settle({ ...settlement, boundExceeded: false }),
    /INVALID_SETTLEMENT/,
  );
  assert.equal((await ledger.settle(settlement)).boundExceeded, true);
  assert.equal(await ledger.remaining("grant1"), 600);
  const replay = await ledger.settle(settlement);
  assert.equal(replay.replayed, true);
  assert.equal(replay.boundExceeded, true);
  // Overruns can take the balance below zero; the gateway refuses at zero or less.
  await ledger.reserve({ grantId: "grant1", reservationId: "r2", maxCost: 600 });
  await ledger.settle({
    grantId: "grant1",
    reservationId: "r2",
    maxCost: 600,
    ...usage(900),
    boundExceeded: true,
  });
  assert.equal(await ledger.remaining("grant1"), -300);
});

test("ceilings, reservations and settlements survive closing and reopening the ledger", async (t) => {
  const f = await fixture(t);
  const first = await BudgetLedger.open(f.options);
  await first.setCeiling({ grantId: "grant1", ceiling: 500 });
  await first.reserve({ grantId: "grant1", reservationId: "r1", maxCost: 200 });
  await first.reserve({ grantId: "grant1", reservationId: "r2", maxCost: 100 });
  await first.settle({
    grantId: "grant1",
    reservationId: "r1",
    maxCost: 200,
    ...usage(20),
    boundExceeded: false,
  });
  first.close();
  const reopened = await f.open();
  assert.equal(await reopened.remaining("grant1"), 500 - 20 - 100);
  await assert.rejects(
    reopened.setCeiling({ grantId: "grant1", ceiling: 900 }),
    /CEILING_ALREADY_SET/,
  );
  const replay = await reopened.settle({
    grantId: "grant1",
    reservationId: "r1",
    maxCost: 200,
    ...usage(199),
    boundExceeded: false,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.totalTokens, 20);
  assert.equal((await stat(join(f.root, "budget.sqlite"))).mode & 0o777, 0o600);
});

test("a ledger folder or file others can write, or a linked ledger file, is refused", async (t) => {
  const f = await fixture(t);
  (await BudgetLedger.open(f.options)).close();
  await chmod(f.root, 0o770);
  await assert.rejects(BudgetLedger.open(f.options), /UNTRUSTED_PATH/);
  await chmod(f.root, 0o700);
  await chmod(join(f.root, "budget.sqlite"), 0o644);
  await assert.rejects(BudgetLedger.open(f.options), /UNTRUSTED_BUDGET_LEDGER/);
  const other = join(f.root, "other");
  await mkdir(other, { mode: 0o700 });
  await writeFile(join(other, "x"), "");
  await symlink(join(other, "x"), join(other, "budget.sqlite"));
  await assert.rejects(BudgetLedger.open({ ...f.options, root: other }));
});

test("the gateway adapter charges only the permit's grant and has no way to set a ceiling", async (t) => {
  const f = await fixture(t);
  const ledger = await f.open();
  await ledger.setCeiling({ grantId: "grantA", ceiling: 100 });
  await ledger.setCeiling({ grantId: "grantB", ceiling: 100 });
  const permit = (grantId: string): InferencePermit => ({
    taskId: "task1",
    grantId,
    expiresAt: Date.now() + 60000,
    allowedModels: ["m"],
    allowedEfforts: ["low"],
    networkNamespace: "net:[2]",
  });
  const budget = gatewayBudget(ledger);
  assert.deepEqual(Object.keys(budget).sort(), ["remainingTokens", "reserve", "settle"]);
  const request = { requestSha256: "0".repeat(64), model: "m", effort: "low", requestBytes: 1 };
  assert.equal(
    await budget.reserve(permit("grantA"), { ...request, reservationId: "r1", maxCost: 70 }),
    true,
  );
  assert.equal(await budget.remainingTokens(permit("grantA")), 30);
  assert.equal(await budget.remainingTokens(permit("grantB")), 100);
  const settlement = { reservationId: "r1", maxCost: 70, ...usage(10), boundExceeded: false };
  await assert.rejects(budget.settle(permit("grantB"), settlement), /RESERVATION_GRANT_MISMATCH/);
  assert.equal(await budget.remainingTokens(permit("grantA")), 30);
  await budget.settle(permit("grantA"), settlement);
  assert.equal(await budget.remainingTokens(permit("grantA")), 90);
});

test("replaying the settlement journal settles open attempts once; a second replay changes nothing", async (t) => {
  const f = await fixture(t);
  const ledger = await f.open();
  await ledger.setCeiling({ grantId: "grant1", ceiling: 1000 });
  for (const [reservationId, maxCost] of [
    ["r1", 100],
    ["r2", 100],
    ["r3", 100],
  ] as const)
    await ledger.reserve({ grantId: "grant1", reservationId, maxCost });
  const at = "2026-09-25T12:00:00.000Z";
  const actual = (total: number) => usage(total);
  // The gateway already settled r1 and wrote its completion line; r2 and r3 are still open.
  await ledger.settle({
    grantId: "grant1",
    reservationId: "r1",
    maxCost: 100,
    ...actual(10),
    boundExceeded: false,
  });
  const journal = join(f.root, "settlements.ndjson");
  await writeFile(
    journal,
    [
      { reservationId: "r1", grantId: "grant1", maxCost: 100, actual: actual(10), at },
      { reservationId: "r1", grantId: "grant1", settled: true, at },
      { reservationId: "r2", grantId: "grant1", maxCost: 100, actual: actual(30), at },
      { reservationId: "r3", grantId: "grant1", maxCost: 100, actual: actual(250), at },
      {
        reservationId: "r3",
        grantId: "grant1",
        event: "BOUND_EXCEEDED",
        maxCost: 100,
        actual: actual(250),
        at,
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n") + '\n{"reservationId":"torn","gra',
    { mode: 0o600 },
  );
  assert.equal(await ledger.remaining("grant1"), 1000 - 10 - 100 - 100);
  const first = await replaySettlementJournal(journal, ledger, f.options.authorityUid);
  assert.deepEqual(first, { applied: ["r2", "r3"], alreadySettled: [], failed: [] });
  assert.equal(await ledger.remaining("grant1"), 1000 - 10 - 30 - 250);
  const second = await replaySettlementJournal(journal, ledger, f.options.authorityUid);
  assert.deepEqual(second, { applied: [], alreadySettled: ["r2", "r3"], failed: [] });
  assert.equal(await ledger.remaining("grant1"), 1000 - 10 - 30 - 250);
});

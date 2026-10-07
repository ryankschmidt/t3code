import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ExecutionGrantAuthority,
  openExecutionGrantReader,
} from "../src/execution-grant-authority.ts";
import type { Principal } from "../src/review-authority.ts";
import type { SnapshotGrantReader } from "../src/execution-grants.ts";
import {
  createInferenceAuthorizer,
  type GrantClearance,
  type InferenceAuthorizerOptions,
} from "../src/inference-authorizer.ts";

const NOW = 1_800_000_000_000;
const HOST = "net:[4026531840]";
const TASK = "net:[4026532001]";
const peer = { uid: 2201, gid: 2201, pid: 401 };
const worker: Principal = { id: "agent1", kind: "worker", taskIds: ["task1"] };

async function fixture(t: test.TestContext) {
  // /tmp is deliberately not used: writable ancestry must fail the protected-path check.
  const root = await mkdtemp(join(homedir(), ".inference-authorizer-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const procRoot = join(root, "proc");
  await mkdir(join(procRoot, "sys/kernel/random"), { recursive: true });
  await writeFile(
    join(procRoot, "sys/kernel/random/boot_id"),
    "a6c22550-61e9-4e91-930b-6661109c12af\n",
  );
  /** A fake /proc entry: stat with start ticks, status ids, one cgroup and a net namespace link. */
  async function processRow(
    pid: number,
    o: { start?: string; ns?: string | null; uid?: number; group?: string } = {},
  ) {
    const dir = join(procRoot, String(pid));
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, "ns"), { recursive: true });
    const fields = Array<string>(40).fill("0");
    fields[0] = "S";
    fields[19] = o.start ?? (pid === 400 ? "12345" : "12350");
    await writeFile(join(dir, "stat"), `${pid} (worker) ${fields.join(" ")}\n`);
    const ids = Array<number>(4)
      .fill(o.uid ?? 2201)
      .join("\t");
    await writeFile(join(dir, "status"), `Uid:\t${ids}\nGid:\t${ids}\n`);
    await writeFile(join(dir, "cgroup"), `0::${o.group ?? "/throughline/worker.service"}\n`);
    if (o.ns !== null) await symlink(o.ns ?? TASK, join(dir, "ns/net"));
  }
  await processRow(400);
  await processRow(peer.pid);
  const grantRoot = join(root, "grants");
  await mkdir(grantRoot, { mode: 0o700 });
  const authorityUid = process.getuid!();
  const authority = await ExecutionGrantAuthority.bootstrap({
    root: grantRoot,
    authorityUid,
    procRoot,
    now: () => NOW,
  });
  t.after(() => authority.close());
  const execution = await authority.attest(400);
  const issue = (grantId: string, principal: Principal = worker) =>
    authority.issue({
      requestId: `issue-${grantId}`,
      grantId,
      principal,
      execution,
      expiresAt: NOW + 60000,
    });
  const renew = async (grantId: string, expiresAt: number) => {
    const state = (await authority.read(grantId))!;
    await authority.renew({
      requestId: `renew-${grantId}`,
      grantId,
      expectedRevision: state.revision,
      expectedDigest: state.digest,
      expiresAt,
    });
  };
  const revoke = async (grantId: string) => {
    const state = (await authority.read(grantId))!;
    await authority.revoke({
      requestId: `revoke-${grantId}`,
      grantId,
      expectedRevision: state.revision,
      expectedDigest: state.digest,
    });
  };
  await issue("grant1");
  const reader = await openExecutionGrantReader({ root: grantRoot, authorityUid });
  t.after(() => reader.close());
  const cleared: GrantClearance = {
    taskId: "task1",
    allowedModels: ["gpt-test"],
    allowedEfforts: ["low"],
  };
  const clearances = new Map<string, GrantClearance>([["grant1", cleared]]);
  const authorizer = (overrides: Partial<InferenceAuthorizerOptions> = {}) =>
    createInferenceAuthorizer({
      grantRoot,
      authorityUid,
      procRoot,
      now: () => NOW,
      store: reader,
      hostNetworkNamespace: HOST,
      clearances: { grantClearance: async (grantId) => clearances.get(grantId) ?? null },
      ...overrides,
    });
  return {
    procRoot,
    grantRoot,
    processRow,
    issue,
    renew,
    revoke,
    reader,
    clearances,
    cleared,
    authorizer,
  };
}

test("a peer whose process matches one active grant gets a permit from the grant and its clearance", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.authorizer()(peer), {
    taskId: "task1",
    grantId: "grant1",
    expiresAt: NOW + 60000,
    allowedModels: ["gpt-test"],
    allowedEfforts: ["low"],
    networkNamespace: TASK,
  });
});

test("a peer with a wrong uid or gid gets no permit", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.authorizer()({ ...peer, uid: 2202 }), null);
  assert.equal(await f.authorizer()({ ...peer, gid: 2202 }), null);
});

test("a reused leader pid with different start ticks gets no permit", async (t) => {
  const f = await fixture(t);
  await f.processRow(400, { start: "99999" });
  assert.equal(await f.authorizer()(peer), null);
});

test("an expired grant or a revoked grant gets no permit", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.authorizer({ now: () => NOW + 60000 })(peer), null);
  assert.notEqual(await f.authorizer()(peer), null);
  await f.revoke("grant1");
  assert.equal(await f.authorizer()(peer), null);
});

test("a peer in the host namespace, or with no readable namespace, gets no permit", async (t) => {
  const f = await fixture(t);
  await f.processRow(peer.pid, { ns: HOST });
  assert.equal(await f.authorizer()(peer), null);
  await f.processRow(peer.pid, { ns: "mnt:[4026532001]" });
  assert.equal(await f.authorizer()(peer), null);
  await f.processRow(peer.pid, { ns: null });
  assert.equal(await f.authorizer()(peer), null);
});

/** The fixture's real SQLite grant reader, with some members replaced. */
const storeOf = (
  f: Awaited<ReturnType<typeof fixture>>,
  members: Partial<SnapshotGrantReader> = {},
): SnapshotGrantReader => ({
  list: () => f.reader.list(),
  get: (grantId) => f.reader.get(grantId),
  verify: () => f.reader.verify(),
  snapshot: (decide) => f.reader.snapshot(decide),
  ...members,
});
/** A store whose verify(), the authorizer's last await, runs effect after the real check. */
const atVerify = (f: Awaited<ReturnType<typeof fixture>>, effect: () => Promise<unknown>) =>
  storeOf(f, {
    verify: async () => {
      await f.reader.verify();
      await effect();
    },
  });

test("a namespace that changes while the grant is attested gives no permit", async (t) => {
  const f = await fixture(t);
  const store = storeOf(f, {
    list: async () => {
      // The link changes after the first read and before the second.
      await rm(join(f.procRoot, String(peer.pid), "ns/net"));
      await symlink("net:[4026532002]", join(f.procRoot, String(peer.pid), "ns/net"));
      return f.reader.list();
    },
  });
  assert.equal(await f.authorizer({ store })(peer), null);
});

/** A clearance reader that runs effect while the authorizer waits on the clearance lookup. */
const during = (
  f: Awaited<ReturnType<typeof fixture>>,
  effect: () => Promise<unknown>,
): InferenceAuthorizerOptions["clearances"] => ({
  grantClearance: async (grantId) => {
    await effect();
    return f.clearances.get(grantId) ?? null;
  },
});

test("a grant revoked or expired during the clearance lookup gets no permit", async (t) => {
  const f = await fixture(t);
  assert.notEqual(await f.authorizer({ clearances: during(f, async () => {}) })(peer), null);
  let clock = NOW;
  const expiring = during(f, async () => {
    clock = NOW + 60000;
  });
  assert.equal(await f.authorizer({ now: () => clock, clearances: expiring })(peer), null);
  const revoking = during(f, () => f.revoke("grant1"));
  assert.equal(await f.authorizer({ clearances: revoking })(peer), null);
});

test("a namespace that changes during the clearance lookup gives no permit", async (t) => {
  const f = await fixture(t);
  const link = join(f.procRoot, String(peer.pid), "ns/net");
  const moving = during(f, async () => {
    await rm(link);
    await symlink("net:[4026532002]", link);
  });
  assert.equal(await f.authorizer({ clearances: moving })(peer), null);
});

test("a leader replaced during the clearance lookup gets no permit", async (t) => {
  const f = await fixture(t);
  const replacing = during(f, () => f.processRow(400, { start: "99999" }));
  assert.equal(await f.authorizer({ clearances: replacing })(peer), null);
});

test("a second matching grant issued during the clearance lookup gives no permit", async (t) => {
  const f = await fixture(t);
  f.clearances.set("grant2", f.cleared);
  const doubling = during(f, () => f.issue("grant2"));
  assert.equal(await f.authorizer({ clearances: doubling })(peer), null);
});

test("a grant database replaced during the clearance lookup gives no permit", async (t) => {
  const f = await fixture(t);
  const database = join(f.grantRoot, ".authority", "grants.sqlite");
  const replacing = during(f, async () => {
    await copyFile(database, database + ".copy");
    await rename(database + ".copy", database);
  });
  assert.equal(await f.authorizer({ clearances: replacing })(peer), null);
});

test("a second matching grant issued during the registry check gives no permit", async (t) => {
  const f = await fixture(t);
  f.clearances.set("grant2", f.cleared);
  const doubling = atVerify(f, () => f.issue("grant2"));
  assert.equal(await f.authorizer({ store: doubling })(peer), null);
});

test("the selected grant revoked or renewed during the registry check gets no permit", async (t) => {
  const f = await fixture(t);
  assert.notEqual(await f.authorizer({ store: atVerify(f, async () => {}) })(peer), null);
  const renewing = atVerify(f, () => f.renew("grant1", NOW + 120000));
  assert.equal(await f.authorizer({ store: renewing })(peer), null);
  const revoking = atVerify(f, () => f.revoke("grant1"));
  assert.equal(await f.authorizer({ store: revoking })(peer), null);
});

test("a registry holding more than 1024 active grants at the final read gives no permit", async (t) => {
  const f = await fixture(t);
  // Unrelated active grants (another uid) written straight into the grant database.
  const filling = atVerify(f, async () => {
    const base = f.reader.snapshot((grants) => grants[0]!);
    const db = new DatabaseSync(join(f.grantRoot, ".authority", "grants.sqlite"));
    try {
      const insert = db.prepare("INSERT INTO grants(grant_id,state) VALUES(?,?)");
      db.exec("BEGIN");
      for (let n = 0; n < 1024; n++) {
        const grantId = "extra-" + String(n).padStart(4, "0");
        const grant = { ...base, grantId, uid: 9999, gid: 9999 };
        insert.run(grantId, JSON.stringify({ grant, revision: 1, digest: "x", status: "active" }));
      }
      db.exec("COMMIT");
    } finally {
      db.close();
    }
  });
  assert.equal(await f.authorizer({ store: filling })(peer), null);
});

test("a pid reused by a host-namespace process during the registry check gets no permit", async (t) => {
  const f = await fixture(t);
  const reused = atVerify(f, () => f.processRow(peer.pid, { start: "77777", ns: HOST }));
  assert.equal(await f.authorizer({ store: reused })(peer), null);
});

test("a namespace that changes during the registry check gives no permit", async (t) => {
  const f = await fixture(t);
  const moved = atVerify(f, () => f.processRow(peer.pid, { ns: "net:[4026532002]" }));
  assert.equal(await f.authorizer({ store: moved })(peer), null);
});

test("a peer whose start ticks, uid or cgroup change during the registry check gets no permit", async (t) => {
  const f = await fixture(t);
  for (const change of [
    { start: "77777" },
    { uid: 2202 },
    { group: "/throughline/other.service" },
  ]) {
    const changed = atVerify(f, () => f.processRow(peer.pid, change));
    assert.equal(await f.authorizer({ store: changed })(peer), null);
    await f.processRow(peer.pid);
    assert.notEqual(await f.authorizer()(peer), null);
  }
});

test("a clock that passes the grant's expiry during the final /proc reads gives no permit", async (t) => {
  const f = await fixture(t);
  // The clock reads NOW until the final pass has begun (at the registry check) and the final
  // match has sampled it once; every later read is at the grant's expiry.
  let finalPass = false,
    samples = 0;
  const now = () => (finalPass && ++samples > 1 ? NOW + 60000 : NOW);
  const store = atVerify(f, async () => {
    finalPass = true;
  });
  assert.equal(await f.authorizer({ now, store })(peer), null);
});

/** Another process revokes grant1 straight in the grant database without waiting for any lock. */
const revokeFromAnotherProcess = (database: string) =>
  execFileSync(
    process.execPath,
    [
      "--no-warnings",
      "--input-type=module",
      "-e",
      [
        'import { DatabaseSync } from "node:sqlite";',
        "const db = new DatabaseSync(" + JSON.stringify(database) + ");",
        'db.exec("PRAGMA busy_timeout=0");',
        "try {",
        "  db.prepare(\"UPDATE grants SET state=json_set(state,'$.status','revoked') WHERE grant_id='grant1'\").run();",
        '  process.stdout.write("REVOKED");',
        "} catch (error) {",
        '  process.stdout.write(error.errcode === 5 ? "BUSY" : "ERROR " + error.message);',
        "}",
      ].join("\n"),
    ],
    { encoding: "utf8" },
  );

test("a revocation from another process cannot commit while the final checks run", async (t) => {
  const f = await fixture(t);
  const database = join(f.grantRoot, ".authority", "grants.sqlite");
  // The clock is read inside the final checks; its first read in the final pass tries the revocation.
  let finalPass = false,
    attempt: string | undefined;
  const now = () => {
    if (finalPass && attempt === undefined) attempt = revokeFromAnotherProcess(database);
    return NOW;
  };
  const store = atVerify(f, async () => {
    finalPass = true;
  });
  const permit = await f.authorizer({ now, store })(peer);
  assert.equal(attempt, "BUSY");
  assert.notEqual(permit, null);
  // Once the final checks have ended, the same revocation commits and the next call is refused.
  assert.equal(revokeFromAnotherProcess(database), "REVOKED");
  assert.equal(await f.authorizer()(peer), null);
});

test("a snapshot block that throws or returns a promise ends its transaction", async (t) => {
  const f = await fixture(t);
  const database = join(f.grantRoot, ".authority", "grants.sqlite");
  assert.throws(
    () =>
      f.reader.snapshot(() => {
        throw Error("DECIDE_FAILED");
      }),
    /DECIDE_FAILED/,
  );
  assert.equal(revokeFromAnotherProcess(database), "REVOKED");
  // An asynchronous block (a final block given an await) is refused rather than run unlocked.
  assert.throws(() => f.reader.snapshot(async () => 1), /SNAPSHOT_MUST_BE_SYNCHRONOUS/);
  assert.equal(revokeFromAnotherProcess(database), "REVOKED");
});

test("a grant database switched to WAL mode is refused", async (t) => {
  const f = await fixture(t);
  const wal = new DatabaseSync(join(f.grantRoot, ".authority", "grants.sqlite"));
  t.after(() => wal.close());
  assert.equal(wal.prepare("PRAGMA journal_mode=WAL").get()?.journal_mode, "wal");
  assert.throws(() => f.reader.snapshot(() => 1), /JOURNAL_MODE_REFUSED/);
  assert.equal(await f.authorizer()(peer), null);
});

test("an authorizer without a synchronous grant reader is refused at creation", async (t) => {
  const f = await fixture(t);
  // File mode (no store), and a store that has only list() and get().
  const fileMode = { store: undefined as unknown as SnapshotGrantReader };
  assert.throws(() => f.authorizer(fileMode), /INVALID_AUTHORIZER_CONFIGURATION/);
  const listOnly = { list: () => f.reader.list(), get: (id: string) => f.reader.get(id) };
  const partial = { store: listOnly as unknown as SnapshotGrantReader };
  assert.throws(() => f.authorizer(partial), /INVALID_AUTHORIZER_CONFIGURATION/);
});

test("two grants matching the same process give no permit", async (t) => {
  const f = await fixture(t);
  await f.issue("grant2");
  f.clearances.set("grant2", f.cleared);
  assert.equal(await f.authorizer()(peer), null);
});

test("a grant with no clearance, or a clearance for another task, gets no permit", async (t) => {
  const f = await fixture(t);
  f.clearances.delete("grant1");
  assert.equal(await f.authorizer()(peer), null);
  f.clearances.set("grant1", { ...f.cleared, taskId: "task2" });
  assert.equal(await f.authorizer()(peer), null);
});

test("a reviewer grant, or a worker grant for two tasks, gets no permit", async (t) => {
  const f = await fixture(t);
  await f.revoke("grant1");
  await f.issue("grant2", { id: "judge1", kind: "reviewer", taskIds: ["task1"] });
  f.clearances.set("grant2", f.cleared);
  assert.equal(await f.authorizer()(peer), null);
  await f.revoke("grant2");
  await f.issue("grant3", { id: "agent1", kind: "worker", taskIds: ["task1", "task2"] });
  f.clearances.set("grant3", f.cleared);
  assert.equal(await f.authorizer()(peer), null);
});

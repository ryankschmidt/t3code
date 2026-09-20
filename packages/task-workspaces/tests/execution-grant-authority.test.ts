import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, chmod, rename, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ExecutionGrantAuthority,
  openExecutionGrantReader,
} from "../src/execution-grant-authority.ts";
import { createExecutionGrantResolver } from "../src/execution-grants.ts";
import { spawn } from "node:child_process";
import { once } from "node:events";
const NOW = 1800000000000;

test("normal open never bootstraps and established control loss cannot authorize bootstrap", async (t) => {
  const root = await mkdtemp(join(homedir(), ".grant-bootstrap-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { root, authorityUid: process.getuid!() };
  await assert.rejects(ExecutionGrantAuthority.open(options));
  const authority = await ExecutionGrantAuthority.bootstrap(options);
  authority.close();
  await assert.rejects(ExecutionGrantAuthority.bootstrap(options));
  await rm(join(root, ".authority"), { recursive: true });
  await assert.rejects(ExecutionGrantAuthority.open(options));
  await assert.rejects(ExecutionGrantAuthority.bootstrap(options));
});

for (const phase of ["before", "after"]) {
  test(
    `SIGKILL ${phase} bootstrap COMMIT never converts partial initialization into a new authority`,
    { skip: process.platform !== "linux", timeout: 20000 },
    async (t) => {
      const root = await mkdtemp(join(homedir(), ".grant-bootstrap-death-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      const options = { root, authorityUid: process.getuid!() };
      const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
      const url = new URL(`../src/execution-grant-authority.${extension}`, import.meta.url).href;
      const code = `import{DatabaseSync}from'node:sqlite';import{writeSync}from'node:fs';import{ExecutionGrantAuthority}from ${JSON.stringify(url)};const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'){${phase === "after" ? "exec.call(this,sql);" : ""}writeSync(1,'BOOTSTRAP_BOUNDARY\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}return exec.call(this,sql);};await ExecutionGrantAuthority.bootstrap(${JSON.stringify(options)});`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      });
      await new Promise<void>((resolve, reject) => {
        child.stdout!.once("data", (b) => {
          assert.match(b.toString(), /BOOTSTRAP_BOUNDARY/);
          resolve();
        });
        child.once("exit", (code) => reject(Error(`bootstrap exited ${code}`)));
      });
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      assert.equal((await exited)[1], "SIGKILL");
      await assert.rejects(ExecutionGrantAuthority.open(options));
      await assert.rejects(ExecutionGrantAuthority.bootstrap(options));
      await assert.rejects(openExecutionGrantReader(options));
    },
  );
}
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(homedir(), ".grant-authority-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const procRoot = join(root, "proc");
  await mkdir(join(procRoot, "sys/kernel/random"), { recursive: true });
  await writeFile(
    join(procRoot, "sys/kernel/random/boot_id"),
    "a6c22550-61e9-4e91-930b-6661109c12af",
  );
  async function processRow(start = "12345") {
    const dir = join(procRoot, "400");
    await mkdir(dir, { recursive: true });
    const fields = Array(40).fill("0");
    fields[0] = "S";
    fields[19] = start;
    await writeFile(join(dir, "stat"), `400 (worker) ${fields.join(" ")}\n`);
    await writeFile(
      join(dir, "status"),
      "Uid:\t2201\t2201\t2201\t2201\nGid:\t2201\t2201\t2201\t2201\n",
    );
    await writeFile(join(dir, "cgroup"), "0::/throughline/worker.service\n");
  }
  await processRow();
  const options = { root, authorityUid: process.getuid!(), procRoot, now: () => NOW };
  const authority = await ExecutionGrantAuthority.bootstrap(options);
  t.after(() => authority.close());
  const execution = await authority.attest(400);
  const issue = {
    requestId: "issue1",
    grantId: "grant1",
    principal: { id: "worker", kind: "worker" as const, taskIds: ["task1"] },
    execution,
    expiresAt: NOW + 60000,
  };
  return { root, procRoot, authority, options, issue, processRow };
}
test("issue feeds explicit transactional resolver and exact retries never extend lease", async (t) => {
  const f = await fixture(t);
  const first = await f.authority.issue(f.issue);
  assert.deepEqual(await f.authority.issue(f.issue), first);
  const reader = await openExecutionGrantReader(f.options);
  t.after(() => reader.close());
  assert.deepEqual(
    await createExecutionGrantResolver({
      grantRoot: f.root,
      authorityUid: f.options.authorityUid,
      procRoot: f.procRoot,
      now: () => NOW,
      store: reader,
    })({ uid: 2201, gid: 2201, pid: 400 }),
    f.issue.principal,
  );
  await assert.rejects(f.authority.issue({ ...f.issue, expiresAt: NOW + 70000 }), /REQUEST_REUSED/);
});
test("CAS renewal preserves identity and revoke survives old request replay and reopen", async (t) => {
  const f = await fixture(t);
  const first = await f.authority.issue(f.issue);
  const renew = {
    requestId: "renew1",
    grantId: "grant1",
    expectedRevision: first.revision,
    expectedDigest: first.digest,
    expiresAt: NOW + 120000,
  };
  const next = await f.authority.renew(renew);
  assert.deepEqual(await f.authority.renew(renew), next);
  await assert.rejects(
    f.authority.revoke({
      requestId: "stale",
      grantId: "grant1",
      expectedRevision: first.revision,
      expectedDigest: first.digest,
    }),
    /CAS/,
  );
  const revoked = await f.authority.revoke({
    requestId: "revoke1",
    grantId: "grant1",
    expectedRevision: next.revision,
    expectedDigest: next.digest,
  });
  assert.equal(revoked.status, "revoked");
  assert.deepEqual(await f.authority.issue(f.issue), first);
  assert.deepEqual(await f.authority.renew(renew), next);
  const reopened = await ExecutionGrantAuthority.open(f.options);
  t.after(() => reopened.close());
  assert.equal((await reopened.read("grant1"))?.status, "revoked");
  await assert.rejects(
    reopened.renew({
      ...renew,
      requestId: "resurrect",
      expectedRevision: revoked.revision,
      expectedDigest: revoked.digest,
    }),
    /REVOKED/,
  );
});
test("PID reuse, forged kernel binding, excessive lease and role widening refuse", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.authority.issue({ ...f.issue, execution: { ...f.issue.execution, uid: 0 } }),
  );
  await assert.rejects(f.authority.issue({ ...f.issue, expiresAt: NOW + 86400001 }));
  const issued = await f.authority.issue(f.issue);
  await f.processRow("99999");
  await assert.rejects(
    f.authority.renew({
      requestId: "reuse",
      grantId: "grant1",
      expectedRevision: issued.revision,
      expectedDigest: issued.digest,
      expiresAt: NOW + 120000,
    }),
    /EXECUTION/,
  );
  await f.processRow();
  const widening = {
    requestId: "widen",
    grantId: "grant1",
    expectedRevision: issued.revision,
    expectedDigest: issued.digest,
    expiresAt: NOW + 120000,
    principal: { id: "worker", kind: "reviewer", taskIds: ["another-task"] },
  };
  await assert.rejects(f.authority.renew(widening), /FIELDS/);
});

test("writer refuses wrong authority UID and newly worker-writable ancestry", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    ExecutionGrantAuthority.open({ ...f.options, authorityUid: f.options.authorityUid + 1 }),
    /UID/,
  );
  await chmod(f.root, 0o770);
  await assert.rejects(f.authority.issue(f.issue), /UNTRUSTED/);
  await chmod(f.root, 0o700);
});

test(
  "independent OS processes CAS renewal against revocation without lost updates",
  { skip: process.platform !== "linux", timeout: 20000 },
  async (t) => {
    const f = await fixture(t),
      first = await f.authority.issue(f.issue);
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    const url = new URL(`../src/execution-grant-authority.${extension}`, import.meta.url).href;
    const compare = {
      grantId: "grant1",
      expectedRevision: first.revision,
      expectedDigest: first.digest,
    };
    const children = ["renew", "revoke"].map((operation) => {
      const request = {
        ...compare,
        requestId: `process-${operation}`,
        ...(operation === "renew" ? { expiresAt: NOW + 120000 } : {}),
      };
      const code = `import{ExecutionGrantAuthority}from ${JSON.stringify(url)};const a=await ExecutionGrantAuthority.open({...${JSON.stringify({ ...f.options, now: undefined })},now:()=>${NOW}});process.stdout.write('READY\\n');process.stdin.once('data',async()=>{try{await a[${JSON.stringify(operation)}](${JSON.stringify(request)});process.stdout.write('ACCEPTED\\n');}catch(e){if(!String(e).includes('CAS'))throw e;process.stdout.write('CAS_REFUSED\\n');}finally{a.close();process.stdin.destroy();}});`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      child.stdout!.on("data", (b) => {
        output += b.toString();
      });
      const exit = once(child, "exit");
      const ready = new Promise<void>((resolve, reject) => {
        child.stdout!.once("data", (b) => {
          assert.match(b.toString(), /READY/);
          resolve();
        });
        child.once("exit", () => reject(Error("early child exit")));
      });
      return { child, exit, ready, output: () => output };
    });
    await Promise.all(children.map((c) => c.ready));
    children.forEach((c) => c.child.stdin!.write("go\n"));
    for (const c of children) assert.equal((await c.exit)[0], 0);
    assert.equal(children.filter((c) => c.output().includes("ACCEPTED")).length, 1);
    assert.equal((await f.authority.read("grant1"))?.revision, 2);
  },
);
test("explicit database reader missing database does not fall back to JSON", async (t) => {
  const root = await mkdtemp(join(homedir(), ".grant-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "legacy.json"), "{}");
  await assert.rejects(openExecutionGrantReader({ root, authorityUid: process.getuid!() }));
});

test("explicit malformed store must never fall back to a valid legacy grant", async (t) => {
  const f = await fixture(t);
  await f.authority.issue(f.issue);
  const legacy = join(f.root, "legacy");
  await mkdir(legacy, { mode: 0o700 });
  const state = await f.authority.read("grant1");
  await writeFile(join(legacy, "grant1.json"), JSON.stringify(state!.grant), { mode: 0o600 });
  const base = {
    grantRoot: legacy,
    authorityUid: f.options.authorityUid,
    procRoot: f.procRoot,
    now: () => NOW,
  };
  assert.deepEqual(
    await createExecutionGrantResolver(base)({ uid: 2201, gid: 2201, pid: 400 }),
    f.issue.principal,
  );
  const store = {
    list: async () => null,
    get: async () => state!.grant,
  } as unknown as import("../src/execution-grants.ts").ExecutionGrantReader;
  await assert.rejects(
    createExecutionGrantResolver({ ...base, store })({ uid: 2201, gid: 2201, pid: 400 }),
  );
});

test("open writer and reader refuse replaced database instead of serving stale handles", async (t) => {
  const f = await fixture(t);
  await f.authority.issue(f.issue);
  const reader = await openExecutionGrantReader(f.options);
  t.after(() => reader.close());
  const path = join(f.root, ".authority", "grants.sqlite");
  await rename(path, `${path}.old`);
  await copyFile(`${path}.old`, path);
  await assert.rejects(reader.list(), /DATABASE_REPLACED/);
  await assert.rejects(f.authority.read("grant1"), /DATABASE_REPLACED/);
});

test("concurrent authority instances admit exactly one competing CAS operation", async (t) => {
  const f = await fixture(t),
    first = await f.authority.issue(f.issue);
  const second = await ExecutionGrantAuthority.open(f.options);
  t.after(() => second.close());
  const compare = {
    grantId: "grant1",
    expectedRevision: first.revision,
    expectedDigest: first.digest,
  };
  const results = await Promise.allSettled([
    f.authority.renew({ ...compare, requestId: "renew-race", expiresAt: NOW + 120000 }),
    second.revoke({ ...compare, requestId: "revoke-race" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await f.authority.read("grant1"))?.revision, 2);
});

for (const phase of ["before", "after"]) {
  test(
    `real SIGKILL ${phase} SQLite commit recovers grant and replay receipt atomically`,
    { skip: process.platform !== "linux", timeout: 20000 },
    async (t) => {
      const f = await fixture(t);
      const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
      const url = new URL(`../src/execution-grant-authority.${extension}`, import.meta.url).href;
      const code = `import{ExecutionGrantAuthority}from ${JSON.stringify(url)};import{writeSync}from'node:fs';const a=await ExecutionGrantAuthority.open({...${JSON.stringify({ ...f.options, now: undefined })},now:()=>${NOW}});const db=a.db;const original=db.exec.bind(db);db.exec=(sql)=>{if(sql==='COMMIT'){${phase === "after" ? "original(sql);" : ""}writeSync(1,'COMMIT_BOUNDARY\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}${phase === "before" ? "return original(sql);" : "if(sql!=='COMMIT')return original(sql);"}};await a.issue(${JSON.stringify(f.issue)});`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      });
      await new Promise<void>((resolve, reject) => {
        child.stdout!.once("data", (b) => {
          assert.match(b.toString(), /COMMIT_BOUNDARY/);
          resolve();
        });
        child.once("exit", (c) => reject(Error(`child exited ${c}`)));
      });
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      assert.equal((await exited)[1], "SIGKILL");
      const current = await f.authority.read("grant1");
      assert.equal(current !== null, phase === "after");
      const receipt = await f.authority.issue(f.issue);
      assert.equal(receipt.revision, 1);
      assert.deepEqual(await f.authority.issue(f.issue), receipt);
    },
  );
}

test(
  "actual Linux proc attestation issues and resolves current non-root execution",
  { skip: process.platform !== "linux" || process.getuid?.() === 0 },
  async (t) => {
    const root = await mkdtemp(join(homedir(), ".grant-real-proc-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const a = await ExecutionGrantAuthority.bootstrap({ root, authorityUid: process.getuid!() });
    t.after(() => a.close());
    const execution = await a.attest(process.pid);
    assert.equal(execution.uid, process.getuid!());
    const p = { id: "actual-worker", kind: "worker" as const, taskIds: ["real-task"] };
    await a.issue({
      requestId: "actual-issue",
      grantId: "actual",
      principal: p,
      execution,
      expiresAt: Date.now() + 60000,
    });
    const reader = await openExecutionGrantReader({ root, authorityUid: process.getuid!() });
    t.after(() => reader.close());
    assert.deepEqual(
      await createExecutionGrantResolver({
        grantRoot: root,
        authorityUid: process.getuid!(),
        store: reader,
      })({ uid: process.getuid!(), gid: process.getgid!(), pid: process.pid }),
      p,
    );
  },
);

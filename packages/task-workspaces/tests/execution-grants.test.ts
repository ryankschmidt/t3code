import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createExecutionGrantResolver, type ExecutionGrant } from "../src/execution-grants.ts";

const NOW = 1_800_000_000_000;
const bootId = "a6c22550-61e9-4e91-930b-6661109c12af";
const peer = { uid: 2201, gid: 2201, pid: 401 };
const principal = { id: "worker-a", kind: "worker" as const, taskIds: ["task-a"] };
const cgroup = "/throughline/worker-a.service";

function stat(pid: number, start: string, state = "S"): string {
  // starttime is field 22, or index 19 after the parenthesized comm field.
  const fields = Array<string>(40).fill("0");
  fields[0] = state;
  fields[19] = start;
  return `${pid} (name with ) nested ( spaces) ${fields.join(" ")}\n`;
}

async function fixture(t: test.TestContext) {
  // /tmp is deliberately not used: writable ancestry must fail policy checks.
  const root = await mkdtemp(join(homedir(), ".throughline-grant-test-"));
  await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  const grantRoot = join(root, "grants");
  const procRoot = join(root, "proc");
  await mkdir(grantRoot, { mode: 0o700 });
  await mkdir(join(procRoot, "sys/kernel/random"), { recursive: true });
  await writeFile(join(procRoot, "sys/kernel/random/boot_id"), `${bootId}\n`);
  const grant: ExecutionGrant = {
    schema: "throughline.execution-grant.v1",
    grantId: "grant-a",
    principal,
    uid: peer.uid,
    gid: peer.gid,
    bootId,
    cgroup,
    leaderPid: 400,
    leaderStartTicks: "12345",
    expiresAt: NOW + 60_000,
  };
  async function process(
    pid: number,
    options: {
      uid?: number;
      gid?: number;
      start?: string;
      state?: string;
      group?: string;
      status?: string;
    } = {},
  ) {
    const dir = join(procRoot, String(pid));
    await mkdir(dir, { recursive: true });
    const uid = options.uid ?? peer.uid,
      gid = options.gid ?? peer.gid;
    await writeFile(
      join(dir, "stat"),
      stat(pid, options.start ?? (pid === 400 ? "12345" : "12350"), options.state),
    );
    await writeFile(
      join(dir, "status"),
      options.status ??
        `Name:\tworker\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\nGid:\t${gid}\t${gid}\t${gid}\t${gid}\n`,
    );
    await writeFile(join(dir, "cgroup"), `0::${options.group ?? cgroup}\n`);
  }
  async function save(value: ExecutionGrant = grant, name = "grant-a.json") {
    await writeFile(join(grantRoot, name), JSON.stringify(value), { mode: 0o600 });
  }
  await process(400);
  await process(401);
  await save();
  const authorityUid = globalThis.process.getuid!();
  const resolver = () =>
    createExecutionGrantResolver({ grantRoot, authorityUid, procRoot, now: () => NOW });
  return { root, grantRoot, procRoot, grant, process, save, resolver, authorityUid };
}

test("live exact kernel peer resolves supervisor principal with robust proc stat parsing", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.resolver()(peer), principal);
});

test("UID reuse alone cannot authorize peer in a different execution cgroup", async (t) => {
  const f = await fixture(t);
  await f.process(peer.pid, { group: "/throughline/unrelated.service" });
  await assert.rejects(f.resolver()(peer));
});

test("kernel uid and gid must match grant and all proc status identities", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.resolver()({ ...peer, uid: peer.uid + 1 }));
  await assert.rejects(f.resolver()({ ...peer, gid: peer.gid + 1 }));
  await f.process(peer.pid, {
    status: "Uid:\t2201\t0\t2201\t2201\nGid:\t2201\t2201\t2201\t2201\n",
  });
  await assert.rejects(f.resolver()(peer));
});

test("dead or reused leader pid cannot preserve an old grant", async (t) => {
  const f = await fixture(t);
  await f.process(400, { start: "99999" });
  await assert.rejects(f.resolver()(peer));
  await rm(join(f.procRoot, "400"), { recursive: true });
  await assert.rejects(f.resolver()(peer));
});

test("leader identity and cgroup transitions invalidate the grant", async (t) => {
  const f = await fixture(t);
  for (const options of [
    { uid: 0 },
    { gid: 0 },
    { group: "/different.service" },
    { state: "Z" },
    { state: "X" },
  ]) {
    await f.process(400, options);
    await assert.rejects(f.resolver()(peer));
  }
});

test("wrong boot, expired and excessive leases fail closed", async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { bootId: "different-boot" },
    { expiresAt: NOW },
    { expiresAt: NOW - 1 },
    { expiresAt: NOW + 24 * 60 * 60 * 1000 + 1 },
    { expiresAt: NOW + 0.5 },
  ]) {
    await f.save({ ...f.grant, ...patch });
    await assert.rejects(f.resolver()(peer));
  }
});

test("duplicate matching grants refuse ambiguity even when principals agree", async (t) => {
  const f = await fixture(t);
  await f.save({ ...f.grant, grantId: "grant-b" }, "grant-b.json");
  await assert.rejects(f.resolver()(peer));
});

test("worker-writable grant files and registry directories refuse", async (t) => {
  const f = await fixture(t);
  await chmod(join(f.grantRoot, "grant-a.json"), 0o660);
  await assert.rejects(f.resolver()(peer));
  await chmod(join(f.grantRoot, "grant-a.json"), 0o600);
  await chmod(f.grantRoot, 0o770);
  await assert.rejects(f.resolver()(peer));
});

test("writable ancestor above grant root refuses", async (t) => {
  const f = await fixture(t);
  await chmod(f.root, 0o777);
  await assert.rejects(f.resolver()(peer));
});

test("symlink grant file or symlink registry ancestry refuses", async (t) => {
  const f = await fixture(t);
  const outside = join(f.root, "outside.json");
  await writeFile(outside, JSON.stringify(f.grant), { mode: 0o600 });
  await rm(join(f.grantRoot, "grant-a.json"));
  await symlink(outside, join(f.grantRoot, "grant-a.json"));
  await assert.rejects(f.resolver()(peer));
  await rm(join(f.grantRoot, "grant-a.json"));
  await f.save();
  const alias = join(f.root, "alias");
  await symlink(f.grantRoot, alias);
  await assert.rejects(
    createExecutionGrantResolver({
      grantRoot: alias,
      authorityUid: f.authorityUid,
      procRoot: f.procRoot,
      now: () => NOW,
    })(peer),
  );
});

test("untrusted file ownership, oversized record and oversized registry refuse", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    createExecutionGrantResolver({
      grantRoot: f.grantRoot,
      authorityUid: f.authorityUid + 1234,
      procRoot: f.procRoot,
      now: () => NOW,
    })(peer),
  );
  await writeFile(join(f.grantRoot, "grant-a.json"), " ".repeat(65537), { mode: 0o600 });
  await assert.rejects(f.resolver()(peer));
  await f.save();
  await Promise.all(
    Array.from({ length: 1024 }, (_, i) =>
      f.save({ ...f.grant, grantId: `extra-${i}`, uid: 9999 }, `extra-${i}.json`),
    ),
  );
  await assert.rejects(f.resolver()(peer));
});

test("unknown schema, role, malformed ids and invalid kernel peer refuse", async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { schema: "unknown" },
    { grantId: "../escape" },
    { principal: { ...principal, kind: "controller" } },
    { principal: { ...principal, taskIds: [] } },
  ]) {
    await f.save({ ...f.grant, ...patch } as ExecutionGrant);
    await assert.rejects(f.resolver()(peer));
  }
  await f.save();
  for (const patch of [{ pid: 0 }, { pid: 1.5 }, { uid: -1 }, { gid: Number.NaN }])
    await assert.rejects(f.resolver()({ ...peer, ...patch }));
});

test("configured lease bound may tighten but cannot exceed twenty-four hours", async (t) => {
  const f = await fixture(t);
  const options = {
    grantRoot: f.grantRoot,
    authorityUid: f.authorityUid,
    procRoot: f.procRoot,
    now: () => NOW,
  };
  await assert.rejects(async () =>
    createExecutionGrantResolver({ ...options, maxLeaseMs: 1000 })(peer),
  );
  for (const maxLeaseMs of [0, -1, Number.NaN, 24 * 60 * 60 * 1000 + 1])
    await assert.rejects(async () =>
      createExecutionGrantResolver({ ...options, maxLeaseMs })(peer),
    );
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createExecutionGrantResolver, type ExecutionGrant } from "../../src/execution-grants.ts";

test(
  "actual Linux proc grants require live leader and exact execution cgroup, not uid alone",
  { skip: process.platform !== "linux" },
  async (t) => {
    const root = await mkdtemp(join(homedir(), ".throughline-live-grant-"));
    await chmod(root, 0o700);
    const grantRoot = join(root, "grants");
    await mkdir(grantRoot, { mode: 0o700 });
    const leader = spawn("/usr/bin/sleep", ["60"], { stdio: "ignore" });
    const connector = spawn("/usr/bin/sleep", ["60"], { stdio: "ignore" });
    t.after(async () => {
      if (leader.exitCode === null && leader.signalCode === null) leader.kill("SIGKILL");
      if (connector.exitCode === null && connector.signalCode === null) connector.kill("SIGKILL");
      await rm(root, { recursive: true, force: true });
    });
    await Promise.all([once(leader, "spawn"), once(connector, "spawn")]);
    assert.ok(leader.pid && connector.pid);
    const pid = leader.pid;
    const rawStat = await readFile(`/proc/${pid}/stat`, "utf8");
    const leaderStartTicks = rawStat
      .slice(rawStat.lastIndexOf(") ") + 2)
      .trim()
      .split(/\s+/)[19]!;
    const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
    const cgroupText = (await readFile(`/proc/${pid}/cgroup`, "utf8")).trim();
    assert.match(cgroupText, /^0::\/.+/);
    const cgroup = cgroupText.slice(3);
    const uid = process.getuid!(),
      gid = process.getgid!();
    const grant: ExecutionGrant = {
      schema: "throughline.execution-grant.v1",
      grantId: "live",
      principal: { id: "fixture-worker", kind: "worker", taskIds: ["fixture-task"] },
      uid,
      gid,
      bootId,
      cgroup,
      leaderPid: pid,
      leaderStartTicks,
      expiresAt: Date.now() + 30_000,
    };
    const grantPath = join(grantRoot, "live.json");
    await writeFile(grantPath, JSON.stringify(grant), { mode: 0o600 });
    const resolve = createExecutionGrantResolver({ grantRoot, authorityUid: uid });
    const peer = { uid, gid, pid: connector.pid };
    assert.deepEqual(await resolve(peer), grant.principal);
    await writeFile(
      grantPath,
      JSON.stringify({ ...grant, cgroup: "/wrong-execution-unit.service" }),
      { mode: 0o600 },
    );
    await assert.rejects(resolve(peer));
    await writeFile(grantPath, JSON.stringify(grant), { mode: 0o600 });
    assert.deepEqual(await resolve(peer), grant.principal);
    const dead = once(leader, "exit");
    leader.kill("SIGKILL");
    await dead;
    await assert.rejects(resolve(peer));
    console.log(
      JSON.stringify({
        actualProc: true,
        uid,
        gid,
        leaderPid: pid,
        connectorPid: connector.pid,
        bootId,
        cgroup,
        leaderStartTicks,
        validGrantResolved: true,
        wrongCgroupRefused: true,
        killedLeaderRefused: true,
        connectorStillAlive: connector.exitCode === null && connector.signalCode === null,
        limitation:
          "Fixture registry is owned by the test account; not production supervisor isolation.",
      }),
    );
  },
);

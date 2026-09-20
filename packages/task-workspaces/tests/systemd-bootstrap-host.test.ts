import test from "node:test";
import assert from "node:assert/strict";
import { SystemdBootstrapHost } from "../src/systemd-bootstrap-host.ts";
import { systemdExecutionPlan } from "../src/systemd-execution.ts";

test("real host adapter embeds fixed run/deadline and aligns actual private allocation path", async () => {
  const binding = { agentId: "agent-a", taskId: "task-a", runId: "run-a" },
    expiresAt = Date.now() + 5000;
  const pin = {
    binding,
    expiresAt,
    executable: {
      node: "/opt/throughline/node",
      nodeSha256: "a".repeat(64),
      entry: "/opt/throughline/worker-entry.js",
      entrySha256: "b".repeat(64),
    },
  };
  const host = new SystemdBootstrapHost("/run", pin);
  pin.expiresAt = 1;
  pin.binding.taskId = "changed-after-construction";
  const original = { agentId: "agent-a", taskId: "task-a", runId: "run-a" };
  const profile = {
    id: "profile-a",
    executable: "/usr/bin/cat",
    executableSha256: "c".repeat(64),
    args: [],
    memoryBytes: 64 * 1024 * 1024,
    cpuPercent: 100,
    maxSeconds: 5,
    tasksMax: 32,
  };
  const effective = host.effectiveProfile(original, profile),
    config = JSON.parse(effective.args[1]!);
  assert.equal(effective.executable, "/opt/throughline/node");
  assert.equal(config.expiresAt, expiresAt);
  assert.deepEqual(config.binding, original);
  assert.equal(config.workspace, systemdExecutionPlan(original, profile).workspace);
  assert.equal(config.workspace, `${systemdExecutionPlan(original, profile).workspaceRoot}/task-a`);
  assert.equal(config.executable, profile.executable);
  await assert.rejects(host.ready(original), /EXECUTION_CHANNEL_UNAVAILABLE/);
  await assert.rejects(
    host.release(original, { grantId: "grant-a", expiresAt }),
    /EXECUTION_CHANNEL_UNAVAILABLE/,
  );
  assert.throws(
    () => host.effectiveProfile({ ...original, runId: "other" }, profile),
    /HOST_BINDING_MISMATCH/,
  );
  const reordered = { ...profile, args: profile.args };
  assert.equal(
    systemdExecutionPlan(original, effective).description,
    systemdExecutionPlan(
      original,
      host.effectiveProfile({ runId: "run-a", taskId: "task-a", agentId: "agent-a" }, reordered),
    ).description,
  );
});

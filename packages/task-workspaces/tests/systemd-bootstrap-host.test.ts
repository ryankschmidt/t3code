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
  const inference = {
    gatewaySocket: "/run/throughline/inference.sock",
    gatewayUid: 998,
    hostNetworkNamespace: "net:[123]",
    requestTimeoutMs: 5000,
  };
  const inferenceHost = new SystemdBootstrapHost("/run", { ...pin, inference });
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
  // Private networking is mandatory: an omitted field still yields a private plan.
  assert.ok(
    systemdExecutionPlan(original, inferenceHost.effectiveProfile(original, profile)).args.includes(
      "--property=PrivateNetwork=yes",
    ),
  );
  assert.ok(
    systemdExecutionPlan(original, effective).args.includes("--property=PrivateNetwork=yes"),
  );
  const privateProfile = inferenceHost.effectiveProfile(original, {
    ...profile,
    networkIsolation: "private",
  });
  assert.ok(
    systemdExecutionPlan(original, privateProfile).args.includes("--property=PrivateNetwork=yes"),
  );
  assert.deepEqual(JSON.parse(privateProfile.args[1]!).inference, inference);
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

test("host refuses a plan without private networking even with no inference", async () => {
  const binding = { agentId: "agent-a", taskId: "task-a", runId: "run-a" };
  const host = new SystemdBootstrapHost("/run", {
    binding,
    expiresAt: Date.now() + 5000,
    executable: {
      node: "/opt/throughline/node",
      nodeSha256: "a".repeat(64),
      entry: "/opt/throughline/worker-entry.js",
      entrySha256: "b".repeat(64),
    },
  });
  const hostNetworked = {
    id: "profile-a",
    executable: "/usr/bin/cat",
    executableSha256: "c".repeat(64),
    args: [],
    memoryBytes: 64 * 1024 * 1024,
    cpuPercent: 100,
    maxSeconds: 5,
    tasksMax: 32,
    networkIsolation: "host" as unknown as "private",
  };
  assert.throws(() => host.effectiveProfile(binding, hostNetworked), /PRIVATE_NETWORK_REQUIRED/);
  await assert.rejects(host.prepare(binding, hostNetworked), /PRIVATE_NETWORK_REQUIRED/);
  await assert.rejects(host.launch(binding, hostNetworked), /PRIVATE_NETWORK_REQUIRED/);
});

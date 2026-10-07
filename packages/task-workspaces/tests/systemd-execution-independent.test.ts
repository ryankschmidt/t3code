import test from "node:test";
import assert from "node:assert/strict";
import { systemdExecutionPlan } from "../src/systemd-execution.ts";

test("equivalent restored binding and profile retain exact unit ownership description", () => {
  const binding = { agentId: "agent-a", taskId: "task-a", runId: "run-a" };
  const profile = {
    id: "profile-a",
    executable: "/usr/bin/cat",
    executableSha256: "a".repeat(64),
    args: [],
    memoryBytes: 67108864,
    cpuPercent: 100,
    maxSeconds: 60,
    tasksMax: 32,
  };
  const original = systemdExecutionPlan(binding, profile);
  const restored = systemdExecutionPlan(
    { runId: binding.runId, taskId: binding.taskId, agentId: binding.agentId },
    {
      tasksMax: profile.tasksMax,
      maxSeconds: profile.maxSeconds,
      cpuPercent: profile.cpuPercent,
      memoryBytes: profile.memoryBytes,
      args: profile.args,
      executableSha256: profile.executableSha256,
      executable: profile.executable,
      id: profile.id,
    },
  );
  assert.equal(restored.unit, original.unit);
  assert.deepEqual(
    restored.args,
    original.args,
    "same logical execution must remain inspectable/stoppable after object-key reordering",
  );
  assert.equal(restored.description, original.description);
});

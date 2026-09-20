import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  systemdExecutionPlan,
  parseOwnedUnit,
  SystemdExecutionDriver,
} from "../src/systemd-execution.ts";
const binding = { agentId: "agent-a", taskId: "task-a", runId: "run-a" };
const profile = {
  id: "profile-a",
  executable: "/usr/bin/cat",
  executableSha256: "a".repeat(64),
  args: [],
  memoryBytes: 64 * 1024 * 1024,
  cpuPercent: 100,
  maxSeconds: 60,
  tasksMax: 32,
};

test("private task storage and persistent agent home have different lifetimes", () => {
  const a = systemdExecutionPlan(binding, profile);
  const b = systemdExecutionPlan({ ...binding, taskId: "task-b", runId: "run-b" }, profile);
  assert.equal(a.unit, b.unit); // one concurrent execution per persistent agent
  assert.equal(a.home, b.home);
  assert.notEqual(a.workspace, b.workspace);
  assert.notEqual(a.description, b.description);
  assert.ok(a.args.includes("--property=DynamicUser=yes"));
  assert.ok(a.args.includes("--property=NoNewPrivileges=yes"));
  assert.ok(a.args.includes("--property=KillMode=control-group"));
  assert.ok(a.args.includes("--property=ProtectSystem=strict"));
  assert.ok(a.args.includes("--expand-environment=no"));
  assert.ok(a.args.includes("--property=RuntimeMaxSec=60"));
  assert.deepEqual(a.args.slice(a.args.indexOf("--") + 1), [
    "/usr/bin/env",
    "-i",
    "PATH=/usr/bin:/bin",
    `HOME=${a.home}`,
    "LANG=C",
    "/usr/bin/cat",
  ]);
});
test("unit names and policy cannot be injected through task identity or profile", () => {
  assert.throws(() => systemdExecutionPlan({ ...binding, agentId: "x\nUser=root" }, profile));
  assert.throws(() => systemdExecutionPlan(binding, { ...profile, executable: "cat" }));
  assert.throws(() => systemdExecutionPlan(binding, { ...profile, maxSeconds: 0 }));
  assert.throws(() => systemdExecutionPlan(binding, { ...profile, tasksMax: 1e9 }));
  assert.throws(() => systemdExecutionPlan(binding, { ...profile, args: ["%n"] }));
  assert.throws(() => systemdExecutionPlan(binding, { ...profile, args: ["--uid=root\n"] }));
});
test("existing unit must match the full execution binding, not just its name", () => {
  const plan = systemdExecutionPlan(binding, profile);
  const output = `Id=${plan.unit}\nDescription=${plan.description}\nLoadState=loaded\nActiveState=active\nMainPID=123\nControlGroup=/system.slice/${plan.unit}\nInvocationID=${"b".repeat(32)}\n`;
  assert.equal(parseOwnedUnit(output, plan).pid, 123);
  assert.throws(() => parseOwnedUnit(output.replace(plan.description, "another task"), plan));
  assert.throws(() => parseOwnedUnit(output.replace("MainPID=123", "MainPID=0"), plan));
  assert.throws(() => parseOwnedUnit(output.replace("/system.slice/", "/other.slice/"), plan));
  assert.throws(() => parseOwnedUnit(output + "MainPID=456\n", plan));
});

test(
  "real Linux preflight pins the executable and nonroot launch stops before service creation",
  { skip: process.platform !== "linux" || process.getuid?.() === 0 },
  async () => {
    const measured = {
      ...profile,
      executableSha256: createHash("sha256")
        .update(await readFile(profile.executable))
        .digest("hex"),
    };
    const driver = new SystemdExecutionDriver("/run", measured);
    await assert.rejects(
      new SystemdExecutionDriver("/usr/bin/cat", measured).prepare(binding),
      /INVALID_CONTROL_ROOT/,
    );
    const prepared = await driver.prepare(binding);
    assert.match(prepared.unit, /^throughline-exec-[a-f0-9]{24}\.service$/);
    await assert.rejects(driver.start(binding), /EXECUTION_ROOT_SERVICE_REQUIRED/);
    await assert.rejects(
      new SystemdExecutionDriver("/run", profile).prepare(binding),
      /EXECUTABLE_VERSION_CHANGED/,
    );
  },
);

test(
  "cleanup does not depend on the old executable still being installed",
  { skip: process.platform !== "linux" || process.getuid?.() === 0 },
  async () => {
    const old = new SystemdExecutionDriver("/run", {
      ...profile,
      executable: "/opt/throughline-old-release-absent/node",
    });
    await assert.rejects(old.stop(binding, "c".repeat(32)), /EXECUTION_ROOT_SERVICE_REQUIRED/);
    await assert.rejects(old.inspect(binding), /EXECUTION_UNIT_NOT_OWNED_OR_ACTIVE/);
  },
);

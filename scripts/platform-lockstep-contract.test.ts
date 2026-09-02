import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEveryPlatformTarget,
  assertRunningPlatform,
  macBackupBundlePath,
} from "./platform-lockstep-contract.ts";

const targets = [{ id: "mac-arm64" }, { id: "linux-x64" }];

test("accepts only when every declared platform artifact exists", () => {
  assert.doesNotThrow(() => assertEveryPlatformTarget(targets, () => true));
});

test("refuses a partial platform result by naming the missing target", () => {
  assert.throws(
    () => assertEveryPlatformTarget(targets, (target) => target.id === "mac-arm64"),
    /LOCKSTEP_REFUSED: missing platform artifacts: linux-x64/,
  );
});

test("Mac backups preserve the stable bundle name inside a dated folder", () => {
  assert.equal(
    macBackupBundlePath("/backups", "0.0.37", "2026-09-01T23:14:15.000Z"),
    "/backups/ThroughLine-0.0.37-replaced-2026-09-01T23-14-15-000Z/ThroughLine.app",
  );
});

test("running-platform proof requires the installed executable and receipt version", () => {
  assert.doesNotThrow(() =>
    assertRunningPlatform({
      platform: "mac-arm64",
      expectedExecutable: "/Applications/ThroughLine.app/Contents/MacOS/ThroughLine",
      actualExecutable: "/Applications/ThroughLine.app/Contents/MacOS/ThroughLine",
      expectedVersion: "0.0.37",
      actualVersion: "0.0.37",
    }),
  );
  assert.throws(
    () =>
      assertRunningPlatform({
        platform: "mac-arm64",
        expectedExecutable: "/Applications/ThroughLine.app/Contents/MacOS/ThroughLine",
        actualExecutable: "/backups/ThroughLine.app/Contents/MacOS/ThroughLine",
        expectedVersion: "0.0.37",
        actualVersion: "0.0.36",
      }),
    /LOCKSTEP_REFUSED: mac-arm64 running executable mismatch.*running version mismatch/s,
  );
});

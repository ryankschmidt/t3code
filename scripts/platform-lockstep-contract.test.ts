import assert from "node:assert/strict";
import test from "node:test";
import { assertEveryPlatformTarget } from "./platform-lockstep-contract.ts";

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

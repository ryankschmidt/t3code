import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { regressionFiles, runRegression } from "./run.ts";

const checkout = resolve(import.meta.dirname, "../../..");

test("retained runs keep all rewind pins plus explicit mobile voice/settings coverage", () => {
  const files = regressionFiles(checkout);
  assert.equal(
    files.reduce((count, entry) => count + entry.cases.length, 0),
    24,
  );
  assert.equal(new Set(files.map((entry) => entry.package)).size, 4);
  assert.ok(files.some((entry) => entry.file.endsWith("thread-settings-options.test.ts")));
  assert.ok(files.some((entry) => entry.file.endsWith("messageOptimizer.test.ts")));
});

test("an existing evidence directory refuses before any test runner starts", () => {
  const evidence = mkdtempSync(resolve(tmpdir(), "throughline-regression-stale-"));
  try {
    assert.throws(() => runRegression(checkout, evidence), { code: "EEXIST" });
  } finally {
    rmSync(evidence, { recursive: true });
  }
});

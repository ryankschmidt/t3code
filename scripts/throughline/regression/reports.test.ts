import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { checkPinnedReports } from "./reports.ts";

const checkout = resolve(import.meta.dirname, "../../..");
const file = "apps/mobile/src/features/threads/use-composer-command-menu.test.ts";
const title = "offers Claude client menus once, only in an existing thread";
const pins = [{ file, cases: [title] }];
const report = (cases: Array<{ title: string; status: string }>) => ({
  testResults: [{ name: resolve(checkout, file), assertionResults: cases }],
});

test("green totals cannot replace an exact pinned mobile case", () => {
  assert.deepEqual(checkPinnedReports(pins, checkout, [report([{ title, status: "passed" }])]), []);
  assert.deepEqual(checkPinnedReports(pins, checkout, []), [`FILE_NOT_RUN: ${file}`]);
  for (const replacement of ["unrelated green case", `${title} renamed`]) {
    assert.deepEqual(
      checkPinnedReports(pins, checkout, [report([{ title: replacement, status: "passed" }])]),
      [`CASE_MISSING: ${file} :: ${title}`],
    );
  }
});

test("skipped, pending and failed pinned cases refuse", () => {
  for (const status of ["skipped", "pending", "failed"]) {
    assert.deepEqual(checkPinnedReports(pins, checkout, [report([{ title, status }])]), [
      `CASE_NOT_PASSED: ${file} :: ${title} (${status})`,
    ]);
  }
});

test("duplicate results retain the existing capability check's all-matches-must-pass rule", () => {
  assert.deepEqual(
    checkPinnedReports(pins, checkout, [
      report([
        { title, status: "passed" },
        { title, status: "passed" },
      ]),
    ]),
    [],
  );
  assert.deepEqual(
    checkPinnedReports(pins, checkout, [
      report([
        { title, status: "passed" },
        { title, status: "failed" },
      ]),
    ]),
    [`CASE_NOT_PASSED: ${file} :: ${title} (failed)`],
  );
});

test("a matching title in a different file does not satisfy a pin", () => {
  const wrongFile = {
    testResults: [
      {
        name: resolve(checkout, "apps/mobile/src/other.test.ts"),
        assertionResults: [{ title, status: "passed" }],
      },
    ],
  };
  assert.deepEqual(checkPinnedReports(pins, checkout, [wrongFile]), [`FILE_NOT_RUN: ${file}`]);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const checkout = resolve(import.meta.dirname, "../../..");
const manifestFile = resolve(checkout, "docs/throughline/capabilities/rewind/Capability.json");

test("repository rewind manifest preserves the original 1.2.0 bytes and all 17 pins", () => {
  assert.ok(existsSync(manifestFile), "repository rewind manifest is missing");
  const bytes = readFileSync(manifestFile);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "b7a1baf245c8762179309a00ab906bb4aa616e1706a9c40d285b458ef2bd8aea",
    "original rewind manifest must move byte-for-byte, without weakening any pin",
  );
  const manifest = JSON.parse(bytes.toString("utf8")) as {
    regression: Array<{ file: string; cases: string[] }>;
  };
  assert.equal(manifest.regression.length, 6);
  assert.equal(
    manifest.regression.reduce((count, entry) => count + entry.cases.length, 0),
    17,
  );
  assert.ok(manifest.regression.some((entry) => entry.file.startsWith("apps/mobile/")));
  for (const entry of manifest.regression) {
    const source = readFileSync(resolve(checkout, entry.file), "utf8");
    for (const title of entry.cases) {
      assert.ok(
        source.includes(JSON.stringify(title)),
        `${entry.file}: missing original pin ${title}`,
      );
    }
  }
});

// @effect-diagnostics nodeBuiltinImport:off - These fixtures exercise synchronous git snapshots before an Effect runtime exists.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./repo-binding.ts";
import { mountLineViolations } from "./mount-lines.ts";

const entry = "apps/server/src/entry.ts";
function fixture(next: string, baseline = "export const oldValue = 1;\n") {
  const root = mkdtempSync(join(tmpdir(), "throughline-mount-unit-"));
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Mount fixture");
  git(root, "config", "user.email", "mount-fixture@invalid");
  git(root, "config", "commit.gpgsign", "false");
  mkdirSync(join(root, "apps/server/src/throughline"), { recursive: true });
  writeFileSync(join(root, entry), baseline);
  writeFileSync(
    join(root, "apps/server/src/throughline/bridge.ts"),
    "export const bridge = () => 1;\n",
  );
  git(root, "add", "--", "apps");
  git(root, "commit", "--quiet", "-m", "fixture baseline");
  const base = git(root, "rev-parse", "HEAD").trim();
  writeFileSync(join(root, entry), baseline + next);
  git(root, "add", "--", entry);
  git(root, "commit", "--quiet", "-m", "fixture edit");
  const head = git(root, "rev-parse", "HEAD").trim();
  return { root, base, head, manifest: { merge_base: base, entries: [] } };
}

for (const increments of [1, 5]) {
  for (const laterImport of [false, true]) {
    test(`${increments} prefix increment(s)${laterImport ? " followed by a namespace import" : ""}`, () => {
      const f = fixture(
        "++counter;\n".repeat(increments) +
          (laterImport ? 'import { bridge } from "./throughline/bridge.ts";\n' : ""),
        "export let counter = 0;\n",
      );
      try {
        assert.deepEqual(mountLineViolations(f.root, f.base, f.head, f.manifest), [
          {
            path: entry,
            addedLines: increments + Number(laterImport),
            nonNamespaceLines: increments,
          },
        ]);
      } finally {
        rmSync(f.root, { recursive: true, force: true });
      }
    });
  }
}

for (const [name, added, refused] of [
  ["one namespace import", 'import { bridge } from "./throughline/bridge.ts";\n', false],
  [
    "ten non-namespace lines",
    Array.from({ length: 10 }, (_, i) => `export const value${i} = ${i};\n`).join(""),
    true,
  ],
  [
    "a namespace call",
    'import { bridge } from "./throughline/bridge.ts";\nconst result = bridge();\n',
    false,
  ],
  [
    "a comment pretending to import",
    '// import { bridge } from "./throughline/bridge.ts";\n',
    true,
  ],
  [
    "another statement after an import",
    'import { bridge } from "./throughline/bridge.ts"; oldValue.toString();\n',
    true,
  ],
  [
    "more than three namespace lines",
    'import { bridge } from "./throughline/bridge.ts";\nbridge();\nbridge();\nbridge();\n',
    true,
  ],
] as const) {
  test(name, () => {
    const f = fixture(added);
    try {
      const violations = mountLineViolations(f.root, f.base, f.head, f.manifest);
      assert.equal(violations.length > 0, refused);
      if (refused) assert.equal(violations[0]?.path, entry);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}

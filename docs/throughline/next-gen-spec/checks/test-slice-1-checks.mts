// Disposable slice-contract fixtures. No operator repository, remote push, install or credential access.
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  lstatSync,
  symlinkSync,
  unlinkSync,
  rmdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  archiveRows,
  archiveMatches,
  globToRegex,
  matchesAny,
  publishSibling,
  canonical,
  under,
  selectedPaths,
  indexEntries,
  tagIdentity,
  admissionAllowed,
  pipelinePaths,
  expectedStep,
  same,
  publicationBytes,
  parseMarkdown,
  emptyDirectoryPlan,
  removeEmptyDirectories,
  manifestOf,
} from "./slice-1-contracts.mts";
const root = mkdtempSync(join(tmpdir(), "p2-02-slice-fixtures-"));
const cases: Array<[string, () => void]> = [];
const test = (name: string, run: () => void) => cases.push([name, run]);
const file = (p: string, text = "payload\n") => {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
};
const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const repo = (name: string, committed = true) => {
  const d = join(root, name);
  mkdirSync(d);
  git(d, "init", "-q");
  git(d, "config", "user.name", "Disposable fixture");
  git(d, "config", "user.email", "fixture@example.invalid");
  if (committed) {
    file(join(d, "tracked.txt"));
    git(d, "add", "--", "tracked.txt");
    git(d, "commit", "-qm", "fixture initial");
  }
  return d;
};
const fp = {
  path: "/source",
  archive: "rpi:/mnt/storage/archives/source",
  sha256: "a".repeat(64),
  file_count: 2,
  symlink_count: 0,
  entry_count: 3,
  bytes: 12,
};
const row = {
  source: fp.path,
  archive: fp.archive,
  ...fp,
  status: "ARCHIVED_AND_REMOVED",
  verify_result: "PASS",
  rsync_checksum_verified: true,
  remote_file_count: 2,
  remote_symlink_count: 0,
};
test("real pretty-printed object-with-moves archive is accepted", () =>
  assert.deepEqual(
    archiveRows(JSON.stringify({ schema: "mac-disk-archive-ledger.v1", moves: [row] }, null, 2)),
    [row],
  ));
test("JSONL/archive format guess is refused", () =>
  assert.throws(() => archiveRows(JSON.stringify(row) + "\n" + JSON.stringify(row))));
test("archive receipt binds source destination digest and counts", () =>
  assert.equal(archiveMatches(row, fp), true));
for (const key of ["archive", "sha256", "bytes", "remote_file_count", "verify_result"])
  test(`archive mismatch ${key} is refused`, () =>
    assert.equal(archiveMatches({ ...row, [key]: key === "bytes" ? 999 : "wrong" }, fp), false));
test("recursive glob includes zero-level and deep docs", () => {
  for (const p of ["docs/a.md", "docs/deep/a.md", "docs/deep/more/a.md"])
    assert.equal(globToRegex("docs/**").test(p), true);
  assert.equal(globToRegex("**/*.md").test("README.md"), true);
});
test("recursive exclusions do not corrupt expansions", () => {
  assert.equal(matchesAny("docs/deep/_meta/run.md", ["**/_meta/**"]), true);
  assert.equal(matchesAny("docs/deep/a.md", ["**/_meta/**"]), false);
});
test("nonexistent leaf below symlink resolves to physical parent", () => {
  const safe = join(root, "safe"),
    forbidden = join(root, "forbidden");
  mkdirSync(safe);
  mkdirSync(forbidden);
  symlinkSync(forbidden, join(safe, "alias"));
  assert.equal(
    canonical(join(safe, "alias", "not-yet-created", "leaf")),
    join(canonical(forbidden), "not-yet-created", "leaf"),
  );
  assert.equal(under(join(safe, "alias", "new"), forbidden), true);
});
test("broken ancestor symlink refuses instead of lexical fallback", () => {
  symlinkSync(join(root, "missing-target"), join(root, "broken"));
  assert.throws(() => canonical(join(root, "broken", "leaf")));
});
test("publication restores old copy after first rename failure", () => {
  const d = join(root, "pub1"),
    p = join(root, "pub1.pending"),
    old = join(root, "pub1.previous");
  file(join(d, "old.txt"));
  file(join(p, "new.txt"));
  assert.throws(() =>
    publishSibling(p, d, old, (n) => {
      if (n === 1) throw Error("injected");
    }),
  );
  assert.equal(readFileSync(join(d, "old.txt"), "utf8"), "payload\n");
});
test("publication restores old copy after second rename failure", () => {
  const d = join(root, "pub2"),
    p = join(root, "pub2.pending"),
    old = join(root, "pub2.previous");
  file(join(d, "old.txt"));
  file(join(p, "new.txt"));
  assert.throws(() =>
    publishSibling(p, d, old, (n) => {
      if (n === 2) throw Error("injected");
    }),
  );
  assert.equal(existsSync(join(d, "old.txt")), true);
  assert.equal(existsSync(join(p, "new.txt")), true);
});
test("first publication and replacement use real siblings", () => {
  const d = join(root, "pub3"),
    p = join(root, "pub3.pending"),
    old = join(root, "pub3.previous");
  file(join(p, "new.txt"));
  assert.equal(publishSibling(p, d, old).installed, true);
  assert.equal(existsSync(join(d, "new.txt")), true);
  file(join(p, "replacement.txt"), "replacement\n");
  assert.equal(publishSibling(p, d, old).installed, true);
  assert.equal(readFileSync(join(d, "replacement.txt"), "utf8"), "replacement\n");
  assert.equal(existsSync(join(old, "new.txt")), true);
  assert.throws(() => publishSibling(join(d, "nested"), d, old));
});
test("empty selection uses working-tree set and preserves exact index entries", () => {
  const d = repo("selection");
  file(join(d, "tracked.txt"), "working edit\n");
  file(join(d, "odd\nname file.txt"));
  const before = indexEntries(d);
  const a = selectedPaths(d),
    b = selectedPaths(d, []);
  assert.deepEqual(a, b);
  assert.deepEqual(a.paths.sort(), ["odd\nname file.txt", "tracked.txt"]);
  assert.equal(a.argv.includes("--pathspec-from-file=-"), true);
  assert.equal(a.argv.includes("--"), false);
  assert.equal(a.stdin.endsWith("\0"), true);
  assert.equal(indexEntries(d), before);
});
test("unborn HEAD selection and initial commit use one exact NUL pathspec contract", () => {
  const d = repo("unborn", false);
  file(join(d, "first.txt"));
  const before = indexEntries(d),
    plan = selectedPaths(d, []);
  assert.equal(plan.unborn, true);
  assert.deepEqual(plan.paths, ["first.txt"]);
  assert.equal(indexEntries(d), before);
  execFileSync("git", ["-C", d, ...plan.argv], { input: plan.stdin });
  git(d, "commit", "-qm", "initial via explicit set");
  assert.equal(git(d, "show", "--format=", "--name-only", "HEAD").trim(), "first.txt");
});
test("empty computed set issues no staging command", () => {
  const d = repo("empty");
  assert.deepEqual(selectedPaths(d).argv, []);
  assert.equal(selectedPaths(d).stdin, "");
});
test("partially staged blob equality catches same-name index mutation", () => {
  const d = repo("partial");
  file(join(d, "tracked.txt"), "staged\n");
  git(d, "add", "--", "tracked.txt");
  const before = indexEntries(d);
  file(join(d, "tracked.txt"), "working-only\n");
  selectedPaths(d);
  assert.equal(indexEntries(d), before);
  git(d, "add", "--", "tracked.txt");
  assert.notEqual(indexEntries(d), before);
});
test("tag object differs when annotation changes with same peeled commit", () => {
  const d = repo("tags");
  git(d, "tag", "-a", "v1", "-m", "original annotation");
  const a = tagIdentity(d, "v1");
  git(d, "tag", "-d", "v1");
  git(d, "tag", "-a", "v1", "-m", "different annotation");
  const b = tagIdentity(d, "v1");
  assert.equal(a.peeled_commit, b.peeled_commit);
  assert.notEqual(a.object_sha, b.object_sha);
});
test("closed admission admits the normal next release but refuses another run in flight", () => {
  assert.equal(
    admissionAllowed(
      { admission_state: "closed", completed_at: "now", admitted_release: "0.0.60" },
      "0.0.61",
      "run",
    ),
    true,
  );
  assert.equal(
    admissionAllowed({ admission_state: "closed", release_in_flight: "other" }, "0.0.61", "run"),
    false,
  );
});
test("moved admission admits only the pinned acceptance release and owned run", () => {
  assert.equal(
    admissionAllowed({ admission_state: "moved", admitted_release: "0.0.60" }, "0.0.60", "run"),
    true,
  );
  assert.equal(
    admissionAllowed({ admission_state: "moved", admitted_release: "0.0.60" }, "0.0.61", "run"),
    false,
  );
  assert.equal(
    admissionAllowed(
      { admission_state: "moved", admitted_release: "0.0.60", release_in_flight: "other" },
      "0.0.60",
      "run",
    ),
    false,
  );
});
test("frozen admission refuses every release", () => {
  for (const release of ["0.0.60", "0.0.61"])
    assert.equal(admissionAllowed({ admission_state: "frozen" }, release, "run"), false);
});
for (const type of ["commit", "tree", "blob"])
  test(`tag identity preserves the tag object and its ${type} target`, () => {
    const d = repo("tag-" + type);
    const target =
      type === "commit" ? "HEAD" : type === "tree" ? "HEAD^{tree}" : "HEAD:tracked.txt";
    const sha = git(d, "rev-parse", target).trim();
    git(d, "tag", "-a", "retain", sha, "-m", "retention");
    const identity: any = tagIdentity(d, "retain");
    assert.equal(identity.target_type, type);
    assert.equal(identity.peeled_object, sha);
    assert.equal(identity.peeled_commit, type === "commit" ? sha : null);
    assert.equal(identity.object_sha, git(d, "rev-parse", "refs/tags/retain").trim());
  });
test("pipeline allows declared vault records but refuses vault build roots", () => {
  const R: any = {
    move_record: join(root, "records", "move.json"),
    evidence_root: join(root, "records"),
    vault_copy: { destination: join(root, "vault", "copy") },
  };
  mkdirSync(R.evidence_root);
  mkdirSync(join(root, "vault"));
  const p: any = {
    checkout: join(root, "checkout"),
    source: {
      worktrees_root: join(root, "worktrees"),
      release_checkout: join(root, "worktrees", "{release}"),
    },
    backup_root: join(root, "backup"),
    forbidden_roots: [join(root, "vault")],
    move_record: R.move_record,
    evidence_root: R.evidence_root,
    vault_copy: R.vault_copy,
  };
  assert.deepEqual(pipelinePaths(p, R), []);
  p.checkout = join(root, "vault", "future");
  assert.equal(pipelinePaths(p, R).length > 0, true);
});
test("harmless executable cannot masquerade as exact internal step", () => {
  const expected = expectedStep("vault-clean", "/runtime/tool");
  assert.equal(
    same({ ...expected, command: ["true", "internal-step", "vault-clean"] }, expected),
    false,
  );
});
test("publication parses YAML, preserves author fields and refreshes owned provenance", () => {
  const text =
    '---\ntitle: "Authored title"\ncreated: "2020-01-01"\nsource_commit: old\nrelease: old\n---\n# Body\n';
  const written = publicationBytes(text, {
    path: "README.md",
    repository: "repository",
    commit: "b".repeat(40),
    release: "0.0.57",
    date: "2026-10-09",
  });
  const fm = parseMarkdown(written).metadata;
  assert.equal(fm.title, "Authored title");
  assert.equal(fm.created, "2020-01-01");
  assert.equal(fm.source_commit, "b".repeat(40));
  assert.equal(fm.release, "0.0.57");
  assert.equal(parseMarkdown(written).body, "# Body\n");
});
test("empty cleanup refuses a symlink without removing any directory", () => {
  const d = join(root, "cleanup");
  mkdirSync(join(d, "child"), { recursive: true });
  symlinkSync(join(root, "absent"), join(d, "residue"));
  assert.throws(() => emptyDirectoryPlan(d));
  assert.equal(existsSync(join(d, "child")), true);
});
test("empty cleanup plans first and removes bottom-up only real empty directories", () => {
  const d = join(root, "cleanup-good");
  mkdirSync(join(d, "child", "nested"), { recursive: true });
  assert.equal(removeEmptyDirectories(d).length, 3);
  assert.equal(existsSync(d), false);
});
test("preserved tree fingerprint binds contents not only filenames", () => {
  const d = join(root, "preserved");
  file(join(d, "a"));
  const a = manifestOf(d);
  file(join(d, "a"), "changed\n");
  assert.notEqual(manifestOf(d).sha256, a.sha256);
});
let bad = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log("OK   " + name);
  } catch (e) {
    bad++;
    console.log("BAD  " + name + ": " + (e as Error).message);
  }
}
const cleanup = (p: string) => {
  const s = lstatSync(p);
  if (s.isDirectory() && !s.isSymbolicLink()) {
    for (const n of readdirSync(p)) cleanup(join(p, n));
    rmdirSync(p);
  } else unlinkSync(p);
};
cleanup(root);
console.log(`\n${cases.length - bad} of ${cases.length} slice-1 fixtures behaved`);
process.exit(bad ? 1 : 0);

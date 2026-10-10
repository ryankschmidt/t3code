// Real disposable repositories and files; no operator repository or archive is mutated.
import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { manifestOf } from "./slice-1-contracts.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const root = realpathSync(mkdtempSync(join(tmpdir(), "repository-move-fixtures-")));
const originalSpec = JSON.parse(readFileSync(join(HERE, "../spec.json"), "utf8"));
const file = (p: string, text: string) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};
const json = (p: string, value: unknown) => file(p, JSON.stringify(value));
const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const home = join(root, "home"),
  trees = join(root, "worktrees"),
  records = join(root, "records");
mkdirSync(home);
mkdirSync(trees);
mkdirSync(records);
git(home, "init", "-q", "-b", "main");
git(home, "config", "user.name", "Move fixture");
git(home, "config", "user.email", "fixture@example.invalid");
file(join(home, "file.txt"), "initial\n");
git(home, "add", "--", "file.txt");
git(home, "commit", "-qm", "initial");
const a = git(home, "rev-parse", "HEAD");
const release = join(trees, "1.2.3"),
  task = join(trees, "task");
git(home, "worktree", "add", "-qb", "release/1.2.3", release);
git(home, "worktree", "add", "-qb", "task", task);
// Two rewritten tips: neither is a descendant of the frozen commit.
const tree = git(home, "rev-parse", "HEAD^{tree}");
const b = git(home, "commit-tree", tree, "-m", "first replay");
const c = git(home, "commit-tree", tree, "-m", "second replay");
git(task, "update-ref", "refs/heads/task", c);
const defaults = join(root, "bin/defaults");
file(defaults, '#!/usr/bin/env node\nconsole.log("1.2.3");\n');
chmodSync(defaults, 0o755);
const movePath = join(records, "Move-Record.json"),
  annotations = join(records, "Worktree-Move-Annotations.jsonl");
const reviewB = join(records, "review-b.json"),
  reviewC = join(records, "review-c.json"),
  custody = join(records, "custody.json");
json(reviewB, { verdict: "PASS", head: b });
json(reviewC, { verdict: "PASS", head: c });
json(custody, { previous_head: a, new_head: b });
const schema = "throughline.worktree-move-annotation.v1",
  at = "2026-10-10T08:00:00.000Z";
const freeze = {
  schema,
  kind: "addition-freeze",
  path: task,
  head: a,
  branch: "task",
  observed_at: at,
  reason: "fixture",
  evidence: { command: "git worktree list --porcelain", output_path: custody },
};
const chain = [
  freeze,
  {
    schema,
    kind: "rebased",
    path: task,
    previous_head: a,
    new_head: b,
    review: reviewB,
    custody_evidence: custody,
    observed_at: at,
  },
  {
    schema,
    kind: "rebased",
    path: task,
    previous_head: b,
    new_head: c,
    review: reviewC,
    custody_evidence: custody,
    observed_at: at,
  },
];
const move = {
  worktrees: [
    { path: home, head: a, branch: "main" },
    { path: release, head: a, branch: "release/1.2.3" },
  ],
  worktree_mapping: [
    { before: home, after: home, frozen_head: a, branch: "main" },
    { before: release, after: release, frozen_head: a, branch: "release/1.2.3" },
  ],
  fingerprints: [],
};
const spec = structuredClone(originalSpec);
Object.assign(spec.repository, {
  home,
  worktrees: trees,
  move_record: movePath,
  archive_ledger: join(records, "archive.json"),
  evidence_root: join(root, "evidence"),
  old_backup_root: join(root, "backup"),
  retired_folder: join(root, "retired"),
});
const rr = spec.tasks.find((t: any) => t.id === "T1.05").record_retention;
rr.address = join(root, "retained");
rr.manifest = join(records, "retained.jsonl");
const specPath = join(root, "spec.json");
json(specPath, spec);
const rows = (values: unknown[]) =>
  file(annotations, values.map((x) => JSON.stringify(x)).join("\n") + "\n");
const run = (id: string, expected: number, reason?: string) => {
  const r = spawnSync(
    process.execPath,
    [join(HERE, "slice-1-repository-move.mts"), "--spec", specPath, "--only", id],
    { encoding: "utf8", env: { ...process.env, PATH: join(root, "bin") + ":" + process.env.PATH } },
  );
  assert.equal(r.status, expected, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`^${expected === 0 ? "PASS" : "FAIL"}  ${id} `, "m"));
  if (reason) assert.ok(r.stdout.includes(reason), r.stdout);
};
const cases: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => cases.push([name, fn]);
test("S1-C03 valid two-rebase chain with exact passing reviews", () => {
  json(movePath, move);
  rows(chain);
  run("S1-C03", 0);
});
test("S1-C03 an existing frozen mapping accepts the same reviewed chain", () => {
  json(movePath, {
    ...move,
    worktree_mapping: [
      ...move.worktree_mapping,
      { before: task, after: task, frozen_head: a, branch: "task" },
    ],
  });
  rows(chain.slice(1));
  run("S1-C03", 0);
});
test("S1-C03 ordinary frozen mapping still passes without a rebase", () => {
  git(task, "update-ref", "refs/heads/task", a);
  try {
    json(movePath, move);
    rows([freeze]);
    run("S1-C03", 0);
  } finally {
    git(task, "update-ref", "refs/heads/task", c);
  }
});
for (const [name, patch] of [
  ["missing review", { review: undefined }],
  ["nonexistent review", { review: join(records, "absent.json") }],
  ["missing custody evidence", { custody_evidence: join(records, "absent.json") }],
  ["head does not match current HEAD", { new_head: b }],
  ["disconnected chain", { previous_head: a }],
] as const)
  test(`S1-C03 ${name} refuses`, () => {
    json(movePath, move);
    rows([chain[0], chain[1], { ...chain[2], ...patch }]);
    run("S1-C03", 1, "rebase");
  });
test("S1-C03 an earlier failing review cannot be hidden by a newer pass", () => {
  json(movePath, move);
  rows(chain);
  json(reviewB, { verdict: "FAIL", head: b });
  try {
    run("S1-C03", 1, "review");
  } finally {
    json(reviewB, { verdict: "PASS", head: b });
  }
});
test("S1-C03 passing review for a different head refuses", () => {
  json(movePath, move);
  rows(chain);
  json(reviewC, { verdict: "PASS", head: b });
  try {
    run("S1-C03", 1, "review");
  } finally {
    json(reviewC, { verdict: "PASS", head: c });
  }
});
test("S1-C03 duplicate freeze cannot reset a bad chain", () => {
  json(movePath, move);
  rows([freeze, { ...chain[1], review: join(records, "absent.json") }, { ...freeze, head: c }]);
  run("S1-C03", 1);
});
test("S1-C03 frozen detached addition stays valid at its head", () => {
  git(task, "checkout", "--detach", c);
  try {
    json(movePath, move);
    rows([{ ...freeze, head: c, branch: null }]);
    run("S1-C03", 0);
  } finally {
    git(task, "checkout", "task");
  }
});

const oldRelease = join(root, "old-release"),
  preserved = join(release, "release");
file(join(preserved, "app.dmg"), "preserved bytes\n");
const fp = {
  path: join(oldRelease, "release"),
  target: join(oldRelease, "release"),
  disposition: "moved-and-preserved",
  ...manifestOf(preserved),
};
const moved = {
  schema,
  kind: "disposition",
  before: oldRelease,
  after: release,
  frozen_head: a,
  branch: "release/1.2.3",
  disposition: "moved",
  observed_at: at,
  evidence: { command: "git worktree move", output_path: custody },
};
const preservedMove = {
  ...move,
  worktrees: [...move.worktrees, { path: oldRelease, head: a, branch: "release/1.2.3" }],
  fingerprints: [fp],
};
test("S1-C06 preserved release follows its move annotation", () => {
  json(movePath, preservedMove);
  rows([moved]);
  run("S1-C06", 0);
});
test("S1-C06 moved release with changed bytes refuses", () => {
  json(movePath, preservedMove);
  rows([moved]);
  file(join(preserved, "app.dmg"), "changed bytes\n");
  try {
    run("S1-C06", 1, "fingerprint drift");
  } finally {
    file(join(preserved, "app.dmg"), "preserved bytes\n");
  }
});
test("S1-C06 unbound move annotation refuses", () => {
  json(movePath, preservedMove);
  rows([{ ...moved, frozen_head: b }]);
  run("S1-C06", 1);
});

const alias = join(root, "staging/Applications"),
  target = join(root, "applications");
mkdirSync(target);
file(join(target, "untouched.txt"), "do not follow\n");
mkdirSync(dirname(alias));
symlinkSync(target, alias);
const aliasFp = {
  path: alias,
  target: alias,
  disposition: "moved-and-preserved",
  ...manifestOf(alias),
};
unlinkSync(alias);
const archived = {
  source: alias,
  archive: "rpi:/mnt/storage/archives/staging/Applications",
  ...manifestOf(target),
  ...aliasFp,
  status: "ARCHIVED_AND_REMOVED",
  verify_result: "PASS",
  rsync_checksum_verified: true,
  remote_file_count: aliasFp.file_count,
  remote_symlink_count: aliasFp.symlink_count,
};
test("S1-C06 removed staging link with exact passing archive ledger is archived", () => {
  json(movePath, { ...move, fingerprints: [aliasFp] });
  rows([]);
  json(spec.repository.archive_ledger, { schema: "mac-disk-archive-ledger.v1", moves: [archived] });
  run("S1-C06", 0);
  assert.equal(readFileSync(join(target, "untouched.txt"), "utf8"), "do not follow\n");
});
test("S1-C06 staging link with failed archive proof refuses", () => {
  json(movePath, { ...move, fingerprints: [aliasFp] });
  rows([]);
  json(spec.repository.archive_ledger, {
    schema: "mac-disk-archive-ledger.v1",
    moves: [{ ...archived, verify_result: "FAIL" }],
  });
  run("S1-C06", 1);
});
test("S1-C06 retained dangling staging link is not archived", () => {
  symlinkSync(join(root, "absent-target"), alias);
  try {
    json(movePath, { ...move, fingerprints: [aliasFp] });
    rows([]);
    json(spec.repository.archive_ledger, {
      schema: "mac-disk-archive-ledger.v1",
      moves: [archived],
    });
    run("S1-C06", 1);
  } finally {
    unlinkSync(alias);
  }
});

test("every done_when has safe core-root install and server-relative checker folders", () => {
  for (const task of originalSpec.tasks) {
    const command = task.done_when.command;
    if (command.includes("pnpm -C /Users/Admin/core-root install")) {
      assert.ok(command.startsWith("cd /Users/Admin/core-root && "), task.id);
      assert.ok(!/node \.\/checks\//.test(command), task.id + " checker would run from core-root");
    }
    if (/cd [^&]*apps\/server.*node \.\/checks\//.test(command))
      assert.match(command, /\(cd [^&]*apps\/server && [^)]*\) && node \.\/checks\//, task.id);
  }
});
for (const id of ["T1.04", "T1.09", "T2.03"])
  test(`${id} literal done_when executes each command in its intended folder`, () => {
    const d = join(root, id),
      repo = join(d, "repo"),
      core = join(d, "core"),
      design = join(repo, "docs/throughline/next-gen-spec"),
      log = join(d, "calls.jsonl");
    mkdirSync(join(repo, "apps/server"), { recursive: true });
    mkdirSync(core);
    mkdirSync(design, { recursive: true });
    const recordCall =
      '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.CALL_LOG, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),file:process.argv[1]})+"\\n");\n';
    const pnpm = join(d, "bin/pnpm");
    file(pnpm, recordCall);
    chmodSync(pnpm, 0o755);
    for (const checker of ["slice-1-repository-move.mts", "slice-2-seam.mts"])
      file(
        join(design, "checks", checker),
        'import fs from "node:fs"; fs.appendFileSync(process.env.CALL_LOG, JSON.stringify({cwd:process.cwd(),checker:import.meta.url})+"\\n");\n',
      );
    const command = originalSpec.tasks
      .find((t: any) => t.id === id)
      .done_when.command.replaceAll("/Users/Admin/throughline", repo)
      .replaceAll("/Users/Admin/core-root", core);
    const r = spawnSync("/bin/sh", ["-c", command], {
      cwd: design,
      encoding: "utf8",
      env: { ...process.env, CALL_LOG: log, PATH: dirname(pnpm) + ":" + process.env.PATH },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const calls = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    assert.equal(calls.filter((x) => x.checker).length, 1);
    if (id === "T1.09")
      assert.equal(calls.find((x) => x.args?.includes("test"))?.cwd, join(repo, "apps/server"));
    else assert.equal(calls.find((x) => x.args?.includes("install"))?.cwd, core);
  });

let bad = 0;
try {
  for (const [name, fn] of cases) {
    try {
      fn();
      console.log("OK   " + name);
    } catch (e) {
      bad++;
      console.log("BAD  " + name + ": " + (e as Error).message);
    }
  }
} finally {
  const clean = (p: string) => {
    const s = lstatSync(p);
    if (s.isDirectory() && !s.isSymbolicLink()) {
      for (const n of readdirSync(p)) clean(join(p, n));
      rmdirSync(p);
    } else unlinkSync(p);
  };
  clean(root);
}
console.log(`\n${cases.length - bad} of ${cases.length} repository-move fixtures behaved`);
process.exitCode = bad ? 1 : 0;

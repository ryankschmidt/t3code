/**
 * checkpoint-bridge proof (T2.1 slice proof, standalone — no worker needed).
 *
 * Creates a throwaway git workspace, dirties SCOPED and UNSCOPED paths, then
 * proves the bridge's contract:
 *   1. capture succeeds and the ref exists under refs/t3-absurd/checkpoints/;
 *   2. the checkpoint commit is parented on HEAD and its diff vs HEAD contains
 *      ONLY the scoped paths (the unscoped dirty file is NOT captured);
 *   3. the repository's real state is untouched: same git status, same HEAD,
 *      no new branch commits;
 *   4. re-capture of the same (task, step) is idempotent (ref overwritten);
 *   5. duration is reported (the scoped add is the anti-stampede property).
 *
 * Run: node --experimental-strip-types src/checkpoint-bridge-proof.ts
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureStepCheckpoint, listCheckpointPaths, stepCheckpointRef } from "./checkpoint-bridge.ts";

function sh(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const ws = mkdtempSync(join(tmpdir(), "ckpt-bridge-proof-"));
const failures: string[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!ok) failures.push(name);
};

try {
  // Workspace: baseline commit, then dirty a scoped dir (a/) and an unscoped dir (b/).
  sh(ws, ["init", "-q"]);
  sh(ws, ["config", "user.email", "proof@local"]);
  sh(ws, ["config", "user.name", "checkpoint-bridge-proof"]);
  mkdirSync(join(ws, "a"));
  mkdirSync(join(ws, "b"));
  writeFileSync(join(ws, "a", "one.txt"), "baseline a\n");
  writeFileSync(join(ws, "b", "two.txt"), "baseline b\n");
  sh(ws, ["add", "-A"]);
  sh(ws, ["commit", "-qm", "baseline"]);
  const headBefore = sh(ws, ["rev-parse", "HEAD"]);

  writeFileSync(join(ws, "a", "one.txt"), "CHANGED a\n");
  writeFileSync(join(ws, "a", "new.txt"), "NEW scoped file\n");
  writeFileSync(join(ws, "b", "two.txt"), "CHANGED b (must NOT be captured)\n");
  const statusBefore = sh(ws, ["status", "--porcelain"]);

  const res = await captureStepCheckpoint({
    cwd: ws,
    taskId: "proof-task-001",
    step: "dispatch-turn",
    scopePaths: ["a"],
  });

  // 1. ref exists where the contract says.
  const expectedRef = stepCheckpointRef("proof-task-001", "dispatch-turn");
  const refOid = sh(ws, ["rev-parse", "--verify", `${expectedRef}^{commit}`]);
  check("ref-exists", res.checkpointRef === expectedRef && refOid === res.commitOid,
    `${res.checkpointRef} -> ${res.commitOid.slice(0, 10)}`);

  // 2. parented on HEAD; diff vs HEAD is EXACTLY the scoped changes.
  const parent = sh(ws, ["rev-parse", `${expectedRef}^`]);
  check("parented-on-head", parent === headBefore, `parent ${parent.slice(0, 10)}`);
  const diff = sh(ws, ["diff", "--name-only", "HEAD", expectedRef]).split("\n").filter(Boolean).sort();
  const expectDiff = ["a/new.txt", "a/one.txt"];
  check("diff-scoped-only", JSON.stringify(diff) === JSON.stringify(expectDiff),
    `diff=[${diff.join(", ")}] (b/two.txt correctly absent)`);

  // 3. repo untouched: status identical, HEAD identical, single branch commit.
  const statusAfter = sh(ws, ["status", "--porcelain"]);
  const headAfter = sh(ws, ["rev-parse", "HEAD"]);
  const logCount = sh(ws, ["rev-list", "--count", "HEAD"]);
  check("worktree-and-index-untouched", statusAfter === statusBefore, "git status unchanged");
  check("no-branch-commits", headAfter === headBefore && logCount === "1",
    `HEAD unchanged, rev-list count=${logCount} (no stampede in git log)`);

  // 4. idempotent re-capture (same task+step overwrites the ref).
  const res2 = await captureStepCheckpoint({
    cwd: ws, taskId: "proof-task-001", step: "dispatch-turn", scopePaths: ["a"],
  });
  check("idempotent-recapture", res2.checkpointRef === expectedRef, `re-capture -> ${res2.commitOid.slice(0, 10)}`);

  // 5. tree is a full snapshot (baseline + scoped changes) — restore-safe.
  const paths = (await listCheckpointPaths(ws, expectedRef)).sort();
  check("tree-full-snapshot", JSON.stringify(paths) === JSON.stringify(["a/new.txt", "a/one.txt", "b/two.txt"]),
    `tree=[${paths.join(", ")}] (b/two.txt at BASELINE content)`);
  const bContent = sh(ws, ["show", `${expectedRef}:b/two.txt`]);
  check("unscoped-content-is-baseline", bContent === "baseline b", `b/two.txt in checkpoint = "${bContent}"`);

  console.log(JSON.stringify({
    verdict: failures.length === 0 ? "PASS" : "FAIL",
    failures,
    captureDurationMs: res.durationMs,
    workspace: ws,
  }));
  process.exitCode = failures.length === 0 ? 0 : 1;
} finally {
  rmSync(ws, { recursive: true, force: true });
}

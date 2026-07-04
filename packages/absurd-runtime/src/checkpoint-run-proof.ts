/**
 * checkpoint-bridge driver-level proof (T2.1 e2e, client-side spawner).
 *
 * Starts NO worker. Creates a scratch git workspace, dirties scoped + unscoped
 * paths, then spawns ONE t3.thread-run WITH checkpoint params against the
 * RUNNING supervised server. Proves the driver wiring end-to-end:
 *   - the task completes with git-checkpoint steps committed in Postgres;
 *   - the scratch workspace gains refs under refs/t3-absurd/checkpoints/<taskID>/;
 *   - the checkpoint diff vs HEAD contains ONLY the scoped path;
 *   - the workspace's branch history and status are untouched.
 *
 * Run: node --env-file=.env --experimental-strip-types src/checkpoint-run-proof.ts
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Absurd } from "absurd-sdk";
import { THREAD_RUN_TASK, type ThreadRunParams } from "./thread-driver.ts";

function sh(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const ws = mkdtempSync(join(tmpdir(), "ckpt-run-proof-"));
sh(ws, ["init", "-q"]);
sh(ws, ["config", "user.email", "proof@local"]);
sh(ws, ["config", "user.name", "checkpoint-run-proof"]);
mkdirSync(join(ws, "work"));
mkdirSync(join(ws, "other"));
writeFileSync(join(ws, "work", "surface.txt"), "baseline\n");
writeFileSync(join(ws, "other", "noise.txt"), "baseline\n");
sh(ws, ["add", "-A"]);
sh(ws, ["commit", "-qm", "baseline"]);
writeFileSync(join(ws, "work", "surface.txt"), "changed by the run's work surface\n");
writeFileSync(join(ws, "other", "noise.txt"), "unscoped change — must NOT be captured\n");
const statusBefore = sh(ws, ["status", "--porcelain"]);

const app = new Absurd({ queueName: "t3-absurd-runtime" });
const params: ThreadRunParams = {
  prompt: "checkpointed run proof",
  holdMs: 1500,
  checkpoint: { cwd: ws, scopePaths: ["work"] },
};
const spawn = await app.spawn(THREAD_RUN_TASK, params, { queue: "t3-absurd-runtime" });
console.log(`[ckpt-run-proof] spawned ${spawn.taskID}`);
const snapshot = await app.awaitTaskResult(spawn.taskID, { timeout: 120 });
await app.close();

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!ok) failures.push(name);
};

check("task-completed", snapshot.state === "completed", `state=${snapshot.state}`);

const refs = sh(ws, ["for-each-ref", "--format=%(refname)", "refs/t3-absurd/"])
  .split("\n")
  .filter(Boolean);
check(
  "both-step-refs-exist",
  refs.length === 2 &&
    refs.every((r) => r.startsWith(`refs/t3-absurd/checkpoints/${spawn.taskID}/`)),
  refs.join(", ") || "(none)",
);

const ref = `refs/t3-absurd/checkpoints/${spawn.taskID}/await-turn-complete`;
const diff = sh(ws, ["diff", "--name-only", "HEAD", ref]).split("\n").filter(Boolean);
check("diff-scoped-only", JSON.stringify(diff) === JSON.stringify(["work/surface.txt"]),
  `diff=[${diff.join(", ")}] (other/noise.txt correctly absent)`);

check("workspace-untouched",
  sh(ws, ["status", "--porcelain"]) === statusBefore && sh(ws, ["rev-list", "--count", "HEAD"]) === "1",
  "status + branch history unchanged");

console.log(JSON.stringify({ verdict: failures.length === 0 ? "PASS" : "FAIL", failures, taskID: spawn.taskID, workspace: ws }));
rmSync(ws, { recursive: true, force: true });
process.exit(failures.length === 0 ? 0 : 1);

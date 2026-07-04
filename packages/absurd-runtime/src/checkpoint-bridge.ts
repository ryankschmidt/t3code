/**
 * checkpoint-bridge (charter capability module #4, Landing Sprint T2.1).
 *
 * Maps Absurd step boundaries to SCOPED git checkpoints. This is the overlay
 * replacement for the per-message whole-repo capture hot path: instead of
 * `git add -A -- .` over an entire workspace on every message/turn (upstream
 * CheckpointReactor + GitVcsDriver.captureCheckpoint), a durable task captures
 * only at step completion and only over its declared work surface.
 *
 * Mechanics mirror the proven upstream pattern (temp index -> add -> write-tree
 * -> commit-tree -> update-ref) with two deliberate differences:
 *   1. The add is PATH-SCOPED (`git add -A -- <scope...>`), not `-- .`.
 *   2. Refs live under `refs/t3-absurd/checkpoints/<taskId>/<step>` so durable
 *      checkpoints are namespaced away from upstream's thread checkpoint refs.
 *
 * Invariants (the module's contract):
 *   - never touches the repository's real index (temp GIT_INDEX_FILE);
 *   - never creates branch commits — `git log` on any branch is unchanged;
 *   - never mutates the worktree;
 *   - idempotent per (taskId, step): re-capture overwrites the same ref.
 *
 * Must NOT own: step shape (thread-driver's), upstream reactor behavior,
 * retry policy, credential material.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type StepCheckpointOptions = {
  /** Git workspace the capture runs in (a repo root or worktree). */
  cwd: string;
  /** Durable task id — namespaces the checkpoint ref. */
  taskId: string;
  /** Step name the checkpoint marks (e.g. "dispatch-turn"). */
  step: string;
  /**
   * Paths (relative to cwd) the capture is scoped to. THE point of the bridge:
   * defaults to ["."] only if omitted, and callers are expected to scope.
   */
  scopePaths?: readonly string[] | undefined;
  /** Commit message override. */
  message?: string | undefined;
};

export type StepCheckpointResult = {
  checkpointRef: string;
  commitOid: string;
  treeOid: string;
  scopePaths: readonly string[];
  durationMs: number;
};

/** Canonical ref for a durable-task step checkpoint. */
export function stepCheckpointRef(taskId: string, step: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-");
  return `refs/t3-absurd/checkpoints/${clean(taskId)}/${clean(step)}`;
}

async function git(
  cwd: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * Capture a scoped checkpoint of the current worktree state at a step
 * boundary. Uses a temporary index so the repository's real index, branches,
 * and worktree are untouched.
 */
export async function captureStepCheckpoint(
  opts: StepCheckpointOptions,
): Promise<StepCheckpointResult> {
  const started = Date.now();
  const scopePaths = opts.scopePaths && opts.scopePaths.length > 0 ? opts.scopePaths : ["."];
  const checkpointRef = stepCheckpointRef(opts.taskId, opts.step);
  const indexDir = await mkdtemp(join(tmpdir(), "t3-absurd-ckpt-"));
  const indexFile = join(indexDir, "index");
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    // Seed the temp index from HEAD when one exists so the written tree is a
    // full snapshot (scoped adds layered over the last commit), matching the
    // restore semantics upstream relies on. Fresh repos start empty.
    const head = await git(opts.cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).catch(
      () => "",
    );
    if (head.length > 0) {
      await git(opts.cwd, ["read-tree", head], env);
    }
    await git(opts.cwd, ["add", "-A", "--", ...scopePaths], env);
    const treeOid = await git(opts.cwd, ["write-tree"], env);
    const message =
      opts.message ?? `t3-absurd step checkpoint ${opts.step} (task ${opts.taskId})`;
    const commitArgs = head.length > 0
      ? ["commit-tree", treeOid, "-p", head, "-m", message]
      : ["commit-tree", treeOid, "-m", message];
    const commitOid = await git(opts.cwd, commitArgs, env);
    if (commitOid.length === 0) {
      throw new Error("checkpoint-bridge: git commit-tree returned an empty oid");
    }
    await git(opts.cwd, ["update-ref", checkpointRef, commitOid]);
    return {
      checkpointRef,
      commitOid,
      treeOid,
      scopePaths,
      durationMs: Date.now() - started,
    };
  } finally {
    await rm(indexDir, { recursive: true, force: true });
  }
}

/** List a checkpoint's tree paths (proof/inspection helper). */
export async function listCheckpointPaths(cwd: string, ref: string): Promise<string[]> {
  const out = await git(cwd, ["ls-tree", "-r", "--name-only", ref]);
  return out.length === 0 ? [] : out.split("\n");
}

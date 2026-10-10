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
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

class CheckpointGitError extends Data.TaggedError("CheckpointGitError")<{
  readonly message: string;
}> {}

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

const git = Effect.fnUntraced(function* (
  cwd: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make("git", [...args], {
          cwd,
          env,
          extendEnv: true,
        }),
      );
      // Drain both pipes concurrently, with the same per-pipe execFile bound.
      // Reading stdout alone would lose nonzero exit failures or deadlock stderr.
      const readOutput = (stream: typeof handle.stdout) => {
        let bytes = 0;
        return stream.pipe(
          Stream.mapEffect((chunk) => {
            bytes += chunk.byteLength;
            return bytes > 8 * 1024 * 1024
              ? Effect.fail(
                  new CheckpointGitError({
                    message: "checkpoint-bridge: git output exceeded maxBuffer",
                  }),
                )
              : Effect.succeed(chunk);
          }),
          Stream.decodeText,
          Stream.mkString,
        );
      };
      const { stdout, stderr, code } = yield* Effect.all(
        {
          stdout: readOutput(handle.stdout),
          stderr: readOutput(handle.stderr),
          code: handle.exitCode,
        },
        { concurrency: "unbounded" },
      );
      if (code !== 0) {
        return yield* new CheckpointGitError({
          message: `checkpoint-bridge: git ${args[0]} exited ${code}: ${stderr.trim()}`,
        });
      }
      return stdout.trim();
    }),
  );
});

/**
 * Capture a scoped checkpoint of the current worktree state at a step
 * boundary. Uses a temporary index so the repository's real index, branches,
 * and worktree are untouched.
 */
export async function captureStepCheckpoint(
  opts: StepCheckpointOptions,
): Promise<StepCheckpointResult> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Clock.currentTimeMillis;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const scopePaths = opts.scopePaths && opts.scopePaths.length > 0 ? opts.scopePaths : ["."];
        const checkpointRef = stepCheckpointRef(opts.taskId, opts.step);
        const indexDir = yield* Effect.acquireRelease(
          fs.makeTempDirectory({ prefix: "t3-absurd-ckpt-" }),
          (directory) => fs.remove(directory, { recursive: true, force: true }).pipe(Effect.orDie),
        );
        const indexFile = path.join(indexDir, "index");
        const env = { GIT_INDEX_FILE: indexFile };
        // Seed the temp index from HEAD when one exists so the written tree is a
        // full snapshot (scoped adds layered over the last commit), matching the
        // restore semantics upstream relies on. Fresh repos start empty.
        const head = yield* git(opts.cwd, [
          "rev-parse",
          "--verify",
          "--quiet",
          "HEAD^{commit}",
        ]).pipe(Effect.orElseSucceed(() => ""));
        if (head.length > 0) {
          yield* git(opts.cwd, ["read-tree", head], env);
        }
        yield* git(opts.cwd, ["add", "-A", "--", ...scopePaths], env);
        const treeOid = yield* git(opts.cwd, ["write-tree"], env);
        const message =
          opts.message ?? `t3-absurd step checkpoint ${opts.step} (task ${opts.taskId})`;
        const commitArgs =
          head.length > 0
            ? ["commit-tree", treeOid, "-p", head, "-m", message]
            : ["commit-tree", treeOid, "-m", message];
        const commitOid = yield* git(opts.cwd, commitArgs, env);
        if (commitOid.length === 0) {
          return yield* new CheckpointGitError({
            message: "checkpoint-bridge: git commit-tree returned an empty oid",
          });
        }
        yield* git(opts.cwd, ["update-ref", checkpointRef, commitOid]);
        return {
          checkpointRef,
          commitOid,
          treeOid,
          scopePaths,
          durationMs: (yield* Clock.currentTimeMillis) - started,
        };
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
}

/** List a checkpoint's tree paths (proof/inspection helper). */
export async function listCheckpointPaths(cwd: string, ref: string): Promise<string[]> {
  const out = await Effect.runPromise(
    git(cwd, ["ls-tree", "-r", "--name-only", ref]).pipe(Effect.provide(NodeServices.layer)),
  );
  return out.length === 0 ? [] : out.split("\n");
}

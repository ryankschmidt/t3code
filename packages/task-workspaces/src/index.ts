import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, rename, rm, mkdtemp, lstat, realpath } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { publicationChildStdio, withPublicationLock } from "./publication-lock.ts";

export type Change = { path: string; content: string | null };
export type Task = { taskId: string; agentId: string; baseline: string; scope: string[] };
export type PreparedPublication = {
  taskId: string;
  baseline: string;
  acceptedParent: string;
  candidateTree: string;
  changesSha256: string;
};
export type CheckReceipt = PreparedPublication & { passed: true; reviewerId: string };
export type PublicationReceipt = {
  taskId: string;
  requestId: string;
  revision: string;
  previousRevision: string;
  changesSha256: string;
  status: "accepted";
  reviewerId: string;
};
export type WorkspaceAllocation = Task & { path: string; status: "private-draft" };
export class PublicationError extends Error {
  readonly code: string;
  readonly paths: string[];
  constructor(code: string, paths: string[] = []) {
    super(`${code}${paths.length ? `: ${paths.join(", ")}` : ""}`);
    this.code = code;
    this.paths = paths;
  }
}
function fail(code: string): never {
  throw new PublicationError(code);
}
function identifier(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))
    fail("INVALID_IDENTIFIER");
}
function safePath(path: string): void {
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((p) => !p || p === "." || p === ".." || p.toLowerCase() === ".git")
  )
    fail("INVALID_PATH");
}
function canonical(changes: Change[]): Change[] {
  if (!Array.isArray(changes)) fail("INVALID_CHANGES");
  const seen = new Set<string>();
  const result = changes.map((c) => {
    if (!c || (typeof c.content !== "string" && c.content !== null)) fail("INVALID_CHANGE");
    safePath(c.path);
    if (seen.has(c.path)) fail("DUPLICATE_PATH");
    seen.add(c.path);
    return { path: c.path, content: c.content };
  });
  return result.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function changesDigest(changes: Change[]): string {
  return digest(canonical(changes));
}
const acceptedRef = "refs/heads/accepted";
type CommitRecord = {
  schema: "task-publication.v1";
  taskId: string;
  requestId: string;
  previousRevision: string;
  changesSha256: string;
  reviewerId: string;
  requestDigest: string;
};

/** The caller owns this trusted root. Receipt authentication and OS isolation live outside this storage module. */
export class PublicationStore {
  readonly root: string;
  readonly repo: string;
  constructor(options: { root: string }) {
    this.root = resolve(options.root);
    this.repo = join(this.root, "accepted.git");
  }
  private git(args: string[], input?: string, index?: string, repo = this.repo): string {
    return execFileSync(
      "/usr/bin/git",
      [
        "--git-dir",
        repo,
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgSign=false",
        "-c",
        "core.quotePath=false",
        ...args,
      ],
      {
        cwd: this.root,
        input,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 30_000,
        env: {
          PATH: "/usr/bin:/bin",
          HOME: this.root,
          LANG: "C",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_SYSTEM: "/dev/null",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
          GIT_NO_REPLACE_OBJECTS: "1",
          GIT_LITERAL_PATHSPECS: "1",
          GIT_AUTHOR_NAME: "ThroughLine Publisher",
          GIT_AUTHOR_EMAIL: "publisher@localhost",
          GIT_COMMITTER_NAME: "ThroughLine Publisher",
          GIT_COMMITTER_EMAIL: "publisher@localhost",
          ...(index ? { GIT_INDEX_FILE: index } : {}),
        },
        stdio: publicationChildStdio(),
      },
    );
  }
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    return withPublicationLock(this.root, fn);
  }
  async initialize(files: Record<string, string>): Promise<string> {
    return this.locked(async () => {
      await mkdir(join(this.root, "tasks"), { recursive: true, mode: 0o700 });
      this.git(["init", "--bare", this.repo]);
      const existing = this.git(["for-each-ref", "--format=%(objectname)", acceptedRef]).trim();
      if (existing) return existing;
      const changes = canonical(
        Object.entries(files).map(([path, content]) => {
          if (typeof content !== "string") fail("INVALID_SEED");
          return { path, content };
        }),
      );
      const tree = await this.tree(null, changes);
      const revision = this.git(["commit-tree", tree], "throughline-seed.v1\n").trim();
      this.git(["update-ref", acceptedRef, revision, "0".repeat(40)]);
      return revision;
    });
  }
  async currentRevision(): Promise<string> {
    return this.git(["rev-parse", "--verify", acceptedRef]).trim();
  }
  private entries(revision: string): Map<string, string> {
    const output = this.git(["ls-tree", "-r", "-z", revision]);
    return new Map(
      output
        .split("\0")
        .filter(Boolean)
        .map((row) => {
          const tab = row.indexOf("\t");
          return [row.slice(tab + 1), row.slice(0, tab)];
        }),
    );
  }
  async readAccepted(path: string): Promise<string | null> {
    safePath(path);
    const entry = this.entries(await this.currentRevision()).get(path);
    if (!entry) return null;
    return this.git(["cat-file", "blob", entry.split(" ")[2]!]);
  }
  async getTask(taskId: string): Promise<Task | null> {
    identifier(taskId);
    try {
      return JSON.parse(await readFile(join(this.root, "tasks", `${taskId}.json`), "utf8")) as Task;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async materializeTask(request: {
    taskId: string;
    workspaceRoot: string;
  }): Promise<WorkspaceAllocation> {
    identifier(request.taskId);
    return this.locked(async () => {
      const task = await this.getTask(request.taskId);
      if (!task) fail("TASK_NOT_FOUND");
      if (
        typeof request.workspaceRoot !== "string" ||
        !request.workspaceRoot ||
        request.workspaceRoot.includes("\0")
      )
        fail("INVALID_WORKSPACE_ROOT");
      const supplied = resolve(request.workspaceRoot);
      // The supervisor supplies and protects the parent. Resolve platform aliases (e.g. macOS /var),
      // but reject a symlink in the allocation root itself rather than following it.
      await mkdir(dirname(supplied), { recursive: true, mode: 0o700 });
      const workspaceRoot = join(await realpath(dirname(supplied)), basename(supplied));
      const publisherRoot = await realpath(this.root);
      if (
        workspaceRoot === publisherRoot ||
        publisherRoot.startsWith(`${workspaceRoot}/`) ||
        workspaceRoot.startsWith(`${publisherRoot}/`)
      )
        fail("UNSAFE_WORKSPACE_ROOT");
      try {
        await mkdir(workspaceRoot, { mode: 0o700 });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
      const rootStat = await lstat(workspaceRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("UNSAFE_WORKSPACE_ROOT");
      const target = join(workspaceRoot, task.taskId);
      const registry = join(this.root, "allocations");
      await mkdir(registry, { recursive: true, mode: 0o700 });
      const recordPath = join(registry, `${task.taskId}.json`);
      type Record = { allocation: WorkspaceAllocation; staging: string; ino: number; dev: number };
      let record: Record | null = null;
      try {
        record = JSON.parse(await readFile(recordPath, "utf8")) as Record;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      const statOrNull = async (path: string) => {
        try {
          return await lstat(path);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw e;
        }
      };
      if (record) {
        if (
          record.allocation.path !== target ||
          record.allocation.taskId !== task.taskId ||
          record.allocation.baseline !== task.baseline ||
          record.allocation.agentId !== task.agentId
        )
          fail("ALLOCATION_MISMATCH");
        let state = await statOrNull(target);
        if (!state) {
          const staged = await statOrNull(record.staging);
          if (
            !staged?.isDirectory() ||
            staged.isSymbolicLink() ||
            staged.ino !== record.ino ||
            staged.dev !== record.dev
          )
            fail("ALLOCATION_MISSING");
          await rename(record.staging, target);
          state = await lstat(target);
        }
        if (
          !state.isDirectory() ||
          state.isSymbolicLink() ||
          state.ino !== record.ino ||
          state.dev !== record.dev
        )
          fail("ALLOCATION_REPLACED");
        return record.allocation;
      }
      if (await statOrNull(target)) fail("WORKSPACE_TARGET_EXISTS");
      const staging = await mkdtemp(join(workspaceRoot, ".allocating-"));
      let journaled = false;
      try {
        const repo = join(staging, ".git");
        this.git(["init", "--initial-branch=task", staging], undefined, undefined, repo);
        // Copy objects through Git's pack protocol, never clone config/remotes, hardlinks or alternates.
        const pack = execFileSync(
          "/usr/bin/git",
          ["--git-dir", this.repo, "pack-objects", "--stdout", "--revs"],
          {
            input: `${task.baseline}\n`,
            stdio: publicationChildStdio(),
            maxBuffer: 64 * 1024 * 1024,
            timeout: 30_000,
            env: {
              PATH: "/usr/bin:/bin",
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_CONFIG_GLOBAL: "/dev/null",
              GIT_CONFIG_SYSTEM: "/dev/null",
              GIT_NO_REPLACE_OBJECTS: "1",
            },
          },
        );
        execFileSync("/usr/bin/git", ["--git-dir", repo, "index-pack", "--stdin"], {
          input: pack,
          stdio: publicationChildStdio(),
          maxBuffer: 64 * 1024 * 1024,
          timeout: 30_000,
          env: {
            PATH: "/usr/bin:/bin",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_SYSTEM: "/dev/null",
            GIT_NO_REPLACE_OBJECTS: "1",
          },
        });
        this.git(["update-ref", "refs/heads/task", task.baseline], undefined, undefined, repo);
        this.git(
          ["--work-tree", staging, "read-tree", "--reset", "-u", task.baseline],
          undefined,
          undefined,
          repo,
        );
        const allocation: WorkspaceAllocation = { ...task, path: target, status: "private-draft" };
        const stat = await lstat(staging);
        record = { allocation, staging, ino: stat.ino, dev: stat.dev };
        const temporary = join(registry, `${randomUUID()}.tmp`);
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify(record));
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, recordPath);
        const directory = await open(registry, "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
        journaled = true;
        await rename(staging, target);
        const parent = await open(workspaceRoot, "r");
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
        return allocation;
      } finally {
        if (!journaled) await rm(staging, { recursive: true, force: true });
      }
    });
  }
  async openTask(request: { taskId: string; agentId: string; scope: string[] }): Promise<Task> {
    identifier(request.taskId);
    identifier(request.agentId);
    if (!Array.isArray(request.scope) || !request.scope.length) fail("INVALID_SCOPE");
    const scope = [...new Set(request.scope)].sort();
    scope.forEach((p) => {
      if (typeof p !== "string") fail("INVALID_SCOPE");
      safePath(p.endsWith("/") ? p.slice(0, -1) : p);
    });
    return this.locked(async () => {
      const prior = await this.getTask(request.taskId);
      if (prior) {
        if (
          prior.agentId !== request.agentId ||
          JSON.stringify(prior.scope) !== JSON.stringify(scope)
        )
          fail("TASK_BINDING_MISMATCH");
        return prior;
      }
      const task = {
        taskId: request.taskId,
        agentId: request.agentId,
        scope,
        baseline: await this.currentRevision(),
      };
      const directory = join(this.root, "tasks");
      const temporary = join(directory, `${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(task));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, join(directory, `${task.taskId}.json`));
      const dir = await open(directory, "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
      return task;
    });
  }
  private async tree(parent: string | null, changes: Change[]): Promise<string> {
    const temporary = await mkdtemp(join(this.root, "index-"));
    const index = join(temporary, "index");
    try {
      this.git(parent ? ["read-tree", parent] : ["read-tree", "--empty"], undefined, index);
      const updates = changes
        .map((c) =>
          c.content === null
            ? `0 ${"0".repeat(40)}\t${c.path}\0`
            : `100644 ${this.git(["hash-object", "-w", "--stdin"], c.content).trim()}\t${c.path}\0`,
        )
        .join("");
      if (updates) this.git(["update-index", "-z", "--index-info"], updates, index);
      return this.git(["write-tree"], undefined, index).trim();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  private async taskChanges(
    taskId: string,
    input: Change[],
  ): Promise<{ task: Task; changes: Change[] }> {
    identifier(taskId);
    const task = await this.getTask(taskId);
    if (!task) fail("TASK_NOT_FOUND");
    const changes = canonical(input);
    for (const c of changes)
      if (!task.scope.some((s) => (s.endsWith("/") ? c.path.startsWith(s) : c.path === s)))
        fail("OUT_OF_SCOPE");
    return { task, changes };
  }
  private async prepare(task: Task, changes: Change[]): Promise<PreparedPublication> {
    const acceptedParent = await this.currentRevision();
    const before = this.entries(task.baseline),
      now = this.entries(acceptedParent);
    const paths = new Set([...before.keys(), ...now.keys()]);
    const conflicts = changes
      .filter((c) =>
        [...paths].some(
          (p) =>
            (p === c.path || p.startsWith(`${c.path}/`) || c.path.startsWith(`${p}/`)) &&
            before.get(p) !== now.get(p),
        ),
      )
      .map((c) => c.path);
    if (conflicts.length) throw new PublicationError("PUBLICATION_CONFLICT", conflicts);
    const candidateTree = await this.tree(acceptedParent, changes);
    const candidate = this.entries(candidateTree);
    const requested = new Set(changes.map((c) => c.path));
    // Git can replace a directory with a file. Never let that implicitly delete unsubmitted children.
    for (const path of new Set([...now.keys(), ...candidate.keys()])) {
      if (now.get(path) !== candidate.get(path) && !requested.has(path))
        fail("IMPLICIT_PATH_CHANGE");
    }
    return {
      taskId: task.taskId,
      baseline: task.baseline,
      acceptedParent,
      candidateTree,
      changesSha256: changesDigest(changes),
    };
  }
  async preparePublication(request: {
    taskId: string;
    changes: Change[];
  }): Promise<PreparedPublication> {
    const { task, changes } = await this.taskChanges(request.taskId, request.changes);
    return this.locked(() => this.prepare(task, changes));
  }
  async publish(request: {
    taskId: string;
    requestId: string;
    changes: Change[];
    check: CheckReceipt;
  }): Promise<PublicationReceipt> {
    identifier(request.requestId);
    const { task, changes } = await this.taskChanges(request.taskId, request.changes);
    const check = request.check;
    if (
      !check ||
      check.passed !== true ||
      check.taskId !== task.taskId ||
      check.baseline !== task.baseline ||
      check.changesSha256 !== changesDigest(changes) ||
      check.reviewerId === task.agentId
    )
      fail("INVALID_CHECK");
    identifier(check.reviewerId);
    const requestDigest = digest({
      taskId: task.taskId,
      changes,
      check: {
        taskId: check.taskId,
        baseline: check.baseline,
        acceptedParent: check.acceptedParent,
        candidateTree: check.candidateTree,
        changesSha256: check.changesSha256,
        passed: check.passed,
        reviewerId: check.reviewerId,
      },
    });
    return this.locked(async () => {
      // Commit metadata IS the receipt journal: no post-ref sidecar write can lose an accepted request.
      const history = this.git(["rev-list", acceptedRef]).trim().split("\n");
      for (const revision of history) {
        const raw = this.git(["show", "-s", "--format=%B", revision]);
        let record: CommitRecord;
        try {
          record = JSON.parse(raw) as CommitRecord;
        } catch {
          continue;
        }
        if (record.schema !== "task-publication.v1" || record.requestId !== request.requestId)
          continue;
        if (record.requestDigest !== requestDigest) fail("REQUEST_REUSED");
        return {
          taskId: record.taskId,
          requestId: record.requestId,
          revision,
          previousRevision: record.previousRevision,
          changesSha256: record.changesSha256,
          status: "accepted",
          reviewerId: record.reviewerId,
        };
      }
      if ((await this.currentRevision()) !== check.acceptedParent) fail("CHECK_STALE");
      const candidate = await this.prepare(task, changes);
      if (candidate.candidateTree !== check.candidateTree) fail("INVALID_CHECK");
      const record: CommitRecord = {
        schema: "task-publication.v1",
        taskId: task.taskId,
        requestId: request.requestId,
        previousRevision: candidate.acceptedParent,
        changesSha256: candidate.changesSha256,
        reviewerId: check.reviewerId,
        requestDigest,
      };
      const revision = this.git(
        ["commit-tree", candidate.candidateTree, "-p", candidate.acceptedParent],
        JSON.stringify(record),
      ).trim();
      this.git(["update-ref", acceptedRef, revision, candidate.acceptedParent]);
      return {
        taskId: task.taskId,
        requestId: request.requestId,
        revision,
        previousRevision: candidate.acceptedParent,
        changesSha256: candidate.changesSha256,
        status: "accepted",
        reviewerId: check.reviewerId,
      };
    });
  }
}

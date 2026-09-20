import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertProtectedPath, readProtectedJson } from "./protected-files.ts";
import {
  attestExecution,
  type ExecutionGrant,
  type ExecutionIdentity,
  type ExecutionGrantReader,
} from "./execution-grants.ts";
import type { Principal } from "./review-authority.ts";

export type GrantAuthorityOptions = {
  root: string;
  authorityUid: number;
  procRoot?: string;
  now?: () => number;
};
export type GrantState = {
  grant: ExecutionGrant;
  revision: number;
  digest: string;
  status: "active" | "revoked";
};
export type GrantOperationReceipt = GrantState & {
  operation: "issue" | "renew" | "revoke";
  requestId: string;
};
type Issue = {
  requestId: string;
  grantId: string;
  principal: Principal;
  execution: ExecutionIdentity;
  expiresAt: number;
};
type Compare = {
  requestId: string;
  grantId: string;
  expectedRevision: number;
  expectedDigest: string;
};
type Renew = Compare & { expiresAt: number };
const id = (v: unknown) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v))
    throw Error("INVALID_GRANT_IDENTIFIER");
};
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function keys(value: object, allowed: string[]) {
  if (Object.keys(value).some((k) => !allowed.includes(k))) throw Error("GRANT_FIELDS_REFUSED");
}
function principal(p: Principal): Principal {
  if (!p || typeof p !== "object") throw Error("INVALID_PRINCIPAL");
  keys(p, ["id", "kind", "taskIds"]);
  id(p.id);
  if (
    !["worker", "reviewer"].includes(p.kind) ||
    !Array.isArray(p.taskIds) ||
    p.taskIds.length < 1 ||
    p.taskIds.length > 1024 ||
    new Set(p.taskIds).size !== p.taskIds.length
  )
    throw Error("INVALID_PRINCIPAL");
  p.taskIds.forEach(id);
  return { id: p.id, kind: p.kind, taskIds: [...p.taskIds].sort() };
}
function execution(e: ExecutionIdentity): ExecutionIdentity {
  if (!e || typeof e !== "object") throw Error("INVALID_EXECUTION");
  keys(e, ["uid", "gid", "bootId", "cgroup", "leaderPid", "leaderStartTicks"]);
  if (
    !Number.isSafeInteger(e.uid) ||
    e.uid <= 0 ||
    e.uid > 0xffffffff ||
    !Number.isSafeInteger(e.gid) ||
    e.gid < 0 ||
    e.gid > 0xffffffff ||
    !Number.isSafeInteger(e.leaderPid) ||
    e.leaderPid <= 0 ||
    typeof e.bootId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(e.bootId) ||
    typeof e.leaderStartTicks !== "string" ||
    !/^\d+$/.test(e.leaderStartTicks) ||
    typeof e.cgroup !== "string" ||
    !e.cgroup.startsWith("/") ||
    e.cgroup === "/"
  )
    throw Error("INVALID_EXECUTION");
  return {
    uid: e.uid,
    gid: e.gid,
    bootId: e.bootId,
    cgroup: e.cgroup,
    leaderPid: e.leaderPid,
    leaderStartTicks: e.leaderStartTicks,
  };
}
const paths = (root: string) => ({
  control: join(root, ".authority"),
  database: join(root, ".authority", "grants.sqlite"),
  witness: join(root, ".execution-authority-established.json"),
  ready: join(root, ".authority", "ready.json"),
});
async function protectedDatabase(options: GrantAuthorityOptions) {
  await assertProtectedPath(options.root, options.authorityUid);
  const p = paths(options.root);
  await assertProtectedPath(p.control, options.authorityUid);
  const file = await open(p.database, constants.O_NOFOLLOW | constants.O_RDONLY, 0o600);
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.size === 0 ||
      stat.nlink !== 1 ||
      (stat.uid !== options.authorityUid && stat.uid !== 0) ||
      (stat.mode & 0o022) !== 0
    )
      throw Error("UNTRUSTED_AUTHORITY_DATABASE");
  } finally {
    await file.close();
  }
  await assertProtectedPath(p.database, options.authorityUid);
  return p.database;
}
async function writeWitness(path: string, value: unknown): Promise<void> {
  const file = await open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
}
async function syncDirectory(path: string) {
  const dir = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}
async function initialized(options: GrantAuthorityOptions, db: DatabaseSync): Promise<void> {
  const p = paths(options.root);
  const witness = (await readProtectedJson(p.witness, options.authorityUid, 4096)) as {
    schema?: unknown;
    authorityId?: unknown;
    authorityUid?: unknown;
  };
  const ready = (await readProtectedJson(p.ready, options.authorityUid, 4096)) as {
    schema?: unknown;
    authorityId?: unknown;
  };
  if (
    witness.schema !== "execution-authority-established.v1" ||
    witness.authorityUid !== options.authorityUid ||
    typeof witness.authorityId !== "string" ||
    ready.schema !== "execution-authority-ready.v1" ||
    ready.authorityId !== witness.authorityId
  )
    throw Error("AUTHORITY_NOT_INITIALIZED");
  if (
    db.prepare("PRAGMA user_version").get()?.user_version !== 1 ||
    db.prepare("SELECT authority_id FROM authority_metadata WHERE singleton=1").get()
      ?.authority_id !== witness.authorityId
  )
    throw Error("AUTHORITY_HISTORY_MISMATCH");
  db.prepare("SELECT grant_id,state FROM grants LIMIT 0").all();
  db.prepare("SELECT request_id,digest,receipt FROM requests LIMIT 0").all();
}

/** One transaction owns both authorization state and its replay receipt; no active JSON projection. */
export class ExecutionGrantAuthority {
  private readonly db: DatabaseSync;
  private readonly options: GrantAuthorityOptions;
  private readonly databaseIdentity: { dev: number; ino: number };
  private constructor(
    db: DatabaseSync,
    options: GrantAuthorityOptions,
    databaseIdentity: { dev: number; ino: number },
  ) {
    this.db = db;
    this.options = options;
    this.databaseIdentity = databaseIdentity;
  }
  static async open(options: GrantAuthorityOptions): Promise<ExecutionGrantAuthority> {
    if (!process.getuid || process.getuid() !== options.authorityUid)
      throw Error("GRANT_AUTHORITY_UID_REFUSED");
    const path = await protectedDatabase(options);
    const identity = await lstat(path);
    const db = new DatabaseSync(`${pathToFileURL(path).href}?mode=rw`);
    try {
      db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
      await initialized(options, db);
    } catch (error) {
      db.close();
      throw error;
    }
    return new ExecutionGrantAuthority(
      db,
      { ...options },
      { dev: identity.dev, ino: identity.ino },
    );
  }
  /** Explicit first provisioning only. Never invoke this because normal open failed. */
  static async bootstrap(options: GrantAuthorityOptions): Promise<ExecutionGrantAuthority> {
    if (!process.getuid || process.getuid() !== options.authorityUid)
      throw Error("GRANT_AUTHORITY_UID_REFUSED");
    await assertProtectedPath(options.root, options.authorityUid);
    const p = paths(options.root);
    try {
      await lstat(p.control);
      throw Error("AUTHORITY_ALREADY_ESTABLISHED");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const authorityId = randomUUID();
    // This immutable marker survives loss of the entire control directory. Interrupted creation
    // deliberately stays closed: repair requires explicit recovery, never automatic bootstrap.
    await writeWitness(p.witness, {
      schema: "execution-authority-established.v1",
      authorityId,
      authorityUid: options.authorityUid,
    });
    await syncDirectory(options.root);
    await mkdir(p.control, { mode: 0o700 });
    const file = await open(
      p.database,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    await file.close();
    const db = new DatabaseSync(p.database);
    try {
      db.exec(
        "PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE;",
      );
      db.exec(
        "CREATE TABLE grants(grant_id TEXT PRIMARY KEY,state TEXT NOT NULL); CREATE TABLE requests(request_id TEXT PRIMARY KEY,digest TEXT NOT NULL,receipt TEXT NOT NULL); CREATE TABLE authority_metadata(singleton INTEGER PRIMARY KEY CHECK(singleton=1),authority_id TEXT NOT NULL); PRAGMA user_version=1;",
      );
      db.prepare("INSERT INTO authority_metadata(singleton,authority_id) VALUES(1,?)").run(
        authorityId,
      );
      db.exec("COMMIT");
    } finally {
      db.close();
    }
    await writeWitness(p.ready, { schema: "execution-authority-ready.v1", authorityId });
    await syncDirectory(p.control);
    await syncDirectory(options.root);
    return this.open(options);
  }
  close() {
    this.db.close();
  }
  private async authorized() {
    if (!process.getuid || process.getuid() !== this.options.authorityUid)
      throw Error("GRANT_AUTHORITY_UID_REFUSED");
    const path = await protectedDatabase(this.options);
    const stat = await lstat(path);
    if (stat.dev !== this.databaseIdentity.dev || stat.ino !== this.databaseIdentity.ino)
      throw Error("AUTHORITY_DATABASE_REPLACED");
    await initialized(this.options, this.db);
  }
  async attest(pid: number) {
    await this.authorized();
    return attestExecution(pid, this.options.procRoot);
  }
  async read(grantId: string): Promise<GrantState | null> {
    id(grantId);
    await this.authorized();
    return this.state(grantId);
  }
  private state(grantId: string): GrantState | null {
    const row = this.db.prepare("SELECT state FROM grants WHERE grant_id=?").get(grantId);
    return row ? (JSON.parse(row.state as string) as GrantState) : null;
  }
  private replay(requestId: string, digest: string): GrantOperationReceipt | null {
    const row = this.db
      .prepare("SELECT digest,receipt FROM requests WHERE request_id=?")
      .get(requestId);
    if (!row) return null;
    if (row.digest !== digest) throw Error("GRANT_REQUEST_REUSED");
    return JSON.parse(row.receipt as string) as GrantOperationReceipt;
  }
  private lease(expiresAt: number) {
    const now = (this.options.now ?? Date.now)();
    if (
      !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= now ||
      expiresAt - now > 86400000
    )
      throw Error("GRANT_LEASE_REFUSED");
  }
  private async live(e: ExecutionIdentity) {
    const expected = execution({
      uid: e.uid,
      gid: e.gid,
      bootId: e.bootId,
      cgroup: e.cgroup,
      leaderPid: e.leaderPid,
      leaderStartTicks: e.leaderStartTicks,
    });
    if (
      JSON.stringify(await attestExecution(e.leaderPid, this.options.procRoot)) !==
      JSON.stringify(expected)
    )
      throw Error("EXECUTION_BINDING_CHANGED");
  }
  private transaction(
    requestId: string,
    digest: string,
    operation: GrantOperationReceipt["operation"],
    change: () => GrantState,
  ): GrantOperationReceipt {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.replay(requestId, digest);
      if (prior) {
        this.db.exec("COMMIT");
        return prior;
      }
      const state = change();
      const receipt = { ...state, operation, requestId };
      this.db
        .prepare(
          "INSERT INTO grants(grant_id,state) VALUES(?,?) ON CONFLICT(grant_id) DO UPDATE SET state=excluded.state",
        )
        .run(state.grant.grantId, JSON.stringify(state));
      this.db
        .prepare("INSERT INTO requests(request_id,digest,receipt) VALUES(?,?,?)")
        .run(requestId, digest, JSON.stringify(receipt));
      this.db.exec("COMMIT");
      return receipt;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async issue(input: Issue): Promise<GrantOperationReceipt> {
    keys(input, ["requestId", "grantId", "principal", "execution", "expiresAt"]);
    id(input.requestId);
    id(input.grantId);
    const request: Issue = {
      requestId: input.requestId,
      grantId: input.grantId,
      principal: principal(input.principal),
      execution: execution(input.execution),
      expiresAt: input.expiresAt,
    };
    const digest = hash({ operation: "issue", ...request });
    await this.authorized();
    const prior = this.replay(request.requestId, digest);
    if (prior) return prior;
    this.lease(request.expiresAt);
    await this.live(request.execution);
    return this.transaction(request.requestId, digest, "issue", () => {
      this.lease(request.expiresAt);
      if (this.state(request.grantId)) throw Error("GRANT_ALREADY_EXISTS");
      const grant: ExecutionGrant = {
        schema: "throughline.execution-grant.v1",
        grantId: request.grantId,
        principal: request.principal,
        ...request.execution,
        expiresAt: request.expiresAt,
      };
      return {
        grant,
        revision: 1,
        status: "active",
        digest: hash({ grant, revision: 1, status: "active" }),
      };
    });
  }
  private compare(input: Compare): Compare {
    id(input.requestId);
    id(input.grantId);
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      typeof input.expectedDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.expectedDigest)
    )
      throw Error("GRANT_CAS_REQUIRED");
    return {
      requestId: input.requestId,
      grantId: input.grantId,
      expectedRevision: input.expectedRevision,
      expectedDigest: input.expectedDigest,
    };
  }
  private matched(request: Compare) {
    const current = this.state(request.grantId);
    if (
      !current ||
      current.revision !== request.expectedRevision ||
      current.digest !== request.expectedDigest
    )
      throw Error("GRANT_CAS_REFUSED");
    return current;
  }
  async renew(input: Renew): Promise<GrantOperationReceipt> {
    keys(input, ["requestId", "grantId", "expectedRevision", "expectedDigest", "expiresAt"]);
    const request = { ...this.compare(input), expiresAt: input.expiresAt };
    const digest = hash({ operation: "renew", ...request });
    await this.authorized();
    const prior = this.replay(request.requestId, digest);
    if (prior) return prior;
    const current = this.matched(request);
    if (current.status !== "active") throw Error("GRANT_REVOKED");
    this.lease(request.expiresAt);
    await this.live(current.grant);
    return this.transaction(request.requestId, digest, "renew", () => {
      const current = this.matched(request);
      if (current.status !== "active") throw Error("GRANT_REVOKED");
      this.lease(request.expiresAt);
      const grant = { ...current.grant, expiresAt: request.expiresAt };
      const revision = current.revision + 1;
      return {
        grant,
        revision,
        status: "active",
        digest: hash({ grant, revision, status: "active" }),
      };
    });
  }
  async revoke(input: Compare): Promise<GrantOperationReceipt> {
    keys(input, ["requestId", "grantId", "expectedRevision", "expectedDigest"]);
    const request = this.compare(input);
    const digest = hash({ operation: "revoke", ...request });
    await this.authorized();
    return this.transaction(request.requestId, digest, "revoke", () => {
      const current = this.matched(request);
      if (current.status !== "active") throw Error("GRANT_REVOKED");
      const revision = current.revision + 1;
      return {
        ...current,
        revision,
        status: "revoked",
        digest: hash({ grant: current.grant, revision, status: "revoked" }),
      };
    });
  }
}

/** Explicit composition choice. Missing/corrupt database never opens legacy JSON grants. */
export async function openExecutionGrantReader(
  options: Pick<GrantAuthorityOptions, "root" | "authorityUid">,
): Promise<ExecutionGrantReader & { close(): void }> {
  const bound = { ...options };
  const path = await protectedDatabase(bound);
  const identity = await lstat(path);
  const db = new DatabaseSync(`${pathToFileURL(path).href}?mode=ro`, { readOnly: true });
  db.exec("PRAGMA busy_timeout=5000");
  try {
    await initialized(bound, db);
  } catch (error) {
    db.close();
    throw error;
  }
  const check = async () => {
    await protectedDatabase(bound);
    const stat = await lstat(path);
    if (stat.dev !== identity.dev || stat.ino !== identity.ino)
      throw Error("AUTHORITY_DATABASE_REPLACED");
    await initialized(bound, db);
  };
  return {
    async list() {
      await check();
      return db
        .prepare(
          "SELECT state FROM grants WHERE json_extract(state,'$.status')='active' ORDER BY grant_id LIMIT 1025",
        )
        .all()
        .map((row) => (JSON.parse(row.state as string) as GrantState).grant);
    },
    async get(grantId) {
      id(grantId);
      await check();
      const row = db.prepare("SELECT state FROM grants WHERE grant_id=?").get(grantId);
      if (!row) return null;
      const state = JSON.parse(row.state as string) as GrantState;
      return state.status === "active" ? state.grant : null;
    },
    close() {
      db.close();
    },
  };
}

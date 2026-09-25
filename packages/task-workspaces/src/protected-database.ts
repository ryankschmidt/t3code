import { DatabaseSync } from "node:sqlite";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertProtectedPath } from "./protected-files.ts";

export type ProtectedDatabaseOptions = { root: string; authorityUid: number };

/**
 * One SQLite file in a protected folder, used only by the service account that owns it. The file
 * is created 0600 on first open, and the schema is created in the transaction that checks its
 * version. check() re-verifies the account, the path and the file identity before each use.
 */
export class ProtectedDatabase {
  readonly db: DatabaseSync;
  private readonly options: ProtectedDatabaseOptions;
  private readonly path: string;
  private readonly name: string;
  private readonly identity: { dev: number; ino: number };
  private constructor(
    db: DatabaseSync,
    options: ProtectedDatabaseOptions,
    path: string,
    name: string,
    identity: { dev: number; ino: number },
  ) {
    this.db = db;
    this.options = options;
    this.path = path;
    this.name = name;
    this.identity = identity;
  }
  /** name prefixes the refusal codes; schema runs once, when the file is new (user_version 0). */
  static async open(
    options: ProtectedDatabaseOptions,
    file: string,
    name: string,
    schema: string,
  ): Promise<ProtectedDatabase> {
    const bound = { root: options.root, authorityUid: options.authorityUid };
    if (!process.getuid || process.getuid() !== bound.authorityUid)
      throw Error(`${name}_UID_REFUSED`);
    await assertProtectedPath(bound.root, bound.authorityUid);
    const path = join(bound.root, file);
    const handle = await open(
      path,
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        (stat.uid !== bound.authorityUid && stat.uid !== 0) ||
        (stat.mode & 0o077) !== 0
      )
        throw Error(`UNTRUSTED_${name}`);
    } finally {
      await handle.close();
    }
    await assertProtectedPath(path, bound.authorityUid);
    const identity = await lstat(path);
    const db = new DatabaseSync(`${pathToFileURL(path).href}?mode=rw`);
    const database = new ProtectedDatabase(db, bound, path, name, {
      dev: identity.dev,
      ino: identity.ino,
    });
    try {
      db.exec(
        "PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;",
      );
      database.transaction(() => {
        const version = db.prepare("PRAGMA user_version").get()?.user_version;
        if (version === 0) db.exec(`${schema} PRAGMA user_version=1;`);
        else if (version !== 1) throw Error(`${name}_VERSION_REFUSED`);
      });
    } catch (error) {
      db.close();
      throw error;
    }
    return database;
  }
  close() {
    this.db.close();
  }
  async check() {
    if (!process.getuid || process.getuid() !== this.options.authorityUid)
      throw Error(`${this.name}_UID_REFUSED`);
    await assertProtectedPath(this.path, this.options.authorityUid);
    const stat = await lstat(this.path);
    if (stat.dev !== this.identity.dev || stat.ino !== this.identity.ino)
      throw Error(`${this.name}_REPLACED`);
  }
  /** One BEGIN IMMEDIATE transaction: the write lock is taken before anything is read. */
  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

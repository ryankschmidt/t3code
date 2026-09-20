import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { connect } from "node:net";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  rename,
  stat,
  chmod,
  truncate,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startPublisherRuntime } from "../../src/publisher-runtime.ts";
import { ExecutionGrantAuthority } from "../../src/execution-grant-authority.ts";
import { PublicationStore } from "../../src/index.ts";

function exchange(path: string, text: string) {
  return new Promise<{ raw: string; ok?: boolean }>((resolve, reject) => {
    const socket = connect(path);
    let raw = "";
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(Error("SOCKET_TEST_TIMEOUT"));
    });
    socket.on("connect", () => socket.end(text));
    socket.on("data", (b) => (raw += b.toString()));
    socket.on("error", () => {});
    socket.on("close", () => {
      let ok: boolean | undefined;
      try {
        ok = JSON.parse(raw).ok;
      } catch {}
      resolve({ raw, ok });
    });
  });
}

test(
  "actual Unix runtime selects SQLite, observes revoke, refuses DB loss despite legacy, and closes readers",
  { skip: process.platform !== "linux" || process.getuid?.() === 0, timeout: 30000 },
  async (t) => {
    const root = await mkdtemp(join(homedir(), ".pub-db-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const uid = process.getuid!();
    const grantRoot = join(root, "grants"),
      stateRoot = join(root, "state");
    await mkdir(grantRoot, { mode: 0o700 });
    await mkdir(stateRoot, { mode: 0o700 });
    const helper = join(root, "peer-exec");
    // Compile only this bounded fixture's helper; no installed service or binary is touched.
    const native = fileURLToPath(
      new URL(
        import.meta.url.endsWith(".ts")
          ? "../../native/peer-exec.c"
          : "../../../native/peer-exec.c",
        import.meta.url,
      ),
    );
    execFileSync("/usr/bin/cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", native, "-o", helper]);
    await chmod(helper, 0o700);
    const authority = await ExecutionGrantAuthority.bootstrap({
      root: grantRoot,
      authorityUid: uid,
    });
    t.after(() => authority.close());
    const execution = await authority.attest(process.pid);
    const principal = { id: "socket-worker", kind: "worker" as const, taskIds: ["task1"] };
    const issued = await authority.issue({
      requestId: "issue",
      grantId: "runtime-grant",
      principal,
      execution,
      expiresAt: Date.now() + 60000,
    });
    const store = new PublicationStore({ root: join(stateRoot, "publisher") });
    await store.initialize({ "help.txt": "accepted" });
    await store.openTask({ taskId: "task1", agentId: principal.id, scope: ["help.txt"] });
    const configPath = join(root, "config.json"),
      connectionEntry = join(root, "connection.mjs"),
      closed = join(root, "readers-closed.txt"),
      socketPath = join(root, "publisher.sock");
    const runtimeUrl = new URL(
      `../../src/publisher-runtime.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`,
      import.meta.url,
    ).href;
    await writeFile(
      connectionEntry,
      `import{DatabaseSync}from'node:sqlite';import{appendFileSync}from'node:fs';import{serveConfiguredPublisherConnection}from ${JSON.stringify(runtimeUrl)};const close=DatabaseSync.prototype.close;DatabaseSync.prototype.close=function(){appendFileSync(${JSON.stringify(closed)},'closed\\n');return close.call(this);};await serveConfiguredPublisherConnection(process.argv[2],Number(process.argv[3]));`,
      { mode: 0o600 },
    );
    const config = {
      schema: "throughline.publisher-runtime.v1",
      socketPath,
      stateRoot,
      grantRoot,
      grantAuthorityUid: uid,
      grantBackend: "sqlite-authority",
      peerHelper: helper,
      nodeExecutable: "/opt/ship-warden/runtime/bin/node",
      connectionEntry,
      maxConnections: 8,
      maxRequestBytes: 8192,
      readTimeoutMs: 1000,
    };
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    let validationClosed = 0;
    const close = DatabaseSync.prototype.close;
    DatabaseSync.prototype.close = function () {
      validationClosed++;
      return close.call(this);
    };
    let runtime: Awaited<ReturnType<typeof startPublisherRuntime>>;
    try {
      runtime = await startPublisherRuntime(configPath, uid);
    } finally {
      DatabaseSync.prototype.close = close;
    }
    assert.equal(validationClosed, 1);
    t.after(() => runtime.close());
    const request = JSON.stringify({
      requestId: "snapshot",
      operation: "task.snapshot",
      taskId: "task1",
    });
    assert.equal((await exchange(socketPath, request)).ok, true);
    assert.equal((await exchange(socketPath, "not-json")).ok, false);
    await authority.revoke({
      requestId: "revoke",
      grantId: "runtime-grant",
      expectedRevision: issued.revision,
      expectedDigest: issued.digest,
    });
    assert.equal((await exchange(socketPath, request)).ok, false);
    assert.equal((await readFile(closed, "utf8")).trim().split("\n").length, 3);
    // Valid legacy grant cannot rescue explicitly selected SQLite after loss.
    await writeFile(join(grantRoot, "runtime-grant.json"), JSON.stringify(issued.grant), {
      mode: 0o600,
    });
    const database = join(grantRoot, ".authority", "grants.sqlite");
    await rename(database, `${database}.lost`);
    assert.notEqual((await exchange(socketPath, request)).ok, true);
    await assert.rejects(stat(database));
    await assert.rejects(startPublisherRuntime(configPath, uid));
    await rename(`${database}.lost`, database);
    await truncate(database, 0);
    assert.notEqual((await exchange(socketPath, request)).ok, true);
    assert.equal((await stat(database)).size, 0);
    await assert.rejects(startPublisherRuntime(configPath, uid));
    // Only the tagged rehearsal mode may use the legacy file.
    await runtime.close();
    await writeFile(
      configPath,
      JSON.stringify({ ...config, grantBackend: "legacy-json-rehearsal" }),
      { mode: 0o600 },
    );
    runtime = await startPublisherRuntime(configPath, uid);
    assert.equal((await exchange(socketPath, request)).ok, true);
  },
);

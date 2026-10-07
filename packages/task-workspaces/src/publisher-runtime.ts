import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { assertProtectedPath, readProtectedJson } from "./protected-files.ts";
import { createExecutionGrantResolver } from "./execution-grants.ts";
import { openExecutionGrantReader } from "./execution-grant-authority.ts";
import { PublicationStore } from "./index.ts";
import { createPublisherDispatcher } from "./publisher-ipc.ts";
import { servePublisherConnection } from "./publisher-connection.ts";

export type PublisherRuntimeConfig = {
  schema: "throughline.publisher-runtime.v1";
  socketPath: string;
  stateRoot: string;
  grantRoot: string;
  grantAuthorityUid: number;
  grantBackend: "sqlite-authority" | "legacy-json-rehearsal";
  peerHelper: string;
  nodeExecutable: string;
  connectionEntry: string;
  maxConnections: number;
  maxRequestBytes: number;
  readTimeoutMs: number;
};
const keys = [
  "schema",
  "socketPath",
  "stateRoot",
  "grantRoot",
  "grantAuthorityUid",
  "grantBackend",
  "peerHelper",
  "nodeExecutable",
  "connectionEntry",
  "maxConnections",
  "maxRequestBytes",
  "readTimeoutMs",
];
const bounded = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= lo && x <= hi;
function diagnostic(event: string, fields: Record<string, number | string | null> = {}): void {
  // Trusted-side events carry no request bytes, file contents, arbitrary child text, or secrets.
  process.stderr.write(
    JSON.stringify({ component: "throughline-publisher", event, ...fields }) + "\n",
  );
}

export async function loadPublisherConfig(
  path: string,
  authorityUid = 0,
): Promise<PublisherRuntimeConfig> {
  const value = await readProtectedJson(path, authorityUid);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("INVALID_RUNTIME_CONFIG");
  const config = value as Record<string, unknown>;
  if (
    Object.keys(config).some((k) => !keys.includes(k)) ||
    keys.some((k) => !(k in config)) ||
    config.schema !== "throughline.publisher-runtime.v1" ||
    !["sqlite-authority", "legacy-json-rehearsal"].includes(config.grantBackend as string) ||
    !bounded(config.grantAuthorityUid, 0, 0xffffffff) ||
    !bounded(config.maxConnections, 1, 64) ||
    !bounded(config.maxRequestBytes, 1, 1024 * 1024) ||
    !bounded(config.readTimeoutMs, 1, 30000)
  )
    throw Error("INVALID_RUNTIME_CONFIG");
  for (const key of [
    "socketPath",
    "stateRoot",
    "grantRoot",
    "peerHelper",
    "nodeExecutable",
    "connectionEntry",
  ]) {
    const p = config[key];
    if (typeof p !== "string" || !isAbsolute(p) || normalize(p) !== p || p.includes("\0"))
      throw Error("INVALID_RUNTIME_CONFIG");
  }
  if (Buffer.byteLength(config.socketPath as string) > 100) throw Error("INVALID_RUNTIME_CONFIG");
  return config as PublisherRuntimeConfig;
}

/** Service-owned entry. No worker-supplied executable, arguments, environment, or static UID-role table. */
export async function startPublisherRuntime(configPath: string, authorityUid = 0) {
  if (process.platform !== "linux" || !process.getuid || process.getuid() === 0)
    throw Error("UNPRIVILEGED_LINUX_SERVICE_REQUIRED");
  const config = await loadPublisherConfig(configPath, authorityUid);
  for (const path of [config.peerHelper, config.nodeExecutable, config.connectionEntry]) {
    await assertProtectedPath(path, authorityUid);
    const stat = await lstat(path);
    if (!stat.isFile() || (path !== config.connectionEntry && (stat.mode & 0o111) === 0))
      throw Error("INVALID_RUNTIME_EXECUTABLE");
  }
  await assertProtectedPath(dirname(config.socketPath), process.getuid());
  await assertProtectedPath(config.stateRoot, process.getuid());
  if (!(await lstat(config.stateRoot)).isDirectory()) throw Error("INVALID_STATE_ROOT");
  await assertProtectedPath(config.grantRoot, config.grantAuthorityUid);
  if (!(await lstat(config.grantRoot)).isDirectory()) throw Error("INVALID_GRANT_ROOT");
  // Read-only validation before exposing a socket. Every child opens its own current reader.
  if (config.grantBackend === "sqlite-authority") {
    const validation = await openExecutionGrantReader({
      root: config.grantRoot,
      authorityUid: config.grantAuthorityUid,
    });
    try {
      await validation.list();
    } finally {
      validation.close();
    }
  }
  const children = new Set<ChildProcess>();
  const server = createServer({ pauseOnConnect: true }, (socket) => {
    if (children.size >= config.maxConnections) {
      diagnostic("CAPACITY_REFUSED");
      socket.destroy();
      return;
    }
    const child = spawn(
      config.peerHelper,
      [config.nodeExecutable, config.connectionEntry, configPath, String(authorityUid)],
      {
        stdio: [socket, socket, "pipe"],
        env: { PATH: "/usr/bin:/bin", HOME: config.stateRoot, LANG: "C" },
        cwd: config.stateRoot,
      },
    );
    children.add(child);
    let stderrBytes = 0;
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes = Math.min(Number.MAX_SAFE_INTEGER, stderrBytes + chunk.length);
    });
    child.once("error", () => {
      diagnostic("CONNECTION_SPAWN_FAILED");
      socket.destroy();
    });
    child.once("close", (code, signal) => {
      if (code !== 0 || stderrBytes > 0)
        diagnostic("CONNECTION_CHILD_EXIT", { code, signal, stderrBytes });
      children.delete(child);
      socket.destroy();
    });
  });
  server.maxConnections = config.maxConnections;
  server.on("drop", () => diagnostic("CAPACITY_REFUSED"));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  try {
    // Reachability is not authority. Each actual connection still requires live kernel-bound grants.
    await chmod(config.socketPath, 0o666);
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    socketPath: config.socketPath,
    activeConnections: () => children.size,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** Fixed service child reached only through peer-exec. Direct worker invocation has no access to state. */
export async function serveConfiguredPublisherConnection(
  configPath: string,
  authorityUid = 0,
): Promise<void> {
  const config = await loadPublisherConfig(configPath, authorityUid);
  const reader =
    config.grantBackend === "sqlite-authority"
      ? await openExecutionGrantReader({
          root: config.grantRoot,
          authorityUid: config.grantAuthorityUid,
        })
      : null;
  try {
    const dispatch = createPublisherDispatcher({
      store: new PublicationStore({ root: join(config.stateRoot, "publisher") }),
      reviewsRoot: join(config.stateRoot, "reviews"),
      maxRequestBytes: config.maxRequestBytes,
      resolvePrincipal: createExecutionGrantResolver({
        grantRoot: config.grantRoot,
        authorityUid: config.grantAuthorityUid,
        ...(reader ? { store: reader } : {}),
      }),
    });
    await servePublisherConnection({
      input: process.stdin,
      output: process.stdout,
      environment: process.env,
      maxBytes: config.maxRequestBytes,
      readTimeoutMs: config.readTimeoutMs,
      dispatch,
    });
  } finally {
    reader?.close();
  }
}

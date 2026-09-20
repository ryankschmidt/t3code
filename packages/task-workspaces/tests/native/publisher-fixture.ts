// Linux rehearsal adapter. Public child_process stdio stream transfer supplies the accepted connection.
import { createServer, createConnection, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicationStore } from "../../src/index.ts";
import { createPublisherDispatcher } from "../../src/publisher-ipc.ts";
import { servePublisherConnection } from "../../src/publisher-connection.ts";

const [mode, socketPath, root, helper, workerUid, reviewerUid] = process.argv.slice(2);
if (!mode || !socketPath || !root) throw Error("fixture arguments missing");
if (mode === "connection") {
  const store = new PublicationStore({ root: join(root, "publisher") });
  const dispatch = createPublisherDispatcher({
    store,
    reviewsRoot: join(root, "reviews"),
    resolvePrincipal: async (peer) => {
      if (peer.uid === Number(workerUid))
        return { id: "worker-a", kind: "worker", taskIds: ["task-a"] };
      if (peer.uid === Number(reviewerUid))
        return { id: "reviewer-a", kind: "reviewer", taskIds: ["task-a"] };
      throw Error("unknown real kernel principal");
    },
  });
  await servePublisherConnection({
    input: process.stdin,
    output: process.stdout,
    environment: process.env,
    maxBytes: 65536,
    readTimeoutMs: 5000,
    dispatch,
  });
} else if (mode === "server") {
  if (!helper) throw Error("helper missing");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const store = new PublicationStore({ root: join(root, "publisher") });
  await store.initialize({ "help.txt": "accepted before IPC" });
  await store.openTask({ taskId: "task-a", agentId: "worker-a", scope: ["help.txt"] });
  const children = new Set<ReturnType<typeof spawn>>();
  const server = createServer({ pauseOnConnect: true }, (socket: Socket) => {
    const child = spawn(
      helper,
      [
        process.execPath,
        fileURLToPath(import.meta.url),
        "connection",
        socketPath,
        root,
        helper,
        workerUid!,
        reviewerUid!,
      ],
      {
        stdio: [socket, socket, "pipe"],
        env: {
          PATH: "/usr/bin:/bin",
          HOME: root,
          THROUGHL_PEER_UID: "0",
          THROUGHL_PEER_GID: "0",
          THROUGHL_PEER_PID: "1",
        },
      },
    );
    children.add(child);
    child.stderr?.on("data", (x) => process.stderr.write(x));
    child.on("close", () => {
      children.delete(child);
      socket.destroy();
    });
    child.on("error", () => socket.destroy());
  });
  server.listen(socketPath, async () => {
    await chmod(socketPath, 0o666);
    await writeFile(join(root, "pid"), String(process.pid));
    console.log(
      JSON.stringify({
        state: "LISTENING",
        pid: process.pid,
        uid: process.getuid?.(),
        socketPath,
        root,
      }),
    );
  });
  process.on("SIGTERM", () => {
    for (const child of children) child.kill("SIGTERM");
    server.close(() => process.exit(0));
  });
} else if (mode === "client") {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const socket = createConnection(socketPath);
  let response = "";
  socket.setTimeout(15000, () => socket.destroy(new Error("response timeout")));
  socket.on("connect", () => socket.end(Buffer.concat(chunks)));
  socket.on("data", (x) => {
    response += String(x);
  });
  socket.on("end", () => {
    process.stdout.write(response);
  });
  socket.on("error", (e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
} else throw Error("unknown fixture mode");

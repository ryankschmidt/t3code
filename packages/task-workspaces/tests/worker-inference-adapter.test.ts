import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readlink, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as adapter from "../src/worker-inference-adapter.ts";

test(
  "production adapter refuses the shared host network before opening a listener",
  { skip: process.platform !== "linux" },
  async () => {
    await assert.rejects(
      adapter.startWorkerInferenceAdapter({
        gatewaySocket: "/not-a-socket",
        gatewayUid: 0,
        hostNetworkNamespace: await readlink("/proc/self/ns/net"),
        requestTimeoutMs: 1000,
      }),
      /PRIVATE_NETWORK_REQUIRED/,
    );
  },
);

test("HTTP compatibility handler forwards over Unix socket and preserves streaming response", async (t) => {
  const root = await mkdtemp(join(homedir(), ".inference-adapter-")),
    socket = join(root, "gateway.sock");
  const seen: { path?: string; body?: string } = {};
  const gateway = http.createServer((req, res) => {
    seen.path = req.url;
    let body = "";
    req.on("data", (x) => (body += x));
    req.on("end", () => {
      seen.body = body;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
      setImmediate(() => res.end("data: last\n\n"));
    });
  });
  await new Promise<void>((r) => gateway.listen(socket, r));
  // Protocol-only fixture: intentionally not the production listener/startup guard.
  const front = http.createServer((req, res) =>
    adapter.forwardWorkerInference(req, res, { gatewaySocket: socket, requestTimeoutMs: 1000 }),
  );
  await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
  t.after(async () => {
    front.closeAllConnections();
    gateway.closeAllConnections();
    await Promise.all([
      new Promise<void>((r) => front.close(() => r())),
      new Promise<void>((r) => gateway.close(() => r())),
    ]);
    await rm(root, { recursive: true, force: true });
  });
  const address = front.address();
  assert.ok(address && typeof address !== "string");
  const result = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: address.port,
        path: "/v1/responses",
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (res) => {
        let body = "";
        res.on("data", (x) => (body += x));
        res.on("end", () => resolve({ status: res.statusCode, body }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end('{"model":"gpt-6-astra","reasoning":{"effort":"low"}}');
  });
  assert.equal(result.status, 200);
  assert.equal(result.body, "data: first\n\ndata: last\n\n");
  assert.equal(seen.path, "/v1/responses");
  assert.equal(seen.body, '{"model":"gpt-6-astra","reasoning":{"effort":"low"}}');
});

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { mkdtemp, readlink, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  serveInferenceConnection,
  createLoopbackBrokerForwarder,
  type InferenceSettlement,
} from "../src/inference-gateway.ts";
import { forwardWorkerInference } from "../src/worker-inference-adapter.ts";

test(
  "worker HTTP translation and Unix capability preserve inference, headers and budget refusal",
  { skip: process.platform !== "linux", timeout: 10000 },
  async (t) => {
    const root = await mkdtemp(join(homedir(), ".inference-path-")),
      socket = join(root, "inference.sock");
    const hostNetworkNamespace = await readlink("/proc/self/ns/net");
    let forwarded = 0,
      reserved = 0,
      remaining = 1000,
      upstreamBody = "",
      upstreamHeaders: http.IncomingHttpHeaders | undefined;
    const broker = http.createServer((req, res) => {
      forwarded++;
      upstreamHeaders = req.headers;
      req.on("data", (x) => (upstreamBody += x));
      req.on("end", () => {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "set-cookie": "must-not-leave-broker",
        });
        res.write("data: first\n\n");
        setImmediate(() => res.end("data: last\n\n"));
      });
    });
    await new Promise<void>((r) => broker.listen(0, "127.0.0.1", r));
    const brokerAddress = broker.address();
    assert.ok(brokerAddress && typeof brokerAddress !== "string");
    const settlements: InferenceSettlement[] = [];
    const peers = new Set<net.Socket>(),
      serving = new Set<Promise<void>>();
    const gateway = net.createServer((peer) => {
      peers.add(peer);
      peer.once("close", () => peers.delete(peer));
      // Explicit policy fixture: not measured SO_PEERCRED or a real peer network namespace.
      const work = serveInferenceConnection(
        { uid: process.getuid!(), gid: process.getgid!(), pid: process.pid },
        peer,
        {
          config: {
            maxRequestBytes: 4096,
            maxResponseBytes: 4096,
            maxHeaderBytes: 4096,
            timeoutMs: 2000,
            revalidateEveryMs: 20,
            hostNetworkNamespace,
            maxOutputTokensPerCall: 4000,
            inputOverheadTokens: 100,
            settlementJournalPath: join(root, "settlements.ndjson"),
          },
          dependencies: {
            authorize: async () => ({
              grantId: "grant-a",
              taskId: "task-a",
              expiresAt: Date.now() + 5000,
              allowedModels: ["gpt-6-astra"],
              allowedEfforts: ["low"],
              networkNamespace: "net:[1]",
            }),
            reserve: async () => {
              if (reserved >= 1) throw Error("BUDGET_EXHAUSTED");
              reserved++;
              return true;
            },
            forward: createLoopbackBrokerForwarder({ port: brokerAddress.port }),
            remainingTokens: async () => remaining,
            settle: async (_permit, settlement) => {
              settlements.push(settlement);
            },
          },
        },
      );
      serving.add(work);
      void work.finally(() => serving.delete(work)).catch(() => undefined);
    });
    await new Promise<void>((r) => gateway.listen(socket, r));
    const front = http.createServer((req, res) =>
      forwardWorkerInference(req, res, { gatewaySocket: socket, requestTimeoutMs: 3000 }),
    );
    await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
    t.after(async () => {
      front.closeAllConnections();
      broker.closeAllConnections();
      for (const peer of peers) peer.destroy();
      await Promise.allSettled(serving);
      await Promise.all([
        new Promise<void>((r) => front.close(() => r())),
        new Promise<void>((r) => gateway.close(() => r())),
        new Promise<void>((r) => broker.close(() => r())),
      ]);
      await rm(root, { recursive: true, force: true });
    });
    const address = front.address();
    assert.ok(address && typeof address !== "string");
    const plain = '{"model":"gpt-6-astra","reasoning":{"effort":"low"}}';
    const request = (payload = plain) =>
      new Promise<{ status: number | undefined; headers: http.IncomingHttpHeaders; body: string }>(
        (resolve, reject) => {
          const req = http.request(
            {
              host: "127.0.0.1",
              port: address.port,
              path: "/v1/responses",
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: "caller-must-not-forward",
                cookie: "caller-cookie",
                connection: "x-remove",
                "x-remove": "must-not-forward",
                "x-native-metadata": "keep",
              },
            },
            (res) => {
              let body = "";
              res.on("data", (x) => (body += x));
              res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
              res.on("error", reject);
            },
          );
          req.on("error", reject);
          req.end(payload);
        },
      );
    const first = await request();
    assert.equal(first.status, 200);
    assert.equal(first.body, "data: first\n\ndata: last\n\n");
    assert.equal(upstreamHeaders?.authorization, undefined);
    assert.equal(upstreamHeaders?.cookie, undefined);
    assert.equal(upstreamHeaders?.["x-remove"], undefined);
    assert.equal(upstreamHeaders?.["x-native-metadata"], "keep");
    assert.equal(first.headers["set-cookie"], undefined);
    const second = await request();
    assert.notEqual(second.status, 200);
    assert.equal(forwarded, 1);
    assert.equal(reserved, 1);
    // Output is capped at the remaining budget minus the body bytes and the input overhead; with
    // no final usage record nothing is settled.
    const wide = Buffer.byteLength(
      JSON.stringify({ ...JSON.parse(plain), max_output_tokens: 1000, store: false }),
    );
    assert.equal(JSON.parse(upstreamBody).max_output_tokens, 1000 - wide - 100);
    await Promise.allSettled([...serving]);
    assert.equal(settlements.length, 0);
    // Budget exhausted, unknown fields and background mode are refused through the worker path.
    remaining = 0;
    const exhausted = await request();
    assert.equal(exhausted.status, 429);
    assert.match(exhausted.body, /BUDGET_EXHAUSTED/);
    remaining = 1000;
    const unknown = await request(
      '{"model":"gpt-6-astra","reasoning":{"effort":"low"},"service_tier":"priority"}',
    );
    assert.equal(unknown.status, 400);
    assert.match(unknown.body, /FIELD_NOT_ALLOWED/);
    const background = await request(
      '{"model":"gpt-6-astra","reasoning":{"effort":"low"},"background":true}',
    );
    assert.equal(background.status, 400);
    assert.match(background.body, /FIELD_NOT_ALLOWED/);
    assert.equal(forwarded, 1);
    assert.equal(reserved, 1);
  },
);

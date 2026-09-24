import nodeTest from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as net from "node:net";
import { mkdtemp, rm, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  serveInferenceConnection,
  createLoopbackBrokerForwarder,
  type InferencePermit,
  type InferenceGatewayDependencies,
} from "../src/inference-gateway.ts";

const body = JSON.stringify({ model: "gpt-test", reasoning: { effort: "low" }, input: "hello" });
const test = process.platform === "linux" ? nodeTest : nodeTest.skip; // No non-Linux namespace-isolation claim.
async function fixture(t: nodeTest.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "ig-"));
  const socketPath = join(root, "s");
  let forwards = 0,
    reserves = 0;
  const reservationIds: string[] = [];
  const received: Array<{ headers: http.IncomingHttpHeaders; body: string; path: string }> = [];
  let respond = (req: http.IncomingMessage, res: http.ServerResponse) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: data, path: req.url! });
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "set-cookie": "credential=never-forward",
        authorization: "Bearer hidden",
        "x-request-id": "safe-id",
      });
      res.write("data: first\n\n");
      setImmediate(() => res.end("data: last\n\n"));
    });
  };
  const upstream = http.createServer((req, res) => {
    forwards++;
    respond(req, res);
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const hostNetworkNamespace = await readlink("/proc/self/ns/net");
  // Peer namespace is injected synthetic authorization evidence; no namespace is created here.
  const permit: InferencePermit = {
    taskId: "task1",
    grantId: "grant1",
    expiresAt: Date.now() + 60000,
    allowedModels: ["gpt-test"],
    allowedEfforts: ["low"],
    networkNamespace: hostNetworkNamespace === "net:[22]" ? "net:[23]" : "net:[22]",
  };
  const config = {
    maxRequestBytes: 4096,
    maxResponseBytes: 32768,
    maxHeaderBytes: 4096,
    timeoutMs: 3000,
    revalidateEveryMs: 10,
    hostNetworkNamespace,
  };
  const dependencies: InferenceGatewayDependencies = {
    authorize: async () => permit,
    reserve: async (_permit, request) => {
      reserves++;
      reservationIds.push(request.reservationId);
      assert.equal(request.requestSha256, createHash("sha256").update(body).digest("hex"));
    },
    forward: createLoopbackBrokerForwarder({ port: (upstream.address() as net.AddressInfo).port }),
  };
  const pending = new Set<Promise<void>>();
  const server = net.createServer({ pauseOnConnect: true, allowHalfOpen: true }, (socket) => {
    const served = serveInferenceConnection(
      { uid: process.getuid?.() ?? 1002, gid: process.getgid?.() ?? 1002, pid: process.pid },
      socket,
      { config, dependencies },
    );
    pending.add(served);
    void served.finally(() => pending.delete(served));
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await Promise.allSettled([...pending]);
    await rm(root, { recursive: true, force: true });
  });
  function request(path = "/responses", payload = body, headers: http.OutgoingHttpHeaders = {}) {
    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>(
      (resolve, reject) => {
        const req = http.request(
          {
            socketPath,
            path,
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
              ...headers,
            },
            agent: false,
          },
          (res) => {
            let text = "";
            res.on("data", (c) => (text += c));
            res.on("end", () =>
              resolve({ status: res.statusCode!, headers: res.headers, body: text }),
            );
            res.on("error", reject);
          },
        );
        req.on("error", reject);
        req.end(payload);
      },
    );
  }
  function streaming(onChunk: (res: http.IncomingMessage) => void) {
    return new Promise<{ body: string; aborted: boolean }>((resolve, reject) => {
      const req = http.request(
        {
          socketPath,
          path: "/responses",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
          agent: false,
        },
        (res) => {
          let text = "";
          res.on("data", (chunk) => {
            text += chunk.toString();
            onChunk(res);
          });
          res.on("end", () => resolve({ body: text, aborted: false }));
          res.on("aborted", () => resolve({ body: text, aborted: true }));
          res.on("error", () => resolve({ body: text, aborted: true }));
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  }
  function raw(text: string) {
    return new Promise<string>((resolve, reject) => {
      const client = net.connect(socketPath);
      let result = "";
      client.setTimeout(2000, () => {
        client.destroy();
        reject(Error("fixture timeout"));
      });
      client.on("connect", () => client.write(text));
      client.on("data", (data) => (result += data.toString()));
      client.on("error", () => {});
      client.on("close", () => resolve(result));
    });
  }
  return {
    request,
    streaming,
    raw,
    socketPath,
    config,
    dependencies,
    permit,
    received,
    reservationIds,
    counts: () => ({ forwards, reserves }),
    respond: (fn: typeof respond) => {
      respond = fn;
    },
  };
}

test("permitted request reserves before fixed-loopback forwarding and strips authority headers", async (t) => {
  const f = await fixture(t);
  const result = await f.request("/v1/responses", body, {
    authorization: "Bearer secret",
    cookie: "secret",
    host: "evil.invalid",
    forwarded: "secret",
    "x-codex-turn-metadata": "keep",
    connection: "x-remove",
    "x-remove": "hidden",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body, "data: first\n\ndata: last\n\n");
  assert.equal(f.counts().reserves, 1);
  assert.equal(f.counts().forwards, 1);
  assert.equal(f.received[0]!.headers.authorization, undefined);
  assert.equal(f.received[0]!.headers.cookie, undefined);
  assert.equal(f.received[0]!.headers["x-remove"], undefined);
  assert.equal(f.received[0]!.headers["x-codex-turn-metadata"], "keep");
  assert.match(f.received[0]!.headers.host!, /^127\.0\.0\.1:/);
  assert.equal(result.headers["set-cookie"], undefined);
  assert.equal(result.headers.authorization, undefined);
  assert.equal(result.headers["x-request-id"], "safe-id");
});

test("unknown expired model/effort and reservation-denied requests never forward", async (t) => {
  const f = await fixture(t);
  f.dependencies.authorize = async () => null;
  assert.equal((await f.request()).status, 401);
  f.dependencies.authorize = async () => ({ ...f.permit, expiresAt: Date.now() - 1 });
  assert.equal((await f.request()).status, 401);
  f.dependencies.authorize = async () => f.permit;
  assert.equal(
    (await f.request("/responses", body.replace("gpt-test", "gpt-foreign"))).status,
    403,
  );
  assert.equal((await f.request("/responses", body.replace("low", "high"))).status, 403);
  f.dependencies.reserve = async () => {
    throw Error("private-budget-detail");
  };
  const denied = await f.request();
  assert.equal(denied.status, 429);
  assert.equal(denied.body.includes("private-budget-detail"), false);
  assert.equal(f.counts().forwards, 0);
});

test("route query compression body-size and duplicate model smuggling refuse", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "/responses?beta=true",
    "http://evil.invalid/responses",
    "/api/status",
    "/v1/%72esponses",
  ]) {
    assert.equal((await f.request(path)).status, 400);
  }
  assert.equal((await f.request("/responses", body, { "content-encoding": "gzip" })).status, 400);
  assert.equal((await f.request("/responses", "x".repeat(5000))).status, 413);
  assert.equal(
    (
      await f.request(
        "/responses",
        '{"model":"evil","model":"gpt-test","reasoning":{"effort":"low"}}',
      )
    ).status,
    400,
  );
  assert.equal(f.counts().forwards, 0);
});

test("foreign or revoked current permit after initial admission cannot pay", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  f.dependencies.authorize = async () =>
    ++calls === 1 ? f.permit : { ...f.permit, taskId: "foreign" };
  assert.equal((await f.request()).status, 403);
  assert.equal(f.counts().forwards, 0);
  calls = 0;
  f.dependencies.authorize = async () => (++calls === 1 ? f.permit : null);
  assert.equal((await f.request()).status, 403);
  assert.equal(f.counts().forwards, 0);
});

test("upstream redirects are refused and never followed", async (t) => {
  const f = await fixture(t);
  f.respond((_req, res) => {
    res.writeHead(302, { location: "http://evil.invalid/credentials" });
    res.end();
  });
  const result = await f.request();
  assert.equal(result.status, 502);
  assert.equal(result.headers.location, undefined);
  assert.equal(f.counts().forwards, 1);
});

test("missing or host network namespace attestation never forwards", async (t) => {
  const f = await fixture(t); // Namespace IDs in this fixture are synthetic labels, not installed isolation proof.
  f.dependencies.authorize = async () => ({
    ...f.permit,
    networkNamespace: f.config.hostNetworkNamespace,
  });
  assert.equal((await f.request()).status, 401);
  f.dependencies.authorize = async () =>
    ({ ...f.permit, networkNamespace: undefined }) as unknown as InferencePermit;
  assert.equal((await f.request()).status, 401);
  assert.equal(f.counts().forwards, 0);
});

test(
  "SSE arrives before completion and revocation cancels upstream",
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t);
    let allowed = true,
      closed!: () => void;
    const upstreamClosed = new Promise<void>((r) => (closed = r));
    f.dependencies.authorize = async () => (allowed ? f.permit : null);
    f.respond((req, res) => {
      req.resume();
      res.on("close", closed);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: live\n\n");
    });
    const result = await f.streaming(() => {
      allowed = false;
    });
    await upstreamClosed;
    assert.equal(result.body, "data: live\n\n");
    assert.equal(result.aborted, true);
    assert.equal(f.counts().forwards, 1);
  },
);

test("client disconnect cancels the in-flight upstream response", { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  let closed!: () => void;
  const upstreamClosed = new Promise<void>((r) => (closed = r));
  f.respond((req, res) => {
    req.resume();
    res.once("close", closed);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: live\n\n");
  });
  await f.streaming((res) => res.destroy());
  await upstreamClosed;
  assert.equal(f.counts().forwards, 1);
});

test(
  "reservation wait is deadline-bounded and never forwards after expiry",
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t);
    f.config.timeoutMs = 30;
    f.dependencies.reserve = async () => new Promise<void>(() => {});
    const result = await f.request();
    assert.equal(result.status, 504);
    assert.equal(f.counts().forwards, 0);
  },
);

test(
  "response limit aborts without forwarding an over-limit chunk",
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t);
    f.config.maxResponseBytes = 5;
    f.respond((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end("more-than-five");
    });
    await assert.rejects(f.request());
    assert.equal(f.counts().forwards, 1);
  },
);

test("upstream body is backpressured rather than fully buffered", async (t) => {
  const f = await fixture(t);
  f.config.maxResponseBytes = 1024 * 1024;
  let pauses = 0;
  const forward = f.dependencies.forward;
  f.dependencies.forward = async (request) => {
    const response = await forward(request);
    response.body.on("pause", () => {
      if (!response.body.readableEnded) pauses++;
    });
    return response;
  };
  f.respond((req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(Buffer.alloc(512 * 1024, 65));
  });
  const result = await f.request();
  assert.equal(result.body.length, 512 * 1024);
  assert.ok(pauses > 0);
});

test("HTTP framing, upgrade, CONNECT and oversized headers cannot reach upstream", async (t) => {
  const f = await fixture(t);
  for (const request of [
    "CONNECT evil.invalid:443 HTTP/1.1\r\nHost: fixture\r\n\r\n",
    "GET /responses HTTP/1.1\r\nHost: fixture\r\nConnection: upgrade\r\nUpgrade: websocket\r\n\r\n",
    "POST /responses HTTP/1.1\r\nHost: fixture\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
    "POST /responses HTTP/1.1\r\nHost: fixture\r\nX-Large: " +
      "s".repeat(6000) +
      "\r\nContent-Length: 0\r\n\r\n",
  ]) {
    const response = await f.raw(request);
    assert.match(response, /HTTP\/1\.1 400/);
    assert.ok(response.length < 512);
  }
  assert.equal(f.counts().forwards, 0);
});

test("pipelined connection never forwards a second paid request", async (t) => {
  const f = await fixture(t);
  const request = `POST /responses HTTP/1.1\r\nHost: fixture\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
  await f.raw(request + request);
  assert.ok(f.counts().forwards <= 1);
});

test(
  "periodic network namespace recheck cancels a namespace-changed stream",
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t);
    let changed = false,
      closed!: () => void;
    const done = new Promise<void>((resolve) => (closed = resolve));
    f.dependencies.authorize = async () => ({
      ...f.permit,
      networkNamespace: changed ? "net:[33]" : f.permit.networkNamespace,
    });
    f.respond((req, res) => {
      req.resume();
      res.on("close", closed);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: live\n\n");
    });
    const result = await f.streaming(() => {
      changed = true;
    });
    await done;
    assert.equal(result.aborted, true);
  },
);

test("fabricated host anchor and missing authorizer/reserver never forward", async (t) => {
  const f = await fixture(t);
  const actual = f.config.hostNetworkNamespace;
  f.config.hostNetworkNamespace = "net:[999999999999]";
  assert.equal((await f.request()).status, 503);
  f.config.hostNetworkNamespace = actual;
  const authorize = f.dependencies.authorize;
  Reflect.deleteProperty(f.dependencies, "authorize");
  assert.equal((await f.request()).status, 503);
  f.dependencies.authorize = authorize;
  Reflect.deleteProperty(f.dependencies, "reserve");
  assert.equal((await f.request()).status, 503);
  assert.equal(f.counts().forwards, 0);
});

test("upstream transport errors are sanitized", async (t) => {
  const f = await fixture(t);
  f.dependencies.forward = async () => {
    throw Error("PRIVATE_UPSTREAM_CONFIGURATION");
  };
  const response = await f.request();
  assert.equal(response.status, 502);
  assert.equal(response.body.includes("PRIVATE_UPSTREAM_CONFIGURATION"), false);
});

test("identical paid-attempt bodies use distinct server reservation IDs", async (t) => {
  const f = await fixture(t);
  await f.request();
  await f.request();
  assert.equal(f.counts().forwards, 2);
  assert.equal(f.reservationIds.length, 2);
  assert.notEqual(f.reservationIds[0], f.reservationIds[1]);
  for (const id of f.reservationIds) assert.match(id, /^[a-f0-9-]{36}$/);
});

test("sanitized refusal body also honors the configured response byte bound", async (t) => {
  const f = await fixture(t);
  f.config.maxResponseBytes = 1;
  const result = await f.request("/forbidden");
  assert.equal(result.status, 400);
  assert.equal(Buffer.byteLength(result.body), 0);
  assert.equal(f.counts().forwards, 0);
});

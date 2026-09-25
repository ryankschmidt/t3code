import nodeTest from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as net from "node:net";
import { mkdtemp, rm, readlink, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  serveInferenceConnection,
  createLoopbackBrokerForwarder,
  type InferencePermit,
  type InferenceGatewayDependencies,
  type InferenceSettlement,
} from "../src/inference-gateway.ts";

const body = JSON.stringify({ model: "gpt-test", reasoning: { effort: "low" }, input: "hello" });
const test = process.platform === "linux" ? nodeTest : nodeTest.skip; // No non-Linux namespace-isolation claim.
async function fixture(t: nodeTest.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "ig-"));
  const socketPath = join(root, "s");
  let forwards = 0,
    reserves = 0;
  const reservationIds: string[] = [];
  const requestHashes: string[] = [];
  const maxCosts: number[] = [];
  const settlements: InferenceSettlement[] = [];
  const charged = new Map<string, number>(),
    applied = new Set<string>();
  let remaining = 100000;
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
    maxOutputTokensPerCall: 4000,
    inputOverheadTokens: 250,
    settlementJournalPath: join(root, "settlements.ndjson"),
  };
  // Fake budget service: remaining is its balance.
  const dependencies: InferenceGatewayDependencies = {
    authorize: async () => permit,
    reserve: async (_permit, request) => {
      reserves++;
      reservationIds.push(request.reservationId);
      requestHashes.push(request.requestSha256);
      maxCosts.push(request.maxCost);
      // Atomic check-and-debit: nothing awaits between the check and the debit.
      if (request.maxCost > remaining) return false;
      remaining -= request.maxCost;
      charged.set(request.reservationId, request.maxCost);
      return true;
    },
    forward: createLoopbackBrokerForwarder({ port: (upstream.address() as net.AddressInfo).port }),
    remainingTokens: async () => remaining,
    settle: async (_permit, settlement) => {
      settlements.push(settlement);
      // Applies maxCost - actual in either direction, at most once per reservation.
      const maxCost = charged.get(settlement.reservationId);
      if (maxCost === undefined || applied.has(settlement.reservationId)) return;
      applied.add(settlement.reservationId);
      remaining += maxCost - settlement.totalTokens;
    },
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
  function streaming(onChunk: (res: http.IncomingMessage) => void, payload = body) {
    return new Promise<{ body: string; aborted: boolean }>((resolve, reject) => {
      const req = http.request(
        {
          socketPath,
          path: "/responses",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
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
      req.end(payload);
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
    requestHashes,
    maxCosts,
    settlements,
    setRemaining: (n: number) => {
      remaining = n;
    },
    balance: () => remaining,
    /** Parsed settlement journal lines; empty when nothing was journaled. */
    journal: async () =>
      (await readFile(config.settlementJournalPath, "utf8").catch(() => ""))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    /** Every accepted connection's handler has fully resolved (including settlement). */
    idle: async () => {
      await Promise.allSettled([...pending]);
    },
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
  // The reservation hash covers the rewritten body that was actually forwarded.
  assert.equal(f.requestHashes[0], createHash("sha256").update(f.received[0]!.body).digest("hex"));
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
    f.dependencies.reserve = async () => new Promise<boolean>(() => {});
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
  const reserve = f.dependencies.reserve;
  Reflect.deleteProperty(f.dependencies, "reserve");
  assert.equal((await f.request()).status, 503);
  f.dependencies.reserve = reserve;
  const journalPath = f.config.settlementJournalPath;
  f.config.settlementJournalPath = "relative/settlements.ndjson";
  assert.equal((await f.request()).status, 503);
  f.config.settlementJournalPath = journalPath;
  for (const perCall of [0, -1, 1.5, undefined]) {
    f.config.maxOutputTokensPerCall = perCall as number;
    assert.equal((await f.request()).status, 503);
  }
  f.config.maxOutputTokensPerCall = 4000;
  for (const overhead of [-1, 1.5, undefined]) {
    f.config.inputOverheadTokens = overhead as number;
    assert.equal((await f.request()).status, 503);
  }
  f.config.inputOverheadTokens = 250;
  const remainingTokens = f.dependencies.remainingTokens;
  Reflect.deleteProperty(f.dependencies, "remainingTokens");
  assert.equal((await f.request()).status, 503);
  f.dependencies.remainingTokens = remainingTokens;
  Reflect.deleteProperty(f.dependencies, "settle");
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
  const same = JSON.stringify({ ...JSON.parse(body), max_output_tokens: 100 });
  f.setRemaining(1000);
  await f.request("/responses", same);
  await f.request("/responses", same);
  assert.equal(f.counts().forwards, 2);
  assert.equal(f.reservationIds.length, 2);
  assert.notEqual(f.reservationIds[0], f.reservationIds[1]);
  for (const id of f.reservationIds) assert.match(id, /^[a-f0-9-]{36}$/);
  // Two identical bodies are two up-front debits of the same maxCost.
  assert.equal(f.maxCosts[0], f.maxCosts[1]);
  assert.equal(f.balance(), 1000 - 2 * f.maxCosts[0]!);
});

test("sanitized refusal body also honors the configured response byte bound", async (t) => {
  const f = await fixture(t);
  f.config.maxResponseBytes = 1;
  const result = await f.request("/forbidden");
  assert.equal(result.status, 400);
  assert.equal(Buffer.byteLength(result.body), 0);
  assert.equal(f.counts().forwards, 0);
});

const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
const withField = (key: string, value: unknown) =>
  JSON.stringify({ ...JSON.parse(body), [key]: value });

test("exhausted budget refuses before reservation and never forwards", async (t) => {
  const f = await fixture(t);
  for (const exhausted of [
    async () => 0,
    async () => -5,
    async () => Number.NaN,
    async () => {
      throw Error("private-budget-detail");
    },
  ]) {
    f.dependencies.remainingTokens = exhausted;
    const result = await f.request();
    assert.equal(result.status, 429);
    assert.match(result.body, /BUDGET_EXHAUSTED/);
    assert.equal(result.body.includes("private-budget-detail"), false);
  }
  await f.idle();
  assert.equal(f.counts().forwards, 0);
  assert.equal(f.counts().reserves, 0);
  assert.equal(f.settlements.length, 0);
});

const bytesWithCap = (payload: string, cap: number) =>
  Buffer.byteLength(
    JSON.stringify({ ...JSON.parse(payload), max_output_tokens: cap, store: false }),
  );
const withoutAt = (line: Record<string, unknown> | undefined) => {
  const { at, ...rest } = line ?? {};
  assert.match(String(at), /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  return rest;
};
const jsonUsage = (usage: unknown) => (req: http.IncomingMessage, res: http.ServerResponse) => {
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "resp_1", output: [], usage }));
  });
};
const usage18 = {
  input_tokens: 11,
  output_tokens: 7,
  output_tokens_details: { reasoning_tokens: 3 },
  total_tokens: 18,
};
const actual18 = { inputTokens: 11, outputTokens: 7, reasoningTokens: 3, totalTokens: 18 };
const refusedWithoutCharge = async (f: Awaited<ReturnType<typeof fixture>>, payloads: string[]) => {
  for (const payload of payloads) {
    const result = await f.request("/responses", payload);
    assert.equal(result.status, 400, payload);
    assert.match(result.body, /FIELD_NOT_ALLOWED/);
  }
  assert.equal(f.counts().reserves, 0);
  assert.equal(f.counts().forwards, 0);
};
const captureStderr = (t: nodeTest.TestContext) => {
  const written: string[] = [];
  const write = process.stderr.write;
  process.stderr.write = ((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  t.after(() => {
    process.stderr.write = write;
  });
  return written;
};
const completed6 = {
  type: "response.completed",
  response: { usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } },
};

test("maxCost larger than the remaining budget refuses without reserving or forwarding", async (t) => {
  const f = await fixture(t);
  const one = withField("max_output_tokens", 1);
  const floor = bytesWithCap(one, 1) + f.config.inputOverheadTokens;
  for (const [remaining, payload] of [
    [floor, one],
    [floor, withField("max_output_tokens", 50)],
    [floor, body],
    [5, body],
  ] as const) {
    f.setRemaining(remaining);
    const result = await f.request("/responses", payload);
    assert.equal(result.status, 429);
    assert.match(result.body, /BUDGET_EXHAUSTED/);
  }
  assert.equal(f.counts().reserves, 0);
  assert.equal(f.counts().forwards, 0);
  // One more token of budget fits the body, the overhead and one output token.
  f.setRemaining(floor + 1);
  assert.equal((await f.request("/responses", one)).status, 200);
  assert.equal(JSON.parse(f.received[0]!.body).max_output_tokens, 1);
  assert.deepEqual(f.maxCosts, [floor + 1]);
});

test("the forwarded body carries max_output_tokens = outputCap and maxCost is debited", async (t) => {
  const f = await fixture(t);
  const overhead = f.config.inputOverheadTokens;
  for (const [payload, cap] of [
    [withField("max_output_tokens", 5000), 1000 - bytesWithCap(body, 1000) - overhead],
    [withField("max_output_tokens", 100), 100],
    [body, 1000 - bytesWithCap(body, 1000) - overhead],
  ] as const) {
    f.setRemaining(1000);
    assert.equal((await f.request("/responses", payload)).status, 200);
    const forwarded = f.received.at(-1)!.body;
    assert.equal(JSON.parse(forwarded).max_output_tokens, cap);
    // The reservation is body bytes + inputOverheadTokens + outputCap.
    assert.equal(f.maxCosts.at(-1), Buffer.byteLength(forwarded) + overhead + cap);
    // This response has no final usage record: the whole maxCost stays charged.
    assert.equal(f.balance(), 1000 - f.maxCosts.at(-1)!);
  }
});

test("maxOutputTokensPerCall caps a request without max_output_tokens and clamps larger ones", async (t) => {
  const f = await fixture(t);
  const perCall = f.config.maxOutputTokensPerCall;
  for (const payload of [body, withField("max_output_tokens", perCall + 5000)]) {
    f.setRemaining(100000);
    assert.equal((await f.request("/responses", payload)).status, 200);
    const forwarded = f.received.at(-1)!.body;
    assert.equal(JSON.parse(forwarded).max_output_tokens, perCall);
    // Reserves bodyBytes + inputOverheadTokens + maxOutputTokensPerCall, not the whole budget.
    assert.equal(
      f.maxCosts.at(-1),
      Buffer.byteLength(forwarded) + f.config.inputOverheadTokens + perCall,
    );
    assert.equal(f.balance(), 100000 - f.maxCosts.at(-1)!);
  }
});

test("of two concurrent requests that together exceed the budget, exactly one forwards", async (t) => {
  const f = await fixture(t);
  const payload = withField("max_output_tokens", 600);
  f.setRemaining(1000);
  // Both requests read the same remaining budget before either reserves.
  const remainingTokens = f.dependencies.remainingTokens;
  let reads = 0,
    release!: () => void;
  const bothRead = new Promise<void>((r) => (release = r));
  f.dependencies.remainingTokens = async (permit) => {
    const value = await remainingTokens(permit);
    if (++reads === 2) release();
    await bothRead;
    return value;
  };
  const results = await Promise.all([
    f.request("/responses", payload),
    f.request("/responses", payload),
  ]);
  await f.idle();
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 429]);
  assert.match(results.find((r) => r.status === 429)!.body, /BUDGET_EXHAUSTED/);
  assert.equal(f.counts().reserves, 2);
  assert.equal(f.counts().forwards, 1);
  assert.ok(f.maxCosts[0]! + f.maxCosts[1]! > 1000);
  assert.equal(f.balance(), 1000 - f.maxCosts[0]!);
});

test("a final usage record produces exactly one refund with the exact numbers", async (t) => {
  const f = await fixture(t);
  const journalAtSettle: Record<string, unknown>[][] = [];
  const settle = f.dependencies.settle;
  f.dependencies.settle = async (permit, settlement) => {
    journalAtSettle.push(await f.journal());
    await settle(permit, settlement);
  };
  f.respond(jsonUsage(usage18));
  f.setRemaining(1000);
  assert.equal((await f.request()).status, 200);
  await f.idle();
  const [reservationId, maxCost] = [f.reservationIds[0], f.maxCosts[0]!];
  assert.ok(maxCost > 18);
  assert.deepEqual(f.settlements, [{ reservationId, maxCost, ...actual18, boundExceeded: false }]);
  // maxCost was charged up front and maxCost - 18 refunded: exactly 18 stays spent.
  assert.equal(f.balance(), 1000 - 18);
  // The attempt line was on disk before settle was called; the completion line follows it.
  const attempt = { reservationId, grantId: "grant1", maxCost, actual: actual18 };
  assert.equal(journalAtSettle.length, 1);
  assert.deepEqual(journalAtSettle[0]!.map(withoutAt), [attempt]);
  assert.deepEqual((await f.journal()).map(withoutAt), [
    attempt,
    { reservationId, grantId: "grant1", settled: true },
  ]);
});

test("actual usage above maxCost debits the excess and journals BOUND_EXCEEDED", async (t) => {
  const f = await fixture(t);
  f.respond(jsonUsage({ input_tokens: 5000, output_tokens: 10, total_tokens: 5010 }));
  f.setRemaining(10000);
  assert.equal((await f.request("/responses", withField("max_output_tokens", 100))).status, 200);
  await f.idle();
  const [reservationId, maxCost] = [f.reservationIds[0], f.maxCosts[0]!];
  const actual = { inputTokens: 5000, outputTokens: 10, reasoningTokens: 0, totalTokens: 5010 };
  assert.ok(maxCost < 5010);
  assert.deepEqual(f.settlements, [{ reservationId, maxCost, ...actual, boundExceeded: true }]);
  // maxCost was charged up front and the excess 5010 - maxCost at settlement: 5010 is spent.
  assert.equal(f.balance(), 10000 - 5010);
  assert.deepEqual((await f.journal()).map(withoutAt), [
    { reservationId, grantId: "grant1", maxCost, actual },
    { reservationId, grantId: "grant1", event: "BOUND_EXCEEDED", maxCost, actual },
    { reservationId, grantId: "grant1", settled: true },
  ]);
});

test("a streamed response.completed usage record produces one refund", async (t) => {
  const f = await fixture(t);
  f.respond((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sse({ type: "response.output_text.delta", delta: "hi" }));
      res.end(
        sse({
          type: "response.completed",
          response: {
            usage: {
              input_tokens: 4,
              output_tokens: 2,
              output_tokens_details: { reasoning_tokens: 1 },
              total_tokens: 6,
            },
          },
        }),
      );
    });
  });
  f.setRemaining(1000);
  assert.equal((await f.request()).status, 200);
  await f.idle();
  assert.deepEqual(f.settlements, [
    {
      reservationId: f.reservationIds[0],
      maxCost: f.maxCosts[0],
      inputTokens: 4,
      outputTokens: 2,
      reasoningTokens: 1,
      totalTokens: 6,
      boundExceeded: false,
    },
  ]);
  assert.equal(f.balance(), 1000 - 6);
});

test(
  "an intermediate usage record followed by an abort produces no refund",
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t);
    const usage = (output: number) => ({
      input_tokens: 5,
      output_tokens: output,
      total_tokens: 5 + output,
    });
    f.respond((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(sse({ type: "response.created", response: { usage: usage(0) } }));
        res.write(sse({ type: "response.in_progress", response: { usage: usage(2) } }));
        res.write(sse({ type: "response.output_text.delta", delta: "hi", usage: usage(3) }));
        setTimeout(() => res.destroy(), 20);
      });
    });
    f.setRemaining(1000);
    const result = await f.streaming(() => {}).catch(() => ({ body: "", aborted: true }));
    await f.idle();
    assert.equal(result.aborted, true);
    assert.equal(f.counts().forwards, 1);
    assert.deepEqual(f.settlements, []);
    assert.deepEqual(await f.journal(), []);
    assert.equal(f.balance(), 1000 - f.maxCosts[0]!);
  },
);

test("a response or failure without a final usage record settles nothing", async (t) => {
  const f = await fixture(t);
  const payload = withField("max_output_tokens", 100);
  f.setRemaining(1000);
  assert.equal((await f.request("/responses", payload)).status, 200); // no usage in this SSE
  const forward = f.dependencies.forward;
  f.dependencies.forward = async () => {
    throw Error("upstream down");
  };
  assert.equal((await f.request("/responses", payload)).status, 502);
  f.dependencies.forward = forward;
  await f.idle();
  assert.deepEqual(f.settlements, []);
  assert.deepEqual(await f.journal(), []);
  assert.equal(f.balance(), 1000 - f.maxCosts[0]! - f.maxCosts[1]!);
});

test(
  "settlement completes before the connection handler resolves on client disconnect",
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t);
    let settled = false;
    const settle = f.dependencies.settle;
    f.dependencies.settle = async (permit, settlement) => {
      await new Promise((r) => setTimeout(r, 150));
      await settle(permit, settlement);
      settled = true;
    };
    f.respond((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        sse({
          type: "response.completed",
          response: { usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } },
        }),
      );
    });
    await f.streaming((res) => res.destroy());
    await f.idle();
    assert.equal(settled, true);
    assert.equal(f.settlements.length, 1);
  },
);

test(
  "a CR-only response.completed settles when the client disconnects right after it",
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t);
    const completed = {
      type: "response.completed",
      response: { usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } },
    };
    f.setRemaining(1000);
    f.respond((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "text/event-stream" });
      // The stream stays open: its end is the client disconnect, not a normal end.
      res.write(`data: ${JSON.stringify(completed)}\r\r`);
    });
    await f.streaming((res) => res.destroy());
    await f.idle();
    assert.deepEqual(f.settlements, [
      {
        reservationId: f.reservationIds[0],
        maxCost: f.maxCosts[0],
        inputTokens: 4,
        outputTokens: 2,
        reasoningTokens: 0,
        totalTokens: 6,
        boundExceeded: false,
      },
    ]);
    assert.equal(f.balance(), 1000 - 6);
  },
);

test(
  "a settle failure leaves the journal attempt line open and the full charge",
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t);
    const payload = withField("max_output_tokens", 100);
    f.respond(jsonUsage(usage18));
    f.setRemaining(1000);
    for (const failing of [
      async () => {
        throw Error("budget service down");
      },
      () => {
        throw Error("budget service down");
      },
    ]) {
      f.dependencies.settle = failing;
      assert.equal((await f.request("/responses", payload)).status, 200);
    }
    await f.idle();
    assert.deepEqual(
      (await f.journal()).map(withoutAt),
      f.reservationIds.map((reservationId, i) => ({
        reservationId,
        grantId: "grant1",
        maxCost: f.maxCosts[i],
        actual: actual18,
      })),
    );
    assert.equal(f.balance(), 1000 - f.maxCosts[0]! - f.maxCosts[1]!);
  },
);

test("a retried settle from the journal attempt line does not refund twice", async (t) => {
  const f = await fixture(t);
  f.respond(jsonUsage(usage18));
  f.setRemaining(1000);
  assert.equal((await f.request()).status, 200);
  await f.idle();
  assert.equal(f.balance(), 1000 - 18);
  // A later retry replays the attempt line, for example because its completion line was lost.
  const [attempt] = await f.journal();
  const { reservationId, maxCost, actual } = attempt as {
    reservationId: string;
    maxCost: number;
    actual: typeof actual18;
  };
  const replay = { reservationId, maxCost, ...actual, boundExceeded: actual.totalTokens > maxCost };
  await f.dependencies.settle(f.permit, replay);
  await f.dependencies.settle(f.permit, replay);
  assert.equal(f.settlements.length, 3);
  assert.equal(f.balance(), 1000 - 18);
});

test("a journal ending in a torn partial line gets the next attempt on its own line", async (t) => {
  const f = await fixture(t);
  const torn = '{"reservationId":"torn-write","grantId":"gr';
  await writeFile(f.config.settlementJournalPath, torn);
  f.respond(jsonUsage(usage18));
  f.setRemaining(1000);
  assert.equal((await f.request()).status, 200);
  await f.idle();
  const [reservationId, maxCost] = [f.reservationIds[0], f.maxCosts[0]];
  const lines = (await readFile(f.config.settlementJournalPath, "utf8")).split("\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[0], torn);
  assert.deepEqual(withoutAt(JSON.parse(lines[1]!)), {
    reservationId,
    grantId: "grant1",
    maxCost,
    actual: actual18,
  });
  assert.deepEqual(withoutAt(JSON.parse(lines[2]!)), {
    reservationId,
    grantId: "grant1",
    settled: true,
  });
  assert.equal(lines[3], "");
  assert.equal(f.balance(), 1000 - 18);
});

test("an unwritable journal still settles an overrun with boundExceeded in the settle call", async (t) => {
  const f = await fixture(t);
  const stderr = captureStderr(t);
  f.config.settlementJournalPath = `${f.config.settlementJournalPath}.missing/journal.ndjson`;
  f.respond(jsonUsage({ input_tokens: 5000, output_tokens: 10, total_tokens: 5010 }));
  f.setRemaining(10000);
  assert.equal((await f.request("/responses", withField("max_output_tokens", 100))).status, 200);
  await f.idle();
  const [reservationId, maxCost] = [f.reservationIds[0]!, f.maxCosts[0]!];
  const actual = { inputTokens: 5000, outputTokens: 10, reasoningTokens: 0, totalTokens: 5010 };
  assert.deepEqual(f.settlements, [{ reservationId, maxCost, ...actual, boundExceeded: true }]);
  assert.equal(f.balance(), 10000 - 5010);
  // The attempt, BOUND_EXCEEDED and completion appends each failed and each named the reservation.
  assert.equal(stderr.filter((line) => line.includes(reservationId)).length, 3);
});

test("an unwritable journal still refunds an underrun", async (t) => {
  const f = await fixture(t);
  const stderr = captureStderr(t);
  f.config.settlementJournalPath = `${f.config.settlementJournalPath}.missing/journal.ndjson`;
  f.respond(jsonUsage(usage18));
  f.setRemaining(1000);
  assert.equal((await f.request()).status, 200);
  await f.idle();
  const [reservationId, maxCost] = [f.reservationIds[0]!, f.maxCosts[0]!];
  assert.deepEqual(f.settlements, [{ reservationId, maxCost, ...actual18, boundExceeded: false }]);
  assert.equal(f.balance(), 1000 - 18);
  assert.equal(stderr.filter((line) => line.includes(reservationId)).length, 2);
});

test("concurrent settlements each land on their own parseable journal line", async (t) => {
  const f = await fixture(t);
  const torn = '{"reservationId":"torn-write","grantId":"gr';
  await writeFile(f.config.settlementJournalPath, torn);
  // All six responses are held and then released together, so their settlements overlap.
  const held: http.ServerResponse[] = [];
  f.respond((req, res) => {
    req.resume();
    req.on("end", () => {
      held.push(res);
      if (held.length < 6) return;
      for (const r of held) {
        r.writeHead(200, { "content-type": "application/json" });
        r.end(JSON.stringify({ id: "resp_1", output: [], usage: usage18 }));
      }
    });
  });
  f.setRemaining(10000);
  const payload = withField("max_output_tokens", 100);
  const results = await Promise.all(
    Array.from({ length: 6 }, () => f.request("/responses", payload)),
  );
  await f.idle();
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200, 200, 200, 200, 200],
  );
  const [first, ...rest] = (await readFile(f.config.settlementJournalPath, "utf8")).split("\n");
  assert.equal(first, torn);
  assert.equal(rest.pop(), "");
  // Six attempt lines and six completion lines: no blank, merged or torn lines.
  assert.equal(rest.length, 12);
  const records = rest.map((line) => JSON.parse(line) as { reservationId: string; settled?: true });
  assert.deepEqual(new Set(records.map((r) => r.reservationId)), new Set(f.reservationIds));
  assert.equal(records.filter((r) => r.settled).length, 6);
  assert.equal(f.balance(), 10000 - 6 * 18);
});

test("a final usage record in the chunk that crosses maxResponseBytes still settles", async (t) => {
  const f = await fixture(t);
  const delta = sse({ type: "response.output_text.delta", delta: "hi" });
  for (const [type, payload, total] of [
    ["text/event-stream", delta + sse(completed6), 6],
    ["application/json", JSON.stringify({ id: "resp_1", output: [], usage: usage18 }), 18],
  ] as const) {
    f.config.maxResponseBytes = Buffer.byteLength(payload) - 10;
    f.respond((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": type });
        res.end(payload);
      });
    });
    f.setRemaining(1000);
    // The crossing chunk is still refused: the client stream ends without it.
    await assert.rejects(f.request());
    await f.idle();
    assert.equal(f.settlements.at(-1)?.totalTokens, total);
    assert.equal(f.balance(), 1000 - total);
  }
  assert.equal(f.settlements.length, 2);
});

test("a stream that ends after its final data line without a blank line settles", async (t) => {
  const f = await fixture(t);
  const delta = sse({ type: "response.output_text.delta", delta: "hi" });
  f.setRemaining(1000);
  // First the data line is terminated but its blank line never comes; then not even the line end.
  for (const ending of ["\n", ""]) {
    f.respond((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(delta);
        res.end(`data: ${JSON.stringify(completed6)}${ending}`);
      });
    });
    assert.equal((await f.request()).status, 200);
    await f.idle();
  }
  assert.deepEqual(
    f.settlements.map((s) => s.totalTokens),
    [6, 6],
  );
  assert.equal(f.balance(), 1000 - 2 * 6);
});

test("a stream that ends mid-JSON does not settle", async (t) => {
  const f = await fixture(t);
  const whole = JSON.stringify(completed6);
  const payload = withField("max_output_tokens", 100);
  f.setRemaining(1000);
  for (const cut of [whole.slice(0, -2), whole.slice(0, whole.indexOf('"total_tokens"'))]) {
    f.respond((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`data: ${cut}`);
      });
    });
    assert.equal((await f.request("/responses", payload)).status, 200);
    await f.idle();
  }
  assert.deepEqual(f.settlements, []);
  assert.equal(f.balance(), 1000 - f.maxCosts[0]! - f.maxCosts[1]!);
});

test("CR-only and split CRLF framed streams still yield the final usage record", async (t) => {
  const f = await fixture(t);
  const completed = {
    type: "response.completed",
    response: { usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } },
  };
  f.setRemaining(1000);
  for (const end of ["\r", "\r\n"]) {
    const frame = (event: unknown) => `data: ${JSON.stringify(event)}${end}${end}`;
    f.respond((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(frame({ type: "response.output_text.delta", delta: "hi" }));
        // The final boundary is split across writes, and the stream ends on it.
        const last = frame(completed);
        res.write(last.slice(0, -1));
        setImmediate(() => res.end(last.slice(-1)));
      });
    });
    assert.equal((await f.request()).status, 200);
    await f.idle();
  }
  assert.deepEqual(
    f.settlements,
    f.reservationIds.map((reservationId, i) => ({
      reservationId,
      maxCost: f.maxCosts[i],
      inputTokens: 4,
      outputTokens: 2,
      reasoningTokens: 0,
      totalTokens: 6,
      boundExceeded: false,
    })),
  );
  assert.equal(f.balance(), 1000 - 2 * 6);
});

test("previous_response_id and any store other than false are refused", async (t) => {
  const f = await fixture(t);
  await refusedWithoutCharge(f, [
    withField("previous_response_id", "resp_123"),
    withField("store", true),
    withField("store", "false"),
    withField("store", null),
  ]);
  assert.equal((await f.request("/responses", withField("store", false))).status, 200);
});

test("an absent store is forwarded as store:false", async (t) => {
  const f = await fixture(t);
  assert.equal(Object.hasOwn(JSON.parse(body), "store"), false);
  assert.equal((await f.request()).status, 200);
  assert.equal(JSON.parse(f.received[0]!.body).store, false);
});

test("conversation and prompt are refused as fields outside the allowlist", async (t) => {
  const f = await fixture(t);
  await refusedWithoutCharge(f, [
    withField("conversation", "conv_123"),
    withField("conversation", { id: "conv_123" }),
    withField("prompt", { id: "pmpt_123", version: "2" }),
  ]);
});

test("only function and custom tools pass; local_shell, hosted and unknown tools are refused", async (t) => {
  const f = await fixture(t);
  await refusedWithoutCharge(
    f,
    [
      [{ type: "local_shell" }],
      [{ type: "web_search" }],
      [{ type: "web_search_preview" }],
      [{ type: "file_search", vector_store_ids: ["vs_1"] }],
      [{ type: "code_interpreter", container: { type: "auto" } }],
      [{ type: "image_generation" }],
      [{ type: "mcp", server_label: "docs", server_url: "https://example.invalid/mcp" }],
      [{ type: "function", name: "f", parameters: {} }, { type: "computer_use_preview" }],
      [{ name: "untyped" }],
      ["web_search"],
      { type: "function" },
    ].map((tools) => withField("tools", tools)),
  );
  const local = [
    { type: "function", name: "shell", parameters: { type: "object", properties: {} } },
    { type: "custom", name: "apply_patch" },
  ];
  assert.equal((await f.request("/responses", withField("tools", local))).status, 200);
  assert.deepEqual(JSON.parse(f.received[0]!.body).tools, local);
});

test("untyped input items pass only with role and content and no id", async (t) => {
  const f = await fixture(t);
  await refusedWithoutCharge(
    f,
    [
      [{ id: "msg_existing" }],
      [{ id: "msg_existing", role: "user", content: "hi" }],
      [{ role: "user" }],
      [{ content: "hi" }],
    ].map((input) => withField("input", input)),
  );
  const untyped = [
    { role: "user", content: "hi" },
    { role: "assistant", content: [{ type: "output_text", text: "ok" }] },
  ];
  assert.equal((await f.request("/responses", withField("input", untyped))).status, 200);
  assert.deepEqual(JSON.parse(f.received[0]!.body).input, untyped);
});

test("input items whose type is not on the allow-list are refused", async (t) => {
  const f = await fixture(t);
  await refusedWithoutCharge(f, [
    ...[
      [{ type: "item_reference", id: "msg_1" }],
      [{ type: "web_search_call", id: "ws_1", status: "completed" }],
      [{ type: "local_shell_call", id: "lsh_1", call_id: "c1", status: "completed" }],
      [{ type: "computer_call_output", call_id: "c1", output: { type: "computer_screenshot" } }],
      [{ type: null, role: "user", content: "hi" }],
      [null],
      ["text"],
      [["nested"]],
      { role: "user", content: "hi" },
      42,
      null,
    ].map((input) => withField("input", input)),
  ]);
  const allowed = [
    { type: "message", role: "user", id: "msg_1", content: "hi" },
    { type: "function_call", call_id: "c1", name: "shell", arguments: "{}" },
    { type: "function_call_output", call_id: "c1", output: "done" },
    { type: "custom_tool_call", call_id: "c2", name: "apply_patch", input: "*** Begin Patch" },
    {
      type: "custom_tool_call_output",
      call_id: "c2",
      output: [{ type: "input_text", text: "ok" }],
    },
    { type: "reasoning", summary: [], encrypted_content: "gAAAAB-opaque" },
  ];
  assert.equal((await f.request("/responses", withField("input", allowed))).status, 200);
  assert.deepEqual(JSON.parse(f.received[0]!.body).input, allowed);
});

test("message content parts other than input_text, output_text and refusal are refused", async (t) => {
  const f = await fixture(t);
  await refusedWithoutCharge(
    f,
    [
      [{ role: "user", content: [{ type: "input_image", detail: "low" }] }],
      [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_file", filename: "a.pdf", file_data: "JVBERi0xLjQ=" }],
        },
      ],
      [{ type: "message", role: "user", content: [{ type: "input_audio" }] }],
      [{ type: "message", role: "user", content: ["plain string part"] }],
      [{ type: "message", role: "user", content: { type: "input_text", text: "x" } }],
      [{ type: "message", role: "user", id: "msg_1" }],
    ].map((input) => withField("input", input)),
  );
  const text = [
    {
      type: "message",
      role: "assistant",
      content: [
        { type: "output_text", text: "ok" },
        { type: "refusal", refusal: "no" },
      ],
    },
  ];
  assert.equal((await f.request("/responses", withField("input", text))).status, 200);
});

test("image and file inputs anywhere in input are refused", async (t) => {
  const f = await fixture(t);
  await refusedWithoutCharge(
    f,
    [
      [{ type: "input_image", detail: "high" }],
      [
        {
          role: "user",
          content: [
            { type: "input_text", text: "look" },
            { type: "input_image", detail: "low" },
          ],
        },
      ],
      [
        {
          role: "user",
          content: [{ type: "input_file", filename: "a.pdf", file_data: "JVBERi0xLjQ=" }],
        },
      ],
      [{ type: "function_call_output", call_id: "c1", output: [{ type: "input_image" }] }],
    ].map((input) => withField("input", input)),
  );
  const text = [{ role: "user", content: [{ type: "input_text", text: "hello" }] }];
  assert.equal((await f.request("/responses", withField("input", text))).status, 200);
});

test("item_reference items are refused at the top of input and nested", async (t) => {
  const f = await fixture(t);
  await refusedWithoutCharge(
    f,
    [
      [{ type: "item_reference", id: "msg_123" }],
      [{ role: "user", content: [{ type: "item_reference", id: "msg_123" }] }],
      [
        {
          type: "function_call_output",
          call_id: "c1",
          output: [{ type: "item_reference", id: "fc_1" }],
        },
      ],
    ].map((input) => withField("input", input)),
  );
});

test("reasoning items without encrypted_content are refused; with it they pass", async (t) => {
  const f = await fixture(t);
  const go = { role: "user", content: [{ type: "input_text", text: "go" }] };
  await refusedWithoutCharge(
    f,
    [
      { type: "reasoning", id: "rs_123", summary: [] },
      { type: "reasoning", id: "rs_123", summary: [], encrypted_content: "" },
      { type: "reasoning", id: "rs_123", summary: [], encrypted_content: null },
    ].map((reasoning) => withField("input", [reasoning, go])),
  );
  const carried = [
    { type: "reasoning", id: "rs_123", summary: [], encrypted_content: "gAAAAB-opaque" },
    go,
  ];
  assert.equal((await f.request("/responses", withField("input", carried))).status, 200);
  assert.deepEqual(JSON.parse(f.received[0]!.body).input, carried);
});

test("file_id, file_url and image_url anywhere in the body are refused", async (t) => {
  const f = await fixture(t);
  const content = (extra: Record<string, string>) => [
    { role: "user", content: [{ type: "input_text", text: "x", ...extra }] },
  ];
  await refusedWithoutCharge(f, [
    withField("input", content({ file_id: "file_1" })),
    withField("input", content({ file_url: "https://example.invalid/a.pdf" })),
    withField("metadata", { image_url: "https://example.invalid/a.png" }),
    withField("tools", [
      {
        type: "function",
        name: "f",
        parameters: { type: "object", properties: { file_id: { type: "string" } } },
      },
    ]),
  ]);
});

test("unknown top-level fields are refused before reservation or forward", async (t) => {
  const f = await fixture(t);
  for (const field of ["service_tier", "conversation", "prompt", "extra_body"]) {
    const result = await f.request("/responses", withField(field, "x"));
    assert.equal(result.status, 400);
    assert.match(result.body, /FIELD_NOT_ALLOWED/);
  }
  assert.equal(f.counts().reserves, 0);
  assert.equal(f.counts().forwards, 0);
});

test("background mode is refused unless explicitly false", async (t) => {
  const f = await fixture(t);
  for (const background of [true, "true", 1, null]) {
    const result = await f.request("/responses", withField("background", background));
    assert.equal(result.status, 400);
    assert.match(result.body, /FIELD_NOT_ALLOWED/);
  }
  assert.equal(f.counts().reserves, 0);
  assert.equal(f.counts().forwards, 0);
  assert.equal((await f.request("/responses", withField("background", false))).status, 200);
});

test("non-object or unparsable JSON is refused as INVALID_REQUEST", async (t) => {
  const f = await fixture(t);
  for (const payload of ["[]", '"text"', "42", "null", "{not json"]) {
    const result = await f.request("/responses", payload);
    assert.equal(result.status, 400);
    assert.match(result.body, /INVALID_REQUEST/);
  }
  assert.equal(f.counts().forwards, 0);
});

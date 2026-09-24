import * as http from "node:http";
import type { Socket } from "node:net";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { readlink } from "node:fs/promises";

export type PeerCredentials = Readonly<{ uid: number; gid: number; pid: number }>;
export type InferencePermit = {
  taskId: string;
  grantId: string;
  expiresAt: number;
  allowedModels: string[];
  allowedEfforts: string[];
  networkNamespace: string;
};
export type InferenceGatewayConfig = {
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxHeaderBytes: number;
  timeoutMs: number;
  revalidateEveryMs: number;
  hostNetworkNamespace: string;
};
export type InferenceForwardRequest = {
  path: "/responses" | "/v1/responses";
  headers: http.OutgoingHttpHeaders;
  body: Buffer;
  signal: AbortSignal;
  maxHeaderBytes: number;
};
export type InferenceForwardResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Readable;
};
export type InferenceGatewayDependencies = {
  /** Trusted service must attest CURRENT grant and actual kernel network namespace, never headers. */
  authorize(peer: PeerCredentials): Promise<InferencePermit | null>;
  reserve(
    permit: InferencePermit,
    request: {
      reservationId: string;
      requestSha256: string;
      model: string;
      effort: string;
      requestBytes: number;
    },
  ): Promise<void>;
  forward(request: InferenceForwardRequest): Promise<InferenceForwardResponse>;
};
class Refusal extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const namespace = (s: unknown): s is string => typeof s === "string" && /^net:\[\d+\]$/.test(s);
function configCheck(c: InferenceGatewayConfig, d: InferenceGatewayDependencies) {
  const bounded = (n: number, max: number) => Number.isSafeInteger(n) && n > 0 && n <= max;
  if (
    !c ||
    !d ||
    typeof d.authorize !== "function" ||
    typeof d.reserve !== "function" ||
    typeof d.forward !== "function" ||
    !bounded(c.maxRequestBytes, 64 * 1024 * 1024) ||
    !bounded(c.maxResponseBytes, 128 * 1024 * 1024) ||
    !bounded(c.maxHeaderBytes, 65536) ||
    !bounded(c.timeoutMs, 900000) ||
    !bounded(c.revalidateEveryMs, 30000) ||
    c.revalidateEveryMs > c.timeoutMs ||
    !namespace(c.hostNetworkNamespace)
  )
    throw new Refusal("INVALID_GATEWAY_CONFIGURATION", 500);
}
function permit(value: InferencePermit | null, c: InferenceGatewayConfig): InferencePermit | null {
  const strings = (v: unknown, max: number): v is string[] =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= max &&
    v.every((s) => typeof s === "string" && s.length > 0 && s.length <= 256);
  if (
    !value ||
    typeof value.taskId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.taskId) ||
    typeof value.grantId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.grantId) ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= Date.now() ||
    !namespace(value.networkNamespace) ||
    value.networkNamespace === c.hostNetworkNamespace ||
    !strings(value.allowedModels, 256) ||
    !strings(value.allowedEfforts, 32)
  )
    return null;
  return {
    ...value,
    allowedModels: [...value.allowedModels],
    allowedEfforts: [...value.allowedEfforts],
  };
}
const blocked = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "expect",
  "content-length",
  "forwarded",
  "via",
  "x-real-ip",
  "x-client-ip",
  "openai-organization",
  "openai-project",
  "chatgpt-account-id",
]);
function cleanHeaders(
  headers: http.IncomingHttpHeaders | http.OutgoingHttpHeaders,
): http.OutgoingHttpHeaders {
  const nominated = Object.entries(headers)
    .filter(([name]) => name.toLowerCase() === "connection")
    .flatMap(([, value]) =>
      String(value ?? "")
        .toLowerCase()
        .split(",")
        .map((v) => v.trim()),
    );
  const out: http.OutgoingHttpHeaders = {};
  for (const [raw, value] of Object.entries(headers)) {
    const name = raw.toLowerCase();
    if (
      value === undefined ||
      blocked.has(name) ||
      nominated.includes(name) ||
      /auth|cookie|token|secret|credential|api[-_]?key|throughline|namespace|(?:^|-)(?:uid|gid|pid)(?:-|$)|(?:^|-)account-id$|(?:^|-)(?:task|grant|principal|actor|agent|reservation)-id$/.test(
        name,
      ) ||
      name.startsWith("x-forwarded-")
    )
      continue;
    out[name] = value;
  }
  return out;
}
function duplicateKeys(text: string) {
  let i = 0;
  const space = () => {
    while (/\s/.test(text[i] ?? "") && i < text.length) i++;
  };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i++] === '"') break;
    }
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (depth: number): void => {
    if (depth > 128) throw new Refusal("INVALID_JSON", 400);
    space();
    if (text[i] === '"') {
      string();
      return;
    }
    if (text[i] === "{") {
      i++;
      space();
      const seen = new Set<string>();
      if (text[i] === "}") {
        i++;
        return;
      }
      for (;;) {
        space();
        const key = string();
        if (seen.has(key)) throw new Refusal("DUPLICATE_JSON_KEY", 400);
        seen.add(key);
        space();
        i++;
        value(depth + 1);
        space();
        if (text[i++] === "}") return;
      }
    }
    if (text[i] === "[") {
      i++;
      space();
      if (text[i] === "]") {
        i++;
        return;
      }
      for (;;) {
        value(depth + 1);
        space();
        if (text[i++] === "]") return;
      }
    }
    while (i < text.length && !/[\s,}\]]/.test(text[i]!)) i++;
  };
  value(0);
}
function readBody(req: http.IncomingMessage, max: number, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0,
      done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      req.off("data", data);
      req.off("end", end);
      req.off("error", failed);
      req.off("aborted", aborted);
      signal.removeEventListener("abort", aborted);
      if (error) {
        req.pause();
        reject(error);
      } else resolve(Buffer.concat(chunks, bytes));
    };
    const data = (part: Buffer) => {
      bytes += part.length;
      if (bytes > max) finish(new Refusal("REQUEST_TOO_LARGE", 413));
      else chunks.push(part);
    };
    const end = () => finish(),
      failed = () => finish(new Refusal("INVALID_REQUEST_BODY", 400)),
      aborted = () => finish(new Refusal("REQUEST_CANCELLED", 408));
    req.on("data", data);
    req.once("end", end);
    req.once("error", failed);
    req.once("aborted", aborted);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}
function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Refusal("REQUEST_CANCELLED", 408));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        if (signal.aborted) throw new Refusal("REQUEST_CANCELLED", 408);
        return operation();
      })
      .then(
        (v) => {
          signal.removeEventListener("abort", abort);
          resolve(v);
        },
        (e) => {
          signal.removeEventListener("abort", abort);
          reject(e);
        },
      );
  });
}

/** Only existing loopback broker, never credentials, request-selected destinations or redirects. */
export function createLoopbackBrokerForwarder(options: {
  port: number;
}): (request: InferenceForwardRequest) => Promise<InferenceForwardResponse> {
  const port = options.port;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error("INVALID_BROKER_PORT");
  return (request) =>
    new Promise((resolve, reject) => {
      if (!["/responses", "/v1/responses"].includes(request.path)) {
        reject(new Refusal("INVALID_ROUTE", 400));
        return;
      }
      const headers = cleanHeaders(request.headers);
      delete headers["content-encoding"];
      const upstream = http.request(
        {
          hostname: "127.0.0.1",
          port,
          method: "POST",
          path: request.path,
          headers: {
            ...headers,
            "content-type": "application/json",
            "content-length": request.body.length,
            connection: "close",
            "accept-encoding": "identity",
          },
          agent: false,
          signal: request.signal,
          maxHeaderSize: request.maxHeaderBytes,
        },
        (response) =>
          resolve({
            status: response.statusCode ?? 502,
            headers: response.headers,
            body: response,
          }),
      );
      upstream.once("error", () => reject(new Refusal("UPSTREAM_FAILED", 502)));
      upstream.once("upgrade", (_response, socket) => {
        socket.destroy();
        reject(new Refusal("UPSTREAM_UPGRADE_REFUSED", 502));
      });
      upstream.end(request.body);
    });
}

/** One HTTP/1.1 request on an already accepted, kernel-authenticated Unix connection. */
export async function serveInferenceConnection(
  peer: PeerCredentials,
  socket: Socket,
  options: { config: InferenceGatewayConfig; dependencies: InferenceGatewayDependencies },
): Promise<void> {
  const started = Date.now();
  socket.pause();
  const guard = () => {};
  socket.on("error", guard);
  socket.once("close", () => socket.off("error", guard));
  const c = { ...options.config },
    source = options.dependencies;
  try {
    configCheck(c, source);
    if (
      process.platform !== "linux" ||
      (await readlink("/proc/self/ns/net")) !== c.hostNetworkNamespace
    )
      throw new Refusal("HOST_NAMESPACE_ANCHOR_REFUSED", 503);
  } catch {
    socket.end(
      "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      () => socket.destroy(),
    );
    return;
  }
  const d = {
    authorize: source.authorize.bind(source),
    reserve: source.reserve.bind(source),
    forward: source.forward.bind(source),
  };
  if (!peer) {
    socket.destroy();
    return;
  }
  const actual = Object.freeze({ uid: peer.uid, gid: peer.gid, pid: peer.pid });
  if (
    Object.values(actual).some((n) => !Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) ||
    !actual.pid
  ) {
    socket.destroy();
    return;
  }
  if (socket.destroyed) return;
  const controller = new AbortController();
  let reason = new Refusal("REQUEST_TIMEOUT", 504),
    deadline = started + c.timeoutMs,
    finished = false;
  let timer: ReturnType<typeof setTimeout>, monitor: ReturnType<typeof setInterval> | undefined;
  const abort = (failure: Refusal) => {
    if (!controller.signal.aborted) {
      reason = failure;
      controller.abort();
    }
  };
  const arm = () => {
    clearTimeout(timer);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      abort(new Refusal("REQUEST_TIMEOUT", 504));
      return;
    }
    timer = setTimeout(() => abort(new Refusal("REQUEST_TIMEOUT", 504)), remaining);
  };
  arm();
  const disconnected = () => {
    if (!finished) abort(new Refusal("CLIENT_DISCONNECTED", 408));
  };
  socket.once("close", disconnected);
  socket.once("error", disconnected);
  const failureBody = (error: Refusal) => {
    const body = Buffer.from(JSON.stringify({ error: { code: error.code } }));
    return body.length <= c.maxResponseBytes ? body : Buffer.alloc(0);
  };
  const rawFailure = (error: Refusal) => {
    if (socket.destroyed) return;
    const body = failureBody(error);
    socket.end(
      `HTTP/1.1 ${error.status} Request Refused\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
      () => socket.destroy(),
    );
  };
  let server: http.Server | undefined;
  try {
    const initial = permit(
      await abortable(() => d.authorize(actual).catch(() => null), controller.signal),
      c,
    );
    if (!initial) throw new Refusal("UNAUTHORIZED_EXECUTION", 401);
    deadline = Math.min(deadline, initial.expiresAt);
    arm();
    await new Promise<void>((resolve) => {
      let seen = false;
      const end = () => resolve();
      socket.once("close", end);
      server = http.createServer(
        { maxHeaderSize: c.maxHeaderBytes, insecureHTTPParser: false },
        async (req, res) => {
          if (seen) {
            abort(new Refusal("MULTIPLE_REQUESTS_REFUSED", 400));
            socket.destroy();
            return;
          }
          seen = true;
          res.shouldKeepAlive = false;
          try {
            if (
              req.method !== "POST" ||
              req.httpVersion !== "1.1" ||
              !(req.url === "/responses" || req.url === "/v1/responses")
            )
              throw new Refusal("INVALID_ROUTE", 400);
            if (req.headers.upgrade !== undefined) throw new Refusal("UPGRADE_REFUSED", 400);
            if (
              req.headers["content-encoding"] &&
              String(req.headers["content-encoding"]).toLowerCase() !== "identity"
            )
              throw new Refusal("COMPRESSED_REQUEST_REFUSED", 400);
            if (
              req.headers["transfer-encoding"] &&
              String(req.headers["transfer-encoding"]).toLowerCase() !== "chunked"
            )
              throw new Refusal("INVALID_REQUEST_FRAMING", 400);
            if (
              !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
                String(req.headers["content-type"] ?? ""),
              )
            )
              throw new Refusal("JSON_CONTENT_TYPE_REQUIRED", 400);
            const body = await readBody(req, c.maxRequestBytes, controller.signal);
            let data: Record<string, unknown>;
            try {
              const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
              data = JSON.parse(text);
              if (!data || typeof data !== "object" || Array.isArray(data)) throw Error();
              duplicateKeys(text);
            } catch {
              throw new Refusal("INVALID_JSON", 400);
            }
            const model = data.model,
              effort = (data.reasoning as { effort?: unknown } | undefined)?.effort;
            if (
              typeof model !== "string" ||
              typeof effort !== "string" ||
              !initial.allowedModels.includes(model) ||
              !initial.allowedEfforts.includes(effort)
            )
              throw new Refusal("INFERENCE_POLICY_REFUSED", 403);
            const current = async () => {
              const p = permit(
                await abortable(() => d.authorize(actual).catch(() => null), controller.signal),
                c,
              );
              if (
                !p ||
                p.taskId !== initial.taskId ||
                p.grantId !== initial.grantId ||
                p.networkNamespace !== initial.networkNamespace ||
                !p.allowedModels.includes(model) ||
                !p.allowedEfforts.includes(effort)
              )
                throw new Refusal("EXECUTION_REVOKED_OR_CHANGED", 403);
              deadline = Math.min(deadline, p.expiresAt);
              arm();
              return p;
            };
            const admitted = await current();
            const reservationId = randomUUID();
            try {
              await abortable(
                () =>
                  d.reserve(admitted, {
                    reservationId,
                    requestSha256: createHash("sha256").update(body).digest("hex"),
                    model,
                    effort,
                    requestBytes: body.length,
                  }),
                controller.signal,
              );
            } catch {
              throw new Refusal("RESERVATION_REFUSED", 429);
            }
            await current();
            let checking = false;
            monitor = setInterval(() => {
              if (checking || controller.signal.aborted) return;
              checking = true;
              void current()
                .catch(() => abort(new Refusal("EXECUTION_REVOKED_OR_CHANGED", 403)))
                .finally(() => {
                  checking = false;
                });
            }, c.revalidateEveryMs);
            const route = req.url;
            const upstream = await abortable(
              () =>
                d
                  .forward({
                    path: route,
                    headers: cleanHeaders(req.headers),
                    body,
                    signal: controller.signal,
                    maxHeaderBytes: c.maxHeaderBytes,
                  })
                  .then((response) => {
                    if (controller.signal.aborted) {
                      response.body.destroy();
                      throw reason;
                    }
                    return response;
                  }),
              controller.signal,
            );
            if (
              upstream.status < 200 ||
              upstream.status >= 600 ||
              (upstream.status >= 300 && upstream.status < 400)
            ) {
              upstream.body.destroy();
              throw new Refusal("UPSTREAM_REDIRECT_OR_STATUS_REFUSED", 502);
            }
            const headerBytes = Object.entries(upstream.headers).reduce(
              (n, [key, value]) => n + Buffer.byteLength(key + String(value ?? "")) + 4,
              0,
            );
            if (headerBytes > c.maxHeaderBytes) {
              upstream.body.destroy();
              throw new Refusal("UPSTREAM_HEADERS_TOO_LARGE", 502);
            }
            res.writeHead(upstream.status, {
              ...cleanHeaders(upstream.headers),
              connection: "close",
            });
            let bytes = 0;
            const limit = new Transform({
              transform(chunk: Buffer, _encoding, callback) {
                bytes += chunk.length;
                if (bytes > c.maxResponseBytes) callback(new Refusal("RESPONSE_TOO_LARGE", 502));
                else callback(null, chunk);
              },
            });
            await pipeline(upstream.body, limit, res, { signal: controller.signal });
          } catch (error) {
            const refusal = controller.signal.aborted
              ? reason
              : error instanceof Refusal
                ? error
                : new Refusal("INFERENCE_GATEWAY_FAILED", 502);
            if (!res.headersSent && !socket.destroyed) {
              res.writeHead(refusal.status, {
                "content-type": "application/json",
                connection: "close",
              });
              res.end(failureBody(refusal));
            } else socket.destroy();
          } finally {
            finished = true;
            clearInterval(monitor);
            clearTimeout(timer);
            socket.off("close", end);
            if (!socket.destroyed) socket.destroySoon();
            resolve();
          }
        },
      );
      server.on("clientError", () => {
        rawFailure(new Refusal("INVALID_HTTP_FRAMING", 400));
        resolve();
      });
      // Header bytes are bounded by the parser; do not silently truncate the header map and
      // thereby lose connection-nominated fields that must be stripped.
      server.maxHeadersCount = 0;
      server.on("checkContinue", (_req, res) => {
        res.writeHead(400, { connection: "close" });
        res.end(failureBody(new Refusal("EXPECT_REFUSED", 400)));
        socket.destroySoon();
        resolve();
      });
      server.on("connect", () => {
        rawFailure(new Refusal("CONNECT_REFUSED", 400));
        resolve();
      });
      server.on("upgrade", () => {
        rawFailure(new Refusal("UPGRADE_REFUSED", 400));
        resolve();
      });
      controller.signal.addEventListener(
        "abort",
        () => {
          if (!seen) {
            rawFailure(reason);
            resolve();
          }
        },
        { once: true },
      );
      server.emit("connection", socket);
      socket.resume();
    });
  } catch (error) {
    rawFailure(
      controller.signal.aborted
        ? reason
        : error instanceof Refusal
          ? error
          : new Refusal("INFERENCE_GATEWAY_FAILED", 502),
    );
  } finally {
    finished = true;
    clearTimeout(timer!);
    clearInterval(monitor);
    socket.off("close", disconnected);
    socket.off("error", disconnected);
    server?.removeAllListeners();
    if (!controller.signal.aborted) controller.abort();
  }
}

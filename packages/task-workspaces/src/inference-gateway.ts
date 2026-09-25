import * as http from "node:http";
import type { Socket } from "node:net";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { open, readlink, type FileHandle } from "node:fs/promises";
import { isAbsolute } from "node:path";

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
  /** Largest max_output_tokens forwarded (and reserved) for one call. */
  maxOutputTokensPerCall: number;
  /** Input tokens reserved on top of the body bytes for the upstream's per-request framing. */
  inputOverheadTokens: number;
  /** Append-only local journal: an attempt line before each settle, a completion line after. */
  settlementJournalPath: string;
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
  /**
   * Atomic check-and-debit: resolves true only after maxCost is debited from the remaining
   * budget; resolves false, debiting nothing, when maxCost does not fit.
   */
  reserve(
    permit: InferencePermit,
    request: {
      reservationId: string;
      requestSha256: string;
      model: string;
      effort: string;
      requestBytes: number;
      maxCost: number;
    },
  ): Promise<boolean>;
  forward(request: InferenceForwardRequest): Promise<InferenceForwardResponse>;
  /** Trusted budget service: tokens the task may still spend. <= 0 refuses before any reservation. */
  remainingTokens(permit: InferencePermit): Promise<number>;
  /**
   * Charges the actual usage from a final usage record: applies maxCost - actual, a refund when
   * actual is below maxCost and a debit of the excess when above, at most once per
   * reservationId, and records the overrun durably when boundExceeded is true. Without a call
   * the full maxCost stays charged.
   */
  settle(permit: InferencePermit, settlement: InferenceSettlement): Promise<void>;
};
export type InferenceSettlement = {
  reservationId: string;
  maxCost: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  /** totalTokens > maxCost: the input bound was exceeded. */
  boundExceeded: boolean;
};
const allowedFields = new Set([
  "model",
  "input",
  "instructions",
  "reasoning",
  "max_output_tokens",
  "stream",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "text",
  "temperature",
  "top_p",
  "include",
  "store",
  "metadata",
  "truncation",
  "prompt_cache_key",
  "user",
]);
// Tools the client runs itself; other tools make the upstream read or add content the gateway
// never sees.
const localToolTypes = new Set<unknown>(["function", "custom"]);
const fileKeys = ["file_id", "file_url", "image_url"];
const itemTypes = new Set<unknown>([
  "message",
  "function_call",
  "function_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
  "reasoning",
]);
const partTypes = new Set<unknown>(["input_text", "output_text", "refusal"]);
/** True if value, or any object nested in it, matches. */
function reaches(value: unknown, match: (o: Record<string, unknown>) => boolean): boolean {
  if (!value || typeof value !== "object") return false;
  if (!Array.isArray(value) && match(value as Record<string, unknown>)) return true;
  return Object.values(value).some((v) => reaches(v, match));
}
/** A string, or an array of text parts: content that is carried in the body itself. */
const textParts = (value: unknown) =>
  typeof value === "string" ||
  (Array.isArray(value) &&
    value.every((part) => partTypes.has((part as { type?: unknown } | null)?.type)));
/** Allow-list: input is absent, a string, or items that carry their content in the body. */
function inputAllowed(input: unknown): boolean {
  if (input === undefined || typeof input === "string") return true;
  if (!Array.isArray(input)) return false;
  return input.every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const item = value as Record<string, unknown>;
    // An untyped item with an id is a stored-item reference.
    if (!Object.hasOwn(item, "type"))
      return Object.hasOwn(item, "role") && !Object.hasOwn(item, "id") && textParts(item.content);
    if (!itemTypes.has(item.type)) return false;
    if (item.type === "message") return textParts(item.content);
    if (item.type === "reasoning")
      return typeof item.encrypted_content === "string" && item.encrypted_content !== "";
    if (item.type === "function_call_output" || item.type === "custom_tool_call_output")
      return textParts(item.output);
    return true;
  });
}
let journalTail: Promise<unknown> = Promise.resolve();
/** Journal appends run one at a time in this process, so each tail check sees the last record. */
function appendJournal(path: string, record: object): Promise<boolean> {
  const appended = journalTail.then(() => writeJournalRecord(path, record));
  journalTail = appended;
  return appended;
}
/** Appends one record on its own line in one write, then syncs; false if any step fails. */
async function writeJournalRecord(path: string, record: object): Promise<boolean> {
  let file: FileHandle | undefined;
  try {
    file = await open(path, "a+", 0o600);
    const { size } = await file.stat();
    const last = Buffer.alloc(1);
    if (size > 0) await file.read(last, 0, 1, size - 1);
    // A torn earlier write left no newline: start this record on a line of its own.
    const text = (size > 0 && last[0] !== 0x0a ? "\n" : "") + JSON.stringify(record) + "\n";
    const { bytesWritten } = await file.write(text);
    if (bytesWritten !== Buffer.byteLength(text)) return false;
    await file.sync();
    return true;
  } catch {
    return false;
  } finally {
    await file?.close().catch(() => undefined);
  }
}
type Usage = Omit<InferenceSettlement, "reservationId" | "maxCost" | "boundExceeded">;
type Paid = { permit: InferencePermit; reservationId: string; maxCost: number; finalUsage?: Usage };
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
/** Responses API usage record; anything malformed is treated as absent (no refund). */
function usageRecord(value: unknown): Usage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const u = value as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
    output_tokens_details?: { reasoning_tokens?: unknown } | null;
  };
  const reasoning = u.output_tokens_details?.reasoning_tokens ?? 0;
  if (!count(u.input_tokens) || !count(u.output_tokens) || !count(reasoning)) return undefined;
  const total = u.total_tokens ?? u.input_tokens + u.output_tokens;
  if (!count(total)) return undefined;
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    reasoningTokens: reasoning,
    totalTokens: total,
  };
}
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
    typeof d.remainingTokens !== "function" ||
    typeof d.settle !== "function" ||
    !bounded(c.maxRequestBytes, 64 * 1024 * 1024) ||
    !bounded(c.maxResponseBytes, 128 * 1024 * 1024) ||
    !bounded(c.maxHeaderBytes, 65536) ||
    !bounded(c.timeoutMs, 900000) ||
    !bounded(c.revalidateEveryMs, 30000) ||
    c.revalidateEveryMs > c.timeoutMs ||
    !namespace(c.hostNetworkNamespace) ||
    !bounded(c.maxOutputTokensPerCall, Number.MAX_SAFE_INTEGER) ||
    !Number.isSafeInteger(c.inputOverheadTokens) ||
    c.inputOverheadTokens < 0 ||
    typeof c.settlementJournalPath !== "string" ||
    !isAbsolute(c.settlementJournalPath)
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
    remainingTokens: source.remainingTokens.bind(source),
    settle: source.settle.bind(source),
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
      // Once a request is being handled, only its own completion (after settlement) resolves.
      const end = () => {
        if (!seen) resolve();
      };
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
          let settlement: Paid | undefined, endOfInput: (() => void) | undefined;
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
            const received = await readBody(req, c.maxRequestBytes, controller.signal);
            let data: Record<string, unknown>;
            try {
              const text = new TextDecoder("utf-8", { fatal: true }).decode(received);
              data = JSON.parse(text);
              if (!data || typeof data !== "object" || Array.isArray(data)) throw Error();
              duplicateKeys(text);
            } catch {
              throw new Refusal("INVALID_REQUEST", 400);
            }
            // Refused before any reservation or forward: unknown fields, and any background mode.
            for (const key of Object.keys(data))
              if (!allowedFields.has(key) && !(key === "background" && data[key] === false))
                throw new Refusal("FIELD_NOT_ALLOWED", 400);
            // Input is bounded by the body only if the upstream reads nothing outside the body:
            // no stored responses or items, server-side tools, images or files.
            if (
              (Object.hasOwn(data, "store") && data.store !== false) ||
              (data.tools !== undefined &&
                (!Array.isArray(data.tools) ||
                  data.tools.some((tool) => !localToolTypes.has(tool?.type)))) ||
              !inputAllowed(data.input) ||
              reaches(data, (o) => fileKeys.some((key) => Object.hasOwn(o, key)))
            )
              throw new Refusal("FIELD_NOT_ALLOWED", 400);
            const requested = data.max_output_tokens;
            if (
              requested !== undefined &&
              (!Number.isSafeInteger(requested) || (requested as number) <= 0)
            )
              throw new Refusal("INVALID_REQUEST", 400);
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
            let remaining: number;
            try {
              remaining = Math.floor(
                await abortable(() => d.remainingTokens(admitted), controller.signal),
              );
            } catch {
              if (controller.signal.aborted) throw reason;
              remaining = Number.NaN;
            }
            // Fails closed: unreadable, non-numeric or spent budgets never reach reserve/forward.
            if (!Number.isFinite(remaining) || remaining <= 0)
              throw new Refusal("BUDGET_EXHAUSTED", 429);
            // maxCost = inputUpperBound + outputCap, with inputUpperBound = forwarded body bytes +
            // inputOverheadTokens (the upstream's per-request framing). The upstream enforces
            // max_output_tokens, reasoning included. The input bound is an estimate that
            // settlement monitors (BOUND_EXCEEDED), not a proof. It is measured with the widest
            // cap first: the final cap is no larger, so it has no more digits and the forwarded
            // body is no longer. The forwarded body always carries store:false.
            const rewrite = (cap: number) =>
              Buffer.from(JSON.stringify({ ...data, max_output_tokens: cap, store: false }));
            const ceiling =
              requested === undefined
                ? c.maxOutputTokensPerCall
                : Math.min(requested as number, c.maxOutputTokensPerCall);
            const room =
              remaining - rewrite(Math.min(ceiling, remaining)).length - c.inputOverheadTokens;
            const outputCap = Math.min(ceiling, room);
            if (!Number.isSafeInteger(outputCap) || outputCap < 1)
              throw new Refusal("BUDGET_EXHAUSTED", 429);
            const body = rewrite(outputCap);
            const maxCost = body.length + c.inputOverheadTokens + outputCap;
            const reservationId = randomUUID();
            // A reservation that commits after the client disconnected during this wait stays
            // charged at maxCost; no settlement is needed, because settlement can only refund.
            let reserved: boolean;
            try {
              reserved =
                (await abortable(
                  () =>
                    d.reserve(admitted, {
                      reservationId,
                      requestSha256: createHash("sha256").update(body).digest("hex"),
                      model,
                      effort,
                      requestBytes: body.length,
                      maxCost,
                    }),
                  controller.signal,
                )) === true;
            } catch {
              throw new Refusal("RESERVATION_REFUSED", 429);
            }
            if (!reserved) throw new Refusal("BUDGET_EXHAUSTED", 429);
            // maxCost is now charged; only a final usage record settles it to the actual (finally).
            const paid: Paid = { permit: admitted, reservationId, maxCost };
            settlement = paid;
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
            const contentType = String(upstream.headers["content-type"] ?? "");
            const eventStream = /^text\/event-stream\b/i.test(contentType);
            // Non-streaming JSON is kept (already bounded by maxResponseBytes) to read its usage.
            const kept: Buffer[] | undefined =
              !eventStream && /^application\/json\b/i.test(contentType) ? [] : undefined;
            // SSE is parsed only to find the final usage record (response.completed); any other
            // usage record is ignored. Lines may end in LF, CRLF or CR alone.
            const decoder = new TextDecoder("utf-8");
            let pendingText = "",
              dataLines: string[] = [];
            const event = () => {
              if (dataLines.length === 0) return;
              const text = dataLines.join("\n");
              dataLines = [];
              if (paid.finalUsage) return;
              let parsed: unknown;
              try {
                parsed = JSON.parse(text);
              } catch {
                return;
              }
              if (!parsed || typeof parsed !== "object") return;
              const e = parsed as { type?: unknown; response?: { usage?: unknown } | null };
              if (e.type === "response.completed") paid.finalUsage = usageRecord(e.response?.usage);
            };
            const lines = (atEnd: boolean) => {
              let at: number;
              while ((at = pendingText.search(/[\r\n]/)) >= 0) {
                // A CR ending the buffer may be the first half of a CRLF: wait for the next chunk.
                if (pendingText[at] === "\r" && at === pendingText.length - 1 && !atEnd) return;
                const line = pendingText.slice(0, at);
                pendingText = pendingText.slice(at + (pendingText.startsWith("\r\n", at) ? 2 : 1));
                if (line === "") event();
                else if (line.startsWith("data:"))
                  dataLines.push(line.slice(line[5] === " " ? 6 : 5));
              }
            };
            // End of input, run once on every end of the upstream stream (normal end, client
            // disconnect, abort, error) before settlement is decided.
            let inputEnded = false;
            endOfInput = () => {
              if (inputEnded) return;
              inputEnded = true;
              if (eventStream) {
                pendingText += decoder.decode();
                lines(true);
                // Data lines never closed by a blank line, and a last data line never
                // terminated, form one final event.
                if (pendingText.startsWith("data:"))
                  dataLines.push(pendingText.slice(pendingText[5] === " " ? 6 : 5));
                pendingText = "";
                event();
              } else if (kept) {
                // A complete non-streaming JSON body carries its final usage record at top level.
                try {
                  const whole = JSON.parse(Buffer.concat(kept).toString("utf8")) as {
                    usage?: unknown;
                  } | null;
                  paid.finalUsage = usageRecord(whole?.usage);
                } catch {
                  // No final usage record: maxCost stays charged.
                }
              }
            };
            let bytes = 0;
            const limit = new Transform({
              transform(chunk: Buffer, _encoding, callback) {
                // Parsed before the size check, so a final usage record in the chunk that
                // crosses maxResponseBytes still settles; that chunk is still never forwarded.
                if (eventStream) {
                  pendingText += decoder.decode(chunk, { stream: true });
                  lines(false);
                }
                kept?.push(chunk);
                bytes += chunk.length;
                if (bytes > c.maxResponseBytes) {
                  callback(new Refusal("RESPONSE_TOO_LARGE", 502));
                  return;
                }
                callback(null, chunk);
              },
              flush(callback) {
                endOfInput?.();
                callback();
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
            // At most one settlement per reservation, only from a final usage record, completed
            // before the connection resolves; without one, maxCost stays charged. The journal is
            // a best-effort local recovery record and never gates settle: an attempt line before
            // settle, a completion line after it succeeds, so a failed settle stays open for a
            // retry.
            endOfInput?.();
            endOfInput = undefined;
            const paid = settlement;
            settlement = undefined;
            if (paid?.finalUsage) {
              const { reservationId, maxCost, finalUsage: actual } = paid,
                grantId = paid.permit.grantId,
                boundExceeded = actual.totalTokens > maxCost,
                at = () => new Date().toISOString();
              const record = async (line: object) => {
                if (!(await appendJournal(c.settlementJournalPath, line)))
                  process.stderr.write(
                    `inference-gateway: journal append failed for reservation ${reservationId}\n`,
                  );
              };
              await record({ reservationId, grantId, maxCost, actual, at: at() });
              // The input bound is monitored, not trusted: an overrun is charged and recorded.
              if (boundExceeded)
                await record({
                  reservationId,
                  grantId,
                  event: "BOUND_EXCEEDED",
                  maxCost,
                  actual,
                  at: at(),
                });
              // The settle call carries the overrun, so the ledger records it durably.
              await Promise.resolve()
                .then(() =>
                  d.settle(paid.permit, { reservationId, maxCost, ...actual, boundExceeded }),
                )
                .then(
                  () => record({ reservationId, grantId, settled: true, at: at() }),
                  () => undefined,
                );
            }
            resolve();
          }
        },
      );
      server.on("clientError", () => {
        rawFailure(new Refusal("INVALID_HTTP_FRAMING", 400));
        end();
      });
      // Header bytes are bounded by the parser; do not silently truncate the header map and
      // thereby lose connection-nominated fields that must be stripped.
      server.maxHeadersCount = 0;
      server.on("checkContinue", (_req, res) => {
        res.writeHead(400, { connection: "close" });
        res.end(failureBody(new Refusal("EXPECT_REFUSED", 400)));
        socket.destroySoon();
        end();
      });
      server.on("connect", () => {
        rawFailure(new Refusal("CONNECT_REFUSED", 400));
        end();
      });
      server.on("upgrade", () => {
        rawFailure(new Refusal("UPGRADE_REFUSED", 400));
        end();
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

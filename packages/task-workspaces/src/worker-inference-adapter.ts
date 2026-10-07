import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { lstat, readlink } from "node:fs/promises";
import { dirname, isAbsolute, normalize } from "node:path";
import { assertProtectedPath } from "./protected-files.ts";
export type WorkerInferenceAdapterOptions = {
  gatewaySocket: string;
  gatewayUid: number;
  /** Captured by trusted launcher in the host namespace, never an agent/message claim. */
  hostNetworkNamespace: string;
  requestTimeoutMs: number;
};
function optionsValid(
  options: Pick<WorkerInferenceAdapterOptions, "gatewaySocket" | "requestTimeoutMs">,
) {
  if (
    !isAbsolute(options.gatewaySocket) ||
    normalize(options.gatewaySocket) !== options.gatewaySocket ||
    options.gatewaySocket.includes("\0") ||
    !Number.isSafeInteger(options.requestTimeoutMs) ||
    options.requestTimeoutMs < 1 ||
    options.requestTimeoutMs > 900000
  )
    throw Error("INVALID_INFERENCE_ADAPTER_OPTIONS");
}
function headers(input: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const denied = new Set([
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "host",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "expect",
    "forwarded",
    ...String(input.connection ?? "")
      .toLowerCase()
      .split(",")
      .map((x) => x.trim()),
  ]);
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key]) => !denied.has(key.toLowerCase()) && !/^(proxy-|x-forwarded-)/i.test(key),
    ),
  );
}

/** Protocol translation only. The production listener below owns namespace/socket admission. */
export function forwardWorkerInference(
  request: IncomingMessage,
  response: ServerResponse,
  options: Pick<WorkerInferenceAdapterOptions, "gatewaySocket" | "requestTimeoutMs">,
): void {
  optionsValid(options);
  if (request.method !== "POST" || !["/responses", "/v1/responses"].includes(request.url ?? "")) {
    request.resume();
    response.writeHead(403, { "content-type": "application/json", connection: "close" });
    response.end('{"error":"INFERENCE_ROUTE_REFUSED"}');
    return;
  }
  let settled = false;
  const fail = (status: number, code: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    upstream.destroy();
    if (response.destroyed) return;
    if (response.headersSent) response.destroy();
    else {
      response.writeHead(status, { "content-type": "application/json", connection: "close" });
      response.end(JSON.stringify({ error: code }));
    }
  };
  const upstream = http.request(
    {
      socketPath: options.gatewaySocket,
      path: request.url!,
      method: "POST",
      headers: { ...headers(request.headers), connection: "close" },
      agent: false,
    },
    (incoming) => {
      if (settled) {
        incoming.destroy();
        return;
      }
      response.writeHead(incoming.statusCode ?? 502, {
        ...headers(incoming.headers),
        connection: "close",
      });
      incoming.on("error", () => fail(502, "INFERENCE_STREAM_FAILED"));
      incoming.on("aborted", () => fail(502, "INFERENCE_STREAM_FAILED"));
      incoming.on("end", () => {
        settled = true;
        clearTimeout(timer);
      });
      incoming.pipe(response);
    },
  );
  const timer = setTimeout(() => fail(504, "INFERENCE_TIMEOUT"), options.requestTimeoutMs);
  upstream.on("error", () => fail(502, "INFERENCE_CAPABILITY_UNAVAILABLE"));
  request.on("aborted", () => fail(499, "INFERENCE_CLIENT_ABORTED"));
  request.on("error", () => fail(400, "INFERENCE_INPUT_FAILED"));
  response.on("error", () => fail(499, "INFERENCE_CLIENT_ABORTED"));
  response.on("close", () => {
    if (!settled) {
      settled = true;
      clearTimeout(timer);
      upstream.destroy();
    }
  });
  request.pipe(upstream);
}

/** Host namespace reference is supplied by the protected launcher. The gateway must
 * independently authorize the current Unix peer and its isolated namespace. */
export async function startWorkerInferenceAdapter(
  value: WorkerInferenceAdapterOptions,
): Promise<{ baseUrl: string; close(): Promise<void> }> {
  if (
    !value ||
    Object.keys(value).some(
      (key) =>
        !["gatewaySocket", "gatewayUid", "hostNetworkNamespace", "requestTimeoutMs"].includes(key),
    )
  )
    throw Error("INVALID_INFERENCE_ADAPTER_OPTIONS");
  const options = structuredClone(value);
  optionsValid(options);
  if (process.platform !== "linux") throw Error("LINUX_INFERENCE_ADAPTER_REQUIRED");
  if (!/^net:\[[0-9]+\]$/.test(options.hostNetworkNamespace))
    throw Error("HOST_NETWORK_REFERENCE_REQUIRED");
  if ((await readlink("/proc/self/ns/net")) === options.hostNetworkNamespace)
    throw Error("PRIVATE_NETWORK_REQUIRED");
  if (!Number.isSafeInteger(options.gatewayUid) || options.gatewayUid < 0)
    throw Error("GATEWAY_OWNER_REQUIRED");
  await assertProtectedPath(dirname(options.gatewaySocket), options.gatewayUid);
  const socket = await lstat(options.gatewaySocket);
  if (!socket.isSocket() || socket.uid !== options.gatewayUid)
    throw Error("GATEWAY_SOCKET_REFUSED");
  const sockets = new Set<Socket>();
  const server = http.createServer({ maxHeaderSize: 16384 }, (request, response) =>
    forwardWorkerInference(request, response, options),
  );
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (_req, socket) => socket.destroy());
  server.on("connect", (_req, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("INFERENCE_LISTENER_UNAVAILABLE");
  let closing: Promise<void> | undefined;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      (closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
      })),
  };
}

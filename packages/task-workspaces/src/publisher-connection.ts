import type { Readable, Writable } from "node:stream";
import type { KernelPeer } from "./publisher-ipc.ts";

type Options = {
  input: Readable;
  output: Writable;
  environment: Record<string, string | undefined>;
  maxBytes: number;
  readTimeoutMs: number;
  dispatch: (peer: KernelPeer, bytes: Uint8Array) => Promise<unknown>;
};
class ConnectionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
function peer(environment: Options["environment"]): KernelPeer {
  const values = ["THROUGHL_PEER_UID", "THROUGHL_PEER_GID", "THROUGHL_PEER_PID"].map((key) => {
    const value = environment[key];
    if (!value || !/^\d+$/.test(value)) throw new ConnectionError("KERNEL_PEER_REQUIRED");
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > 0xffffffff)
      throw new ConnectionError("KERNEL_PEER_REQUIRED");
    return number;
  });
  if (values[2] === 0) throw new ConnectionError("KERNEL_PEER_REQUIRED");
  return { uid: values[0]!, gid: values[1]!, pid: values[2]! };
}
function readFrame(input: Readable, maxBytes: number, timeout: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0,
      finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      input.off("data", data);
      input.off("end", end);
      input.off("error", failed);
      if (error) {
        input.pause();
        input.destroy();
        reject(error);
      } else resolve(Buffer.concat(chunks, bytes));
    };
    const data = (chunk: Buffer | string) => {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += part.length;
      if (bytes > maxBytes) return finish(new ConnectionError("REQUEST_SIZE_REFUSED"));
      chunks.push(part);
    };
    const end = () => finish();
    const failed = () => finish(new ConnectionError("REQUEST_READ_FAILED"));
    const timer = setTimeout(() => finish(new ConnectionError("REQUEST_READ_TIMEOUT")), timeout);
    input.on("data", data);
    input.once("end", end);
    input.once("error", failed);
  });
}

/** Invoked only by a protected service composed behind native peer-exec; environment alone is not authentication. */
export async function servePublisherConnection(options: Options): Promise<void> {
  if (
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 1 ||
    options.maxBytes > 1024 * 1024 ||
    !Number.isSafeInteger(options.readTimeoutMs) ||
    options.readTimeoutMs < 1
  )
    throw new ConnectionError("INVALID_CONNECTION_LIMIT");
  let response: unknown;
  try {
    const identity = peer(options.environment);
    // Deadline bounds only request input, never silently cancels a publication already underway.
    const bytes = await readFrame(options.input, options.maxBytes, options.readTimeoutMs);
    response = await options.dispatch(identity, bytes);
  } catch (error) {
    response = {
      ok: false,
      error: { code: error instanceof ConnectionError ? error.code : "INTERNAL_ERROR" },
    };
  }
  await new Promise<void>((resolve, reject) => {
    options.output.write(JSON.stringify(response) + "\n", (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

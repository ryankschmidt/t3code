import type { Readable, Writable } from "node:stream";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import type { ExecutionBinding } from "./systemd-execution.ts";
export type BootstrapOptions = {
  binding: ExecutionBinding;
  expiresAt: number;
  input: Readable;
  output: Writable;
  timeoutMs?: number;
  launch: (input: Readable, output: Writable) => Promise<number>;
};
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}
export function bootstrapDigest(binding: ExecutionBinding, expiresAt: number): string {
  if (
    !binding ||
    Object.keys(binding).some((k) => !["agentId", "taskId", "runId"].includes(k)) ||
    !identifier(binding.agentId) ||
    !identifier(binding.taskId) ||
    !identifier(binding.runId) ||
    !Number.isSafeInteger(expiresAt)
  )
    throw Error("INVALID_BOOTSTRAP_BINDING");
  return createHash("sha256")
    .update(
      JSON.stringify({
        agentId: binding.agentId,
        taskId: binding.taskId,
        runId: binding.runId,
        expiresAt,
      }),
    )
    .digest("hex");
}

/** Consumes one bounded control line and preserves already-buffered native protocol bytes. */
export function readBootstrapFrame(
  input: Readable,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let collected = Buffer.alloc(0),
      complete = false;
    const cleanup = () => {
      clearTimeout(timer);
      input.off("data", data);
      input.off("end", ended);
      input.off("error", failed);
      input.pause();
    };
    const fail = (code: string) => {
      if (complete) return;
      complete = true;
      cleanup();
      reject(Error(code));
    };
    const ended = () => fail("BOOTSTRAP_CONTROL_EOF");
    const failed = () => fail("BOOTSTRAP_CONTROL_IO");
    const data = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const newline = bytes.indexOf(10);
      const head = newline < 0 ? bytes : bytes.subarray(0, newline);
      if (collected.length + head.length > 4096) return fail("BOOTSTRAP_CONTROL_TOO_LARGE");
      collected = Buffer.concat([collected, head]);
      if (newline < 0) return;
      complete = true;
      cleanup();
      const rest = bytes.subarray(newline + 1);
      if (rest.length) input.unshift(rest);
      try {
        const value: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(collected),
        );
        if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
        resolve(value as Record<string, unknown>);
      } catch {
        reject(Error("INVALID_BOOTSTRAP_CONTROL"));
      }
    };
    const timer = setTimeout(() => fail("BOOTSTRAP_CONTROL_TIMEOUT"), timeoutMs);
    input.on("data", data);
    input.once("end", ended);
    input.once("error", failed);
    input.resume();
  });
}
function writeFrame(output: Writable, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    output.write(JSON.stringify(value) + "\n", (error) => (error ? reject(error) : resolve()));
  });
}

/** Runs under the execution identity. Only its trusted controller owns the control input before release. */
export async function runWorkerBootstrap(options: BootstrapOptions): Promise<number> {
  const binding = structuredClone(options.binding),
    expiresAt = options.expiresAt;
  const digest = bootstrapDigest(binding, expiresAt),
    timeoutMs = options.timeoutMs ?? 30000;
  if (!process.getuid || process.getuid() === 0) throw Error("UNPRIVILEGED_BOOTSTRAP_REQUIRED");
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30000 ||
    expiresAt <= Date.now() ||
    expiresAt - Date.now() > 86400000
  )
    throw Error("BOOTSTRAP_DEADLINE_REFUSED");
  let outputError: Error | undefined;
  const observeOutputError = (error: Error) => {
    outputError = error;
  };
  options.output.on("error", observeOutputError);
  try {
    await writeFrame(options.output, {
      schema: "throughline.worker-ready.v1",
      digest,
      pid: process.pid,
      uid: process.getuid(),
    });
    const frame = await readBootstrapFrame(
      options.input,
      Math.min(timeoutMs, expiresAt - Date.now()),
    );
    if (
      Object.keys(frame).some((k) => !["schema", "digest", "grantId", "expiresAt"].includes(k)) ||
      frame.schema !== "throughline.worker-release.v1" ||
      frame.digest !== digest ||
      frame.expiresAt !== expiresAt ||
      !identifier(frame.grantId)
    )
      throw Error("BOOTSTRAP_RELEASE_REFUSED");
    if (outputError || options.output.destroyed || expiresAt <= Date.now())
      throw Error("BOOTSTRAP_RELEASE_UNAVAILABLE");
    await writeFrame(options.output, {
      schema: "throughline.worker-released.v1",
      digest,
      grantId: frame.grantId,
    });
    if (outputError) throw outputError;
    return await options.launch(options.input, options.output);
  } finally {
    options.output.off("error", observeOutputError);
  }
}

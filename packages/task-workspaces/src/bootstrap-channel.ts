import type { Readable, Writable } from "node:stream";
import type { ExecutionBinding } from "./systemd-execution.ts";
import { bootstrapDigest, readBootstrapFrame } from "./worker-bootstrap.ts";

/** Owns one live controller channel, not durable task progress. Reconnection is an owning transport concern. */
export class BootstrapChannel {
  private readonly digest: string;
  private readyPromise?: Promise<{ pid: number; uid: number }>;
  private releasePromise?: Promise<void>;
  private releasedGrant?: string;
  private released = false;
  private inputError?: Error;
  private outputError?: Error;
  constructor(
    private readonly input: Writable,
    private readonly output: Readable,
    binding: ExecutionBinding,
    private readonly expiresAt: number,
  ) {
    this.digest = bootstrapDigest(binding, expiresAt);
    // A write callback rejection does not consume Writable's later error event.
    const onError = (error: Error) => {
      this.inputError = error;
    };
    this.input.on("error", onError);
    this.input.once("close", () => this.input.off("error", onError));
    const onOutputError = (error: Error) => {
      this.outputError = error;
    };
    this.output.on("error", onOutputError);
    this.output.once("close", () => this.output.off("error", onOutputError));
  }
  ready(): Promise<{ pid: number; uid: number }> {
    return (this.readyPromise ??= (async () => {
      const frame = await readBootstrapFrame(this.output, 30000);
      if (
        frame.schema !== "throughline.worker-ready.v1" ||
        frame.digest !== this.digest ||
        !Number.isSafeInteger(frame.pid) ||
        Number(frame.pid) <= 0 ||
        !Number.isSafeInteger(frame.uid) ||
        Number(frame.uid) <= 0
      )
        throw Error("BOOTSTRAP_READY_MISMATCH");
      return { pid: Number(frame.pid), uid: Number(frame.uid) };
    })());
  }
  release(grantId: string): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(grantId))
      return Promise.reject(Error("INVALID_GRANT_IDENTIFIER"));
    if (this.releasedGrant && this.releasedGrant !== grantId)
      return Promise.reject(Error("BOOTSTRAP_RELEASE_REUSED"));
    this.releasedGrant = grantId;
    // A failed acknowledgement is sticky: never inject another control line into possible provider traffic.
    return (this.releasePromise ??= (async () => {
      await this.ready();
      if (this.inputError || this.outputError || this.input.destroyed || this.output.destroyed)
        throw Error("BOOTSTRAP_CONTROL_UNAVAILABLE");
      if (Date.now() >= this.expiresAt) throw Error("BOOTSTRAP_DEADLINE_REFUSED");
      await new Promise<void>((resolve, reject) =>
        this.input.write(
          JSON.stringify({
            schema: "throughline.worker-release.v1",
            digest: this.digest,
            grantId,
            expiresAt: this.expiresAt,
          }) + "\n",
          (error) => (error ? reject(error) : resolve()),
        ),
      );
      const frame = await readBootstrapFrame(
        this.output,
        Math.min(30000, this.expiresAt - Date.now()),
      );
      if (
        frame.schema !== "throughline.worker-released.v1" ||
        frame.digest !== this.digest ||
        frame.grantId !== grantId
      )
        throw Error("BOOTSTRAP_RELEASE_MISMATCH");
      this.released = true;
    })());
  }
  providerStreams() {
    if (!this.released) throw Error("PROVIDER_NOT_RELEASED");
    if (this.inputError || this.outputError || this.input.destroyed || this.output.destroyed)
      throw Error("EXECUTION_CHANNEL_UNAVAILABLE");
    // Output remains paused to preserve coalesced bytes until the consumer attaches and resumes/pipes.
    return { input: this.input, output: this.output };
  }
}

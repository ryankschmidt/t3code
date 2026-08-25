import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import {
  COMSNET_DISPATCH_ACK_TIMEOUT_MS,
  dispatchWithLifecycleResult,
  withComsNetDispatchAckTimeout,
} from "./handlers.ts";
import { COMSNET_REQUEST_LEASE_MS, ComsNetTransportError } from "../../ComsNetTransport.ts";

describe("ComsNet dispatch failure finalization", () => {
  it("keeps the dispatch acknowledgement timeout inside the durable request lease", () => {
    expect(COMSNET_DISPATCH_ACK_TIMEOUT_MS).toBe(Math.floor(COMSNET_REQUEST_LEASE_MS * 0.75));
  });

  it("records one terminal failure before propagating the dispatch error", async () => {
    const recorded: Array<string> = [];
    const dispatchError = new Error("receiver dispatch failed");

    await expect(
      Effect.runPromise(
        dispatchWithLifecycleResult(
          Effect.fail(dispatchError),
          () => Effect.void,
          (message) =>
            Effect.sync(() => {
              recorded.push(message);
            }),
        ),
      ),
    ).rejects.toThrow("receiver dispatch failed");

    expect(recorded).toEqual(["receiver dispatch failed"]);
  });

  it("records successful dispatch before returning the sent request", async () => {
    const lifecycle: Array<string> = [];

    const result = await Effect.runPromise(
      dispatchWithLifecycleResult(
        Effect.succeed("turn-dispatched"),
        () => Effect.sync(() => lifecycle.push("delivered")),
        (message) => Effect.sync(() => lifecycle.push(`failed:${message}`)),
      ),
    );

    expect(result).toBe("turn-dispatched");
    expect(lifecycle).toEqual(["delivered"]);
  });

  it("turns an orchestration queue stall into one honest dispatch failure before the queue lease", async () => {
    const recorded: Array<string> = [];

    await expect(
      Effect.runPromise(
        dispatchWithLifecycleResult(
          withComsNetDispatchAckTimeout(Effect.never, 5),
          () => Effect.void,
          (message) =>
            Effect.sync(() => {
              recorded.push(message);
            }),
        ),
      ),
    ).rejects.toThrow(/timed out/i);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatch(/timed out/i);
  });

  it("preserves the original dispatch error when a terminal race settles the request first", async () => {
    const dispatchError = new Error("receiver dispatch timed out");

    await expect(
      Effect.runPromise(
        dispatchWithLifecycleResult(
          Effect.fail(dispatchError),
          () => Effect.void,
          () =>
            Effect.fail(
              new ComsNetTransportError({
                code: "ALREADY_TERMINAL",
                message: "terminal race settled elsewhere",
              }),
            ),
        ),
      ),
    ).rejects.toThrow("receiver dispatch timed out");
  });
});

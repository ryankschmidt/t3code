// @effect-diagnostics nodeBuiltinImport:off
import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import * as Effect from "effect/Effect";
import { makeSupervisedProcessHandle } from "./SupervisedProcess.ts";

test("failed owner cleanup retains stream error handling until the live streams close", async () => {
  const input = new PassThrough(),
    output = new PassThrough(),
    error = new PassThrough();
  await assert.rejects(
    Effect.runPromise(
      Effect.scoped(
        makeSupervisedProcessHandle({
          pid: 123,
          input,
          output,
          error,
          exit: new Promise(() => {}),
          isRunning: async () => true,
          stop: async () => {
            throw Error("OWNED_CLEANUP_STILL_PENDING");
          },
        }),
      ),
    ),
  );
  // A failed stop did not terminate the process; its pipe may fail afterwards.
  // Emission must not become an uncaught exception in the owning runtime.
  assert.doesNotThrow(() => output.emit("error", Error("LATE_LIVE_PROCESS_PIPE_ERROR")));
  input.destroy();
  output.destroy();
  error.destroy();
});

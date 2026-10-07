import type { Readable, Writable } from "node:stream";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Sink from "effect/Sink";
import * as Duration from "effect/Duration";
import * as PlatformError from "effect/PlatformError";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as NodeStream from "@effect/platform-node/NodeStream";
import * as NodeSink from "@effect/platform-node/NodeSink";

export type SupervisedProcessInput = {
  /** Inspected worker PID, never the systemd-run transport PID. */
  pid: number;
  input: Writable;
  output: Readable;
  error: Readable;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  isRunning: () => Promise<boolean>;
  /** The owning supervisor performs invocation-checked cleanup and reports failure. */
  stop: () => Promise<void>;
};
const failure = (method: string, cause?: unknown) =>
  PlatformError.systemError({
    _tag: "Unknown",
    module: "SupervisedProcess",
    method,
    description: "Owned supervised transport operation failed",
    cause,
  });
const unsupported = (method: string) =>
  PlatformError.badArgument({
    module: "SupervisedProcess",
    method,
    description: "Capability is not supplied by the supervised process owner",
  });
const Pid = Schema.Int.check(Schema.isGreaterThan(0));
const ExitStatus = Schema.Struct({
  code: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  signal: Schema.NullOr(Schema.String),
});

type ErrorGuard = { last?: Error; observers: Set<(error: Error) => void> };
const errorGuards = new WeakMap<Readable | Writable, ErrorGuard>();
function protectErrors(stream: Readable | Writable, observer: (error: Error) => void) {
  if (stream.closed) return () => {};
  let guard = errorGuards.get(stream);
  if (!guard) {
    guard = { observers: new Set() };
    errorGuards.set(stream, guard);
    const owned = guard;
    const onError = (error: Error) => {
      owned.last = error;
      for (const notify of owned.observers) notify(error);
    };
    stream.on("error", onError);
    stream.once("close", () => {
      stream.off("error", onError);
      owned.observers.clear();
      errorGuards.delete(stream);
    });
  }
  guard.observers.add(observer);
  if (guard.last) observer(guard.last);
  const owned = guard;
  return () => {
    owned.observers.delete(observer);
  };
}

/** Translates an already-granted channel. It never spawns, grants authority, or kills a PID. */
export const makeSupervisedProcessHandle = Effect.fn("makeSupervisedProcessHandle")(function* (
  supplied: SupervisedProcessInput,
): Effect.fn.Return<
  ChildProcessSpawner.ChildProcessHandle,
  PlatformError.PlatformError,
  Scope.Scope
> {
  const input = {
    pid: supplied.pid,
    input: supplied.input,
    output: supplied.output,
    error: supplied.error,
    exit: supplied.exit,
    isRunning: supplied.isRunning.bind(supplied),
    stop: supplied.stop.bind(supplied),
  };
  const pid = yield* Schema.decodeUnknownEffect(Pid)(input.pid).pipe(
    Effect.mapError((error) => failure("pid", error)),
  );
  if (
    input.input.writableObjectMode ||
    input.output.readableObjectMode ||
    input.error.readableObjectMode ||
    input.output.readableEncoding !== null ||
    input.error.readableEncoding !== null
  )
    return yield* Effect.fail(unsupported("binary-streams"));
  let stopPromise: Promise<void> | undefined,
    closed = false;
  const stop = () => (stopPromise ??= Promise.resolve().then(() => input.stop()));
  const stopEffect = Effect.tryPromise({ try: stop, catch: (error) => failure("stop", error) });
  const errors: {
    stdin?: PlatformError.PlatformError;
    stdout?: PlatformError.PlatformError;
    stderr?: PlatformError.PlatformError;
  } = {};
  const onInput = (error: Error) => {
    errors.stdin = failure("stdin", error);
  };
  const onOutput = (error: Error) => {
    errors.stdout = failure("stdout", error);
  };
  const onError = (error: Error) => {
    errors.stderr = failure("stderr", error);
  };
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      return [
        protectErrors(input.input, onInput),
        protectErrors(input.output, onOutput),
        protectErrors(input.error, onError),
      ];
    }),
    (unsubscribe) =>
      Effect.gen(function* () {
        closed = true;
        // Drop this scope's observers, not the live stream's one bounded error guard.
        // Only an actual close event releases that protection, regardless of stop outcome.
        yield* stopEffect.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              for (const off of unsubscribe) off();
            }),
          ),
          Effect.orDie,
        );
      }),
  );
  // Capture the promise once, including rejection, without synthesizing a status from stream EOF.
  const observedExit = Promise.resolve(input.exit).then(
    (value) => ({ ok: true as const, value: { ...value } }),
    (cause) => ({ ok: false as const, cause }),
  );
  const exitCode = Effect.gen(function* () {
    const result = yield* Effect.promise(() => observedExit);
    if (!result.ok) return yield* Effect.fail(failure("exitCode", result.cause));
    const status = yield* Schema.decodeUnknownEffect(ExitStatus)(result.value).pipe(
      Effect.mapError((error) => failure("exitCode", error)),
    );
    if (status.signal !== null || status.code === null)
      return yield* Effect.fail(failure("exitCode", { code: status.code, signal: status.signal }));
    return ChildProcessSpawner.ExitCode(status.code);
  });
  const stdout = Stream.unwrap(
    Effect.suspend(() =>
      closed
        ? Effect.fail(failure("scope-closed"))
        : errors.stdout
          ? Effect.fail(errors.stdout)
          : Effect.succeed(
              NodeStream.fromReadable<Uint8Array, PlatformError.PlatformError>({
                evaluate: () => input.output,
                onError: (error) => failure("stdout", error),
                closeOnDone: false,
              }),
            ),
    ),
  );
  const stderrSource = Stream.unwrap(
    Effect.suspend(() =>
      closed
        ? Effect.fail(failure("scope-closed"))
        : errors.stderr
          ? Effect.fail(errors.stderr)
          : Effect.succeed(
              NodeStream.fromReadable<Uint8Array, PlatformError.PlatformError>({
                evaluate: () => input.error,
                onError: (error) => failure("stderr", error),
                closeOnDone: false,
              }),
            ),
    ),
  ).pipe(
    Stream.flatMap((chunk) =>
      Stream.fromIterable(
        (function* () {
          for (let offset = 0; offset < chunk.length; offset += 4096)
            yield chunk.slice(offset, offset + 4096);
        })(),
      ),
    ),
    Stream.rechunk(1),
  );
  // One source subscription, bounded backpressure and bounded recent replay. Late subscribers do
  // not receive unlimited history. Lifetime remains the bridge scope, not either observer.
  const stderr = yield* Stream.share(stderrSource, {
    capacity: 64,
    replay: 64,
    strategy: "suspend",
    idleTimeToLive: Duration.infinity,
  });
  const stdin = Sink.unwrap(
    Effect.suspend(() =>
      closed || stopPromise
        ? Effect.fail(failure("stdin-closed"))
        : errors.stdin
          ? Effect.fail(errors.stdin)
          : Effect.succeed(
              NodeSink.fromWritable<PlatformError.PlatformError, Uint8Array>({
                evaluate: () => input.input,
                onError: (error) => failure("stdin", error),
                endOnDone: false,
              }),
            ),
    ),
  );
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(pid),
    exitCode,
    isRunning: Effect.suspend(() =>
      closed
        ? Effect.fail(failure("scope-closed"))
        : Effect.tryPromise({
            try: () => input.isRunning(),
            catch: (error) => failure("isRunning", error),
          }).pipe(
            Effect.flatMap((value) => Schema.decodeUnknownEffect(Schema.Boolean)(value)),
            Effect.mapError((error) => failure("isRunning", error)),
          ),
    ),
    kill: (options) =>
      options && Object.keys(options).length
        ? Effect.fail(unsupported("kill-options"))
        : stopEffect,
    stdin,
    stdout,
    stderr,
    all: Stream.merge(stdout, stderr),
    getInputFd: () => Sink.fail(unsupported("additional-input-fd")),
    getOutputFd: () => Stream.fail(unsupported("additional-output-fd")),
    unref: Effect.fail(unsupported("unref")),
  });
});

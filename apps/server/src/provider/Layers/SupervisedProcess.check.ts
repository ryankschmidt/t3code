// @effect-diagnostics nodeBuiltinImport:off
// Standalone unprivileged Node process fixture; production bridge never spawns or kills a PID.
import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { spawn } from "node:child_process";
import { once } from "node:events";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Fiber from "effect/Fiber";
import * as Native from "../../../../../packages/effect-codex-app-server/src/client.ts";
import { makeSupervisedProcessHandle, type SupervisedProcessInput } from "./SupervisedProcess.ts";

for (const fails of [false, true]) {
  test(`stream error guards survive ${fails ? "failed" : "successful"} stop until actual close`, async () => {
    const input = new PassThrough(),
      output = new PassThrough(),
      error = new PassThrough();
    let stops = 0;
    const program = Effect.runPromise(
      Effect.scoped(
        makeSupervisedProcessHandle({
          pid: 123,
          input,
          output,
          error,
          exit: new Promise(() => {}),
          isRunning: async () => true,
          stop: async () => {
            stops++;
            if (fails) throw Error("STOP_PENDING");
          },
        }),
      ),
    );
    if (fails) await assert.rejects(program);
    else await program;
    assert.equal(stops, 1);
    for (const stream of [input, output, error]) {
      assert.equal(stream.listenerCount("error"), 1);
      assert.doesNotThrow(() => stream.emit("error", Error("LATE_PIPE_ERROR")));
    }
    const closed = [input, output, error].map((stream) => once(stream, "close"));
    input.destroy();
    output.destroy();
    error.destroy();
    await Promise.all(closed);
    for (const stream of [input, output, error]) assert.equal(stream.listenerCount("error"), 0);
  });
}

test("repeated incomplete scopes do not accumulate raw stream error guards", async () => {
  const input = new PassThrough(),
    output = new PassThrough(),
    error = new PassThrough();
  for (let i = 0; i < 4; i++) {
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
              throw Error("STOP_PENDING");
            },
          }),
        ),
      ),
    );
    for (const stream of [input, output, error]) assert.equal(stream.listenerCount("error"), 1);
  }
  const closed = [input, output, error].map((stream) => once(stream, "close"));
  input.destroy();
  output.destroy();
  error.destroy();
  await Promise.all(closed);
  for (const stream of [input, output, error]) assert.equal(stream.listenerCount("error"), 0);
});

function fixture(overrides: Partial<SupervisedProcessInput> = {}) {
  const input = new PassThrough(),
    output = new PassThrough(),
    error = new PassThrough();
  let stops = 0;
  return {
    input,
    output,
    error,
    stops: () => stops,
    owned: {
      pid: 12345,
      input,
      output,
      error,
      exit: new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(() => {}),
      isRunning: async () => true,
      stop: async () => {
        stops++;
      },
      ...overrides,
    },
  };
}

test("paused initial bytes survive and repeated writes do not end provider stdin", async () => {
  const f = fixture();
  f.output.pause();
  f.output.end(Buffer.from([0, 1, 2, 255]));
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeSupervisedProcessHandle(f.owned);
        assert.equal(h.pid, 12345);
        const out = yield* Stream.runCollect(h.stdout);
        assert.deepEqual(
          Buffer.concat(out.map((x) => Buffer.from(x))),
          Buffer.from([0, 1, 2, 255]),
        );
        yield* Stream.run(Stream.make(Buffer.from("first")), h.stdin);
        yield* Stream.run(Stream.make(Buffer.from("second")), h.stdin);
        assert.equal(f.input.writableEnded, false);
        assert.equal(f.input.read().toString(), "firstsecond");
      }),
    ),
  );
  assert.equal(f.stops(), 1);
});

test("stderr source broadcasts complete bytes to simultaneous consumers", async () => {
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeSupervisedProcessHandle(f.owned);
        const left = yield* Stream.runCollect(h.stderr).pipe(Effect.forkScoped);
        const right = yield* Stream.runCollect(h.stderr).pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        f.error.end(Buffer.alloc(65536, 42));
        const a = yield* Fiber.join(left),
          b = yield* Fiber.join(right);
        assert.equal(Buffer.concat(a.map((x) => Buffer.from(x))).length, 65536);
        assert.deepEqual(
          Buffer.concat(a.map((x) => Buffer.from(x))),
          Buffer.concat(b.map((x) => Buffer.from(x))),
        );
      }),
    ),
  );
});

test("nonzero exit preserved, signal and transport failure never become zero", async () => {
  const code = fixture({ exit: Promise.resolve({ code: 7, signal: null }) });
  assert.equal(
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          return yield* (yield* makeSupervisedProcessHandle(code.owned)).exitCode;
        }),
      ),
    ),
    7,
  );
  for (const exit of [
    Promise.resolve({ code: null, signal: "SIGTERM" as const }),
    Promise.resolve({ code: null, signal: null }),
    Promise.reject(Error("transport lost")),
  ]) {
    const f = fixture({ exit });
    await assert.rejects(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            return yield* (yield* makeSupervisedProcessHandle(f.owned)).exitCode;
          }),
        ),
      ),
    );
  }
});

test("explicit kill and scope finalizer share sticky single-flight stop; failures observable", async () => {
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeSupervisedProcessHandle(f.owned);
        yield* Effect.all([h.kill(), h.kill()], { concurrency: "unbounded" });
      }),
    ),
  );
  assert.equal(f.stops(), 1);
  let failures = 0;
  const broken = fixture({
    stop: async () => {
      failures++;
      throw Error("owned stop failed");
    },
  });
  await assert.rejects(Effect.runPromise(Effect.scoped(makeSupervisedProcessHandle(broken.owned))));
  assert.equal(failures, 1);
});

test("unsupported operations fail and stream failures remain typed failures", async () => {
  const f = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeSupervisedProcessHandle(f.owned);
        assert.equal((yield* Effect.exit(h.unref))._tag, "Failure");
        assert.equal((yield* Effect.exit(Stream.runDrain(h.getOutputFd(3))))._tag, "Failure");
        f.output.destroy(Error("output failed"));
        assert.equal((yield* Effect.exit(Stream.runDrain(h.stdout)))._tag, "Failure");
      }),
    ),
  );
});

test("writable backpressure waits for drain and preserves byte order", async () => {
  const writes: Buffer[] = [],
    callbacks: Array<() => void> = [];
  let first!: () => void, second!: () => void;
  const firstWrite = new Promise<void>((r) => (first = r)),
    secondWrite = new Promise<void>((r) => (second = r));
  const input = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      writes.push(Buffer.from(chunk));
      callbacks.push(() => callback());
      if (writes.length === 1) first();
      else second();
    },
  });
  const f = fixture({ input });
  const result = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeSupervisedProcessHandle(f.owned);
        yield* Stream.run(Stream.make(Buffer.from("a"), Buffer.from("b")), h.stdin);
      }),
    ),
  );
  await firstWrite;
  assert.equal(writes.length, 1);
  callbacks[0]!();
  await secondWrite;
  assert.equal(writes.length, 2);
  callbacks[1]!();
  await result;
  assert.equal(Buffer.concat(writes).toString(), "ab");
  assert.equal(input.writableEnded, false);
});

test("stdout EOF does not synthesize successful process exit", async () => {
  let exited!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void,
    eof!: () => void;
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => (exited = resolve),
    ),
    readEof = new Promise<void>((resolve) => (eof = resolve));
  const f = fixture({ exit });
  f.output.end();
  const result = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeSupervisedProcessHandle(f.owned);
        yield* Stream.runDrain(h.stdout);
        assert.equal(yield* h.isRunning, true);
        eof();
        return yield* h.exitCode;
      }),
    ),
  );
  await readEof;
  exited({ code: 9, signal: null });
  assert.equal(await result, 9);
});

test("scope interruption performs owned cleanup exactly once", async () => {
  const f = fixture();
  let ready!: () => void;
  const acquired = new Promise<void>((resolve) => (ready = resolve));
  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        yield* makeSupervisedProcessHandle(f.owned);
        ready();
        return yield* Effect.never;
      }),
    ),
  );
  await acquired;
  await Effect.runPromise(Fiber.interrupt(fiber));
  assert.equal(f.stops(), 1);
});

test(
  "real unprivileged synthetic process is consumed by native Codex client",
  { timeout: 15000 },
  async (t) => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "const r=require('node:readline').createInterface({input:process.stdin});r.on('line',line=>{const m=JSON.parse(line);process.stderr.write('native-stderr\\n');process.stdout.write(JSON.stringify({id:m.id,result:m.params})+'\\n');});",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    });
    let stops = 0;
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
        child.once("error", reject);
      },
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* makeSupervisedProcessHandle({
            pid: child.pid!,
            input: child.stdin,
            output: child.stdout,
            error: child.stderr,
            exit,
            isRunning: async () => child.exitCode === null && child.signalCode === null,
            stop: async () => {
              stops++;
              if (child.exitCode === null && child.signalCode === null) {
                const done = once(child, "exit");
                child.kill("SIGTERM");
                await done;
              }
            },
          });
          const logs = yield* Stream.runCollect(h.stderr).pipe(Effect.forkScoped);
          const context = yield* Layer.build(Native.layerChildProcess(h));
          const client = Context.get(context, Native.CodexAppServerClient);
          assert.deepEqual(yield* client.raw.request("bridge.echo", { text: "first" }), {
            text: "first",
          });
          assert.deepEqual(yield* client.raw.request("bridge.echo", { text: "second" }), {
            text: "second",
          });
          child.stdin.end();
          assert.equal(yield* h.exitCode, 0);
          const chunks = yield* Fiber.join(logs);
          assert.equal(
            Buffer.concat(chunks.map((c) => Buffer.from(c))).toString(),
            "native-stderr\nnative-stderr\n",
          );
        }),
      ),
    );
    assert.equal(stops, 1);
  },
);

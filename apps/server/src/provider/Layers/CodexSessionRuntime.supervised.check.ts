// @effect-diagnostics nodeBuiltinImport:off
// Compiled integration checks own real Node fixture files and processes.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, access, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { ThreadId } from "@t3tools/contracts";
import * as CodexErrors from "effect-codex-app-server/errors";
import { makeCodexSessionRuntime, type CodexSessionRuntimeOptions } from "./CodexSessionRuntime.ts";

const peer = fileURLToPath(new URL("./codex-managed-peer.cjs", import.meta.url));
const threadId = ThreadId.make("managed-thread");
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
async function localPeer(cwd: string, trace: string) {
  const executable = join(cwd, "fixture-codex");
  await writeFile(
    executable,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(peer)} ${quote(trace)} "$@"\n`,
    { mode: 0o700 },
  );
  return executable;
}

test(
  "actual runtime uses the selected managed process and preserves native low effort and resume",
  { timeout: 15000 },
  async () => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), "managed-runtime-"))),
      trace = join(cwd, "native.jsonl");
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
            const options = {
              threadId,
              cwd,
              binaryPath: "/deliberately-absent-local-codex",
              runtimeMode: "full-access",
              model: "gpt-6-astra",
              resumeCursor: { threadId: "preserved-native-thread" },
              supervisedProcess: {
                threadId,
                cwd,
                acquire: spawner
                  .spawn(
                    ChildProcess.make(process.execPath, [peer, trace], {
                      cwd,
                      env: { PATH: "/usr/bin:/bin", LANG: "C" },
                      extendEnv: false,
                    }),
                  )
                  .pipe(
                    Effect.mapError((cause) => new CodexErrors.CodexAppServerSpawnError({ cause })),
                  ),
              },
            } as CodexSessionRuntimeOptions;
            const runtimeEffect = makeCodexSessionRuntime(options);
            // The authority-bound selection cannot drift while acquisition is queued.
            Object.assign(options, { cwd: "/foreign-after-selection" });
            Object.assign(options.supervisedProcess!, { cwd: "/foreign-after-selection" });
            const runtime = yield* runtimeEffect;
            const session = yield* runtime.start();
            assert.equal(session.cwd, cwd);
            const turn = yield* runtime.sendTurn({
              input: "Change the task help text",
              model: "gpt-6-astra",
              effort: "low",
            });
            assert.equal(turn.turnId, "managed-turn");
            assert.deepEqual(turn.resumeCursor, { threadId: "preserved-native-thread" });
          }),
        ).pipe(Effect.provide(NodeServices.layer), Effect.timeout("5 seconds")),
      );
      const messages = (await readFile(trace, "utf8"))
        .trim()
        .split("\n")
        .map((x) => JSON.parse(x));
      assert.deepEqual(
        messages.slice(0, 3).map((m) => m.method),
        ["initialize", "initialized", "thread/resume"],
      );
      const resume = messages.find((m) => m.method === "thread/resume");
      assert.equal(resume.params.threadId, "preserved-native-thread");
      assert.equal(resume.params.cwd, cwd);
      const turn = messages.find((m) => m.method === "turn/start");
      assert.equal(turn.params.effort, "low");
      assert.equal(turn.params.model, "gpt-6-astra");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test("mismatched managed binding refuses before acquisition", { timeout: 5000 }, async () => {
  let acquired = false;
  const options = {
    threadId,
    cwd: "/task/current",
    binaryPath: process.execPath,
    runtimeMode: "full-access",
    supervisedProcess: {
      threadId: ThreadId.make("foreign-thread"),
      cwd: "/task/foreign",
      acquire: Effect.sync(() => {
        acquired = true;
        throw Error("MUST_NOT_ACQUIRE");
      }),
    },
  } as CodexSessionRuntimeOptions;
  await assert.rejects(
    Effect.runPromise(
      Effect.scoped(makeCodexSessionRuntime(options)).pipe(
        Effect.provide(NodeServices.layer),
        Effect.timeout("5 seconds"),
      ),
    ),
    /SUPERVISED_PROCESS_BINDING_MISMATCH/,
  );
  assert.equal(acquired, false);
});

test(
  "explicit null, undefined and failing managed selections never fall back locally",
  { timeout: 10000 },
  async () => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), "managed-refusal-"))),
      trace = join(cwd, "native.jsonl");
    try {
      const binaryPath = await localPeer(cwd, trace);
      for (const selection of [
        null,
        undefined,
        {
          threadId,
          cwd,
          acquire: Effect.fail(
            new CodexErrors.CodexAppServerSpawnError({
              command: "OWNER_UNAVAILABLE",
              cause: new Error("fixture"),
            }),
          ),
        },
      ]) {
        const options = {
          threadId,
          cwd,
          binaryPath,
          runtimeMode: "full-access",
          supervisedProcess: selection,
        } as unknown as CodexSessionRuntimeOptions;
        const selected = makeCodexSessionRuntime(options);
        Reflect.deleteProperty(options, "supervisedProcess");
        await assert.rejects(
          Effect.runPromise(
            Effect.scoped(selected).pipe(
              Effect.provide(NodeServices.layer),
              Effect.timeout("5 seconds"),
            ),
          ),
          /SUPERVISED_PROCESS_BINDING_MISMATCH|OWNER_UNAVAILABLE/,
        );
      }
      await assert.rejects(access(trace), /ENOENT/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test(
  "unmanaged runtime still launches locally and starts its native thread",
  { timeout: 10000 },
  async () => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), "local-runtime-"))),
      trace = join(cwd, "native.jsonl");
    try {
      const binaryPath = await localPeer(cwd, trace);
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* makeCodexSessionRuntime({
              threadId,
              cwd,
              binaryPath,
              runtimeMode: "full-access",
              environment: { PATH: "/usr/bin:/bin", LANG: "C" },
              model: "gpt-6-astra",
            });
            const session = yield* runtime.start();
            assert.equal(session.cwd, cwd);
          }),
        ).pipe(Effect.provide(NodeServices.layer), Effect.timeout("5 seconds")),
      );
      const messages = (await readFile(trace, "utf8"))
        .trim()
        .split("\n")
        .map((x) => JSON.parse(x));
      assert.equal(messages.find((m) => m.method === "thread/start").params.cwd, cwd);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

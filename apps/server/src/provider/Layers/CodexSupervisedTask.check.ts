// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
// @effect-diagnostics globalConsole:off
// Real unprivileged Linux process and file fixtures; no installed-product claim.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Stream from "effect/Stream";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as CodexErrors from "effect-codex-app-server/errors";
import { ThreadId } from "@t3tools/contracts";
import {
  PublicationStore,
  type CheckReceipt,
} from "../../../../../packages/task-workspaces/dist/src/index.js";
import { ExecutionGrantAuthority } from "../../../../../packages/task-workspaces/dist/src/execution-grant-authority.js";
import { attestExecution } from "../../../../../packages/task-workspaces/dist/src/execution-grants.js";
import { BootstrapChannel } from "../../../../../packages/task-workspaces/dist/src/bootstrap-channel.js";
import {
  TaskExecutionSupervisor,
  type SupervisorHost,
  type TaskExecutionInput,
  type DurableExecutionStep,
} from "../../../../../packages/task-workspaces/dist/src/task-execution-supervisor.js";
import { makeSupervisedProcessHandle } from "./SupervisedProcess.ts";
import { makeCodexSessionRuntime } from "./CodexSessionRuntime.ts";

test(
  "registered private task crosses grant gate into actual Codex runtime and checked Git publication",
  {
    skip: process.platform !== "linux" || process.getuid?.() === 0,
    timeout: 20000,
  },
  async (t) => {
    const root = await mkdtemp(join(homedir(), ".tl-native-"));
    const store = new PublicationStore({ root: join(root, "publisher") });
    let child: ChildProcessWithoutNullStreams | undefined;
    let ended: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
    let authority: ExecutionGrantAuthority | undefined;
    try {
      await store.initialize({ "help.txt": "accepted baseline\n", "unrelated.txt": "preserve" });
      await store.openTask({ taskId: "task-a", agentId: "agent-a", scope: ["help.txt"] });
      const authorityRoot = join(root, "authority");
      await mkdir(authorityRoot, { mode: 0o700 });
      authority = await ExecutionGrantAuthority.bootstrap({
        root: authorityRoot,
        authorityUid: process.getuid!(),
      });
      const workspaceRoot = join(root, "tasks"),
        workspace = join(workspaceRoot, "task-a"),
        home = join(root, "home"),
        trace = join(root, "native.jsonl");
      await mkdir(home, { mode: 0o700 });
      const node = "/opt/ship-warden/runtime/bin/node";
      const request: TaskExecutionInput = {
        agentId: "agent-a",
        taskId: "task-a",
        runId: "run-a",
        scope: ["help.txt"],
        expiresAt: Date.now() + 18000,
        grantId: "grant-a",
        issueRequestId: "issue-a",
        revokeRequestId: "revoke-a",
        profile: {
          id: "native-fixture",
          executable: node,
          executableSha256: createHash("sha256")
            .update(await readFile(node))
            .digest("hex"),
          args: [fileURLToPath(new URL("./codex-managed-peer.cjs", import.meta.url)), trace],
          memoryBytes: 128 * 1024 * 1024,
          cpuPercent: 100,
          maxSeconds: 18,
          tasksMax: 32,
        },
      };
      const binding = { agentId: request.agentId, taskId: request.taskId, runId: request.runId };
      let channel: BootstrapChannel | undefined,
        launches = 0,
        stops = 0;
      const host: SupervisorHost = {
        async prepare() {
          return { workspaceRoot, workspacePath: workspace };
        },
        async launch() {
          launches++;
          assert.equal(await authority!.read(request.grantId), null);
          child = spawn(
            node,
            [
              fileURLToPath(new URL("./worker-entry.mjs", import.meta.url)),
              JSON.stringify({
                binding,
                expiresAt: request.expiresAt,
                workspace,
                home,
                executable: node,
                executableSha256: request.profile.executableSha256,
                args: request.profile.args,
              }),
            ],
            {
              cwd: workspace,
              env: { PATH: "/usr/bin:/bin", HOME: home, LANG: "C" },
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          ended = new Promise((resolve, reject) => {
            child!.once("error", reject);
            child!.once("close", (code, signal) => resolve({ code, signal }));
          });
          channel = new BootstrapChannel(child.stdin, child.stdout, binding, request.expiresAt);
          return { requested: true };
        },
        async ready() {
          if (!channel) throw Error("EXECUTION_CHANNEL_UNAVAILABLE");
          return channel.ready();
        },
        async inspect() {
          if (!child || child.exitCode !== null || child.signalCode !== null) return null;
          return {
            invocationId: child.pid!.toString(16).padStart(32, "0"),
            pid: child.pid!,
            identity: await attestExecution(child.pid!),
            workspace,
          };
        },
        async release(_binding, grant) {
          assert.equal((await authority!.read(grant.grantId))?.status, "active");
          assert.equal(
            (await readFile(`/proc/${child!.pid}/task/${child!.pid}/children`, "utf8")).trim(),
            "",
          );
          await channel!.release(grant.grantId);
        },
        async stop(_binding, _profile, invocation) {
          assert.equal(invocation, child!.pid!.toString(16).padStart(32, "0"));
          assert.equal((await authority!.read(request.grantId))?.status, "revoked");
          stops++;
          child!.stdin.end();
          await ended;
        },
      };
      const cache = new Map<string, Promise<unknown>>();
      const step: DurableExecutionStep = async <T>(key: string, work: () => Promise<T>) => {
        if (!cache.has(key)) cache.set(key, work());
        return (await cache.get(key)) as T;
      };
      const supervisor = new TaskExecutionSupervisor({ store, authority, host, step });
      const released = await supervisor.start(request);
      assert.equal(released.status, "provider-released");
      if (released.status !== "provider-released") throw Error("NOT_RELEASED");
      const streams = channel!.providerStreams();
      const threadId = ThreadId.make(request.agentId);
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* makeCodexSessionRuntime({
              threadId,
              cwd: workspace,
              binaryPath: "/never-spawn-locally",
              runtimeMode: "full-access",
              model: "gpt-6-astra",
              supervisedProcess: {
                threadId,
                cwd: workspace,
                acquire: makeSupervisedProcessHandle({
                  pid: released.execution.pid,
                  input: streams.input,
                  output: streams.output,
                  error: child!.stderr,
                  exit: ended!,
                  isRunning: async () => (await host.inspect(binding, request.profile)) !== null,
                  stop: async () => {
                    const result = await supervisor.stop(request);
                    if (result.status !== "stopped") throw Error("OWNED_CLEANUP_UNCONFIRMED");
                  },
                }).pipe(
                  Effect.mapError((cause) => new CodexErrors.CodexAppServerSpawnError({ cause })),
                ),
              },
            });
            const completed = yield* Deferred.make<void>();
            yield* Stream.runForEach(runtime.events, (event) =>
              event.method === "turn/completed"
                ? Deferred.succeed(completed, undefined)
                : Effect.void,
            ).pipe(Effect.forkScoped);
            yield* runtime.start();
            yield* runtime.sendTurn({
              input: "fixture-edit-help",
              model: "gpt-6-astra",
              effort: "low",
            });
            yield* Deferred.await(completed).pipe(Effect.timeout("5 seconds"));
            assert.equal(
              yield* Effect.promise(() => readFile(join(workspace, "help.txt"), "utf8")),
              "native private draft\n",
            );
            assert.equal(
              yield* Effect.promise(() => store.readAccepted("help.txt")),
              "accepted baseline\n",
            );
          }),
        ).pipe(Effect.provide(NodeServices.layer)),
        { signal: t.signal },
      );
      assert.equal(stops, 1);
      assert.equal((await authority.read(request.grantId))?.status, "revoked");
      assert.deepEqual(await ended, { code: 0, signal: null });
      const changes = [
        { path: "help.txt", content: await readFile(join(workspace, "help.txt"), "utf8") },
      ];
      const candidate = await store.preparePublication({ taskId: request.taskId, changes });
      await assert.rejects(
        store.publish({
          taskId: request.taskId,
          requestId: "reject-unchecked",
          changes,
          check: {
            ...candidate,
            passed: false,
            reviewerId: "fixture-reviewer",
          } as unknown as CheckReceipt,
        }),
      );
      assert.equal(await store.readAccepted("help.txt"), "accepted baseline\n");
      const accepted = await store.publish({
        taskId: request.taskId,
        requestId: "accept-checked",
        changes,
        check: { ...candidate, passed: true, reviewerId: "fixture-reviewer" },
      });
      assert.equal(accepted.status, "accepted");
      assert.equal(await store.readAccepted("help.txt"), "native private draft\n");
      assert.equal(await store.readAccepted("unrelated.txt"), "preserve");
      assert.equal(launches, 1);
      const native = (await readFile(trace, "utf8"))
        .trim()
        .split("\n")
        .map((x) => JSON.parse(x));
      assert.equal(native.find((x) => x.method === "turn/start").params.effort, "low");
      console.log(
        JSON.stringify({
          task: request.taskId,
          grantRevoked: true,
          launches,
          stops,
          acceptedRevision: accepted.revision,
          limits:
            "same UID; synthetic peer and fixture reviewer; memory step cache; not installed/UI/Absurd acceptance",
        }),
      );
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await ended?.catch(() => undefined);
      await authority?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeReadline from "node:readline";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  piNativeNavigationSource,
  registerPiNativeNavigation,
  type PiNavigationContext,
} from "./piNativeNavigation.ts";

function fixture(cancelled = false) {
  let entries = ["first", "second", "third"].map((id) => ({
    id,
    type: "message",
    message: { role: "user", content: id },
  }));
  const responses: unknown[] = [];
  let handler!: (args: string, ctx: PiNavigationContext) => Promise<void>;
  registerPiNativeNavigation(
    {
      registerCommand: (_name, command) => {
        handler = command.handler;
      },
    },
    "test-rewind",
    (reply) => responses.push(reply),
  );
  const navigateTree = vi.fn(async (targetId: string, _options: { summarize: false }) => {
    if (!cancelled)
      entries = entries.slice(
        0,
        entries.findIndex((entry) => entry.id === targetId),
      );
    return { cancelled };
  });
  const ctx: PiNavigationContext = {
    ui: { notify: () => {} },
    sessionManager: {
      getSessionId: () => "same-session",
      getSessionFile: () => "same-file",
      getBranch: () => entries,
    },
    isIdle: () => true,
    navigateTree,
  };
  const run = (numTurns: number, sessionId = "same-session") =>
    handler(JSON.stringify({ id: "request", numTurns, sessionId, sessionFile: "same-file" }), ctx);
  return { run, responses, ctx, navigateTree };
}

describe("native Pi navigation bridge", () => {
  it("rejects a native no-op instead of claiming the requested rewind succeeded", async () => {
    const f = fixture();
    f.navigateTree.mockImplementation(async () => ({ cancelled: false }));
    await f.run(1);
    expect(f.responses.at(-1)).toMatchObject({
      success: false,
      error: "Native Pi navigation did not reach the requested turn boundary.",
    });
  });
  it("moves before the selected user turn twice without replacing the session", async () => {
    const f = fixture();
    await f.run(2);
    expect(f.responses.at(-1)).toMatchObject({
      success: true,
      data: {
        sessionId: "same-session",
        sessionFile: "same-file",
        cancelled: false,
        turns: [{ id: "first" }],
      },
    });
    await f.run(1);
    expect(f.responses.at(-1)).toMatchObject({ success: true, data: { turns: [] } });
    expect(f.navigateTree.mock.calls).toEqual([
      ["second", { summarize: false }],
      ["first", { summarize: false }],
    ]);
  });

  it("reports native cancellation without changing or claiming to rewind context", async () => {
    const f = fixture(true);
    await f.run(1);
    expect(f.responses.at(-1)).toMatchObject({
      success: true,
      data: { cancelled: true, turns: [{ id: "first" }, { id: "second" }, { id: "third" }] },
    });
  });

  it("refuses changed identity and a busy session before native navigation", async () => {
    const f = fixture();
    await f.run(1, "other-session");
    expect(f.responses.at(-1)).toMatchObject({ success: false });
    f.ctx.isIdle = () => false;
    await f.run(1);
    expect(f.responses.at(-1)).toMatchObject({ success: false });
    expect(f.navigateTree).not.toHaveBeenCalled();
  });

  it("does not invoke navigation for a read-only snapshot", async () => {
    const f = fixture();
    await f.run(0);
    expect(f.responses.at(-1)).toMatchObject({ success: true, data: { cancelled: false } });
    expect(f.navigateTree).not.toHaveBeenCalled();
  });
});

const nativeBinary = process.env.T3_PI_NATIVE_TEST_BINARY;
it.skipIf(!nativeBinary)(
  "consumes the generated bridge in native Pi RPC: cancellation, repeated root rewind, no model turn",
  async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-native-pi-proof-"));
    const sessionFile = NodePath.join(directory, "session.jsonl");
    const extensionFile = NodePath.join(directory, "navigation.mjs");
    const cancelFile = NodePath.join(directory, "cancel.mjs");
    const sentinelFile = NodePath.join(directory, "external.txt");
    const header = {
      type: "session",
      version: 3,
      id: "d8b7a8a1-1111-4111-8111-123456789012",
      timestamp: "2026-10-09T00:00:00.000Z",
      cwd: directory,
    };
    const entries = [0, 1, 2].flatMap((index) => [
      {
        type: "message",
        id: `user${index}`,
        parentId: index ? `assistant${index - 1}` : null,
        timestamp: "2026-10-09T00:00:00.000Z",
        message: { role: "user", content: `turn ${index}`, timestamp: 0 },
      },
      {
        type: "message",
        id: `assistant${index}`,
        parentId: `user${index}`,
        timestamp: "2026-10-09T00:00:00.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: `reply ${index}` }],
          api: "openai-responses",
          provider: "openai",
          model: "fixture",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 0,
        },
      },
    ]);
    NodeFS.writeFileSync(
      sessionFile,
      [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );
    NodeFS.writeFileSync(extensionFile, piNativeNavigationSource("native-proof-rewind"));
    NodeFS.writeFileSync(
      cancelFile,
      'export default pi => pi.on("session_before_tree", event => event.preparation.targetId === "user2" ? { cancel: true } : undefined);',
    );
    NodeFS.writeFileSync(sentinelFile, "external effects stay unchanged\n");
    const child = NodeChildProcess.spawn(
      process.execPath,
      [
        nativeBinary!,
        "--mode",
        "rpc",
        "--session",
        sessionFile,
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--extension",
        extensionFile,
        "--extension",
        cancelFile,
      ],
      {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          HOME: directory,
          PI_CODING_AGENT_DIR: NodePath.join(directory, "agent"),
          XDG_CONFIG_HOME: directory,
          TMPDIR: directory,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const lines = NodeReadline.createInterface({ input: child.stdout });
    const pending = new Map<
      string,
      { command: string; resolve(value: Record<string, unknown>): void; reject(error: Error): void }
    >();
    const modelEvents: string[] = [];
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    lines.on("line", (line) => {
      let response = JSON.parse(line) as Record<string, unknown>;
      if (
        response.type === "extension_ui_request" &&
        response.method === "notify" &&
        typeof response.message === "string" &&
        response.message.startsWith("throughline-rewind:")
      )
        response = JSON.parse(response.message.slice("throughline-rewind:".length));
      if (["agent_start", "turn_start", "message_start"].includes(String(response.type)))
        modelEvents.push(String(response.type));
      const waiter = pending.get(String(response.id));
      if (waiter && response.command === waiter.command) {
        pending.delete(String(response.id));
        waiter.resolve(response);
      }
    });
    child.on("exit", (code) => {
      for (const waiter of pending.values())
        waiter.reject(new Error(`Native Pi exited ${code}: ${stderr}`));
    });
    let serial = 0;
    const request = (type: string, command = type, args: Record<string, unknown> = {}) => {
      const id = `proof-${++serial}`;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        pending.set(id, { command, resolve, reject });
        child.stdin.write(JSON.stringify({ id, type, ...args }) + "\n");
      });
    };
    const rewind = (numTurns: number) => {
      const id = `proof-${++serial}`;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        pending.set(id, { command: "throughline_rewind", resolve, reject });
        child.stdin.write(
          JSON.stringify({
            id,
            type: "prompt",
            message: `/native-proof-rewind ${JSON.stringify({ id, numTurns, sessionId: header.id, sessionFile })}`,
          }) + "\n",
        );
      });
    };
    try {
      const commands = await request("get_commands");
      expect(commands).toMatchObject({
        success: true,
        data: {
          commands: expect.arrayContaining([
            expect.objectContaining({ name: "native-proof-rewind" }),
          ]),
        },
      });
      expect(await rewind(1)).toMatchObject({
        success: true,
        data: {
          cancelled: true,
          sessionId: header.id,
          sessionFile,
          turns: [{ id: "user0" }, { id: "user1" }, { id: "user2" }],
        },
      });
      expect(await rewind(2)).toMatchObject({
        success: true,
        data: { cancelled: false, sessionId: header.id, sessionFile, turns: [{ id: "user0" }] },
      });
      expect(await rewind(1)).toMatchObject({
        success: true,
        data: { cancelled: false, turns: [] },
      });
      expect(await rewind(1)).toMatchObject({
        success: true,
        data: { cancelled: false, turns: [] },
      });
      expect(await request("get_state")).toMatchObject({
        success: true,
        data: { sessionId: header.id, sessionFile, isStreaming: false, messageCount: 0 },
      });
      expect(modelEvents).toEqual([]);
      expect(NodeFS.readFileSync(sentinelFile, "utf8")).toBe("external effects stay unchanged\n");
      const history = NodeFS.readFileSync(sessionFile, "utf8");
      for (const entry of entries) expect(history).toContain(JSON.stringify(entry));
    } finally {
      child.kill();
      lines.close();
    }
  },
  30_000,
);

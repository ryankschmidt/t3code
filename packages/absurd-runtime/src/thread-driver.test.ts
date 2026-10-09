import type { Absurd } from "absurd-sdk";
import { makeInProcessTransport } from "./in-process-transport.ts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  registerThreadRunTask,
  type ThreadRunParams,
  type ThreadRunResult,
  type ThreadTransport,
} from "./thread-driver.ts";

type TaskContext = {
  readonly taskID: string;
  readonly step: <A>(name: string, run: () => Promise<A>) => Promise<A>;
  readonly heartbeat: () => Promise<void>;
};

type TaskHandler = (params: ThreadRunParams, context: TaskContext) => Promise<ThreadRunResult>;

describe("registerThreadRunTask", () => {
  it("carries supplied trusted context for the transport synthesized command without adding payload identity", async () => {
    const dispatch = vi.fn(
      async (_command: Record<string, unknown>, _context?: unknown) => undefined,
    );
    const transport = makeInProcessTransport({
      dispatchCommand: dispatch,
      replayEvents: async () => [],
      projectId: "fixture",
      instanceId: "fixture",
    });
    const trusted = {
      sender: {
        publicAgentId: "trusted",
        generation: "session",
        nativeKind: "app-session" as const,
        nativeId: "session",
      },
      claims: [],
    };
    await transport.dispatchTurn("thread-1", "prompt", undefined, trusted);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.turn.start",
        message: expect.objectContaining({ text: "prompt" }),
      }),
      trusted,
    );
    expect(dispatch.mock.calls[0]?.[0]).not.toHaveProperty("trustedSenderContext");
    expect(dispatch.mock.calls[0]?.[0].message).not.toHaveProperty("senderPublicId");
  });
  it("carries trusted ingress metadata through the serialized driver and transport, never from turn payload", async () => {
    let handler: TaskHandler | undefined;
    const app = {
      registerTask: (_definition: unknown, run: TaskHandler) => {
        handler = run;
      },
    } as unknown as Absurd;
    const dispatch = vi.fn(async (_command: Record<string, unknown>, _context?: unknown) => ({
      sequence: 1,
    }));
    const transport = makeInProcessTransport({
      dispatchCommand: dispatch,
      replayEvents: async () => [],
      projectId: "fixture",
      instanceId: "fixture",
    });
    registerThreadRunTask(app, transport);
    const trustedSenderContext = {
      sender: {
        publicAgentId: "trusted",
        generation: "session-1",
        nativeKind: "app-session",
        nativeId: "session-1",
      },
      claims: [{ field: "publicAgentId", value: "forged" }],
    };
    const turnCommand = {
      type: "thread.turn.start",
      message: { messageId: "message-1", senderPublicId: "forged", senderGeneration: "forged" },
    };
    const serialized = JSON.parse(
      JSON.stringify({
        prompt: "fixture",
        threadId: "thread-1",
        completionMode: "dispatch-only",
        turnCommand,
        trustedSenderContext,
      }),
    );
    await handler?.(serialized, {
      taskID: "sender-rail",
      step: async (_name, run) => run(),
      heartbeat: async () => undefined,
    });
    expect(dispatch).toHaveBeenCalledWith(turnCommand, trustedSenderContext);
  });
  it("releases the durable worker slot after dispatch for interactive client turns", async () => {
    let handler: TaskHandler | undefined;
    const app = {
      registerTask: (_definition: unknown, registered: TaskHandler) => {
        handler = registered;
      },
    } as unknown as Absurd;
    const transport: ThreadTransport = {
      resolveThread: vi.fn(async () => ({ threadId: "thread-1", created: false })),
      dispatchTurn: vi.fn(async () => ({
        turnId: "turn-1",
        dispatchedAt: "2026-08-27T00:00:00.000Z",
      })),
      awaitTurnComplete: vi.fn(async () => ({ state: "completed" as const, summary: "completed" })),
    };

    registerThreadRunTask(app, transport);

    const result = await handler?.(
      {
        prompt: "hello",
        threadId: "thread-1",
        completionMode: "dispatch-only",
      },
      {
        taskID: "task-1",
        step: async (_name, run) => run(),
        heartbeat: async () => undefined,
      },
    );

    expect(result).toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
      state: "dispatched",
      summary: "turn dispatched; completion is delivered by the provider subscription",
    });
    expect(transport.awaitTurnComplete).not.toHaveBeenCalled();
  });
});

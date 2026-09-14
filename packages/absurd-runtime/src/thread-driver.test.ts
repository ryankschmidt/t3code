import type { Absurd } from "absurd-sdk";
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

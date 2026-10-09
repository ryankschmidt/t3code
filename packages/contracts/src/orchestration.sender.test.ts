import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  OrchestrationEventMetadata,
  OrchestrationMessage,
  ThreadTurnStartCommand,
} from "./orchestration.ts";
const decodeCommand = Schema.decodeUnknownEffect(ThreadTurnStartCommand);
const decodeMetadata = Schema.decodeUnknownEffect(OrchestrationEventMetadata);
const decodeMessage = Schema.decodeUnknownEffect(OrchestrationMessage);

it.effect("retains validation-only sender claims and persisted sender metadata/read fields", () =>
  Effect.gen(function* () {
    const createdAt = "2026-01-01T00:00:00.000Z";
    const command = yield* decodeCommand({
      type: "thread.turn.start",
      commandId: "sender-command",
      threadId: "sender-thread",
      message: {
        messageId: "sender-message",
        role: "user",
        text: "test",
        attachments: [],
        sender_public_id: "claimed",
        sender_generation: "claimed-generation",
      },
      createdAt,
    });
    expect(command.message).toMatchObject({
      sender_public_id: "claimed",
      sender_generation: "claimed-generation",
    });
    const sender = {
      senderPublicId: "authenticated",
      senderGeneration: "authenticated-generation",
    };
    expect(yield* decodeMetadata(sender)).toEqual(sender);
    expect(
      yield* decodeMessage({
        id: "sender-message",
        role: "user",
        text: "test",
        turnId: null,
        streaming: false,
        createdAt,
        updatedAt: createdAt,
        ...sender,
      }),
    ).toMatchObject(sender);
    expect(yield* decodeMetadata({})).toEqual({});
  }),
);

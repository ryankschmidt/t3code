import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { dispatchFromAuthenticatedMcp } from "./handlers.ts";
import {
  CurrentAuthenticatedSender,
  CurrentSenderClaims,
  assertSenderClaims,
} from "../../../throughline/identity/sender-stamp.ts";
import type { McpInvocationScope } from "../../McpInvocationContext.ts";

it.effect(
  "captures the authenticated MCP caller generation and preserves forged fields for engine refusal",
  () =>
    Effect.gen(function* () {
      const scope: McpInvocationScope = {
        environmentId: EnvironmentId.make("mac"),
        threadId: ThreadId.make("sender-thread"),
        providerSessionId: "server-owned-mcp-session",
        providerInstanceId: ProviderInstanceId.make("codex"),
        issuedAt: 1,
        capabilities: new Set(["comsnet"]),
      };
      const command = {
        type: "thread.turn.start" as const,
        commandId: CommandId.make("mcp-command"),
        threadId: ThreadId.make("receiver-thread"),
        message: {
          messageId: MessageId.make("mcp-message"),
          role: "user" as const,
          text: "message",
          attachments: [],
        },
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      const observed: Array<{ readonly publicAgentId: string; readonly generation: string }> = [];
      const engine = {
        dispatch: () =>
          Effect.gen(function* () {
            const sender = yield* CurrentAuthenticatedSender;
            const claims = yield* CurrentSenderClaims;
            yield* assertSenderClaims(sender, claims).pipe(Effect.orDie);
            if (sender === undefined) throw new Error("authenticated sender missing");
            observed.push({ publicAgentId: sender.publicAgentId, generation: sender.generation });
            return { sequence: 1 };
          }),
      };
      const late = dispatchFromAuthenticatedMcp(engine, command, scope, { text: "honest" });
      Object.assign(scope, { issuedAt: 2 });
      yield* late;
      expect(observed).toEqual([
        { publicAgentId: "sender-thread", generation: '["server-owned-mcp-session",1]' },
      ]);
      const forged = yield* Effect.exit(
        dispatchFromAuthenticatedMcp(engine, command, scope, { sender_public_id: "forged" }),
      );
      expect(Exit.isFailure(forged)).toBe(true);
      expect(observed).toHaveLength(1);
    }),
);

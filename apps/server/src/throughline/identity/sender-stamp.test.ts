import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { lookupIdentityAlias } from "./identity-alias.ts";
import {
  senderFromAppSession,
  senderFromMcpScope,
  captureSenderClaims,
  assertSenderClaims,
  stampMessageSender,
  readMessageSender,
} from "./sender-stamp.ts";

it.layer(SqlitePersistenceMemory)("trusted sender persistence", (it) => {
  it.effect(
    "stamps authenticated app/MCP identity and never rewrites a message to a new generation",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const app = senderFromAppSession({
          subject: "authenticated-subject",
          sessionId: "app-session-1",
        });
        const old = senderFromMcpScope({
          threadId: "public-agent",
          providerSessionId: "mcp-capability-session",
          issuedAt: 1,
        });
        const replacement = senderFromMcpScope({
          threadId: "public-agent",
          providerSessionId: "mcp-capability-session",
          issuedAt: 2,
        });
        for (const [messageId, sender] of [
          ["app-message", app],
          ["new-message", replacement],
          ["late-old-message", old],
        ] as const) {
          yield* sql`
          INSERT INTO projection_thread_messages
            (message_id, thread_id, role, text, is_streaming, created_at, updated_at)
          VALUES (${messageId}, 'receiver', 'user', 'honest', 0, 'now', 'now')
        `;
          yield* stampMessageSender(messageId, sender);
          expect(yield* readMessageSender(messageId)).toEqual({
            senderPublicId: sender.publicAgentId,
            senderGeneration: sender.generation,
          });
        }
        const overwritten = yield* Effect.exit(stampMessageSender("late-old-message", replacement));
        expect(Exit.isFailure(overwritten)).toBe(true);
        expect((yield* readMessageSender("late-old-message"))?.senderGeneration).toBe(
          old.generation,
        );
        expect(
          (yield* lookupIdentityAlias("app-session", "mcp-capability-session"))?.publicAgentId,
        ).toBe("public-agent");
        expect((yield* lookupIdentityAlias("app-session", "app-session-1"))?.publicAgentId).toBe(
          "authenticated-subject",
        );
      }),
  );

  it.effect(
    "refuses forged sender/generation claims rather than treating payload fields as authority",
    () =>
      Effect.gen(function* () {
        const sender = senderFromAppSession({ subject: "real-subject", sessionId: "real-session" });
        for (const payload of [
          { sender_public_id: "forged" },
          { senderPublicId: "forged" },
          { sender_generation: "replacement" },
          { message: { senderGeneration: "replacement" } },
          { senderPublicId: 42 },
        ]) {
          expect(
            Exit.isFailure(
              yield* Effect.exit(assertSenderClaims(sender, captureSenderClaims(payload))),
            ),
          ).toBe(true);
        }
        yield* assertSenderClaims(
          sender,
          captureSenderClaims({
            sender_public_id: "real-subject",
            sender_generation: "real-session",
          }),
        );
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              assertSenderClaims(undefined, captureSenderClaims({ senderPublicId: "forged" })),
            ),
          ),
        ).toBe(true);
      }),
  );
});

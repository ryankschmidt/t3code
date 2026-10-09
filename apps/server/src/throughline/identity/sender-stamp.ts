import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { bindIdentityAlias, type NativeKind } from "./identity-alias.ts";

export type AuthenticatedSender = {
  readonly publicAgentId: string;
  readonly generation: string;
  readonly nativeKind: NativeKind;
  readonly nativeId: string;
};
export type SenderClaim = {
  readonly field: "publicAgentId" | "generation";
  readonly value: unknown;
};

export const CurrentAuthenticatedSender = Context.Reference<AuthenticatedSender | undefined>(
  "ThroughLine/identity/AuthenticatedSender",
  { defaultValue: () => undefined },
);
export const CurrentSenderClaims = Context.Reference<readonly SenderClaim[]>(
  "ThroughLine/identity/SenderClaims",
  { defaultValue: () => [] },
);

export class SenderIdentityMismatch extends Schema.TaggedError<SenderIdentityMismatch>()(
  "SenderIdentityMismatch",
  { message: Schema.String },
) {}

// These inputs are server-authenticated metadata, never the incoming command body.
export const senderFromAppSession = (session: {
  readonly subject: string;
  readonly sessionId: string;
}): AuthenticatedSender => ({
  publicAgentId: session.subject,
  generation: session.sessionId,
  nativeKind: "app-session",
  nativeId: session.sessionId,
});
export const senderFromMcpScope = (scope: {
  readonly threadId: string;
  readonly providerSessionId: string;
  readonly issuedAt: number;
}): AuthenticatedSender => ({
  publicAgentId: scope.threadId,
  // providerSessionId here identifies the server-owned MCP capability session,
  // not the native provider resume id (ComsNetTransport's authenticated principal).
  generation: JSON.stringify([scope.providerSessionId, scope.issuedAt]),
  nativeKind: "app-session",
  nativeId: scope.providerSessionId,
});

export function captureSenderClaims(payload: unknown): readonly SenderClaim[] {
  const claims: SenderClaim[] = [];
  const read = (value: unknown) => {
    if (typeof value !== "object" || value === null) return;
    for (const [key, field] of [
      ["senderPublicId", "publicAgentId"],
      ["sender_public_id", "publicAgentId"],
      ["senderGeneration", "generation"],
      ["sender_generation", "generation"],
    ] as const) {
      if (key in value) claims.push({ field, value: value[key as keyof typeof value] });
    }
  };
  read(payload);
  if (typeof payload === "object" && payload !== null && "message" in payload)
    read(payload.message);
  return claims;
}

export const assertSenderClaims = Effect.fn("identity.assertSenderClaims")(function* (
  sender: AuthenticatedSender | undefined,
  claims: readonly SenderClaim[],
) {
  if (claims.some((claim) => sender === undefined || claim.value !== sender[claim.field])) {
    return yield* new SenderIdentityMismatch({ message: "Authenticated sender claim mismatch." });
  }
});

// A durable rail must carry this typed metadata from its trusted server ingress
// and re-provide it at dispatch. Fiber context does not cross a serialized task.
export const withAuthenticatedSender = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  sender: AuthenticatedSender,
  payload?: unknown,
) =>
  effect.pipe(
    Effect.provideService(CurrentAuthenticatedSender, Object.freeze({ ...sender })),
    Effect.provideService(CurrentSenderClaims, captureSenderClaims(payload)),
  );

export const readMessageSender = Effect.fn("identity.readMessageSender")(function* (
  messageId: string,
) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly senderPublicId: string; readonly senderGeneration: string }>`
    SELECT sender_public_id AS "senderPublicId", sender_generation AS "senderGeneration"
    FROM projection_thread_messages WHERE message_id = ${messageId}
      AND sender_public_id IS NOT NULL AND sender_generation IS NOT NULL
  `;
  return rows[0];
});

export const stampMessageSender = Effect.fn("identity.stampMessageSender")(function* (
  messageId: string,
  sender: AuthenticatedSender,
) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* bindIdentityAlias({
        publicAgentId: sender.publicAgentId,
        nativeKind: sender.nativeKind,
        nativeId: sender.nativeId,
      });
      const rows = yield* sql`
      UPDATE projection_thread_messages
      SET sender_public_id = ${sender.publicAgentId}, sender_generation = ${sender.generation}
      WHERE message_id = ${messageId}
        AND (sender_public_id IS NULL OR sender_public_id = ${sender.publicAgentId})
        AND (sender_generation IS NULL OR sender_generation = ${sender.generation})
      RETURNING message_id
    `;
      if (rows.length !== 1)
        return yield* new SenderIdentityMismatch({
          message: "Stored sender generation mismatch or message absent.",
        });
    }),
  );
});

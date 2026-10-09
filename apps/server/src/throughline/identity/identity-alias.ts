import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const nativeKinds = ["claude", "codex", "pi", "throughline-thread", "app-session"] as const;
export type NativeKind = (typeof nativeKinds)[number];

export type IdentityAlias = {
  readonly publicAgentId: string;
  readonly nativeKind: NativeKind;
  readonly nativeId: string;
  readonly boundGeneration: string | null;
  readonly createdAt: string;
};

export class IdentityAliasConflict extends Schema.TaggedError<IdentityAliasConflict>()(
  "IdentityAliasConflict",
  { nativeKind: Schema.String, nativeId: Schema.String },
) {}

export const lookupIdentityAlias = Effect.fn("identity.lookupAlias")(function* (
  nativeKind: NativeKind,
  nativeId: string,
) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<IdentityAlias>`
    SELECT public_agent_id AS "publicAgentId", native_kind AS "nativeKind",
           native_id AS "nativeId", bound_generation AS "boundGeneration", created_at AS "createdAt"
    FROM identity_alias WHERE native_kind = ${nativeKind} AND native_id = ${nativeId}
  `;
  return rows[0];
});

// Uses the ambient SQL transaction/savepoint. An admission failure rolls this write
// back with its command receipt; never dual-write from a detached background fiber.
export const bindIdentityAlias = Effect.fn("identity.bindAlias")(function* (input: {
  readonly publicAgentId: string;
  readonly nativeKind: NativeKind;
  readonly nativeId: string;
  readonly boundGeneration?: string;
}) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
      INSERT INTO identity_alias (public_agent_id, native_kind, native_id, bound_generation, created_at)
      VALUES (${input.publicAgentId}, ${input.nativeKind}, ${input.nativeId},
              ${input.boundGeneration ?? null}, ${createdAt})
      ON CONFLICT(native_kind, native_id) DO NOTHING
    `;
      const alias = yield* lookupIdentityAlias(input.nativeKind, input.nativeId);
      if (
        alias === undefined ||
        alias.publicAgentId !== input.publicAgentId ||
        (input.boundGeneration !== undefined &&
          alias.boundGeneration !== null &&
          alias.boundGeneration !== input.boundGeneration)
      ) {
        return yield* new IdentityAliasConflict({
          nativeKind: input.nativeKind,
          nativeId: input.nativeId,
        });
      }
      if (input.boundGeneration !== undefined && alias.boundGeneration === null) {
        yield* sql`
        UPDATE identity_alias SET bound_generation = ${input.boundGeneration}
        WHERE native_kind = ${input.nativeKind} AND native_id = ${input.nativeId}
      `;
        return { ...alias, boundGeneration: input.boundGeneration };
      }
      return alias;
    }),
  );
});

import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("sender column expansion", (it) => {
  it.effect("keeps old rows unknown and prevents partial or replacement-generation stamps", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });
      yield* sql`
        INSERT INTO projection_thread_messages
          (message_id, thread_id, role, text, is_streaming, created_at, updated_at)
        VALUES ('old', 'thread', 'user', 'preserved', 0, 'before', 'before')
      `;
      yield* runMigrations();
      expect(
        yield* sql`SELECT text, sender_public_id, sender_generation FROM projection_thread_messages`,
      ).toEqual([{ text: "preserved", sender_public_id: null, sender_generation: null }]);
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            sql`UPDATE projection_thread_messages SET sender_public_id = 'partial' WHERE message_id = 'old'`,
          ),
        ),
      ).toBe(true);
      yield* sql`UPDATE projection_thread_messages SET sender_public_id = 'sender', sender_generation = 'old-generation' WHERE message_id = 'old'`;
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            sql`UPDATE projection_thread_messages SET sender_generation = 'replacement' WHERE message_id = 'old'`,
          ),
        ),
      ).toBe(true);
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            sql`UPDATE projection_thread_messages SET sender_public_id = NULL, sender_generation = NULL WHERE message_id = 'old'`,
          ),
        ),
      ).toBe(true);
      expect(
        yield* sql`SELECT sender_public_id, sender_generation FROM projection_thread_messages`,
      ).toEqual([{ sender_public_id: "sender", sender_generation: "old-generation" }]);
      expect(yield* runMigrations()).toEqual([]);
    }),
  );
});

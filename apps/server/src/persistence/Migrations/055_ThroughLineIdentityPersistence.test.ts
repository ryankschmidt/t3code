import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
  "ThroughLine identity expansion",
  (it) => {
    it.effect("registers durable aliases without changing existing message rows", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 54 });
        yield* sql`
        INSERT INTO projection_thread_messages
          (message_id, thread_id, role, text, is_streaming, created_at, updated_at)
        VALUES ('old-message', 'old-thread', 'user', 'preserve me', 0, 'before', 'before')
      `;
        yield* runMigrations();
        const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'identity_alias'
      `;
        assert.deepEqual(tables, [{ name: "identity_alias" }]);
        const messages = yield* sql<{ readonly text: string }>`
        SELECT text FROM projection_thread_messages WHERE message_id = 'old-message'
      `;
        assert.deepEqual(messages, [{ text: "preserve me" }]);
        assert.deepEqual(yield* runMigrations(), []);
      }),
    );
  },
);

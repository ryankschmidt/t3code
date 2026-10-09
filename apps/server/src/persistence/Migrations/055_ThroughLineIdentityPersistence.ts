import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Expand only: native ancestry and existing orchestration rows remain authoritative.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS identity_alias (
      public_agent_id TEXT NOT NULL CHECK(length(trim(public_agent_id)) > 0),
      native_kind TEXT NOT NULL CHECK(native_kind IN
        ('claude', 'codex', 'pi', 'throughline-thread', 'app-session')),
      native_id TEXT NOT NULL CHECK(length(trim(native_id)) > 0),
      bound_generation TEXT CHECK(bound_generation IS NULL OR length(trim(bound_generation)) > 0),
      created_at TEXT NOT NULL,
      PRIMARY KEY (native_kind, native_id)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS identity_alias_public_agent
    ON identity_alias(public_agent_id)
  `;
});

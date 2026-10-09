// @effect-diagnostics nodeBuiltinImport:off - Isolated, non-secret SQLite fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../../persistence/Migrations.ts";
import { bindIdentityAlias, lookupIdentityAlias, nativeKinds } from "./identity-alias.ts";

it.effect(
  "persists every native kind across connection close/reopen and refuses reassignment",
  () =>
    Effect.acquireUseRelease(
      Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "throughline-identity-alias-")),
      ),
      (directory) =>
        Effect.gen(function* () {
          const filename = NodePath.join(directory, "identity.sqlite");
          const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
            effect.pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
          yield* run(
            Effect.gen(function* () {
              yield* runMigrations();
              for (const nativeKind of nativeKinds) {
                yield* bindIdentityAlias({
                  publicAgentId: "public-agent",
                  nativeKind,
                  nativeId: `native-${nativeKind}`,
                  boundGeneration: "generation-1",
                });
              }
              yield* bindIdentityAlias({
                publicAgentId: "public-agent",
                nativeKind: "claude",
                nativeId: "another-native-message",
              });
            }),
          );
          // A fresh SQL layer opens a new physical connection to the same file.
          yield* run(
            Effect.gen(function* () {
              for (const nativeKind of nativeKinds) {
                const alias = yield* lookupIdentityAlias(nativeKind, `native-${nativeKind}`);
                expect(alias?.publicAgentId).toBe("public-agent");
                expect(alias?.boundGeneration).toBe("generation-1");
              }
              expect(
                (yield* lookupIdentityAlias("claude", "another-native-message"))?.publicAgentId,
              ).toBe("public-agent");
              expect(yield* lookupIdentityAlias("codex", "unknown")).toBeUndefined();
              const original = yield* lookupIdentityAlias("claude", "native-claude");
              yield* bindIdentityAlias({
                publicAgentId: "public-agent",
                nativeKind: "claude",
                nativeId: "native-claude",
                boundGeneration: "generation-1",
              });
              expect(yield* lookupIdentityAlias("claude", "native-claude")).toEqual(original);
              for (const attempted of [
                { publicAgentId: "forged-agent", boundGeneration: "generation-1" },
                { publicAgentId: "public-agent", boundGeneration: "generation-2" },
              ]) {
                const conflict = yield* Effect.exit(
                  bindIdentityAlias({
                    ...attempted,
                    nativeKind: "claude",
                    nativeId: "native-claude",
                  }),
                );
                expect(Exit.isFailure(conflict)).toBe(true);
                expect(yield* lookupIdentityAlias("claude", "native-claude")).toEqual(original);
              }
            }),
          );
        }),
      (directory) => Effect.promise(() => NodeFSP.rm(directory, { recursive: true })),
    ),
);

it.effect(
  "rolls aliases and an admitted command receipt back together on transaction failure",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      const admitted = Effect.gen(function* () {
        yield* sql`
          INSERT INTO orchestration_command_receipts
            (command_id, aggregate_kind, aggregate_id, accepted_at, result_sequence, status)
          VALUES ('alias-command', 'thread', 'public-agent', 'now', 1, 'accepted')
        `;
        yield* bindIdentityAlias({
          publicAgentId: "public-agent",
          nativeKind: "codex",
          nativeId: "transaction-native",
        });
      });
      const aborted = yield* Effect.exit(
        sql.withTransaction(admitted.pipe(Effect.andThen(Effect.fail("forced admission failure")))),
      );
      expect(Exit.isFailure(aborted)).toBe(true);
      expect(yield* lookupIdentityAlias("codex", "transaction-native")).toBeUndefined();
      expect(yield* sql`SELECT command_id FROM orchestration_command_receipts`).toEqual([]);
      yield* sql.withTransaction(admitted);
      expect((yield* lookupIdentityAlias("codex", "transaction-native"))?.publicAgentId).toBe(
        "public-agent",
      );
      expect(yield* sql`SELECT command_id FROM orchestration_command_receipts`).toEqual([
        { command_id: "alias-command" },
      ]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

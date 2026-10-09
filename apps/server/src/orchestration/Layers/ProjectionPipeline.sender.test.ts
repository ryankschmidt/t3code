import { CommandId, ProjectId, ProviderInstanceId, ThreadId, MessageId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ServerConfig } from "../../config.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import {
  senderFromAppSession,
  withAuthenticatedSender,
} from "../../throughline/identity/sender-stamp.ts";

const layer = OrchestrationEngineLive.pipe(
  Layer.provideMerge(OrchestrationProjectionPipelineLive),
  Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-sender-replay-" })),
  Layer.provide(NodeServices.layer),
);

it.layer(layer)("persisted sender replay/readback", (it) => {
  it.effect(
    "reconstructs sender from persisted event metadata, with legacy rows still unknown",
    () =>
      Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        const pipeline = yield* OrchestrationProjectionPipeline;
        const snapshot = yield* ProjectionSnapshotQuery;
        const sql = yield* SqlClient.SqlClient;
        const createdAt = "2026-01-01T00:00:00.000Z";
        const projectId = ProjectId.make("sender-replay-project");
        yield* engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("sender-replay-project"),
          projectId,
          title: "sender",
          workspaceRoot: process.cwd(),
          createdAt,
        });
        const sender = senderFromAppSession({
          subject: "authenticated-subject",
          sessionId: "authenticated-session",
        });
        for (const kind of ["authenticated", "legacy"] as const) {
          const threadId = ThreadId.make(`sender-${kind}`);
          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.make(`sender-create-${kind}`),
            threadId,
            projectId,
            title: kind,
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt,
          });
          const dispatch = engine.dispatch({
            type: "thread.turn.start",
            commandId: CommandId.make(`sender-turn-${kind}`),
            threadId,
            message: {
              messageId: MessageId.make(`sender-message-${kind}`),
              role: "user",
              text: kind,
              attachments: [],
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt,
          });
          yield* kind === "authenticated" ? withAuthenticatedSender(dispatch, sender) : dispatch;
        }
        const check = () =>
          Effect.gen(function* () {
            const readback = yield* snapshot.getSnapshot();
            const known = readback.threads.find((t) => t.id === "sender-authenticated")
              ?.messages[0];
            const legacy = readback.threads.find((t) => t.id === "sender-legacy")?.messages[0];
            expect(known).toMatchObject({
              senderPublicId: "authenticated-subject",
              senderGeneration: "authenticated-session",
            });
            expect(legacy?.senderPublicId).toBeUndefined();
            expect(legacy?.senderGeneration).toBeUndefined();
          });
        yield* check();
        const before =
          yield* sql`SELECT event_id, metadata_json FROM orchestration_events ORDER BY sequence`;
        // Destroy only derived fixture rows/cursors, never the authoritative event ledger.
        yield* sql`DELETE FROM projection_thread_messages`;
        yield* sql`DELETE FROM projection_state`;
        yield* pipeline.bootstrap;
        yield* check();
        expect(
          yield* sql`SELECT event_id, metadata_json FROM orchestration_events ORDER BY sequence`,
        ).toEqual(before);
      }),
  );
});

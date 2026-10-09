import { CommandId, MessageId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
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
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import {
  bindIdentityAlias,
  lookupIdentityAlias,
} from "../../throughline/identity/identity-alias.ts";
import {
  readMessageSender,
  senderFromAppSession,
  withAuthenticatedSender,
} from "../../throughline/identity/sender-stamp.ts";

const engineLayer = OrchestrationEngineLive.pipe(
  Layer.provide(OrchestrationProjectionSnapshotQueryLive),
  Layer.provide(OrchestrationProjectionPipelineLive),
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-identity-engine-" })),
  Layer.provide(NodeServices.layer),
);

it.layer(engineLayer)("identity admission", (it) => {
  it.effect(
    "atomically persists the sender/alias and records forged sender admission failure",
    () =>
      Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        const sql = yield* SqlClient.SqlClient;
        const createdAt = "2026-01-01T00:00:00.000Z";
        const projectId = ProjectId.make("identity-project");
        yield* engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("identity-project"),
          projectId,
          title: "Identity",
          workspaceRoot: process.cwd(),
          createdAt,
        });
        const sender = senderFromAppSession({
          subject: "trusted-subject",
          sessionId: "trusted-session",
        });
        for (const [suffix, claim] of [
          ["honest", "trusted-subject"],
          ["forged", "attacker"],
        ] as const) {
          const threadId = ThreadId.make(`identity-${suffix}`);
          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.make(`create-${suffix}`),
            threadId,
            projectId,
            title: suffix,
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt,
          });
          const message = Object.assign(
            {
              messageId: MessageId.make(`message-${suffix}`),
              role: "user" as const,
              text: suffix,
              attachments: [],
            },
            { senderPublicId: claim },
          );
          const result = yield* Effect.exit(
            withAuthenticatedSender(
              engine.dispatch({
                type: "thread.turn.start",
                commandId: CommandId.make(`turn-${suffix}`),
                threadId,
                message,
                runtimeMode: "full-access",
                interactionMode: "default",
                createdAt,
              }),
              sender,
            ),
          );
          expect(Exit.isSuccess(result)).toBe(suffix === "honest");
        }
        expect(yield* readMessageSender("message-honest")).toEqual({
          senderPublicId: "trusted-subject",
          senderGeneration: "trusted-session",
        });
        expect(yield* readMessageSender("message-forged")).toBeUndefined();
        expect((yield* lookupIdentityAlias("app-session", "trusted-session"))?.publicAgentId).toBe(
          "trusted-subject",
        );
        const receipt = yield* sql<{ readonly status: string; readonly error: string | null }>`
        SELECT status, error FROM orchestration_command_receipts WHERE command_id = 'turn-forged'
      `;
        expect(receipt[0]?.status).toBe("rejected");
        expect(receipt[0]?.error).toMatch(/sender.*mismatch/i);

        const replay = yield* Effect.exit(
          withAuthenticatedSender(
            engine.dispatch({
              type: "thread.turn.start",
              commandId: CommandId.make("turn-honest"),
              threadId: ThreadId.make("identity-honest"),
              message: Object.assign(
                {
                  messageId: MessageId.make("message-honest"),
                  role: "user" as const,
                  text: "honest",
                  attachments: [],
                },
                { senderPublicId: "forged-replay" },
              ),
              runtimeMode: "full-access",
              interactionMode: "default",
              createdAt,
            }),
            sender,
          ),
        );
        expect(Exit.isFailure(replay)).toBe(true);
        expect(
          yield* sql`SELECT status FROM orchestration_command_receipts WHERE command_id = 'turn-honest'`,
        ).toEqual([{ status: "accepted" }]);

        // A failure after event projection must roll back that event, message and
        // admission together, while retaining the separately recorded rejection.
        yield* bindIdentityAlias({
          publicAgentId: "different-owner",
          nativeKind: "app-session",
          nativeId: "claimed-session",
        });
        const conflictThread = ThreadId.make("identity-alias-conflict");
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("create-alias-conflict"),
          threadId: conflictThread,
          projectId,
          title: "conflict",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        const failed = yield* Effect.exit(
          withAuthenticatedSender(
            engine.dispatch({
              type: "thread.turn.start",
              commandId: CommandId.make("turn-alias-conflict"),
              threadId: conflictThread,
              message: {
                messageId: MessageId.make("message-alias-conflict"),
                role: "user",
                text: "conflict",
                attachments: [],
              },
              runtimeMode: "full-access",
              interactionMode: "default",
              createdAt,
            }),
            senderFromAppSession({ subject: "trusted-subject", sessionId: "claimed-session" }),
          ),
        );
        expect(Exit.isFailure(failed)).toBe(true);
        expect(
          yield* sql`SELECT message_id FROM projection_thread_messages WHERE message_id = 'message-alias-conflict'`,
        ).toEqual([]);
        expect(
          yield* sql`SELECT event_id FROM orchestration_events WHERE command_id = 'turn-alias-conflict'`,
        ).toEqual([]);
        expect((yield* lookupIdentityAlias("app-session", "claimed-session"))?.publicAgentId).toBe(
          "different-owner",
        );
        expect(
          yield* sql`SELECT status FROM orchestration_command_receipts WHERE command_id = 'turn-alias-conflict'`,
        ).toEqual([{ status: "rejected" }]);
      }),
  );
});

import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  OrchestrationCommand,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ServerConfig } from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ThreadBackgroundLiveness from "./ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "./ThreadPlanProgress.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { OrchestrationEngineLive } from "./Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./Layers/ProjectionSnapshotQuery.ts";
import { readMessageSender, senderFromAppSession } from "../throughline/identity/sender-stamp.ts";
import { bindIdentityAlias, lookupIdentityAlias } from "../throughline/identity/identity-alias.ts";
import { makeSenderRestoringDispatch } from "./AbsurdRuntimeInProcess.ts";
import { makeInProcessTransport } from "../../../../packages/absurd-runtime/src/in-process-transport.ts";
import {
  registerThreadRunTask,
  type ThreadRunParams,
  type ThreadRunResult,
} from "../../../../packages/absurd-runtime/src/thread-driver.ts";

class SenderRailTestError extends Data.TaggedError("SenderRailTestError") {}

const encodeCommand = Schema.encodeUnknownSync(OrchestrationCommand);
const engineLayer = OrchestrationEngineLive.pipe(
  Layer.provide(OrchestrationProjectionSnapshotQueryLive),
  Layer.provide(OrchestrationProjectionPipelineLive),
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "trusted-sender-rail-" })),
  Layer.provide(NodeServices.layer),
);

type TaskContext = {
  readonly taskID: string;
  readonly step: <A>(name: string, run: () => Promise<A>) => Promise<A>;
  readonly heartbeat: () => Promise<void>;
};
type Handler = (params: ThreadRunParams, ctx: TaskContext) => Promise<ThreadRunResult>;

it.layer(engineLayer)("serialized trusted sender rail", (it) => {
  it.effect(
    "restores reviewed sender at actual engine dispatch, replay and refusal without payload fallback",
    () =>
      Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        const sql = yield* SqlClient.SqlClient;
        // Run the adapter's Promise boundary on this test layer's existing fiber,
        // rather than creating a second manual Effect runtime.
        const dispatchJobs = yield* Queue.unbounded<Effect.Effect<void>>();
        yield* Queue.take(dispatchJobs).pipe(Effect.flatten, Effect.forever, Effect.forkChild);
        const runOnTestFiber = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
          new Promise((resolve, reject) => {
            Queue.offerUnsafe(
              dispatchJobs,
              Effect.exit(effect).pipe(
                Effect.flatMap((exit) =>
                  Effect.sync(() => {
                    if (Exit.isSuccess(exit)) resolve(exit.value);
                    else reject(new SenderRailTestError());
                  }),
                ),
              ),
            );
          });
        const dispatch = makeSenderRestoringDispatch(engine.dispatch, runOnTestFiber);
        const transport = makeInProcessTransport({
          dispatchCommand: dispatch,
          replayEvents: async () => [],
          projectId: "rail-project",
          instanceId: "codex",
        });
        let handler: Handler | undefined;
        registerThreadRunTask(
          {
            registerTask: (_definition: unknown, run: Handler) => {
              handler = run;
            },
          } as unknown as Parameters<typeof registerThreadRunTask>[0],
          transport,
        );
        if (handler === undefined) return yield* Effect.die("thread driver did not register");
        const invoke = handler;
        const createdAt = "2026-01-01T00:00:00.000Z";
        const projectId = ProjectId.make("rail-project");
        yield* engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("rail-project"),
          projectId,
          title: "Rail fixture",
          workspaceRoot: process.cwd(),
          createdAt,
        });
        for (const suffix of ["honest", "forged", "missing", "alias-conflict"] as const) {
          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.make(`rail-create-${suffix}`),
            threadId: ThreadId.make(`rail-${suffix}`),
            projectId,
            title: suffix,
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt,
          });
        }
        const command = (suffix: string) => ({
          type: "thread.turn.start" as const,
          commandId: CommandId.make(`rail-turn-${suffix}`),
          threadId: ThreadId.make(`rail-${suffix}`),
          message: {
            messageId: MessageId.make(`rail-message-${suffix}`),
            role: "user" as const,
            text: suffix,
            attachments: [],
          },
          runtimeMode: "full-access" as const,
          interactionMode: "default" as const,
          createdAt,
        });
        const sender = senderFromAppSession({
          subject: "trusted-rail-subject",
          sessionId: "trusted-rail-session",
        });
        const run = (
          suffix: string,
          trusted: ThreadRunParams["trustedSenderContext"],
          override?: Record<string, unknown>,
        ) => {
          const params = JSON.parse(
            JSON.stringify({
              prompt: suffix,
              threadId: `rail-${suffix}`,
              completionMode: "dispatch-only",
              turnCommand: override ?? encodeCommand(command(suffix)),
              ...(trusted === undefined ? {} : { trustedSenderContext: trusted }),
            }),
          ) as ThreadRunParams;
          return Effect.tryPromise({
            try: () =>
              invoke(params, {
                taskID: `rail-task-${suffix}`,
                step: async (_name, body) => body(),
                heartbeat: async () => undefined,
              }),
            catch: () => new SenderRailTestError(),
          });
        };
        yield* run("honest", { sender, claims: [] });
        const accepted = yield* readMessageSender("rail-message-honest");
        expect(accepted).toEqual({
          senderPublicId: sender.publicAgentId,
          senderGeneration: sender.generation,
        });
        yield* run("honest", { sender, claims: [] });
        expect(
          yield* sql`SELECT message_id FROM projection_thread_messages WHERE message_id = 'rail-message-honest'`,
        ).toHaveLength(1);
        const replayForgery = yield* Effect.exit(
          run("honest", { sender, claims: [{ field: "generation", value: "forged" }] }),
        );
        expect(Exit.isFailure(replayForgery)).toBe(true);
        expect(yield* readMessageSender("rail-message-honest")).toEqual(accepted);
        const forged = yield* Effect.exit(
          run("forged", { sender, claims: [{ field: "publicAgentId", value: "forged" }] }),
        );
        expect(Exit.isFailure(forged)).toBe(true);
        expect(yield* readMessageSender("rail-message-forged")).toBeUndefined();
        const missingWire = encodeCommand({
          ...command("missing"),
          message: { ...command("missing").message, senderPublicId: "forged" },
        }) as Record<string, unknown>;
        expect(Exit.isFailure(yield* Effect.exit(run("missing", undefined, missingWire)))).toBe(
          true,
        );
        expect(yield* readMessageSender("rail-message-missing")).toBeUndefined();
        yield* bindIdentityAlias({
          publicAgentId: "other-owner",
          nativeKind: "app-session",
          nativeId: "conflicting-session",
        });
        const conflict = yield* Effect.exit(
          run("alias-conflict", {
            sender: senderFromAppSession({
              subject: sender.publicAgentId,
              sessionId: "conflicting-session",
            }),
            claims: [],
          }),
        );
        expect(Exit.isFailure(conflict)).toBe(true);
        expect(yield* readMessageSender("rail-message-alias-conflict")).toBeUndefined();
        expect(
          (yield* lookupIdentityAlias("app-session", "conflicting-session"))?.publicAgentId,
        ).toBe("other-owner");
        expect(
          yield* sql`SELECT status FROM orchestration_command_receipts WHERE command_id = 'rail-turn-forged'`,
        ).toEqual([{ status: "rejected" }]);
      }),
  );
});

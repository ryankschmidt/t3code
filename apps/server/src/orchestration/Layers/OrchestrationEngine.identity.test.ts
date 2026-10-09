import {
  EnvironmentId,
  EventId,
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ServerConfig } from "../../config.ts";
import {
  SqlitePersistenceMemory,
  makeSqlitePersistenceLive,
} from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { OrchestrationEngineLive, makeExistingSettingsConsumer } from "./OrchestrationEngine.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ProjectionThreadRepositoryLive } from "../../persistence/Layers/ProjectionThreads.ts";
import {
  createHostBindings,
  UnconfirmedSettingsRecordError,
  type SettingsBindingRecord,
} from "../../throughline/settings-intent/HostBindings.ts";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
const decodeJsonEvidence = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const SettingsAuthorizationFlag = Context.Reference<boolean>("test/settings-authorization-flag", {
  defaultValue: () => true,
});
class SettingsAuthorizationDenied extends Schema.TaggedError<SettingsAuthorizationDenied>()(
  "SettingsAuthorizationDenied",
  {},
) {}
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

const settingsRecord: SettingsBindingRecord = {
  operation: "apply",
  bindings: {
    source: "admitted-fixture",
    revision: "1",
    hosts: [
      { role: "mac", environmentId: "fixture-owner" },
      { role: "twr", environmentId: "fixture-tower" },
      { role: "rpi", environmentId: "fixture-rpi" },
    ],
  },
  event: {
    setting: "continueThreadsAfterServerUpdate",
    value: true,
    hosts: [
      { host: "mac", before: false, effective: true, status: "applied" },
      { host: "twr", before: false, effective: true, status: "applied" },
      { host: "rpi", before: false, effective: true, status: "applied" },
    ],
  },
};
const settingsContext = {
  owner: "OrchestrationEngine" as const,
  environmentId: "fixture-owner",
  threadId: "settings-existing-thread",
};
const activityMapping = () => ({
  commandId: CommandId.make("settings-operation"),
  createdAt: "2026-01-01T00:00:00.000Z",
  activity: {
    id: EventId.make("settings-activity"),
    tone: "info" as const,
    // Fixture uses existing vocabulary; no product settings activity kind is admitted here.
    kind: "task.progress",
    summary: "Fixture continuation outcome",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
});

const makeSettingsLayer = (databasePath?: string) =>
  Layer.mergeAll(
    OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
    ),
    ProjectionThreadRepositoryLive,
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("fixture-owner")),
    }),
  ).pipe(
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provideMerge(
      databasePath ? makeSqlitePersistenceLive(databasePath) : SqlitePersistenceMemory,
    ),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-settings-owner-" })),
    Layer.provide(NodeServices.layer),
  );

const createSettingsThread = Effect.fnUntraced(function* (threadId = settingsContext.threadId) {
  const engine = yield* OrchestrationEngineService;
  const createdAt = "2026-01-01T00:00:00.000Z";
  const projectId = ProjectId.make("settings-project");
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("settings-project"),
    projectId,
    title: "Settings fixture",
    workspaceRoot: process.cwd(),
    createdAt,
  });
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`${threadId}-create`),
    threadId: ThreadId.make(threadId),
    projectId,
    title: "Existing fixture",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt,
  });
});

it.layer(makeSettingsLayer())("existing settings record owner", (it) => {
  it.effect(
    "keeps captured Effect authorization context and typed failures when called through the Promise adapter",
    () =>
      Effect.gen(function* () {
        yield* createSettingsThread();
        const contextual = yield* makeExistingSettingsConsumer({
          context: settingsContext,
          authorize: () => SettingsAuthorizationFlag,
          mapActivity: activityMapping,
        }).pipe(Effect.provideService(SettingsAuthorizationFlag, false));
        expect(yield* Effect.promise(() => contextual.verifyExistingContext(settingsContext))).toBe(
          false,
        );
        const failed = yield* makeExistingSettingsConsumer({
          context: settingsContext,
          authorize: () => Effect.fail(new SettingsAuthorizationDenied({})),
          mapActivity: activityMapping,
        });
        expect(yield* Effect.promise(() => failed.verifyExistingContext(settingsContext))).toBe(
          false,
        );
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              Effect.tryPromise(() => failed.append(settingsRecord, settingsContext)),
            ),
          ),
        ).toBe(true);
      }),
  );
  it.effect(
    "refuses wrong environment, absent/deleted thread and expired authorization before appending",
    () =>
      Effect.gen(function* () {
        yield* createSettingsThread();
        const sql = yield* SqlClient.SqlClient;
        for (const context of [
          { ...settingsContext, environmentId: "requested-echo" },
          { ...settingsContext, threadId: "missing-thread" },
        ]) {
          const consumer = yield* makeExistingSettingsConsumer({
            context,
            authorize: () => Effect.succeed(true),
            mapActivity: activityMapping,
          });
          expect(yield* Effect.promise(() => consumer.verifyExistingContext(context))).toBe(false);
          const exit = yield* Effect.exit(
            Effect.tryPromise(() => consumer.append(settingsRecord, context)),
          );
          expect(Exit.isFailure(exit)).toBe(true);
        }
        let allowed = true;
        const consumer = yield* makeExistingSettingsConsumer({
          context: settingsContext,
          authorize: () => Effect.sync(() => allowed),
          mapActivity: activityMapping,
        });
        expect(yield* Effect.promise(() => consumer.verifyExistingContext(settingsContext))).toBe(
          true,
        );
        allowed = false;
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              Effect.tryPromise(() => consumer.append(settingsRecord, settingsContext)),
            ),
          ),
        ).toBe(true);
        allowed = true;
        const deletedContext = { ...settingsContext, threadId: "settings-deleted-thread" };
        yield* createSettingsThread(deletedContext.threadId);
        const deletedConsumer = yield* makeExistingSettingsConsumer({
          context: deletedContext,
          authorize: () => Effect.succeed(true),
          mapActivity: activityMapping,
        });
        yield* sql`UPDATE projection_threads SET deleted_at = '2026-01-02T00:00:00.000Z' WHERE thread_id = 'settings-deleted-thread'`;
        expect(
          yield* Effect.promise(() => deletedConsumer.verifyExistingContext(deletedContext)),
        ).toBe(false);
        expect(
          yield* sql`SELECT command_id FROM orchestration_command_receipts WHERE command_id = 'settings-operation'`,
        ).toEqual([]);
      }),
  );

  it.effect(
    "appends one actual activity with a matching durable receipt and refuses same-id different evidence",
    () =>
      Effect.gen(function* () {
        yield* createSettingsThread();
        const sql = yield* SqlClient.SqlClient;
        const consumer = yield* makeExistingSettingsConsumer({
          context: settingsContext,
          authorize: () => Effect.succeed(true),
          mapActivity: activityMapping,
        });
        const receipt = yield* Effect.promise(() =>
          consumer.append(settingsRecord, settingsContext),
        );
        expect(receipt).toMatchObject({
          environmentId: "fixture-owner",
          threadId: settingsContext.threadId,
          commandId: "settings-operation",
        });
        expect(receipt.sequence).toBeGreaterThan(0);
        expect(
          yield* Effect.promise(() => consumer.append(settingsRecord, settingsContext)),
        ).toEqual(receipt);
        expect(
          yield* sql`SELECT COUNT(*) AS count FROM orchestration_events WHERE command_id = 'settings-operation'`,
        ).toEqual([{ count: 1 }]);
        const rows = yield* sql<{
          payloadJson: string;
          sequence: number;
        }>`SELECT payload_json AS payloadJson, sequence FROM projection_thread_activities WHERE activity_id = 'settings-activity'`;
        expect(yield* decodeJsonEvidence(rows[0]!.payloadJson)).toEqual(settingsRecord);
        expect(
          yield* sql`SELECT sequence FROM orchestration_events WHERE command_id = 'settings-operation'`,
        ).toEqual([{ sequence: receipt.sequence }]);
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              Effect.tryPromise(() =>
                consumer.append(
                  { ...settingsRecord, event: { ...settingsRecord.event, value: false } },
                  settingsContext,
                ),
              ),
            ),
          ),
        ).toBe(true);
        expect(
          yield* decodeJsonEvidence(
            (yield* sql<{
              payloadJson: string;
            }>`SELECT payload_json AS payloadJson FROM projection_thread_activities WHERE activity_id = 'settings-activity'`)[0]!
              .payloadJson,
          ),
        ).toEqual(settingsRecord);
      }),
  );

  it.effect(
    "composes final HostBindings only on admitted fixture ports and existing owner, never memory acknowledgement",
    () =>
      Effect.gen(function* () {
        yield* createSettingsThread();
        const consumer = yield* makeExistingSettingsConsumer({
          context: settingsContext,
          authorize: () => Effect.succeed(true),
          mapActivity: activityMapping,
        });
        const values = new Map(
          settingsRecord.bindings.hosts.map((host) => [host.environmentId, false]),
        );
        const bindings = createHostBindings({
          publicHostMap: settingsRecord.bindings,
          verifyPublicHostMap: async () => true,
          consumer,
          ports: settingsRecord.bindings.hosts.map((host) => ({
            environmentId: host.environmentId,
            verifyAuthenticated: async () => ({
              environmentId: host.environmentId,
              authenticated: true,
            }),
            readContinuation: async () => values.get(host.environmentId)!,
            patchContinuation: async (value) => {
              values.set(host.environmentId, value);
              return value;
            },
          })),
        });
        const result = yield* Effect.promise(() =>
          bindings.applyIntent("continueThreadsAfterServerUpdate", true),
        );
        expect(result.effectiveMatch).toBe(true);
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{
          sequence: number;
          status: string;
        }>`SELECT result_sequence AS sequence, status FROM orchestration_command_receipts WHERE command_id = 'settings-operation'`;
        expect(rows).toEqual([{ sequence: result.receipt.sequence, status: "accepted" }]);
        expect(result.receipt.environmentId).toBe("fixture-owner");
      }),
  );
});

it.layer(makeSettingsLayer())("uncertain settings append", (it) => {
  it.effect(
    "refuses a transient dispatch sequence without the corresponding durable receipt/event",
    () =>
      Effect.gen(function* () {
        yield* createSettingsThread();
        const engine = yield* OrchestrationEngineService;
        const consumer = yield* makeExistingSettingsConsumer({
          context: settingsContext,
          authorize: () => Effect.succeed(true),
          mapActivity: activityMapping,
        }).pipe(
          Effect.provideService(OrchestrationEngineService, {
            ...engine,
            dispatch: () => Effect.succeed({ sequence: 1 }),
          }),
        );
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              Effect.tryPromise(() => consumer.append(settingsRecord, settingsContext)),
            ),
          ),
        ).toBe(true);
        const sql = yield* SqlClient.SqlClient;
        expect(
          yield* sql`SELECT command_id FROM orchestration_command_receipts WHERE command_id = 'settings-operation'`,
        ).toEqual([]);
      }),
  );
  it.effect(
    "retains field-limited evidence after an already committed append failure without automatic retry",
    () =>
      Effect.gen(function* () {
        yield* createSettingsThread();
        const engine = yield* OrchestrationEngineService;
        let dispatches = 0;
        const consumer = yield* makeExistingSettingsConsumer({
          context: settingsContext,
          authorize: () => Effect.succeed(true),
          mapActivity: activityMapping,
        }).pipe(
          Effect.provideService(OrchestrationEngineService, {
            ...engine,
            dispatch: (command, options) =>
              Effect.gen(function* () {
                dispatches++;
                yield* engine.dispatch(command, options);
                return yield* new OrchestrationCommandInvariantError({
                  commandType: command.type,
                  detail: "fixture acknowledgement lost after commit",
                });
              }),
          }),
        );
        let failure: unknown;
        yield* Effect.promise(async () => {
          try {
            await consumer.append(
              Object.assign({ ...settingsRecord }, { unrelated: "excluded fixture property" }),
              settingsContext,
            );
          } catch (cause) {
            failure = cause;
          }
        });
        expect(failure).toBeInstanceOf(UnconfirmedSettingsRecordError);
        expect((failure as UnconfirmedSettingsRecordError).record).toEqual(settingsRecord);
        expect(dispatches).toBe(1);
        // Reconcile the actual durable owner witness, not an in-memory acknowledgement.
        const receipts = yield* OrchestrationCommandReceiptRepository;
        const persisted = yield* receipts.getByCommandId({
          commandId: CommandId.make("settings-operation"),
        });
        expect(Option.isSome(persisted) && persisted.value.status).toBe("accepted");
        const sql = yield* SqlClient.SqlClient;
        expect(
          yield* sql`SELECT COUNT(*) AS count FROM orchestration_events WHERE command_id = 'settings-operation'`,
        ).toEqual([{ count: 1 }]);
      }),
  );
});

it.effect(
  "reopens the existing SQLite owner and corroborates the same accepted operation without another event",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectory({ prefix: "t3-settings-owner-reopen-" });
      const databasePath = path.join(directory, "state.sqlite");
      yield* Effect.gen(function* () {
        const firstReceipt = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* createSettingsThread();
            const consumer = yield* makeExistingSettingsConsumer({
              context: settingsContext,
              authorize: () => Effect.succeed(true),
              mapActivity: activityMapping,
            });
            return yield* Effect.promise(() => consumer.append(settingsRecord, settingsContext));
          }).pipe(Effect.provide(makeSettingsLayer(databasePath))),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const consumer = yield* makeExistingSettingsConsumer({
              context: settingsContext,
              authorize: () => Effect.succeed(true),
              mapActivity: activityMapping,
            });
            expect(
              yield* Effect.promise(() => consumer.verifyExistingContext(settingsContext)),
            ).toBe(true);
            const reordered = {
              event: settingsRecord.event,
              bindings: settingsRecord.bindings,
              operation: "apply" as const,
            };
            expect(
              yield* Effect.promise(() => consumer.append(reordered, settingsContext)),
            ).toEqual(firstReceipt);
            const sql = yield* SqlClient.SqlClient;
            const persisted = yield* sql<{
              payloadJson: string;
            }>`SELECT payload_json AS payloadJson FROM projection_thread_activities WHERE activity_id = 'settings-activity'`;
            expect(persisted).toHaveLength(1);
            expect(yield* decodeJsonEvidence(persisted[0]!.payloadJson)).toEqual(settingsRecord);
            expect(
              yield* sql`SELECT COUNT(*) AS count FROM orchestration_events WHERE command_id = 'settings-operation'`,
            ).toEqual([{ count: 1 }]);
          }).pipe(Effect.provide(makeSettingsLayer(databasePath))),
        );
      }).pipe(
        Effect.ensuring(
          fs
            .remove(databasePath)
            .pipe(Effect.andThen(fs.remove(directory, { recursive: true })), Effect.orDie),
        ),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

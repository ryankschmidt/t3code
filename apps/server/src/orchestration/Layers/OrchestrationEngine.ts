import type {
  OrchestrationClientOrigin,
  OrchestrationEvent,
  OrchestrationReadModel,
  ProjectId,
} from "@t3tools/contracts";
import { OrchestrationCommand, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import {
  UnconfirmedSettingsRecordError,
  type ExistingRecordContext,
  type ExistingSettingsConsumer,
  type SettingsBindingRecord,
} from "../../throughline/settings-intent/HostBindings.ts";
import {
  CurrentAuthenticatedSender,
  CurrentSenderClaims,
  assertSenderClaims,
  captureSenderClaims,
  stampMessageSender,
  type AuthenticatedSender,
  type SenderClaim,
} from "../../throughline/identity/sender-stamp.ts";

import {
  metricAttributes,
  orchestrationCommandAckDuration,
  orchestrationCommandsTotal,
  orchestrationCommandDuration,
} from "../../observability/Metrics.ts";
import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import {
  isOrchestrationCommandRejection,
  OrchestrationCommandIdConflictError,
  OrchestrationCommandInvariantError,
  OrchestrationCommandPreviouslyRejectedError,
  type OrchestrationDispatchError,
  type OrchestrationProjectorDecodeError,
} from "../Errors.ts";
import { decideOrchestrationCommand } from "../decider.ts";
import { createEmptyReadModel, projectEvent } from "../projector.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ThreadBackgroundLivenessService } from "../ThreadBackgroundLiveness.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
const isOrchestrationCommandPreviouslyRejectedError = Schema.is(
  OrchestrationCommandPreviouslyRejectedError,
);
const isOrchestrationCommandIdConflictError = Schema.is(OrchestrationCommandIdConflictError);
const decodeSettingsActivityCommand = Schema.decodeUnknownEffect(OrchestrationCommand);

interface CommandEnvelope {
  command: OrchestrationCommand;
  origin: OrchestrationClientOrigin | undefined;
  sender: AuthenticatedSender | undefined;
  senderClaims: readonly SenderClaim[];
  result: Deferred.Deferred<{ sequence: number }, OrchestrationDispatchError>;
  startedAtMs: number;
}

function commandToAggregateRef(command: OrchestrationCommand): {
  readonly aggregateKind: "project" | "thread";
  readonly aggregateId: ProjectId | ThreadId;
} {
  switch (command.type) {
    case "project.create":
    case "project.meta.update":
    case "project.delete":
      return {
        aggregateKind: "project",
        aggregateId: command.projectId,
      };
    default:
      return {
        aggregateKind: "thread",
        aggregateId: command.threadId,
      };
  }
}

const makeOrchestrationEngine = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* OrchestrationEventStore;
  const commandReceiptRepository = yield* OrchestrationCommandReceiptRepository;
  const projectionPipeline = yield* OrchestrationProjectionPipeline;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const threadBackgroundLiveness = yield* ThreadBackgroundLivenessService;
  const crypto = yield* Crypto.Crypto;

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  let commandReadModel = createEmptyReadModel(yield* nowIso);

  const commandQueue = yield* Queue.unbounded<CommandEnvelope>();
  const eventPubSub = yield* PubSub.unbounded<OrchestrationEvent>();

  const projectEventsOntoReadModel = (
    baseReadModel: OrchestrationReadModel,
    events: ReadonlyArray<OrchestrationEvent>,
  ): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError, never> =>
    Effect.gen(function* () {
      let nextReadModel = baseReadModel;
      for (const event of events) {
        nextReadModel = yield* projectEvent(nextReadModel, event);
      }
      return nextReadModel;
    });

  const processEnvelope = (envelope: CommandEnvelope): Effect.Effect<void> => {
    const dispatchStartSequence = commandReadModel.snapshotSequence;
    let processingStartedAtMs = 0;
    const aggregateRef = commandToAggregateRef(envelope.command);
    const baseMetricAttributes = {
      commandType: envelope.command.type,
      aggregateKind: aggregateRef.aggregateKind,
    } as const;
    const reconcileReadModelAfterDispatchFailure = Effect.gen(function* () {
      const persistedEvents = yield* Stream.runCollect(
        eventStore.readFromSequence(dispatchStartSequence),
      ).pipe(Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)));
      if (persistedEvents.length === 0) {
        return;
      }

      commandReadModel = yield* projectEventsOntoReadModel(commandReadModel, persistedEvents);

      for (const persistedEvent of persistedEvents) {
        yield* PubSub.publish(eventPubSub, persistedEvent);
      }
    });

    return Effect.exit(
      Effect.gen(function* () {
        processingStartedAtMs = yield* Clock.currentTimeMillis;
        yield* Effect.annotateCurrentSpan({
          "orchestration.command_id": envelope.command.commandId,
          "orchestration.command_type": envelope.command.type,
          "orchestration.aggregate_kind": aggregateRef.aggregateKind,
          "orchestration.aggregate_id": aggregateRef.aggregateId,
        });

        const existingReceipt = yield* commandReceiptRepository.getByCommandId({
          commandId: envelope.command.commandId,
        });
        if (Option.isSome(existingReceipt)) {
          // A receipt only proves this exact command was handled. Replaying it
          // for a command aimed at another aggregate would report success for
          // work that never happened.
          if (
            existingReceipt.value.aggregateKind !== aggregateRef.aggregateKind ||
            existingReceipt.value.aggregateId !== aggregateRef.aggregateId
          ) {
            return yield* new OrchestrationCommandIdConflictError({
              commandId: envelope.command.commandId,
              receiptAggregateKind: existingReceipt.value.aggregateKind,
              receiptAggregateId: existingReceipt.value.aggregateId,
              commandAggregateKind: aggregateRef.aggregateKind,
              commandAggregateId: aggregateRef.aggregateId,
            });
          }
          if (existingReceipt.value.status === "accepted") {
            yield* assertSenderClaims(envelope.sender, envelope.senderClaims).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationCommandInvariantError({
                    commandType: envelope.command.type,
                    detail: cause.message,
                    cause,
                  }),
              ),
            );
            return {
              sequence: existingReceipt.value.resultSequence,
            };
          }
          return yield* new OrchestrationCommandPreviouslyRejectedError({
            commandId: envelope.command.commandId,
            detail: existingReceipt.value.error ?? "Previously rejected.",
          });
        }

        if (
          envelope.command.type === "thread.auto-settle" &&
          (yield* eventStore.hasEventAfter({
            aggregateKind: "thread",
            aggregateId: envelope.command.threadId,
            sequenceExclusive: envelope.command.snapshotSequence,
          }))
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: envelope.command.type,
            detail: `thread ${envelope.command.threadId} changed before automatic settlement`,
          });
        }

        // The decider compares the lookup inputs. Only recreation needs an
        // event check, since it can reset a thread to the same field values.
        if (
          envelope.command.type === "thread.pull-request.sync" &&
          (yield* eventStore.hasEventAfter({
            aggregateKind: "thread",
            aggregateId: envelope.command.threadId,
            sequenceExclusive: envelope.command.snapshotSequence,
            type: "thread.created",
          }))
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: envelope.command.type,
            detail: `thread ${envelope.command.threadId} was recreated before pull request discovery`,
          });
        }

        if (
          envelope.command.type === "thread.auto-settle" &&
          threadBackgroundLiveness.getThreadBackgroundLiveness(envelope.command.threadId) !== null
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: envelope.command.type,
            detail: `thread ${envelope.command.threadId} has live background work`,
          });
        }

        // New and moved projects do not carry a resolved identity in the event-derived
        // command model. Legacy PR edits need it to identify the link they replace.
        if (
          envelope.command.type === "thread.meta.update" &&
          envelope.command.linkedPullRequest !== undefined
        ) {
          const threadId = envelope.command.threadId;
          const thread = commandReadModel.threads.find((thread) => thread.id === threadId);
          if (thread !== undefined) {
            const project = yield* projectionSnapshotQuery.getProjectShellById(thread.projectId);
            if (Option.isSome(project)) {
              commandReadModel = {
                ...commandReadModel,
                projects: commandReadModel.projects.map((entry) =>
                  entry.id === thread.projectId
                    ? { ...entry, repositoryIdentity: project.value.repositoryIdentity }
                    : entry,
                ),
              };
            }
          }
        }

        // Command snapshots omit activities at startup and cap them while running.
        // Read this request's durable state before deciding how to send the answer.
        const userInputActivity =
          envelope.command.type === "thread.user-input.respond" ||
          envelope.command.type === "thread.user-input.dismiss"
            ? yield* projectionSnapshotQuery.getUserInputActivity(envelope.command)
            : Option.none();
        const eventBase = yield* decideOrchestrationCommand({
          command: envelope.command,
          readModel: commandReadModel,
          ...(Option.isSome(userInputActivity)
            ? { userInputActivity: userInputActivity.value }
            : {}),
        }).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.mapError((cause) =>
            isOrchestrationCommandRejection(cause)
              ? cause
              : new OrchestrationCommandInvariantError({
                  commandType: envelope.command.type,
                  detail: "Failed to generate an event identifier.",
                  cause,
                }),
          ),
        );
        yield* assertSenderClaims(envelope.sender, envelope.senderClaims).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationCommandInvariantError({
                commandType: envelope.command.type,
                detail: cause.message,
                cause,
              }),
          ),
        );
        const plannedEvents = Array.isArray(eventBase) ? eventBase : [eventBase];
        // Stamp the dispatching client's origin onto every event the command
        // produced. The decider stays pure; attribution is an engine concern.
        const originatedEvents =
          envelope.origin === undefined
            ? plannedEvents
            : plannedEvents.map((planned) => ({
                ...planned,
                metadata: { ...planned.metadata, origin: envelope.origin },
              }));
        const eventBases =
          envelope.sender === undefined
            ? originatedEvents
            : originatedEvents.map((planned) => ({
                ...planned,
                metadata: {
                  ...planned.metadata,
                  senderPublicId: envelope.sender!.publicAgentId,
                  senderGeneration: envelope.sender!.generation,
                },
              }));
        const committedCommand = yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const committedEvents: OrchestrationEvent[] = [];
              const attachmentCleanups: Effect.Effect<void>[] = [];
              let nextCommandReadModel = commandReadModel;

              for (const nextEvent of eventBases) {
                const savedEvent = yield* eventStore.append(nextEvent);
                nextCommandReadModel = yield* projectEvent(nextCommandReadModel, savedEvent);
                const cleanup = yield* projectionPipeline.projectEventDeferred(savedEvent);
                if (envelope.sender !== undefined && savedEvent.type === "thread.message-sent") {
                  yield* stampMessageSender(savedEvent.payload.messageId, envelope.sender).pipe(
                    Effect.provideService(SqlClient.SqlClient, sql),
                    Effect.mapError(
                      (cause) =>
                        new OrchestrationCommandInvariantError({
                          commandType: envelope.command.type,
                          detail: "Authenticated sender persistence mismatch.",
                          cause,
                        }),
                    ),
                  );
                }
                attachmentCleanups.push(cleanup);
                committedEvents.push(savedEvent);
              }

              const lastSavedEvent = committedEvents.at(-1) ?? null;
              if (lastSavedEvent === null) {
                return yield* new OrchestrationCommandInvariantError({
                  commandType: envelope.command.type,
                  detail: "Command produced no events.",
                });
              }

              yield* commandReceiptRepository.upsert({
                commandId: envelope.command.commandId,
                aggregateKind: lastSavedEvent.aggregateKind,
                aggregateId: lastSavedEvent.aggregateId,
                acceptedAt: lastSavedEvent.occurredAt,
                resultSequence: lastSavedEvent.sequence,
                status: "accepted",
                error: null,
              });

              return {
                committedEvents,
                attachmentCleanups,
                lastSequence: lastSavedEvent.sequence,
                nextCommandReadModel,
              } as const;
            }),
          )
          .pipe(
            Effect.catchTag("SqlError", (sqlError) =>
              Effect.fail(
                toPersistenceSqlError("OrchestrationEngine.processEnvelope:transaction")(sqlError),
              ),
            ),
          );

        commandReadModel = committedCommand.nextCommandReadModel;
        for (const cleanup of committedCommand.attachmentCleanups) {
          yield* cleanup;
        }
        for (const [index, event] of committedCommand.committedEvents.entries()) {
          yield* PubSub.publish(eventPubSub, event);
          if (index === 0) {
            yield* Metric.update(
              Metric.withAttributes(
                orchestrationCommandAckDuration,
                metricAttributes({
                  ...baseMetricAttributes,
                  ackEventType: event.type,
                }),
              ),
              Duration.millis(Math.max(0, (yield* Clock.currentTimeMillis) - envelope.startedAtMs)),
            );
          }
        }
        return { sequence: committedCommand.lastSequence };
      }).pipe(Effect.withSpan(`orchestration.command.${envelope.command.type}`)),
    ).pipe(
      Effect.flatMap((exit) =>
        Effect.gen(function* () {
          const outcome = Exit.isSuccess(exit)
            ? "success"
            : Cause.hasInterruptsOnly(exit.cause)
              ? "interrupt"
              : "failure";
          yield* Metric.update(
            Metric.withAttributes(
              orchestrationCommandDuration,
              metricAttributes(baseMetricAttributes),
            ),
            Duration.millis(Math.max(0, (yield* Clock.currentTimeMillis) - processingStartedAtMs)),
          );
          yield* Metric.update(
            Metric.withAttributes(
              orchestrationCommandsTotal,
              metricAttributes({
                ...baseMetricAttributes,
                outcome,
              }),
            ),
            1,
          );

          if (Exit.isSuccess(exit)) {
            yield* Deferred.succeed(envelope.result, exit.value);
            return;
          }

          const error = Cause.squash(exit.cause) as OrchestrationDispatchError;
          if (
            !isOrchestrationCommandPreviouslyRejectedError(error) &&
            !isOrchestrationCommandIdConflictError(error)
          ) {
            yield* reconcileReadModelAfterDispatchFailure.pipe(
              Effect.catch(() =>
                Effect.logWarning(
                  "failed to reconcile orchestration read model after dispatch failure",
                ).pipe(
                  Effect.annotateLogs({
                    commandId: envelope.command.commandId,
                    snapshotSequence: commandReadModel.snapshotSequence,
                  }),
                ),
              ),
            );

            if (isOrchestrationCommandRejection(error)) {
              const previousReceipt = yield* commandReceiptRepository
                .getByCommandId({
                  commandId: envelope.command.commandId,
                })
                .pipe(Effect.exit);
              // A forged replay is refused, but cannot rewrite the original
              // accepted command's durable receipt into a rejection.
              if (
                Exit.isSuccess(previousReceipt) &&
                (Option.isNone(previousReceipt.value) ||
                  previousReceipt.value.value.status !== "accepted")
              ) {
                yield* commandReceiptRepository
                  .upsert({
                    commandId: envelope.command.commandId,
                    aggregateKind: aggregateRef.aggregateKind,
                    aggregateId: aggregateRef.aggregateId,
                    acceptedAt: yield* nowIso,
                    resultSequence: commandReadModel.snapshotSequence,
                    status: "rejected",
                    error: error.message,
                  })
                  .pipe(Effect.ignore);
              }
            }
          }

          yield* Deferred.fail(envelope.result, error);
        }),
      ),
    );
  };

  yield* projectionPipeline.bootstrap;
  commandReadModel = yield* projectionSnapshotQuery.getCommandReadModel();

  const worker = Effect.forever(Queue.take(commandQueue).pipe(Effect.flatMap(processEnvelope)));
  yield* Effect.forkScoped(worker);
  yield* Effect.logDebug("orchestration engine started").pipe(
    Effect.annotateLogs({ sequence: commandReadModel.snapshotSequence }),
  );

  const readEvents: OrchestrationEngineShape["readEvents"] = (fromSequenceExclusive, limit) =>
    eventStore.readFromSequence(fromSequenceExclusive, limit);

  const readThreadEvents: OrchestrationEngineShape["readThreadEvents"] = ({ threadId, ...range }) =>
    eventStore.readAggregateRange({ ...range, aggregateKind: "thread", aggregateId: threadId });

  const getThreadReplayStats: OrchestrationEngineShape["getThreadReplayStats"] = ({
    threadId,
    ...range
  }) =>
    eventStore.getAggregateReplayStats({
      ...range,
      aggregateKind: "thread",
      aggregateId: threadId,
    });

  const dispatch: OrchestrationEngineShape["dispatch"] = (command, options) =>
    Effect.gen(function* () {
      const currentSender = yield* CurrentAuthenticatedSender;
      const sender = currentSender === undefined ? undefined : { ...currentSender };
      const senderClaims = [...(yield* CurrentSenderClaims), ...captureSenderClaims(command)];
      const result = yield* Deferred.make<{ sequence: number }, OrchestrationDispatchError>();
      yield* Queue.offer(commandQueue, {
        command,
        origin: options?.origin,
        sender,
        senderClaims,
        result,
        startedAtMs: yield* Clock.currentTimeMillis,
      });
      return yield* Deferred.await(result);
    });

  return {
    readEvents,
    readThreadEvents,
    getThreadReplayStats,
    dispatch,
    subscribeDomainEvents: PubSub.subscribe(eventPubSub).pipe(Effect.map(Stream.fromSubscription)),
    // Each access creates a fresh PubSub subscription so that multiple
    // consumers (wsServer, ProviderRuntimeIngestion, CheckpointReactor, etc.)
    // each independently receive all domain events.
    get streamDomainEvents(): OrchestrationEngineShape["streamDomainEvents"] {
      return Stream.fromPubSub(eventPubSub);
    },
    // The command read model's snapshotSequence tracks the latest committed
    // event sequence (updated on the worker fiber). A plain property read is a
    // consistent, committed value — reassignment of `commandReadModel` is
    // atomic on the single-threaded event loop.
    latestSequence: Effect.sync(() => commandReadModel.snapshotSequence),
  } satisfies OrchestrationEngineShape;
});

export const OrchestrationEngineLive = Layer.effect(
  OrchestrationEngineService,
  makeOrchestrationEngine,
);

type SettingsActivityCommand = Extract<OrchestrationCommand, { type: "thread.activity.append" }>;

export interface ExistingSettingsConsumerOptions {
  readonly context: ExistingRecordContext;
  /** Current caller authorization, captured by the owning authenticated ingress. */
  readonly authorize: (context: ExistingRecordContext) => Effect.Effect<boolean, unknown>;
  /** The owner supplies its admitted activity mapping and stable operation IDs.
   * This adapter does not invent a settings event kind or infer a record. */
  readonly mapActivity: (
    record: SettingsBindingRecord,
    context: ExistingRecordContext,
  ) => Pick<SettingsActivityCommand, "commandId" | "createdAt"> & {
    readonly activity: Pick<
      SettingsActivityCommand["activity"],
      "id" | "tone" | "kind" | "summary" | "createdAt"
    >;
  };
}

// Keep only the reviewed field-limited core's data, not arbitrary settings or
// transport properties. Fixed key order also makes persisted comparison immune
// to JSON property-order differences.
function copySettingsRecord(record: SettingsBindingRecord): SettingsBindingRecord {
  const common = {
    bindings: {
      source: record.bindings.source,
      revision: record.bindings.revision,
      hosts: record.bindings.hosts.map(({ role, environmentId }) => ({ role, environmentId })),
    },
    event: {
      setting: record.event.setting,
      value: record.event.value,
      hosts: record.event.hosts.map(({ host, before, effective, status }) => ({
        host,
        before,
        effective,
        status,
      })),
    },
  };
  return record.operation === "apply"
    ? { operation: "apply", ...common }
    : {
        operation: "rollback",
        ...common,
        hosts: record.hosts.map(({ host, effective, status }) => ({ host, effective, status })),
      };
}

/** Promise adapter for the reviewed HostBindings core. All durable operations
 * still belong to the existing engine, event store and command receipt lane.
 * Captured services must share the same server environment/database lifetime. */
export const makeExistingSettingsConsumer = Effect.fn("makeExistingSettingsConsumer")(function* (
  options: ExistingSettingsConsumerOptions,
) {
  const identity = yield* ServerEnvironmentIdentity;
  const threads = yield* ProjectionThreadRepository;
  const engine = yield* OrchestrationEngineService;
  const receipts = yield* OrchestrationCommandReceiptRepository;
  const events = yield* OrchestrationEventStore;
  const context = Object.freeze({ ...options.context });
  const authorize = options.authorize;
  const mapActivity = options.mapActivity;

  const verify = Effect.fnUntraced(function* (candidate: ExistingRecordContext) {
    const environmentId = yield* identity.getEnvironmentId;
    if (
      candidate.owner !== "OrchestrationEngine" ||
      candidate.environmentId !== environmentId ||
      candidate.environmentId !== context.environmentId ||
      candidate.threadId !== context.threadId ||
      context.owner !== "OrchestrationEngine" ||
      !(yield* authorize(context))
    ) {
      return false;
    }
    const thread = yield* threads.getById({ threadId: ThreadId.make(context.threadId) });
    return (
      Option.isSome(thread) &&
      thread.value.threadId === context.threadId &&
      thread.value.deletedAt === null
    );
  });

  return {
    context,
    verifyExistingContext: (candidate) =>
      Effect.runPromise(verify(candidate).pipe(Effect.catchCause(() => Effect.succeed(false)))),
    append: async (input, candidate) => {
      const record = copySettingsRecord(input);
      try {
        return await Effect.runPromise(
          Effect.gen(function* () {
            if (!(yield* verify(candidate))) throw new Error("DURABLE_CONTEXT_UNAVAILABLE");
            const mapped = mapActivity(record, context);
            const command: SettingsActivityCommand = {
              type: "thread.activity.append",
              commandId: mapped.commandId,
              threadId: ThreadId.make(context.threadId),
              createdAt: mapped.createdAt,
              activity: {
                id: mapped.activity.id,
                tone: mapped.activity.tone,
                kind: mapped.activity.kind,
                summary: mapped.activity.summary,
                createdAt: mapped.activity.createdAt,
                payload: record,
                turnId: null,
              },
            };
            yield* decodeSettingsActivityCommand(command);
            const { sequence } = yield* engine.dispatch(command);
            const persisted = yield* receipts.getByCommandId({ commandId: command.commandId });
            if (
              !Number.isSafeInteger(sequence) ||
              sequence < 1 ||
              Option.isNone(persisted) ||
              persisted.value.status !== "accepted" ||
              persisted.value.aggregateKind !== "thread" ||
              persisted.value.aggregateId !== context.threadId ||
              persisted.value.resultSequence !== sequence
            ) {
              throw new Error("DURABLE_RECEIPT_UNCONFIRMED");
            }
            const saved = yield* Stream.runCollect(
              events.readAggregateRange({
                aggregateKind: "thread",
                aggregateId: context.threadId,
                fromSequenceExclusive: sequence - 1,
                toSequenceInclusive: sequence,
                limit: 1,
              }),
            );
            const event = saved[0];
            if (
              saved.length !== 1 ||
              !event ||
              event.type !== "thread.activity-appended" ||
              event.commandId !== command.commandId ||
              event.sequence !== sequence ||
              event.payload.threadId !== context.threadId ||
              event.payload.activity.id !== command.activity.id ||
              event.payload.activity.kind !== command.activity.kind ||
              event.payload.activity.tone !== command.activity.tone ||
              event.payload.activity.summary !== command.activity.summary ||
              event.payload.activity.turnId !== null ||
              event.payload.activity.createdAt !== command.activity.createdAt ||
              event.occurredAt !== command.createdAt ||
              JSON.stringify(
                copySettingsRecord(event.payload.activity.payload as SettingsBindingRecord),
              ) !== JSON.stringify(record)
            ) {
              throw new Error("DURABLE_RECEIPT_UNCONFIRMED");
            }
            // Environment is read from the actual owner, never echoed from a request.
            const environmentId = yield* identity.getEnvironmentId;
            if (environmentId !== context.environmentId)
              throw new Error("DURABLE_CONTEXT_UNAVAILABLE");
            return {
              environmentId,
              threadId: event.payload.threadId,
              commandId: event.commandId,
              sequence: event.sequence,
            };
          }),
        );
      } catch {
        // Host writes may already have happened. Do not retry or assert absence.
        throw new UnconfirmedSettingsRecordError(record);
      }
    },
  } satisfies ExistingSettingsConsumer;
});

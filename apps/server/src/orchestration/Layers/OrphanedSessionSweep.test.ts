import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";

import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ORPHANED_SESSION_REASON,
  runOrphanedSessionSweep,
  sweepOrphanedSessions,
} from "./OrphanedSessionSweep.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const PROJECT_ID = ProjectId.make("project-orphan-sweep");

const defaultModelSelection = {
  instanceId: ProviderInstanceId.make("pi"),
  model: "anthropic/claude-opus-4-8",
} as const;

function makeSession(input: {
  readonly threadId: ThreadId;
  readonly status: OrchestrationSession["status"];
  readonly activeTurnId?: TurnId | null;
}): OrchestrationSession {
  return {
    threadId: input.threadId,
    status: input.status,
    providerName: "pi",
    runtimeMode: "full-access",
    activeTurnId: input.activeTurnId ?? null,
    lastError: null,
    updatedAt: NOW,
  };
}

function makeThread(input: {
  readonly id: ThreadId;
  readonly session: OrchestrationSession | null;
  readonly deletedAt?: string | null;
}): OrchestrationThread {
  return {
    id: input.id,
    projectId: PROJECT_ID,
    title: `Thread ${input.id}`,
    modelSelection: defaultModelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    deletedAt: input.deletedAt ?? null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: input.session,
  };
}

function makeReadModel(threads: ReadonlyArray<OrchestrationThread>): OrchestrationReadModel {
  return {
    snapshotSequence: 7,
    projects: [
      {
        id: PROJECT_ID,
        title: "Orphan Sweep Project",
        workspaceRoot: "/tmp/orphan-sweep-project",
        defaultModelSelection,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
    threads: [...threads],
    updatedAt: NOW,
  };
}

function makeSnapshotQueryLayer(input: {
  readonly getSnapshot: () => ReturnType<
    (typeof ProjectionSnapshotQuery)["Service"]["getSnapshot"]
  >;
}) {
  return Layer.succeed(ProjectionSnapshotQuery, {
    getCommandReadModel: () => Effect.die("unused"),
    getSnapshot: input.getSnapshot,
    getShellSnapshot: () => Effect.die("unused"),
    getArchivedShellSnapshot: () => Effect.die("unused"),
    getSnapshotSequence: () => Effect.die("unused"),
    getCounts: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
    getProjectShellById: () => Effect.die("unused"),
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.die("unused"),
    getFullThreadDiffContext: () => Effect.die("unused"),
    getThreadShellById: () => Effect.die("unused"),
    getThreadDetailById: () => Effect.die("unused"),
  });
}

function makeEngine(input?: {
  readonly failFor?: ReadonlySet<string>;
}): { readonly engine: OrchestrationEngineShape; readonly dispatched: OrchestrationCommand[] } {
  const dispatched: OrchestrationCommand[] = [];
  const engine: OrchestrationEngineShape = {
    readEvents: () => Stream.empty,
    dispatch: (command) =>
      "threadId" in command && input?.failFor?.has(String(command.threadId))
        ? Effect.die("dispatch boom")
        : Effect.sync(() => {
            dispatched.push(command);
            return { sequence: dispatched.length };
          }),
    streamDomainEvents: Stream.empty,
  };
  return { engine, dispatched };
}

function runSweep(input: {
  readonly readModel: OrchestrationReadModel;
  readonly failFor?: ReadonlySet<string>;
}) {
  const { engine, dispatched } = makeEngine({ failFor: input.failFor ?? new Set() });
  const layer = Layer.mergeAll(
    Layer.succeed(OrchestrationEngineService, engine),
    makeSnapshotQueryLayer({ getSnapshot: () => Effect.succeed(input.readModel) }),
    NodeServices.layer,
  );
  return Effect.runPromise(sweepOrphanedSessions.pipe(Effect.provide(layer))).then((result) => ({
    result,
    dispatched,
  }));
}

describe("sweepOrphanedSessions", () => {
  it("terminates in-flight sessions from a previous boot with a visible error", async () => {
    const runningThreadId = ThreadId.make("thread-orphan-running");
    const startingThreadId = ThreadId.make("thread-orphan-starting");
    const { result, dispatched } = await runSweep({
      readModel: makeReadModel([
        makeThread({
          id: runningThreadId,
          session: makeSession({
            threadId: runningThreadId,
            status: "running",
            activeTurnId: TurnId.make("turn-orphan-1"),
          }),
        }),
        makeThread({
          id: startingThreadId,
          session: makeSession({ threadId: startingThreadId, status: "starting" }),
        }),
      ]),
    });

    expect(result.sweptThreadIds).toEqual([runningThreadId, startingThreadId]);
    expect(dispatched).toHaveLength(2);

    const command = dispatched[0];
    expect(command?.type).toBe("thread.session.set");
    if (command?.type !== "thread.session.set") {
      throw new Error("expected a thread.session.set command");
    }
    expect(command.threadId).toBe(runningThreadId);
    expect(String(command.commandId)).toMatch(/^server:orphaned-session-sweep:/);
    // Terminal session: the projector settles a running latestTurn to
    // "error" for this status (settledTurnStateForSessionStatus) — the
    // spinner clears and the thread fails visibly.
    expect(command.session.status).toBe("error");
    expect(command.session.activeTurnId).toBeNull();
    expect(command.session.lastError).toBe(ORPHANED_SESSION_REASON);
    expect(command.session.providerName).toBe("pi");
  });

  it("leaves settled sessions, missing sessions, and deleted threads untouched", async () => {
    const threads = (
      ["idle", "ready", "interrupted", "stopped", "error"] as const
    ).map((status, index) => {
      const id = ThreadId.make(`thread-settled-${index}`);
      return makeThread({ id, session: makeSession({ threadId: id, status }) });
    });
    const noSessionThreadId = ThreadId.make("thread-no-session");
    const deletedThreadId = ThreadId.make("thread-deleted-running");
    const { result, dispatched } = await runSweep({
      readModel: makeReadModel([
        ...threads,
        makeThread({ id: noSessionThreadId, session: null }),
        makeThread({
          id: deletedThreadId,
          session: makeSession({ threadId: deletedThreadId, status: "running" }),
          deletedAt: NOW,
        }),
      ]),
    });

    expect(result.sweptThreadIds).toEqual([]);
    expect(dispatched).toHaveLength(0);
  });

  it("keeps sweeping when one dispatch fails", async () => {
    const failingThreadId = ThreadId.make("thread-orphan-fails");
    const survivingThreadId = ThreadId.make("thread-orphan-survives");
    const { result, dispatched } = await runSweep({
      readModel: makeReadModel([
        makeThread({
          id: failingThreadId,
          session: makeSession({ threadId: failingThreadId, status: "running" }),
        }),
        makeThread({
          id: survivingThreadId,
          session: makeSession({ threadId: survivingThreadId, status: "running" }),
        }),
      ]),
      failFor: new Set([String(failingThreadId)]),
    });

    expect(result.sweptThreadIds).toEqual([survivingThreadId]);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.type).toBe("thread.session.set");
  });
});

describe("runOrphanedSessionSweep", () => {
  it("never fails the boot, even when the snapshot read blows up", async () => {
    const { engine } = makeEngine();
    const layer = Layer.mergeAll(
      Layer.succeed(OrchestrationEngineService, engine),
      makeSnapshotQueryLayer({ getSnapshot: () => Effect.die("snapshot boom") }),
      NodeServices.layer,
    );
    await expect(
      Effect.runPromise(runOrphanedSessionSweep.pipe(Effect.provide(layer))),
    ).resolves.toBeUndefined();
  });
});

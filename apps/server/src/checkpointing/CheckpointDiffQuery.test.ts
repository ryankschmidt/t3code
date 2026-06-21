import { assert, it, vi } from "@effect/vitest";
import {
  CheckpointRef,
  CheckpointScopeId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { checkpointRefForScopeOrdinal } from "../orchestration-v2/CheckpointService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as CheckpointDiffQuery from "./CheckpointDiffQuery.ts";
import * as CheckpointStore from "./CheckpointStore.ts";

it.effect("computes V2 run diffs from projected checkpoint scopes", () => {
  const threadId = ThreadId.make("thread:checkpoint-diff-v2");
  const firstRunId = RunId.make("run:checkpoint-diff-v2:1");
  const secondRunId = RunId.make("run:checkpoint-diff-v2:2");
  const firstScopeId = CheckpointScopeId.make("scope:checkpoint-diff-v2:1");
  const secondScopeId = CheckpointScopeId.make("scope:checkpoint-diff-v2:2");
  const secondRef = CheckpointRef.make("refs/t3/test/second");
  const projection = {
    runs: [
      { id: firstRunId, ordinal: 1 },
      { id: secondRunId, ordinal: 2 },
    ],
    checkpointScopes: [
      { id: firstScopeId, runId: firstRunId, kind: "root_run", cwd: "/repo" },
      { id: secondScopeId, runId: secondRunId, kind: "root_run", cwd: "/repo" },
    ],
    checkpoints: [
      {
        scopeId: secondScopeId,
        appRunOrdinal: 2,
        status: "ready",
        ref: secondRef,
      },
    ],
  } as unknown as OrchestrationV2ThreadProjection;
  const diffCheckpoints = vi.fn((_input: CheckpointStore.DiffCheckpointsInput) =>
    Effect.succeed("diff --git a/file b/file"),
  );
  const layer = CheckpointDiffQuery.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadProjection: () => Effect.succeed(projection),
        }),
        Layer.mock(CheckpointStore.CheckpointStore)({ diffCheckpoints }),
      ),
    ),
  );

  return Effect.gen(function* () {
    const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
    const result = yield* query.getFullThreadDiff({ threadId, toTurnCount: 2 });

    assert.equal(result.diff, "diff --git a/file b/file");
    assert.deepEqual(diffCheckpoints.mock.calls[0]?.[0], {
      cwd: "/repo",
      fromCheckpointRef: checkpointRefForScopeOrdinal({
        scopeId: firstScopeId,
        ordinalWithinScope: 0,
      }),
      toCheckpointRef: secondRef,
      fallbackFromToHead: false,
      ignoreWhitespace: true,
    });
  }).pipe(Effect.provide(layer));
});

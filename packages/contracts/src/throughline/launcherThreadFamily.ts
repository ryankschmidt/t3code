// Owner-applied transport schema; intended address packages/contracts/src/throughline/launcherThreadFamily.ts.
import * as Schema from "effect/Schema";
import { ThreadId } from "../baseSchemas.ts";

export const LauncherThreadFamilyInput = Schema.Struct({ threadId: ThreadId });
const base = {
  threadId: Schema.NonEmptyString,
  source: Schema.Literals(["agent-instruments.thread-lineage.v1"]),
};
export const LauncherThreadFamily = Schema.Union([
  Schema.Struct({ ...base, status: Schema.Literals(["unknown"]), reason: Schema.String }),
  Schema.Struct({
    ...base,
    status: Schema.Literals(["recorded"]),
    parentThreadId: Schema.NullOr(Schema.NonEmptyString),
    creatorResolution: Schema.String,
    launcherSeat: Schema.NullOr(Schema.String),
    purpose: Schema.String,
    handle: Schema.NullOr(Schema.String),
    host: Schema.String,
    family: Schema.Union([
      Schema.Struct({
        status: Schema.Literals(["recorded"]),
        rootThreadId: Schema.NonEmptyString,
        ancestorThreadIds: Schema.Array(Schema.NonEmptyString),
      }),
      Schema.Struct({
        status: Schema.Literals(["unknown"]),
        reason: Schema.String,
        ancestorThreadIds: Schema.Array(Schema.NonEmptyString),
      }),
    ]),
  }),
]);
export type LauncherThreadFamily = typeof LauncherThreadFamily.Type;

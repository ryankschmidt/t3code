import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ComsNetTransport from "../../ComsNetTransport.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ComsNetTransport.ComsNetTransport,
  OrchestrationEngineService,
  ProjectionSnapshotQuery,
];

const RequestIdInput = Schema.Struct({ requestId: Schema.String });
const WaitInput = Schema.Struct({
  requestId: Schema.String,
  timeoutMs: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 120_000 }))),
  result: Schema.optional(Schema.Unknown),
});
const SubscribeInput = Schema.Struct({
  timeoutMs: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 120_000 }))),
});
const SendInput = Schema.Struct({
  targetPeerId: Schema.String,
  kind: Schema.String,
  payload: Schema.Unknown,
});
const Failure = Schema.String;
const Success = Schema.Unknown;

const readonlyTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true) as T;

export const ComsNetPeersTool = readonlyTool(
  Tool.make("comsnet_peers", {
    description:
      "List current Claude and Codex seats by stable provider session identity. ThroughLine derives this roster; callers cannot supply or override identities.",
    parameters: Schema.Struct({}),
    success: Success,
    failure: Failure,
    dependencies,
  }).annotate(Tool.Title, "List ComsNet peers"),
);

export const ComsNetSendTool = Tool.make("comsnet_send", {
  description:
    "Send one correlated request to a named current ThroughLine peer. The receiver's ordinary finished turn becomes the terminal result; do not poll its pane.",
  parameters: SendInput,
  success: Success,
  failure: Failure,
  dependencies,
})
  .annotate(Tool.Title, "Send ComsNet request")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false);

export const ComsNetSubscribeTool = Tool.make("comsnet_subscribe", {
  description:
    "Receive queued requests for this exact seat, or wait once up to timeoutMs for the next request. The MCP credential determines the receiver.",
  parameters: SubscribeInput,
  success: Success,
  failure: Failure,
  dependencies,
})
  .annotate(Tool.Title, "Subscribe to ComsNet")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

export const ComsNetStatusTool = readonlyTool(
  Tool.make("comsnet_status", {
    description: "Read one request's status when this seat is its sender or receiver.",
    parameters: RequestIdInput,
    success: Success,
    failure: Failure,
    dependencies,
  }).annotate(Tool.Title, "Get ComsNet status"),
);

export const ComsNetResultTool = Tool.make("comsnet_result", {
  description:
    "Receivers supply result to finish exactly once. Senders omit result to wait once for the receiver's ordinary finished turn. Duplicate completion is refused.",
  parameters: WaitInput,
  success: Success,
  failure: Failure,
  dependencies,
})
  .annotate(Tool.Title, "Complete or await ComsNet result")
  .annotate(Tool.Destructive, false);

export const ComsNetToolkit = Toolkit.make(
  ComsNetPeersTool,
  ComsNetSendTool,
  ComsNetSubscribeTool,
  ComsNetStatusTool,
  ComsNetResultTool,
);

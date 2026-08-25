import {
  type EnvironmentId,
  PreviewAutomationUnavailableError,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

export type McpCapability = "preview" | "comsnet";

export interface McpInvocationScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly capabilities: ReadonlySet<McpCapability>;
  readonly issuedAt: number;
}

export class McpInvocationContext extends Context.Service<
  McpInvocationContext,
  McpInvocationScope
>()("t3/mcp/McpInvocationContext") {}

export class McpCapabilityUnavailableError extends Data.TaggedError(
  "McpCapabilityUnavailableError",
)<{
  readonly capability: McpCapability;
  readonly threadId: ThreadId;
}> {}

export const requireMcpCapability = Effect.fn("mcp.requireCapability")(function* (
  _capability: "preview" = "preview",
) {
  const invocation = yield* McpInvocationContext;
  if (!invocation.capabilities.has("preview")) {
    return yield* new PreviewAutomationUnavailableError({
      capability: "preview",
      environmentId: invocation.environmentId,
      threadId: invocation.threadId,
      providerSessionId: invocation.providerSessionId,
      providerInstanceId: invocation.providerInstanceId,
    });
  }
  return invocation;
});

export const requireComsNetCapability = Effect.fn("mcp.requireComsNetCapability")(function* () {
  const invocation = yield* McpInvocationContext;
  if (!invocation.capabilities.has("comsnet")) {
    return yield* new McpCapabilityUnavailableError({
      capability: "comsnet",
      threadId: invocation.threadId,
    });
  }
  return invocation;
});

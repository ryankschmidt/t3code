// ThroughLine-owned provider message identity: one native-address adapter for all consumers.
import * as Context from "effect/Context";
import {
  claudeDisplayedMessageUuid,
  resolveClaudeRewindMessage,
  type ClaudeSessionLineage,
} from "./native-lineage.ts";
export { NATIVE_UUID_NAMESPACE_V1, readClaudeSessionLineage } from "./native-lineage.ts";
export type { ClaudeSessionLineage } from "./native-lineage.ts";

export type AdmittedMessageRef = {
  readonly threadId: string;
  readonly messageId: string;
  readonly turnId?: string;
  readonly eventId?: string;
};
export type MessageOrigin = AdmittedMessageRef;
// Test-local compatibility input; the operation context itself always carries AdmittedMessageRef.
export type RewindTarget = {
  readonly beforeMessageId: string;
  readonly fallbackTurnId?: string;
  readonly threadId?: string;
};

// Values are provided around the exact operation, not captured from a worker scope or inferred.
export const CurrentMessageOrigin = Context.Reference<MessageOrigin | undefined>(
  "ThroughLine/identity/CurrentMessageOrigin",
  { defaultValue: () => undefined },
);
export const CurrentRewindTarget = Context.Reference<AdmittedMessageRef | undefined>(
  "ThroughLine/identity/CurrentRewindTarget",
  { defaultValue: () => undefined },
);

export function nativeUuidFor(origin: MessageOrigin & { readonly firstTurnId?: string }): string {
  return origin.firstTurnId ?? claudeDisplayedMessageUuid(origin.threadId, origin.messageId);
}

export async function resolveNative(input: {
  readonly providerInstanceConfigDir?: string;
  readonly currentSessionId: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly fallbackTurnId?: string;
  readonly effectivePromptIds: ReadonlyArray<string>;
  readonly readLineage?: (sessionId: string) => Promise<ClaudeSessionLineage | undefined>;
}): Promise<
  | { readonly status: "resolved"; readonly sessionId: string; readonly uuid: string }
  | { readonly status: "unavailable"; readonly reason: string }
> {
  const uuid = await resolveClaudeRewindMessage({
    sessionId: input.currentSessionId,
    ...(input.providerInstanceConfigDir ? { configDir: input.providerInstanceConfigDir } : {}),
    currentMessageIds: input.effectivePromptIds,
    requestedIds: [
      input.messageId,
      ...(input.fallbackTurnId ? [input.fallbackTurnId] : []),
      nativeUuidFor(input),
    ],
    ...(input.readLineage ? { readLineage: input.readLineage } : {}),
  });
  return uuid === undefined
    ? {
        status: "unavailable",
        reason:
          "No exact native prompt in this session generation has the admitted displayed identity.",
      }
    : { status: "resolved", sessionId: input.currentSessionId, uuid };
}

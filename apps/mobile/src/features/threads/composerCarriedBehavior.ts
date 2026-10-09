import { parseClaudeComposerMenu } from "@t3tools/shared/claudeComposerMenus";
import type { ModelObservationActivity } from "@t3tools/contracts";

export type ComposerSubmissionSource = "send-arrow" | "keyboard-submit";

export function withThreadModelActivities<T extends { readonly id: string }>(
  thread: T,
  detail: {
    readonly id: string;
    readonly activities: readonly ModelObservationActivity[];
  } | null,
): T & { readonly activities: readonly ModelObservationActivity[] } {
  return { ...thread, activities: detail?.id === thread.id ? detail.activities : [] };
}

export function formatComposerAnswerObservation(observation: {
  readonly requestedModel: string | null;
  readonly answeringModel: string | null;
  readonly verdict: "match" | "mismatch" | "unknown";
}): string {
  const answered = observation.answeringModel;
  if (answered === null) return "Answered: unknown";
  const label = `Answered: ${answered}`;
  return observation.verdict === "mismatch" && observation.requestedModel !== null
    ? `${label} · Substituted: ${observation.requestedModel} → ${answered}`
    : label;
}

export function composerReturnBehavior(platform: string): "newline" | undefined {
  return platform === "ios" ? "newline" : undefined;
}

export function resolveCarriedComposerSubmission(input: {
  readonly platform: string;
  readonly source: ComposerSubmissionSource;
  readonly draftMessage: string;
  readonly attachmentCount: number;
  readonly driver: string | undefined;
  readonly blocked: boolean;
}):
  | { readonly kind: "blocked" }
  | { readonly kind: "send" }
  | { readonly kind: "local-menu"; readonly menu: "rewind" | "config" } {
  if (input.blocked || (input.platform === "ios" && input.source !== "send-arrow")) {
    return { kind: "blocked" };
  }
  const menu =
    input.driver === "claudeAgent" && input.attachmentCount === 0
      ? parseClaudeComposerMenu(input.draftMessage)
      : null;
  return menu ? { kind: "local-menu", menu } : { kind: "send" };
}

export async function sendWithComposerGuard<T>(
  inFlight: Set<string>,
  threadKey: string,
  send: () => Promise<T | null>,
): Promise<T | null> {
  if (inFlight.has(threadKey)) return null;
  inFlight.add(threadKey);
  try {
    return await send();
  } finally {
    inFlight.delete(threadKey);
  }
}

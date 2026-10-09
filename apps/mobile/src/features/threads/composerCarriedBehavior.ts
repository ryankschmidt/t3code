import { parseClaudeComposerMenu } from "@t3tools/shared/claudeComposerMenus";

export type ComposerSubmissionSource = "send-arrow" | "keyboard-submit";

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

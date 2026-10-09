import { parseClaudeComposerMenu } from "@t3tools/shared/claudeComposerMenus";

export function resolveCarriedComposerMenu(input: {
  readonly driver: string | undefined;
  readonly text: string;
  readonly attachmentCount: number;
  readonly hasPendingAttachments: boolean;
}): "rewind" | "config" | null {
  if (
    input.driver !== "claudeAgent" ||
    input.attachmentCount !== 0 ||
    input.hasPendingAttachments
  ) {
    return null;
  }
  return parseClaudeComposerMenu(input.text);
}

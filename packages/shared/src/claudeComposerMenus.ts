export function parseClaudeComposerMenu(text: string): "rewind" | "config" | null {
  if (text.trim() === "/rewind") return "rewind";
  if (text.trim() === "/config") return "config";
  return null;
}

export function buildRewindEntries(input: {
  messages: ReadonlyArray<{
    id: string;
    role: string;
    text: string;
    createdAt: string;
    turnId: string | null;
  }>;
  checkpoints: ReadonlyArray<{ turnId: string; checkpointTurnCount: number }>;
}) {
  const checkpoints = new Map(
    input.checkpoints.map((row) => [row.turnId, row.checkpointTurnCount]),
  );
  const seen = new Set<string>();
  return input.messages
    .filter((message) => message.role === "user")
    .map((message) => {
      const count = message.turnId ? checkpoints.get(message.turnId) : undefined;
      const isSteer = message.turnId !== null && seen.has(message.turnId);
      if (message.turnId) seen.add(message.turnId);
      const unavailableReason = isSteer
        ? "File restore requires the first message of this turn. Conversation-only restore is available."
        : count === undefined || count < 1
          ? "No file-checkpoint boundary. Conversation-only restore uses the native message."
          : null;
      return {
        ...message,
        turnCount: unavailableReason === null ? count! - 1 : null,
        unavailableReason,
      };
    });
}

export type RewindEntry = ReturnType<typeof buildRewindEntries>[number];

// Terminal preferences cannot be written through the session provider contract.
// Keep the limitation visible instead of pretending /config is the CLI's TUI.
export const CLAUDE_TERMINAL_ONLY_SETTINGS = [
  { label: "Terminal theme", reason: "Applies to the CLI terminal, not the ThroughLine client." },
  {
    label: "Vim / terminal editor mode",
    reason: "The provider exposes no terminal editor setting to this client.",
  },
  {
    label: "Auto-compact",
    reason: "The provider exposes manual /compact, not a session toggle for automatic compaction.",
  },
  {
    label: "CLI auto-updates",
    reason: "CLI installation is managed by the host, not by session settings.",
  },
] as const;

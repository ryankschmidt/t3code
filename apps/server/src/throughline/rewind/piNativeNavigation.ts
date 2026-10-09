// @effect-diagnostics nodeBuiltinImport:off
interface NativeEntry {
  readonly id: string;
  readonly type: string;
  readonly message?: { readonly role: string; readonly [key: string]: unknown };
}

export interface PiNavigationContext {
  readonly ui: { notify(message: string, type: "info"): void };
  readonly sessionManager: {
    getSessionId(): string;
    getSessionFile(): string | undefined;
    getBranch(): ReadonlyArray<NativeEntry>;
  };
  isIdle(): boolean;
  navigateTree(targetId: string, options: { summarize: false }): Promise<{ cancelled: boolean }>;
}

interface PiNavigationApi {
  registerCommand(
    name: string,
    command: {
      description: string;
      handler(args: string, ctx: PiNavigationContext): Promise<void>;
    },
  ): void;
}

/** Self-contained so its emitted JS can load in the configured native Pi child. */
export function registerPiNativeNavigation(
  pi: PiNavigationApi,
  commandName: string,
  emit?: (response: unknown) => void,
) {
  pi.registerCommand(commandName, {
    description: "ThroughLine's same-session conversation navigation bridge",
    async handler(args, ctx) {
      const reply =
        emit ??
        ((response: unknown) =>
          ctx.ui.notify(`throughline-rewind:${JSON.stringify(response)}`, "info"));
      let id: string | undefined;
      try {
        const request: unknown = JSON.parse(args);
        if (typeof request !== "object" || request === null)
          throw new Error("Invalid navigation request.");
        const input = request as Record<string, unknown>;
        if (typeof input.id !== "string") throw new Error("Navigation request id is required.");
        id = input.id;
        if (
          typeof input.numTurns !== "number" ||
          !Number.isSafeInteger(input.numTurns) ||
          input.numTurns < 0
        ) {
          throw new Error("numTurns must be a safe integer >= 0.");
        }
        const manager = ctx.sessionManager;
        const sessionId = manager.getSessionId();
        const sessionFile = manager.getSessionFile();
        if (input.sessionId !== sessionId || input.sessionFile !== sessionFile) {
          throw new Error("Pi navigation session identity changed; refusing rewind.");
        }
        if (input.numTurns > 0 && !ctx.isIdle())
          throw new Error("Pi must be idle before navigating its conversation.");
        const users = manager
          .getBranch()
          .filter((entry) => entry.type === "message" && entry.message?.role === "user");
        const target =
          input.numTurns > 0 ? users[Math.max(0, users.length - input.numTurns)] : undefined;
        let cancelled = false;
        if (target) {
          if (typeof ctx.navigateTree !== "function")
            throw new Error("Native Pi same-session navigation is unsupported.");
          const result = await ctx.navigateTree(target.id, { summarize: false });
          if (typeof result.cancelled !== "boolean")
            throw new Error("Native Pi returned no cancellation result.");
          cancelled = result.cancelled;
        }
        if (manager.getSessionId() !== sessionId || manager.getSessionFile() !== sessionFile) {
          throw new Error("Native Pi navigation replaced the session.");
        }
        const currentUsers = manager
          .getBranch()
          .filter((entry) => entry.type === "message" && entry.message?.role === "user");
        const expectedCount = cancelled ? users.length : Math.max(0, users.length - input.numTurns);
        if (
          currentUsers.length !== expectedCount ||
          currentUsers.some((entry, index) => entry.id !== users[index]?.id)
        )
          throw new Error("Native Pi navigation did not reach the requested turn boundary.");
        const turns: Array<{ id: string; items: Array<unknown> }> = [];
        for (const entry of manager.getBranch()) {
          if (entry.type !== "message" || !entry.message) continue;
          if (entry.message.role === "user") turns.push({ id: entry.id, items: [] });
          turns.at(-1)?.items.push(entry.message);
        }
        reply({
          type: "response",
          command: "throughline_rewind",
          id,
          success: true,
          data: { sessionId, sessionFile, cancelled, turns },
        });
      } catch (error) {
        reply({
          type: "response",
          command: "throughline_rewind",
          id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}

export function piNativeNavigationSource(commandName: string): string {
  return `export default (pi) => (${registerPiNativeNavigation.toString()})(pi, ${JSON.stringify(commandName)});\n`;
}

// @effect-diagnostics nodeBuiltinImport:off
// A standalone synthetic native protocol peer, not an Effect service.
import { createInterface } from "node:readline";
import { appendFileSync, writeFileSync } from "node:fs";
const lines = createInterface({ input: process.stdin });
const write = (message: unknown) => process.stdout.write(JSON.stringify(message) + "\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  appendFileSync(process.argv[2]!, line + "\n");
  if (message.id === undefined) return;
  let result: unknown;
  switch (message.method) {
    case "initialize":
      result = {
        userAgent: "managed-test-peer",
        codexHome: process.cwd(),
        platformFamily: "unix",
        platformOs: process.platform,
      };
      break;
    case "thread/start":
    case "thread/resume":
      result = {
        cwd: process.cwd(),
        model: "gpt-6-astra",
        modelProvider: "openai",
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandbox: { type: "dangerFullAccess" },
        thread: {
          id: message.params.threadId ?? "new-native-thread",
          sessionId: "fixture-session",
          cliVersion: "fixture",
          createdAt: 1789862400,
          updatedAt: 1789862400,
          cwd: process.cwd(),
          ephemeral: false,
          modelProvider: "openai",
          preview: "fixture",
          source: "appServer",
          turns: [],
          status: { type: "idle" },
        },
      };
      break;
    case "turn/start":
      if (
        message.params.input?.some((item: { text?: string }) => item.text === "fixture-edit-help")
      ) {
        writeFileSync("help.txt", "native private draft\n");
      }
      result = { turn: { id: "managed-turn", items: [], status: "inProgress", error: null } };
      break;
    default:
      write({ id: message.id, error: { code: -32601, message: "unknown fixture method" } });
      return;
  }
  write({ id: message.id, result });
  if (message.method === "turn/start") {
    setImmediate(() =>
      write({
        method: "turn/completed",
        params: {
          threadId: message.params.threadId,
          turn: { id: "managed-turn", items: [], status: "completed", error: null },
        },
      }),
    );
  }
});

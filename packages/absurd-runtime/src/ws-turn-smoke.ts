/**
 * WsRpcTransport REAL-turn smoke (T1.3b evidence, no durable worker yet).
 *
 * Drives one real provider turn through the WS door: thread.create →
 * thread.turn.start → awaitTurnComplete (session running → ready). Uses the
 * governed `codex` provider instance (binary = ryan-codex shim) with a tiny
 * one-word prompt. Defaults verified against the live event store 2026-07-04:
 * projectId d7c8eec6… (the only project), modelSelection {codex, gpt-5.5}
 * exactly as Ryan's real UI turns used.
 *
 * Run from packages/absurd-runtime:
 *   BEARER_TOKEN_FILE=/abs/path/token \
 *   node --env-file=.env --experimental-strip-types src/ws-turn-smoke.ts
 */
import { readFileSync } from "node:fs";
import { makeWsRpcTransport } from "./ws-rpc-transport.ts";

const tokenFile = process.env["BEARER_TOKEN_FILE"];
if (!tokenFile) {
  console.error("[turn-smoke] set BEARER_TOKEN_FILE to a path holding the bearer token");
  process.exit(2);
}
const bearerToken = readFileSync(tokenFile, "utf8").trim();

const transport = await makeWsRpcTransport({
  serverUrl: process.env["T3_SERVER_URL"] ?? "http://localhost:13773",
  bearerToken,
  projectId: process.env["T3_PROJECT_ID"] ?? "d7c8eec6-e75d-4227-861c-24e93e010d99",
  instanceId: process.env["T3_INSTANCE_ID"] ?? "codex",
  model: process.env["T3_MODEL"] ?? "gpt-5.5",
});

try {
  const t0 = Date.now();
  const thread = await transport.resolveThread({});
  console.error(`[turn-smoke] thread ${thread.threadId} created=${thread.created}`);
  const turn = await transport.dispatchTurn(
    thread.threadId,
    "Reply with exactly one word: pong",
  );
  console.error(`[turn-smoke] dispatched turn handle ${turn.turnId}`);
  const done = await transport.awaitTurnComplete(thread.threadId, turn.turnId, 60_000);
  console.log(
    JSON.stringify({
      ok: true,
      threadId: thread.threadId,
      state: done.state,
      summary: done.summary,
      elapsedMs: Date.now() - t0,
    }),
  );
  process.exitCode = 0;
} catch (err) {
  console.log(
    JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  process.exitCode = 1;
} finally {
  await transport.close();
}

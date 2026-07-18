/**
 * Client-rail LIVE proof (landing slice acceptance).
 *
 * Drives one real provider turn through THE CLIENT PATH — the same
 * `orchestration.dispatchCommand` WS method the web/desktop client uses:
 *   thread.create (direct arm) → thread.turn.start (ABSURD RAIL: the ws.ts
 *   handler spawns durable t3.thread-run; the in-process transport is the only
 *   place the command enters the engine) → awaitTurnComplete
 *   (thread.session-set running → ready).
 *
 * What this proves when it exits 0:
 *   1. A normal client turn runs natively on the Absurd substrate (the
 *      dispatchCommand ack sequence came from the rail's turn-start event).
 *   2. The turn completed for real (session running → ready observed).
 *
 * What it does NOT prove by itself (the independent validator's job):
 *   the Postgres task row for this turn (absurd-pg: t3.thread-run whose
 *   params.turnCommand.threadId matches the printed threadId) and the event
 *   trail. A separate validator queries those — implementer ≠ validator.
 *
 * Run from packages/absurd-runtime:
 *   BEARER_TOKEN_FILE=/abs/path/token \
 *   node --env-file=.env --experimental-strip-types src/client-rail-proof.ts
 */
import { readFileSync } from "node:fs";
import { makeWsRpcTransport } from "./ws-rpc-transport.ts";

const tokenFile = process.env["BEARER_TOKEN_FILE"];
if (!tokenFile) {
  console.error("[client-rail-proof] set BEARER_TOKEN_FILE to a path holding the bearer token");
  process.exit(2);
}
const bearerToken = readFileSync(tokenFile, "utf8").trim();

const transport = await makeWsRpcTransport({
  serverUrl: process.env["T3_SERVER_URL"] ?? "http://localhost:13773",
  bearerToken,
  projectId: process.env["T3_PROJECT_ID"] ?? "d7c8eec6-e75d-4227-861c-24e93e010d99",
  instanceId: process.env["T3_INSTANCE_ID"] ?? "codex",
  model: process.env["T3_MODEL"] ?? "gpt-5.4-mini",
});

try {
  const t0 = Date.now();
  const thread = await transport.resolveThread({});
  console.error(`[client-rail-proof] thread ${thread.threadId} created=${thread.created}`);
  const turn = await transport.dispatchTurn(
    thread.threadId,
    "Reply with exactly one word: pong",
  );
  console.error(
    `[client-rail-proof] turn dispatched through the client rail; handle ${turn.turnId}`,
  );
  const done = await transport.awaitTurnComplete(thread.threadId, turn.turnId, 120_000);
  console.log(
    JSON.stringify({
      ok: true,
      rail: "client dispatchCommand → absurd t3.thread-run",
      threadId: thread.threadId,
      turnHandle: turn.turnId,
      state: done.state,
      summary: done.summary,
      elapsedMs: Date.now() - t0,
    }),
  );
} finally {
  await transport.close();
}

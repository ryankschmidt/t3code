/**
 * WsRpcTransport connect smoke (T1.3b evidence, no durable worker).
 *
 * Proves the genuinely novel risk in isolation: can a Node process authenticate
 * to the T3 WS RPC door with a Bearer header and complete one round-trip RPC?
 * Reads the bearer from BEARER_TOKEN_FILE (path, never inline) so no token
 * value is ever an argument or logged.
 *
 * Run from packages/absurd-runtime:
 *   BEARER_TOKEN_FILE=/abs/path/token \
 *   node --env-file=.env --experimental-strip-types src/ws-transport-smoke.ts
 */
import { readFileSync } from "node:fs";
import { makeWsRpcTransport } from "./ws-rpc-transport.ts";

const tokenFile = process.env["BEARER_TOKEN_FILE"];
if (!tokenFile) {
  console.error("[ws-smoke] set BEARER_TOKEN_FILE to a path holding the bearer token");
  process.exit(2);
}
const bearerToken = readFileSync(tokenFile, "utf8").trim();
const serverUrl = process.env["T3_SERVER_URL"] ?? "http://localhost:13773";
const projectId = process.env["T3_PROJECT_ID"] ?? "smoke-project-unused";

const transport = await makeWsRpcTransport({
  serverUrl,
  bearerToken,
  projectId,
  instanceId: process.env["T3_INSTANCE_ID"] ?? "ryan-codex",
  model: process.env["T3_MODEL"] ?? "gpt-5.4",
});

try {
  // probe() = replayEvents(0) — a REAL authenticated RPC round-trip over the
  // WS door. If the Bearer upgrade auth or protocol wiring is wrong, this
  // rejects. Read-only: no thread is created, no turn is started.
  const maxSequence = await transport.probe();
  console.log(JSON.stringify({ ok: true, authenticated: true, maxSequence }));
  process.exitCode = 0;
} catch (err) {
  console.error(
    JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  process.exitCode = 1;
} finally {
  await transport.close();
}

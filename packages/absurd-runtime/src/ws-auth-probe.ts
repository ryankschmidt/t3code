/**
 * Raw WS upgrade auth probe (T1.3b diagnostics, no RPC layer).
 *
 * Opens a bare WebSocket to the /ws door with the Bearer header and reports
 * ONLY lifecycle events (open/close/error + close code). Isolates upgrade
 * auth from RPC semantics. Token read from BEARER_TOKEN_FILE; never printed.
 *
 * Run from packages/absurd-runtime:
 *   BEARER_TOKEN_FILE=/abs/path node --env-file=.env --experimental-strip-types src/ws-auth-probe.ts
 */
import { readFileSync } from "node:fs";

const tokenFile = process.env["BEARER_TOKEN_FILE"];
if (!tokenFile) {
  console.error("[ws-auth-probe] set BEARER_TOKEN_FILE");
  process.exit(2);
}
const bearerToken = readFileSync(tokenFile, "utf8").trim();
const serverUrl = process.env["T3_SERVER_URL"] ?? "http://localhost:13773";
const u = new URL("/ws", serverUrl);
u.protocol = u.protocol === "https:" ? "wss:" : "ws:";

const WS = (globalThis as unknown as {
  WebSocket: new (url: string, opts?: unknown) => {
    addEventListener(type: string, cb: (ev: Record<string, unknown>) => void): void;
    close(): void;
  };
}).WebSocket;

const started = Date.now();
const ws = new WS(u.toString(), {
  headers: { authorization: `Bearer ${bearerToken}` },
});

const done = (result: Record<string, unknown>) => {
  console.log(JSON.stringify({ elapsedMs: Date.now() - started, ...result }));
  process.exit(0);
};

ws.addEventListener("open", () => {
  // Auth passed the upgrade. Close politely and report.
  setTimeout(() => {
    ws.close();
    done({ event: "open", authAccepted: true });
  }, 250);
});
ws.addEventListener("close", (ev) =>
  done({ event: "close", code: ev["code"], reason: String(ev["reason"] ?? "") }),
);
ws.addEventListener("error", (ev) => {
  const e = ev as {
    message?: unknown;
    error?: { message?: unknown; cause?: { message?: unknown; code?: unknown } };
  };
  done({
    event: "error",
    message: String(e.error?.message ?? e.message ?? ""),
    cause: String(e.error?.cause?.message ?? ""),
    code: String(e.error?.cause?.code ?? ""),
  });
});

setTimeout(() => done({ event: "timeout", authAccepted: false }), 10_000);

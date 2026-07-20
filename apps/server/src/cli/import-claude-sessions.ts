/**
 * import-claude-sessions — one-shot maintenance importer (landing slice T6).
 *
 * Migrates historical Claude Code CLI sessions (~/.claude/projects JSONL) into
 * T3 client threads that are (a) VISIBLE as conversation history and
 * (b) RESUMABLE via the Claude provider:
 *
 *   visibility  → offline OrchestrationEngine dispatch (decider validates,
 *                 events append + projections update in one SQL transaction):
 *                 project.create → thread.create → per turn
 *                 thread.turn.start (user message) + assistant delta/complete.
 *                 In the offline composition NO provider layer is running, so
 *                 turn-start-requested events are inert history — and the
 *                 client reducer treats them as metadata-only (no spinner).
 *   resumability → ProviderSessionRuntimeRepository row whose resumeCursor is
 *                 { threadId, resume: <jsonl session uuid>,
 *                   resumeSessionAt: <last assistant uuid>, turnCount } —
 *                 exactly the shape ClaudeAdapter.readClaudeResumeState feeds
 *                 into the Agent SDK's `resume` option on the next turn.
 *
 * Provider identity (providerName / instanceId / adapterKey) is TEMPLATED from
 * an existing Claude session row in the target DB when one exists — no
 * guessed enum values; flags override.
 *
 * SAFETY: refuses to run unless :13773 is cleanly connection-refused. A
 * serving OR wedged-but-listening server still holds the SQLite files.
 *
 * Run (from apps/server):
 *   node --experimental-strip-types src/cli/import-claude-sessions.ts \
 *     --profile dev --limit 30 --dry-run
 *
 * Profiles: dev → <baseDir>/dev/state.sqlite (dev web client),
 *           desktop → <baseDir>/userdata/state.sqlite (packaged app).
 *           Migrations run automatically for fresh profiles.
 */
import { parseArgs } from "node:util";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { OrchestrationCommand } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import { OrchestrationLayerLive } from "../orchestration/runtimeLayer.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../persistence/Layers/ProviderSessionRuntime.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import {
  ProviderSessionRuntime,
  ProviderSessionRuntimeRepository,
} from "../persistence/ProviderSessionRuntime.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

// ── CLI args ───────────────────────────────────────────────────────────

const HOME = process.env["HOME"] ?? "/Users/Admin";

const { values: args } = parseArgs({
  options: {
    source: { type: "string", default: `${HOME}/.claude/projects/-Users-Admin` },
    "base-dir": { type: "string", default: `${HOME}/.t3` },
    profile: { type: "string", default: "dev" }, // dev | desktop
    limit: { type: "string", default: "30" },
    "min-user-turns": { type: "string", default: "3" },
    exclude: { type: "string", multiple: true, default: [] },
    "project-root": { type: "string", default: HOME },
    "project-title": { type: "string", default: "Claude Code History" },
    model: { type: "string", default: "claude-fable-5" },
    instance: { type: "string" }, // provider instance override
    "dry-run": { type: "boolean", default: false },
    // Maintenance: delete one thread (by id) before importing — recovery path
    // for a partially-imported session (thread.create is otherwise idempotent
    // and would skip it forever).
    "delete-thread": { type: "string" },
    // Maintenance: reuse an existing import project instead of creating one
    // (recovery reruns would otherwise mint a duplicate project shell).
    "project-id": { type: "string" },
    // Maintenance: re-import ONE session under a FRESH threadId — recovery for
    // a burned thread identity (thread.create identity survives deletion, so
    // the deterministic threadId=sessionId can never be reused). Selection is
    // narrowed to exactly this session; the resume cursor still carries the
    // real session uuid, so provider resumption is unaffected.
    "remap-thread": { type: "string" },
  },
});

const LIMIT = Number(args.limit);
const MIN_USER_TURNS = Number(args["min-user-turns"]);
const PROFILE = args.profile === "desktop" ? "desktop" : "dev";
/** Per-message safety cap; imported history is for reading, not archiving. */
const MAX_MESSAGE_CHARS = 120_000;

// CLI output helpers writing the process streams directly — the effect
// language-service forbids the global console in this package, and this
// standalone maintenance script is not an Effect logging context.
const logLine = (line: string): void => {
  process.stderr.write(`${line}\n`);
};
const printLine = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

// ── JSONL session parsing ──────────────────────────────────────────────

type ParsedMessage = {
  readonly role: "user" | "assistant";
  readonly uuid: string;
  readonly text: string;
  readonly timestamp: string;
};

type ParsedSession = {
  readonly sessionId: string;
  readonly filePath: string;
  readonly mtimeMs: number;
  readonly cwd: string | null;
  readonly summary: string | null;
  readonly messages: ReadonlyArray<ParsedMessage>;
  readonly userTurnCount: number;
  readonly lastAssistantUuid: string | null;
  readonly lastTimestamp: string | null;
};

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n");
}

/** Noise wrappers that are transcripts of local command plumbing, not prompts. */
function isNoiseUserText(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith("<local-command-stdout>") ||
    trimmed.startsWith("<command-name>") ||
    trimmed.startsWith("<local-command-caveat>") ||
    trimmed.startsWith("Caveat: The messages below were generated")
  );
}

/** Pure line-set parser; the caller owns file IO. */
function parseSessionLines(
  sessionId: string,
  filePath: string,
  mtimeMs: number,
  lines: ReadonlyArray<string>,
): ParsedSession | null {
  const messages: ParsedMessage[] = [];
  let cwd: string | null = null;
  let summary: string | null = null;
  let userTurnCount = 0;
  let lastAssistantUuid: string | null = null;
  let lastTimestamp: string | null = null;

  for (const line of lines) {
    if (line.length === 0) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = entry["type"];
    if (type === "summary" && typeof entry["summary"] === "string" && summary === null) {
      summary = entry["summary"];
      continue;
    }
    if (type !== "user" && type !== "assistant") continue;
    if (entry["isMeta"] === true) continue;
    const message = entry["message"] as { role?: string; content?: unknown } | undefined;
    const uuid = typeof entry["uuid"] === "string" ? entry["uuid"] : null;
    const timestamp = typeof entry["timestamp"] === "string" ? entry["timestamp"] : null;
    if (!message || !uuid || !timestamp) continue;
    if (cwd === null && typeof entry["cwd"] === "string") cwd = entry["cwd"];

    if (type === "user" && message.role === "user") {
      const text = extractText(message.content);
      if (isNoiseUserText(text)) continue;
      messages.push({ role: "user", uuid, text: text.slice(0, MAX_MESSAGE_CHARS), timestamp });
      userTurnCount += 1;
      lastTimestamp = timestamp;
    } else if (type === "assistant" && message.role === "assistant") {
      const text = extractText(message.content);
      if (text.trim().length === 0) continue;
      messages.push({ role: "assistant", uuid, text, timestamp });
      lastAssistantUuid = uuid;
      lastTimestamp = timestamp;
    }
  }

  if (userTurnCount < MIN_USER_TURNS) return null;
  return {
    sessionId,
    filePath,
    mtimeMs,
    cwd,
    summary,
    messages,
    userTurnCount,
    lastAssistantUuid,
    lastTimestamp,
  };
}

/**
 * Collapse the raw message stream into turns: each user message opens a turn;
 * every assistant message until the next user message merges into ONE reply
 * (id + timestamp of the LAST fragment, so resume anchors stay real uuids).
 */
type Turn = {
  readonly user: ParsedMessage;
  readonly assistant: ParsedMessage | null;
};

function toTurns(messages: ReadonlyArray<ParsedMessage>): Turn[] {
  const turns: Turn[] = [];
  let currentUser: ParsedMessage | null = null;
  let assistantParts: ParsedMessage[] = [];
  const flush = () => {
    if (currentUser === null) return;
    const last = assistantParts.at(-1);
    const assistant: ParsedMessage | null = last
      ? {
          role: "assistant",
          uuid: last.uuid,
          timestamp: last.timestamp,
          text: assistantParts
            .map((part) => part.text)
            .join("\n\n")
            .slice(0, MAX_MESSAGE_CHARS),
        }
      : null;
    turns.push({ user: currentUser, assistant });
  };
  for (const message of messages) {
    if (message.role === "user") {
      flush();
      currentUser = message;
      assistantParts = [];
    } else if (currentUser !== null) {
      assistantParts.push(message);
    }
  }
  flush();
  return turns;
}

// ── Selection (FileSystem service) ─────────────────────────────────────

const selectSessions = Effect.fn(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const source = args.source!;

  const excluded = new Set<string>([...(args.exclude ?? [])]);
  const envSession = process.env["CLAUDE_CODE_SESSION_ID"];
  if (envSession) excluded.add(envSession);

  const names = yield* fs.readDirectory(source);
  const candidates: Array<{ filePath: string; sessionId: string; mtimeMs: number }> = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const sessionId = name.replace(/\.jsonl$/, "");
    if (excluded.has(sessionId)) continue;
    const filePath = path.join(source, name);
    const info = yield* fs.stat(filePath).pipe(
      Effect.map(Option.some),
      Effect.catch(() => Effect.succeed(Option.none<FileSystem.File.Info>())),
    );
    if (Option.isNone(info)) continue;
    const mtimeMs = Option.match(info.value.mtime, {
      onNone: () => 0,
      onSome: (mtime) => mtime.getTime(),
    });
    candidates.push({ filePath, sessionId, mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const selected: ParsedSession[] = [];
  for (const candidate of candidates) {
    if (selected.length >= LIMIT) break;
    const parsed = yield* fs.readFileString(candidate.filePath).pipe(
      Effect.map((content) =>
        parseSessionLines(
          candidate.sessionId,
          candidate.filePath,
          candidate.mtimeMs,
          content.split(/\r?\n/),
        ),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          logLine(`[import] skipping unreadable ${candidate.filePath}: ${String(error)}`);
          return null;
        }),
      ),
    );
    if (parsed) selected.push(parsed);
  }
  return selected;
});

// ── Live-server refusal guard (HttpClient) ─────────────────────────────

class ServerHoldsStateError extends Schema.TaggedErrorClass<ServerHoldsStateError>()(
  "ServerHoldsStateError",
  { message: Schema.String },
) {}

/**
 * The three observed :13773 states map to safety like this: a RESPONSE means
 * a server is serving (holds SQLite); a TIMEOUT means a wedged-but-listening
 * server (observed twice today — still holds SQLite); a fast TRANSPORT ERROR
 * (connection refused) means nothing is bound — safe to proceed. SQLite's own
 * open would still fail loudly if some other process held the files.
 */
const assertNoLiveServer = Effect.fn(function* () {
  const client = yield* HttpClient.HttpClient;
  const outcome = yield* client.get("http://127.0.0.1:13773/").pipe(
    Effect.timeoutOption(1_500),
    Effect.map((response) =>
      Option.isSome(response) ? ("serving" as const) : ("wedged-listening" as const),
    ),
    Effect.orElseSucceed(() => "unbound" as const),
  );
  if (outcome !== "unbound") {
    return yield* new ServerHoldsStateError({
      message:
        `REFUSED: :13773 is ${outcome} — that server still holds the SQLite state. ` +
        `Stop it first: launchctl bootout gui/$(id -u)/com.ryan.t3-absurd-dev-server`,
    });
  }
});

// ── Config + engine program ────────────────────────────────────────────

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const makeConfig = Effect.fn(function* (baseDir: string, profile: "dev" | "desktop") {
  const devUrl = profile === "dev" ? new URL("http://localhost:5733") : undefined;
  const derived = yield* ServerConfig.deriveServerPaths(baseDir, devUrl);
  yield* ServerConfig.ensureServerDirectories(derived);
  return ServerConfig.make({
    ...derived,
    logLevel: "Warn",
    traceMinLevel: "Warn",
    traceTimingEnabled: false,
    traceBatchWindowMs: 1_000,
    traceMaxBytes: 8_000_000,
    traceMaxFiles: 2,
    otlpTracesUrl: undefined,
    otlpMetricsUrl: undefined,
    otlpExportIntervalMs: 60_000,
    otlpServiceName: "t3-import-claude-sessions",
    mode: "web",
    port: 0,
    host: undefined,
    cwd: process.cwd(),
    baseDir,
    staticDir: undefined,
    devUrl,
    noBrowser: true,
    startupPresentation: "headless",
    desktopBootstrapToken: undefined,
    autoBootstrapProjectFromCwd: false,
    logWebSocketEvents: false,
    tailscaleServeEnabled: false,
    tailscaleServePort: 0,
  });
});

const decodeCommand = Schema.decodeUnknownEffect(OrchestrationCommand);

const program = Effect.fn(function* (sessions: ReadonlyArray<ParsedSession>) {
  const engine = yield* OrchestrationEngineService;
  const runtimeRepo = yield* ProviderSessionRuntimeRepository;
  const cryptoService = yield* Crypto.Crypto;

  // Machine-contract-first boundary: plain objects in (dispatch stamps a fresh
  // commandId via Effect-injected randomness), schema validates and brands,
  // then the engine dispatches the decoded command — the exact shape
  // AbsurdRuntimeInProcess binds for the turn rail.
  const dispatch = (plain: Record<string, unknown>) =>
    cryptoService.randomUUIDv4.pipe(
      Effect.flatMap((uuid) => decodeCommand({ ...plain, commandId: uuid })),
      Effect.flatMap((decoded) => engine.dispatch(decoded)),
    );

  if (args["delete-thread"]) {
    yield* dispatch({ type: "thread.delete", threadId: args["delete-thread"] });
    yield* Effect.log(`[import] deleted thread ${args["delete-thread"]} (recovery)`);
  }

  // Provider identity template: prefer a real Claude row over guessed enums.
  const existingRows = yield* runtimeRepo.list();
  const template = existingRows.find((row) => /claude/i.test(row.providerName));
  const providerName = template?.providerName ?? "claudeAgent";
  const adapterKey = template?.adapterKey ?? "claudeAgent";
  const instanceId = args.instance ?? (template?.providerInstanceId as string | null) ?? "claude";
  yield* Effect.log(
    `[import] provider identity: name=${providerName} instance=${instanceId} adapter=${adapterKey}` +
      (template ? " (templated from existing row)" : " (defaults — no existing Claude row)"),
  );

  // Target project for the imported history (reused on recovery reruns).
  let createdProject: string;
  if (args["project-id"]) {
    createdProject = args["project-id"];
  } else {
    const projectRoot = args["project-root"]!;
    const projectId = yield* cryptoService.randomUUIDv4;
    yield* dispatch({
      type: "project.create",
      projectId,
      title: args["project-title"]!,
      workspaceRoot: projectRoot,
      createdAt: yield* nowIso,
    });
    createdProject = projectId;
  }

  // The repo row is decoded through its own schema for the same reason.
  const decodeRuntimeRow = Schema.decodeUnknownEffect(ProviderSessionRuntime);

  let imported = 0;
  const receipts: Array<Record<string, unknown>> = [];
  for (const session of sessions) {
    const threadId =
      args["remap-thread"] === session.sessionId
        ? yield* cryptoService.randomUUIDv4
        : session.sessionId;
    if (threadId !== session.sessionId) {
      yield* Effect.log(`[import] remap ${session.sessionId} -> fresh thread ${threadId}`);
    }
    const turns = toTurns(session.messages);
    const title = (session.summary ?? turns[0]?.user.text ?? "Imported session")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    const createdAt = turns[0]?.user.timestamp ?? (yield* nowIso);

    const threadCreate = dispatch({
      type: "thread.create",
      threadId,
      projectId: createdProject,
      title,
      modelSelection: { instanceId, model: args.model!, options: [] },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt,
    });

    const created = yield* threadCreate.pipe(
      Effect.map(() => true),
      Effect.catch((error: unknown) =>
        Effect.gen(function* () {
          yield* Effect.log(
            `[import] skip ${session.sessionId}: thread.create rejected (${String(
              (error as { message?: string }).message ?? error,
            )})`,
          );
          return false;
        }),
      ),
    );
    if (!created) continue;

    for (const turn of turns) {
      yield* dispatch({
        type: "thread.turn.start",
        threadId,
        message: {
          messageId: turn.user.uuid,
          role: "user",
          text: turn.user.text,
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: turn.user.timestamp,
      });
      if (turn.assistant) {
        // turnId is omitted (schema: string | undefined) — imported history
        // has no live turn; the decider stamps payload turnId null itself.
        yield* dispatch({
          type: "thread.message.assistant.delta",
          threadId,
          messageId: turn.assistant.uuid,
          delta: turn.assistant.text,
          createdAt: turn.assistant.timestamp,
        });
        yield* dispatch({
          type: "thread.message.assistant.complete",
          threadId,
          messageId: turn.assistant.uuid,
          createdAt: turn.assistant.timestamp,
        });
      }
    }

    const binding = yield* decodeRuntimeRow({
      threadId,
      providerName,
      providerInstanceId: instanceId,
      adapterKey,
      runtimeMode: "full-access",
      status: template?.status ?? "stopped",
      lastSeenAt: session.lastTimestamp ?? (yield* nowIso),
      resumeCursor: {
        threadId,
        resume: session.sessionId,
        ...(session.lastAssistantUuid ? { resumeSessionAt: session.lastAssistantUuid } : {}),
        turnCount: session.userTurnCount,
      },
      runtimePayload: null,
    });
    yield* runtimeRepo.upsert(binding);

    imported += 1;
    receipts.push({
      threadId,
      title,
      turns: turns.length,
      resume: session.sessionId,
      resumeSessionAt: session.lastAssistantUuid,
    });
    yield* Effect.log(`[import] ${imported}/${sessions.length} ${session.sessionId} "${title}"`);
  }

  return { imported, projectId: createdProject, receipts };
});

// ── main ───────────────────────────────────────────────────────────────

const main = Effect.gen(function* () {
  yield* assertNoLiveServer();

  const selected = yield* selectSessions();
  // Remap recovery narrows the run to exactly the burned session — nothing
  // else imports, no matter what else the selection window picked up.
  const sessions = args["remap-thread"]
    ? selected.filter((session) => session.sessionId === args["remap-thread"])
    : selected;
  if (args["remap-thread"] && sessions.length === 0) {
    logLine(
      `[import] remap target ${args["remap-thread"]} not in the selection window — ` +
        `raise --limit (selection is most-recent-first)`,
    );
  }
  logLine(
    `[import] selected ${sessions.length} meaningful sessions (limit ${LIMIT}, ` +
      `min user turns ${MIN_USER_TURNS}, profile ${PROFILE})`,
  );
  for (const session of sessions) {
    logLine(
      `  ${session.sessionId}  turns=${session.userTurnCount}  ` +
        `last=${session.lastTimestamp ?? "?"}  "${(session.summary ?? "").slice(0, 50)}"`,
    );
  }
  if (args["dry-run"]) {
    // Manual literal: numbers only, and the language service reserves
    // JSON.stringify for schema codecs.
    printLine(`{"ok":true,"dryRun":true,"selected":${sessions.length}}`);
    return;
  }

  const config = yield* makeConfig(args["base-dir"]!, PROFILE);
  const runtimeLayer = Layer.mergeAll(
    WorkspacePaths.layer,
    OrchestrationLayerLive.pipe(
      Layer.provideMerge(ProviderSessionRuntimeRepositoryLive),
      Layer.provideMerge(RepositoryIdentityResolver.layer),
      Layer.provideMerge(SqlitePersistenceLayerLive),
    ),
  ).pipe(Layer.provide(ServerConfig.layer(config)), Layer.provideMerge(NodeServices.layer));

  const result = yield* program(sessions).pipe(Effect.provide(runtimeLayer));
  // Manual literal (uuid + enum + count — no escaping needed); per-session
  // receipts already stream through Effect.log above.
  printLine(
    `{"ok":true,"profile":"${PROFILE}","imported":${result.imported},"projectId":"${result.projectId}"}`,
  );
});

await Effect.runPromise(
  main.pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))),
).catch((error: unknown) => {
  logLine(`[import] FAILED: ${String(error)}`);
  process.exitCode = 1;
});

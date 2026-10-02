// @effect-diagnostics nodeBuiltinImport:off - Standalone streaming native-metadata reader; the Effect adapter owns errors/cancellation.
// ThroughLine-owned: hide native transcript layout and fork ancestry behind exact identity.
// No prompt text, file checkpoints or conversation positions participate in this lookup.
import { createHash } from "node:crypto";
import { open, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { createInterface } from "node:readline";

export const NATIVE_UUID_NAMESPACE_V1 = "ThroughLine.claude-message.v1";

export type ClaudeForkOrigin = { readonly sessionId: string; readonly messageUuid: string };
export type ClaudeSessionLineage = ReadonlyMap<string, ClaudeForkOrigin | null>;
const sessionUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Versioned, reproducible assignment BEFORE submission, not a guess about existing history.
// The namespace must remain stable across releases and app restarts.
export function claudeDisplayedMessageUuid(threadId: string, messageId: string): string {
  const bytes = createHash("sha256")
    .update(JSON.stringify([NATIVE_UUID_NAMESPACE_V1, threadId, messageId]))
    .digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function readClaudeSessionLineage(
  sessionId: string,
  configDir = join(homedir(), ".claude"),
): Promise<ClaudeSessionLineage | undefined> {
  if (!sessionUuid.test(sessionId)) throw new Error("Invalid Claude lineage session ID.");
  const projects = await realpath(join(configDir.normalize("NFC"), "projects"));
  const candidates = new Set<string>();
  // Native ancestry can be in another project/worktree. Enumerate directories, not transcripts.
  for (const directory of await readdir(projects, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    try {
      const file = await realpath(join(projects, directory.name, `${sessionId}.jsonl`));
      const confined = relative(projects, file);
      if (isAbsolute(confined) || confined === ".." || confined.startsWith("../")) {
        throw new Error("Claude lineage transcript is outside its provider projects directory.");
      }
      candidates.add(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (candidates.size === 0) return undefined;
  if (candidates.size !== 1)
    throw new Error("Claude lineage session has ambiguous transcript files.");
  const file = await open([...candidates][0]!, "r");
  const { size } = await file.stat();
  if (size === 0) {
    await file.close();
    return new Map();
  }
  const lastByte = Buffer.alloc(1);
  await file.read(lastByte, 0, 1, size - 1);
  const terminated = lastByte[0] === 10 || lastByte[0] === 13;
  // Capture an exact byte snapshot. Background provider output may append while we read.
  const stream = file.createReadStream({
    encoding: "utf8",
    start: 0,
    end: size - 1,
    autoClose: false,
  });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const lineage = new Map<string, ClaudeForkOrigin | null>();
  const consume = (line: string) => {
    if (!line.trim()) return;
    const record: unknown = JSON.parse(line);
    if (
      typeof record !== "object" ||
      record === null ||
      !("uuid" in record) ||
      typeof record.uuid !== "string"
    )
      return;
    let origin: ClaudeForkOrigin | null = null;
    if ("forkedFrom" in record && record.forkedFrom !== undefined && record.forkedFrom !== null) {
      const source = record.forkedFrom;
      if (
        typeof source !== "object" ||
        source === null ||
        !("sessionId" in source) ||
        typeof source.sessionId !== "string" ||
        !sessionUuid.test(source.sessionId) ||
        !("messageUuid" in source) ||
        typeof source.messageUuid !== "string" ||
        !source.messageUuid
      ) {
        throw new Error("Malformed Claude native fork provenance.");
      }
      origin = { sessionId: source.sessionId, messageUuid: source.messageUuid };
    }
    if (
      lineage.has(record.uuid) &&
      JSON.stringify(lineage.get(record.uuid)) !== JSON.stringify(origin)
    ) {
      throw new Error("Conflicting Claude native fork provenance.");
    }
    lineage.set(record.uuid, origin);
  };
  try {
    let pending: string | undefined;
    for await (const line of lines) {
      if (pending !== undefined) consume(pending);
      pending = line;
    }
    if (pending !== undefined) {
      try {
        consume(pending);
      } catch (error) {
        // A partially appended, unterminated JSON tail is not an admitted record. Its
        // missing IDs cannot match; complete malformed/conflicting provenance still refuses.
        const errorPosition =
          error instanceof SyntaxError ? /position (\d+)/.exec(error.message)?.[1] : undefined;
        const incomplete =
          error instanceof SyntaxError &&
          (/Unexpected end of JSON|Unterminated string/.test(error.message) ||
            (errorPosition !== undefined && Number(errorPosition) === pending.length));
        if (terminated || !incomplete) throw error;
      }
    }
  } finally {
    lines.close();
    stream.destroy();
    await file.close();
  }
  return lineage;
}

export async function resolveClaudeRewindMessage(input: {
  readonly sessionId: string;
  readonly configDir?: string;
  // Supplied ONLY from the SDK's effective human-prompt history, not raw transcript membership.
  readonly currentMessageIds: ReadonlyArray<string>;
  readonly requestedIds: ReadonlyArray<string>;
  readonly readLineage?: (sessionId: string) => Promise<ClaudeSessionLineage | undefined>;
}): Promise<string | undefined> {
  const currentIds = new Set(input.currentMessageIds);
  for (const requested of input.requestedIds) if (currentIds.has(requested)) return requested;
  const wanted = new Set(input.requestedIds);
  const cache = new Map<string, Promise<ClaudeSessionLineage | undefined>>();
  const read = (id: string) => {
    let result = cache.get(id);
    if (!result) {
      result = input.readLineage
        ? input.readLineage(id)
        : readClaudeSessionLineage(id, input.configDir);
      cache.set(id, result);
    }
    return result;
  };
  const matches = new Map<string, string>();
  for (const currentId of currentIds) {
    let sessionId = input.sessionId;
    let messageId = currentId;
    const visited = new Set<string>();
    while (true) {
      const node = JSON.stringify([sessionId, messageId]);
      if (visited.has(node)) throw new Error("Cycle in Claude native fork provenance.");
      visited.add(node);
      if (wanted.has(messageId)) {
        const prior = matches.get(messageId);
        if (prior !== undefined && prior !== currentId) {
          throw new Error("Claude rewind message has conflicting native descendants.");
        }
        matches.set(messageId, currentId);
      }
      const origin = (await read(sessionId))?.get(messageId);
      if (!origin) break;
      sessionId = origin.sessionId;
      messageId = origin.messageUuid;
    }
  }
  for (const requested of input.requestedIds) {
    const resolved = matches.get(requested);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

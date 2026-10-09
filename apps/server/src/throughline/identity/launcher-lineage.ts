// @effect-diagnostics nodeBuiltinImport:off - Read-only adapter for the launcher-owned record.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const sourceSchema = "agent-instruments.thread-lineage.v1";
const limits = { maxBytes: 2 * 1024 * 1024, maxRecords: 10_000, maxDepth: 64 } as const;
const creationSchema = Schema.Struct({
  schema: Schema.String,
  kind: Schema.optional(Schema.String),
  thread_id: Schema.NonEmptyString,
  creating_thread_id: Schema.NullOr(Schema.NonEmptyString),
  creating_thread_resolution: Schema.NonEmptyString,
  launcher_seat: Schema.NullOr(Schema.String),
  purpose: Schema.String,
  handle: Schema.NullOr(Schema.String),
  host: Schema.String,
});

type Creation = typeof creationSchema.Type;
const decodeCreation = Schema.decodeUnknownOption(creationSchema);

export type LauncherThreadFamily = {
  readonly threadId: string;
  readonly source: typeof sourceSchema;
} & (
  | { readonly status: "unknown"; readonly reason: string }
  | {
      readonly status: "recorded";
      readonly parentThreadId: string | null;
      readonly creatorResolution: string;
      readonly launcherSeat: string | null;
      readonly purpose: string;
      readonly handle: string | null;
      readonly host: string;
      readonly family:
        | {
            readonly status: "recorded";
            readonly rootThreadId: string;
            readonly ancestorThreadIds: readonly string[];
          }
        | {
            readonly status: "unknown";
            readonly reason: string;
            readonly ancestorThreadIds: readonly string[];
          };
    }
);

// This reads the existing launcher record; it neither creates a registry nor infers
// parentage from titles, handles or native session IDs. Only complete snapshot lines count.
export async function readLauncherThreadFamily(
  threadId: string,
  options: {
    readonly filePath?: string;
    readonly maxBytes?: number;
    readonly maxRecords?: number;
    readonly maxDepth?: number;
  } = {},
): Promise<LauncherThreadFamily> {
  const unknown = (reason: string): LauncherThreadFamily => ({
    threadId,
    source: sourceSchema,
    status: "unknown",
    reason,
  });
  const maxBytes = options.maxBytes ?? limits.maxBytes;
  const maxRecords = options.maxRecords ?? limits.maxRecords;
  const maxDepth = options.maxDepth ?? limits.maxDepth;
  if (
    [maxBytes, maxRecords, maxDepth].some((n) => !Number.isSafeInteger(n) || n < 1) ||
    maxBytes > limits.maxBytes ||
    maxRecords > limits.maxRecords ||
    maxDepth > limits.maxDepth
  ) {
    return unknown("invalid-limits");
  }
  const filePath =
    options.filePath ??
    NodePath.join(NodeOS.homedir(), ".local", "state", "agent-instruments", "thread-lineage.jsonl");
  let snapshot: string;
  try {
    const file = await NodeFSP.open(filePath, "r");
    try {
      const { size } = await file.stat();
      if (size > maxBytes) return unknown("byte-limit");
      const buffer = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        const { bytesRead } = await file.read(buffer, offset, size - offset, offset);
        if (bytesRead === 0) return unknown("file-changed");
        offset += bytesRead;
      }
      snapshot = buffer.toString("utf8");
    } finally {
      await file.close();
    }
  } catch (error) {
    return unknown(
      (error as NodeJS.ErrnoException).code === "ENOENT" ? "file-missing" : "file-unreadable",
    );
  }
  const complete = snapshot.slice(0, snapshot.lastIndexOf("\n") + 1);
  const lines = complete.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length > maxRecords) return unknown("record-limit");
  const records = new Map<string, Creation>();
  const conflicts = new Set<string>();
  const invalidRecords = new Set<string>();
  for (const line of lines) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return unknown("invalid-record");
    }
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("schema" in raw) ||
      raw.schema !== sourceSchema
    )
      continue;
    if ("kind" in raw && raw.kind !== "created") continue;
    const decoded = decodeCreation(raw);
    if (Option.isNone(decoded)) {
      if ("thread_id" in raw && typeof raw.thread_id === "string")
        invalidRecords.add(raw.thread_id);
      continue;
    }
    const record = { ...decoded.value, kind: "created" };
    const prior = records.get(record.thread_id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(record)) conflicts.add(record.thread_id);
    records.set(record.thread_id, record);
  }
  if (invalidRecords.has(threadId)) return unknown("invalid-record");
  if (conflicts.has(threadId)) return unknown("conflicting-records");
  const record = records.get(threadId);
  if (!record) return unknown("not-recorded");
  const base = {
    threadId,
    source: sourceSchema,
    status: "recorded" as const,
    parentThreadId: record.creating_thread_id,
    creatorResolution: record.creating_thread_resolution,
    launcherSeat: record.launcher_seat,
    purpose: record.purpose,
    handle: record.handle,
    host: record.host,
  } as const;
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let current = record;
  for (let depth = 0; depth < maxDepth; depth++) {
    if (visited.has(current.thread_id))
      return {
        ...base,
        family: { status: "unknown", reason: "cycle", ancestorThreadIds: ancestors },
      };
    visited.add(current.thread_id);
    if (current.creating_thread_id === null) {
      return {
        ...base,
        family:
          current.creating_thread_resolution === "NO_SESSION"
            ? { status: "recorded", rootThreadId: current.thread_id, ancestorThreadIds: ancestors }
            : { status: "unknown", reason: "creator-unresolved", ancestorThreadIds: ancestors },
      };
    }
    const parent = current.creating_thread_id;
    ancestors.push(parent);
    if (invalidRecords.has(parent)) {
      return {
        ...base,
        family: {
          status: "unknown",
          reason: "ancestor-invalid-record",
          ancestorThreadIds: ancestors,
        },
      };
    }
    if (conflicts.has(parent))
      return {
        ...base,
        family: { status: "unknown", reason: "conflicting-records", ancestorThreadIds: ancestors },
      };
    const next = records.get(parent);
    if (!next)
      return {
        ...base,
        family: {
          status: "unknown",
          reason: "ancestor-not-recorded",
          ancestorThreadIds: ancestors,
        },
      };
    current = next;
  }
  return {
    ...base,
    family: { status: "unknown", reason: "depth-limit", ancestorThreadIds: ancestors },
  };
}

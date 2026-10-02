// ThroughLine: Claude's history API leaves out hook attachments, so the transcript entry a
// first prompt hangs from is only visible in the transcript file itself. A rewind to the first
// prompt resumes the same session at that entry, the way the CLI's own /rewind does.
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

const decodeTranscriptEntry = Schema.decodeUnknownExit(
  Schema.fromJsonString(
    Schema.Struct({
      uuid: Schema.String,
      parentUuid: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
);

/**
 * The `parentUuid` of transcript entry `messageUuid` in session `sessionId`, read from
 * `<claudeHomePath>/projects/<project>/<sessionId>.jsonl`. Undefined when the transcript, the
 * entry, or a parent is missing. Reading stops at the entry, so a first prompt costs a few
 * lines however long the session is.
 */
export const readClaudeParentUuid = Effect.fn("readClaudeParentUuid")(function* (
  claudeHomePath: string,
  sessionId: string,
  messageUuid: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projectsDir = path.join(claudeHomePath, "projects");
  const projects = yield* fileSystem
    .readDirectory(projectsDir)
    .pipe(Effect.orElseSucceed((): Array<string> => []));
  for (const project of projects) {
    const transcript = path.join(projectsDir, project, `${sessionId}.jsonl`);
    const exists = yield* fileSystem
      .exists(transcript)
      .pipe(Effect.orElseSucceed(() => false));
    if (!exists) continue;
    const entry = yield* fileSystem.stream(transcript).pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.filter((line) => line.includes(messageUuid)),
      Stream.map((line) => decodeTranscriptEntry(line)),
      Stream.filter((decoded) => Exit.isSuccess(decoded) && decoded.value.uuid === messageUuid),
      Stream.runHead,
      Effect.orElseSucceed(() => Option.none()),
    );
    if (Option.isNone(entry) || !Exit.isSuccess(entry.value)) return undefined;
    return entry.value.value.parentUuid ?? undefined;
  }
  return undefined;
});

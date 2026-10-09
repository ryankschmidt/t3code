import * as Schema from "effect/Schema";

const placeholderReleases = new Set(["0.0.0", "unknown", "null", "undefined", "unset"]);
const nullCommit = "0".repeat(40);
const fullCommitPattern = /^[0-9a-f]{40}$/;

const CompiledRelease = Schema.String.check(Schema.isNonEmpty()).check(
  Schema.makeFilter(
    (value) => value === value.trim() && !placeholderReleases.has(value.toLowerCase()),
  ),
);
const FullSourceCommit = Schema.String.check(Schema.isPattern(fullCommitPattern)).check(
  Schema.makeFilter((value) => value !== nullCommit),
);

/** Client artifact identity. Neither field is evidence of provenance by itself. */
export const ReleaseIdentity = Schema.Struct({
  release: Schema.NullOr(CompiledRelease),
  fullCommit: Schema.NullOr(FullSourceCommit),
});
export type ReleaseIdentity = typeof ReleaseIdentity.Type;

/** Validate supplied build metadata only. Never discover or manufacture missing identity. */
export function normalizeReleaseIdentity(value: unknown): ReleaseIdentity {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const release = typeof record?.release === "string" ? record.release.trim() : "";
  const fullCommit =
    typeof record?.fullCommit === "string" ? record.fullCommit.trim().toLowerCase() : "";
  return {
    release: release && !placeholderReleases.has(release.toLowerCase()) ? release : null,
    fullCommit: fullCommitPattern.test(fullCommit) && fullCommit !== nullCommit ? fullCommit : null,
  };
}

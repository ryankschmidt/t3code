import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ReleaseIdentity, normalizeReleaseIdentity } from "./releaseIdentity.ts";

const fullCommit = "79aa410c4656683ac3f15df7e65f520f00666a31";
const decode = Schema.decodeUnknownSync(ReleaseIdentity);

describe("compiled release identity contract", () => {
  it("preserves a complete release/full source commit, including suffixes", () => {
    const identity = { release: "0.0.52-install-cut+20261009", fullCommit };
    expect(normalizeReleaseIdentity(identity)).toEqual(identity);
    expect(decode(identity)).toEqual(identity);
  });

  it("represents absent identity as null without inventing either field", () => {
    for (const value of [undefined, null, {}, [], "0.0.52", 52]) {
      expect(normalizeReleaseIdentity(value)).toEqual({ release: null, fullCommit: null });
    }
    expect(decode({ release: null, fullCommit: null })).toEqual({
      release: null,
      fullCommit: null,
    });
  });

  it("rejects missing, abbreviated, placeholder and non-commit values", () => {
    for (const value of [
      undefined,
      null,
      "",
      " ",
      "HEAD",
      "unknown",
      "placeholder",
      fullCommit.slice(0, 12),
      "0".repeat(40),
      fullCommit + "-dirty",
      123,
      { hash: fullCommit },
    ]) {
      expect(normalizeReleaseIdentity({ release: "0.0.52", fullCommit: value })).toEqual({
        release: "0.0.52",
        fullCommit: null,
      });
    }
    expect(() => decode({ release: "0.0.52", fullCommit: fullCommit.slice(0, 12) })).toThrow();
    expect(() => decode({ release: "0.0.52", fullCommit: "0".repeat(40) })).toThrow();
  });

  it("does not manufacture a release from a display placeholder or a valid commit", () => {
    for (const release of [undefined, null, "", "0.0.0", "unknown", 52]) {
      expect(normalizeReleaseIdentity({ release, fullCommit })).toEqual({
        release: null,
        fullCommit,
      });
    }
    expect(
      normalizeReleaseIdentity({ release: " 0.0.52 ", fullCommit: fullCommit.toUpperCase() }),
    ).toEqual({ release: "0.0.52", fullCommit });
  });
});

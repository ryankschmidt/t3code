import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

export const ORIGIN_URL = "https://github.com/ryankschmidt/throughline.git";
export const UPSTREAM_URL = "https://github.com/pingdotgg/t3code.git";
export const DESIGN_START_COMMIT = "fa95283df6";

export class RepositoryBindingError extends Error {}

export function git(root: string, ...args: string[]): string {
  return execFileSync("/usr/bin/git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Repository identity, not the caller's working directory, authorizes every seam operation. */
export function bindRepository(path: string): { root: string; head: string } {
  try {
    if (!path || !isAbsolute(path)) throw new Error("--repo <absolute path> is required");
    const root = realpathSync.native(path);
    if (realpathSync.native(git(root, "rev-parse", "--show-toplevel").trim()) !== root)
      throw new Error(`${path} is not a repository top level`);
    for (const [remote, expected] of [
      ["origin", ORIGIN_URL],
      ["upstream", UPSTREAM_URL],
    ]) {
      const actual = git(root, "remote", "get-url", remote!).trim();
      if (actual !== expected)
        throw new Error(`${remote}: expected ${expected}, observed ${actual}`);
    }
    git(root, "merge-base", "--is-ancestor", DESIGN_START_COMMIT, "HEAD");
    return { root, head: git(root, "rev-parse", "HEAD").trim() };
  } catch (cause) {
    throw new RepositoryBindingError(
      `BINDING REFUSED: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

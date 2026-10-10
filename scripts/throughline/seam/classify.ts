import { git } from "./repo-binding.ts";

export type SeamClass = "upstream-edit" | "upstream-removed" | "fork-added" | "fork-namespace";
export type ForkFile = { cls: SeamClass; renamedFrom?: string; commits: string[]; marker: boolean };
export type NameStatus = { status: string; path: string; renamedFrom?: string };
const NAMESPACE = [/^packages\/throughline-[^/]+\//, /^apps\/[^/]+\/src\/throughline\//];

export function classifyAdded(path: string): SeamClass {
  return NAMESPACE.some((pattern) => pattern.test(path)) ? "fork-namespace" : "fork-added";
}

/** NUL-delimited git names avoid quoted paths and preserve tabs and newlines in filenames. */
export function nameStatuses(raw: string): NameStatus[] {
  const fields = raw.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const changes: NameStatus[] = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++]!;
    const first = fields[i++];
    if (!first) throw new Error(`Malformed git diff record: ${status}`);
    if (/^R\d+$/.test(status)) {
      const path = fields[i++];
      if (!path) throw new Error(`Malformed rename: ${first}`);
      changes.push({ status, path, renamedFrom: first });
    } else if (["M", "T", "D", "A"].includes(status)) changes.push({ status, path: first });
    else throw new Error(`Unhandled git diff status ${status}: ${first}`);
  }
  return changes;
}

/** The old fork-map projector's split, commit lookup and ThroughLine marker become one facts contract. */
export function classifyFork(
  root: string,
  mergeBase: string,
  forkSha: string,
): Map<string, ForkFile> {
  const changes = nameStatuses(git(root, "diff", "--name-status", "-z", "-M", mergeBase, forkSha));
  const wanted = new Set(
    changes.flatMap((change) => [change.path, ...(change.renamedFrom ? [change.renamedFrom] : [])]),
  );
  const commits = new Map<string, string[]>();
  const log = git(root, "log", "--format=%H%x00%s%x00", `${mergeBase}..${forkSha}`).split("\0");
  for (let i = 0; i + 1 < log.length; i += 2) {
    const sha = log[i]!.trim();
    const subject = log[i + 1]!;
    if (!sha) continue;
    const paths = git(
      root,
      "diff-tree",
      "--root",
      "--no-commit-id",
      "--name-only",
      "-z",
      "-r",
      "-m",
      "--first-parent",
      sha,
    ).split("\0");
    for (const path of new Set(paths)) {
      if (!wanted.has(path)) continue;
      const list = commits.get(path) ?? [];
      list.push(`${sha} ${subject}`);
      commits.set(path, list);
    }
  }
  return new Map(
    changes.map((change) => {
      const cls: SeamClass =
        change.status === "A"
          ? classifyAdded(change.path)
          : change.status === "D"
            ? "upstream-removed"
            : "upstream-edit";
      const subjects = [
        ...new Set([
          ...(commits.get(change.path) ?? []),
          ...(change.renamedFrom ? (commits.get(change.renamedFrom) ?? []) : []),
        ]),
      ];
      const contents =
        cls === "upstream-removed" ? "" : git(root, "show", `${forkSha}:${change.path}`);
      return [
        change.path,
        {
          cls,
          ...(change.renamedFrom ? { renamedFrom: change.renamedFrom } : {}),
          commits: subjects,
          marker: !contents.includes("\0") && contents.includes("ThroughLine:"),
        },
      ];
    }),
  );
}

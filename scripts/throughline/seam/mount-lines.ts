// @effect-diagnostics nodeBuiltinImport:off - The repository's synchronous git/namespace adapter runs before dependency installation or an Effect runtime.
import { posix } from "node:path";
import { git } from "./repo-binding.ts";
import { nameStatuses, type SeamClass } from "./classify.ts";

type MountManifest = {
  merge_base: string;
  entries: ReadonlyArray<{ path: string; class: SeamClass }>;
};
export type MountViolation = {
  path: string;
  addedLines: number;
  nonNamespaceLines: number;
  binary?: boolean;
};
type AddedLine = { line: number; text: string };
type ImportRange = { start: number; end: number };
const namespacePath = (path: string) =>
  /^packages\/throughline-[^/]+\//.test(path) || /^apps\/[^/]+\/src\/throughline\//.test(path);

/** Keep positions/newlines, removing comments and string/template contents from code matching. */
function codeMask(source: string): string {
  const chars = source.split("");
  let quote = "",
    block = false,
    line = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!,
      next = source[i + 1];
    if (line) {
      if (c === "\n") line = false;
      else chars[i] = " ";
      continue;
    }
    if (block) {
      if (c !== "\n") chars[i] = " ";
      if (c === "*" && next === "/") {
        chars[++i] = " ";
        block = false;
      }
      continue;
    }
    if (quote) {
      if (c !== "\n") chars[i] = " ";
      if (c === "\\" && next !== undefined) {
        if (next !== "\n") chars[i + 1] = " ";
        i++;
      } else if (c === quote) quote = "";
      continue;
    }
    if (c === "/" && next === "/") {
      chars[i] = chars[++i] = " ";
      line = true;
    } else if (c === "/" && next === "*") {
      chars[i] = chars[++i] = " ";
      block = true;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
      chars[i] = " ";
    }
  }
  return chars.join("");
}

function packageNames(root: string, sha: string): Set<string> {
  const names = new Set<string>();
  for (const path of git(root, "ls-tree", "-r", "--name-only", "-z", sha, "--", "packages").split(
    "\0",
  )) {
    if (!/^packages\/throughline-[^/]+\/package\.json$/.test(path)) continue;
    const value = JSON.parse(git(root, "show", `${sha}:${path}`)) as { name?: string };
    if (value.name) names.add(value.name);
  }
  return names;
}

function namespaceSpecifier(file: string, specifier: string, packages: Set<string>): boolean {
  if (specifier.startsWith("."))
    return namespacePath(posix.normalize(posix.join(posix.dirname(file), specifier)));
  return [...packages].some((name) => specifier === name || specifier.startsWith(name + "/"));
}

function namespaceCode(file: string, source: string, packages: Set<string>) {
  const mask = codeMask(source),
    ranges: ImportRange[] = [],
    bindings = new Set<string>();
  const imports =
    /(^|\n)[ \t]*import\b(?:\s+type)?\s*(?:(\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*))?)\s+from\s*)?["']([^"'\r\n]+)["'](?:[ \t]+(?:with|assert)[ \t]*\{[^}\r\n]*\})?[ \t]*;?/g;
  for (const match of source.matchAll(imports)) {
    const start = match.index! + (match[1] === "\n" ? 1 : 0),
      end = match.index! + match[0].length;
    if (
      !mask.slice(start, end).trimStart().startsWith("import") ||
      !namespaceSpecifier(file, match[3]!, packages)
    )
      continue;
    ranges.push({ start, end });
    if (/^\s*import\s+type\b/.test(match[0])) continue;
    const clause = codeMask(match[2] ?? "").trim();
    const star = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (star) bindings.add(star[1]!);
    const named = /\{([^}]*)\}/.exec(clause);
    if (named)
      for (const item of named[1]!.split(",")) {
        const name = item.trim();
        if (!name || /^type\b/.test(name)) continue;
        const local = name.split(/\s+as\s+/).at(-1)!;
        if (/^[A-Za-z_$][\w$]*$/.test(local)) bindings.add(local);
      }
    const first = clause.split(",")[0]!.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(first)) bindings.add(first);
  }
  // Conservatively exclude a binding that is redeclared or used as a parameter elsewhere.
  // This is a lexical mount check, not a claim to resolve every TypeScript scope.
  for (const binding of bindings) {
    const escaped = binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declaration = new RegExp(
      `\\b(?:const|let|var|function|class)\\s+${escaped}\\b|\\b${escaped}\\s*=>`,
    );
    const parameters = /\bfunction\b[^()]*\(([^)]*)\)|\(([^)]*)\)\s*=>/g;
    if (
      declaration.test(mask) ||
      [...mask.matchAll(parameters)].some((match) =>
        new RegExp(`\\b${escaped}\\b`).test(match[1] ?? match[2] ?? ""),
      )
    )
      bindings.delete(binding);
  }
  return { mask, ranges, bindings };
}

function callIntoNamespace(masked: string, bindings: Set<string>): boolean {
  const line = masked.trim();
  const element = /^(?:return\s+)?<([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\b[^<>]*\/>\s*;?$/.exec(
    line,
  );
  if (
    element &&
    bindings.has(element[1]!.split(".")[0]!) &&
    (element[1]!.includes(".") || /^[A-Z]/.test(element[1]!))
  )
    return true;
  const call =
    /^(?:(?:return\s+(?:(?:yield\*|await)\s+)?)|(?:(?:yield\*|await)\s+)|(?:(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*(?:(?:yield\*|await)\s+)?))?(?:new\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/.exec(
      line,
    );
  if (!call || !bindings.has(call[1]!.split(".")[0]!)) return false;
  let depth = 1;
  for (let i = call[0].length; i < line.length; i++) {
    if (line[i] === "(") depth++;
    if (line[i] === ")" && --depth === 0) return /^\s*;?\s*$/.test(line.slice(i + 1));
  }
  return false;
}

function addedLines(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let line = 0;
  let inHunk = false;
  for (const row of diff.split("\n")) {
    if (row.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (hunk) {
      line = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    // File headers precede the hunk. Inside it, +++counter is an added ++counter line.
    if (!inHunk) continue;
    if (row.startsWith("+")) added.push({ line: line++, text: row.slice(1) });
    else if (row.startsWith(" ")) line++;
  }
  return added;
}

function inspect(root: string, file: string, from: string, to: string, packages: Set<string>) {
  const diff = git(
    root,
    "diff",
    "--no-ext-diff",
    "--no-color",
    "--no-renames",
    "--unified=0",
    from,
    to,
    "--",
    `:(literal)${file}`,
  );
  const lines = addedLines(diff);
  const binary = /^(?:Binary files .* differ|GIT binary patch)$/m.test(diff);
  const source = lines.length ? git(root, "show", `${to}:${file}`) : "";
  const parsed = namespaceCode(file, source, packages);
  const offsets: number[] = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") offsets.push(i + 1);
  let nonNamespaceLines = 0,
    nonImportLines = 0;
  for (const added of lines) {
    const start = offsets[added.line - 1] ?? 0,
      end = start + added.text.length;
    const pieces = parsed.mask.slice(start, end).split("");
    let importOverlap = false;
    for (const range of parsed.ranges) {
      const lo = Math.max(start, range.start),
        hi = Math.min(end, range.end);
      if (lo >= hi) continue;
      importOverlap = true;
      for (let i = lo; i < hi; i++) pieces[i - start] = " ";
    }
    const namespaceImport = importOverlap && pieces.join("").trim() === "";
    if (!namespaceImport) nonImportLines++;
    if (!namespaceImport && !callIntoNamespace(parsed.mask.slice(start, end), parsed.bindings))
      nonNamespaceLines++;
  }
  return { addedLines: lines.length, nonNamespaceLines, nonImportLines, binary };
}

/** Historical bytes are measured, never failed against the later incremental mount policy. */
export function historicalMountLines(
  root: string,
  mergeBase: string,
  forkSha: string,
  paths: string[],
): Map<string, { mount_lines: number; mount_measurement: string }> {
  const packages = packageNames(root, forkSha);
  return new Map(
    paths.map((path) => {
      const measured = inspect(root, path, mergeBase, forkSha, packages);
      return [
        path,
        {
          mount_lines: measured.nonImportLines,
          mount_measurement: measured.binary
            ? "binary: no text-line representation"
            : "added text lines excluding namespace import declarations",
        },
      ];
    }),
  );
}

export function mountLineViolations(
  root: string,
  admittedForkSha: string,
  head: string,
  manifest: MountManifest,
): MountViolation[] {
  git(root, "merge-base", "--is-ancestor", admittedForkSha, head);
  const packages = packageNames(root, head),
    violations: MountViolation[] = [];
  const knownUpstream = new Set(
    manifest.entries
      .filter((entry) => entry.class === "upstream-edit" || entry.class === "upstream-removed")
      .map((entry) => entry.path),
  );
  for (const change of nameStatuses(
    git(root, "diff", "--name-status", "-z", "-M", admittedForkSha, head),
  )) {
    let upstream =
      knownUpstream.has(change.path) ||
      Boolean(change.renamedFrom && knownUpstream.has(change.renamedFrom));
    if (!upstream)
      try {
        git(root, "cat-file", "-e", `${manifest.merge_base}:${change.renamedFrom ?? change.path}`);
        upstream = true;
      } catch {}
    if (!upstream) continue;
    const measured = inspect(root, change.path, admittedForkSha, head, packages);
    if (measured.binary || measured.addedLines > 3 || measured.nonNamespaceLines > 0)
      violations.push({
        path: change.path,
        addedLines: measured.addedLines,
        nonNamespaceLines: measured.nonNamespaceLines,
        ...(measured.binary ? { binary: true } : {}),
      });
  }
  return violations;
}

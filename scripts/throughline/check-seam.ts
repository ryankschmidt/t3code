// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off - This synchronous repository CLI emits its machine contract before workspace installation or an Effect runtime.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdtempSync,
  appendFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bindRepository,
  git,
  ORIGIN_URL,
  UPSTREAM_URL,
  RepositoryBindingError,
} from "./seam/repo-binding.ts";
import {
  classifyFork,
  classifyAdded,
  nameStatuses,
  type SeamClass,
  type ForkFile,
} from "./seam/classify.ts";
import { historicalMountLines, mountLineViolations } from "./seam/mount-lines.ts";

const FILE = "throughline-seam.json";
const LEGACY =
  "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Seams.json";
const PROJECTOR =
  "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/fork-tax-projector/project-fork-map.ts";
const CAPS = "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/capabilities";
const SHA = /^[a-f0-9]{40}$/;
type Counts = {
  upstream_edit: number;
  upstream_removed: number;
  fork_added: number;
  fork_namespace: number;
};
type Admission = {
  upstream_edit_count: number;
  fork_added_count: number;
  uncovered_fork_path_count: number;
  fork_sha: string;
  admitted_at: string;
  admitted_by: string;
};
type LegacyRule = {
  pattern: string;
  rule: string;
  inferred: boolean;
  capability?: string;
  sources?: string[];
};
type Resolution = { file: string; resolution: string; [field: string]: unknown };
type CapabilityInput = {
  name: string;
  rule: string;
  paths: string[];
  source: string;
  sha256: string;
};
export interface SeamEntry {
  path: string;
  class: SeamClass;
  renamed_from?: string;
  reason: string;
  reason_source: "authored" | "commit-subjects";
  imported_private_symbols: string[];
  schema_assumptions: string[];
  contract_inspection: string;
  conflict_rule: string;
  conflict_rule_source: "authored" | "legacy" | "capability" | "review";
  conflict_rule_inferred: boolean;
  marker: boolean;
  commits: string[];
  capability?: string;
  legacy_rules: LegacyRule[];
  relocation?: "planned" | "kept";
  relocation_reason?: string;
  mount_lines?: number;
  mount_measurement?: string;
}
export interface SeamManifest {
  schema: "throughline.seam-manifest.v1";
  upstream: { remote_url: string; sha: string };
  fork: { sha: string };
  merge_base: string;
  counts: Counts;
  admitted?: Admission;
  entries: SeamEntry[];
  upstream_changes: {
    path: string;
    upstream_commits: string[];
    decision: "adopt" | "retain" | "replace" | "defer";
    reason: string;
    legacy_resolutions: Resolution[];
  }[];
  conflict_rules: { default: "review"; capability_paths: "retain-fork-and-run-capability-tests" };
  migration: {
    ship_seams: { source: string; sha256: string; rules: LegacyRule[]; resolutions: Resolution[] };
    projector: { source: string; sha256: string };
    capabilities: CapabilityInput[];
  };
}

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const read = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const validPath = (path: string) =>
  text(path) &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !path.split("/").some((part) => part === ".." || part === "." || part === "");
const count = (files: Map<string, ForkFile>): Counts => {
  const counts: Counts = {
    upstream_edit: 0,
    upstream_removed: 0,
    fork_added: 0,
    fork_namespace: 0,
  };
  for (const file of files.values()) counts[file.cls.replaceAll("-", "_") as keyof Counts]++;
  return counts;
};
function matches(pattern: string, path: string): boolean {
  if (!validPath(pattern)) throw Error(`INVALID_LEGACY_PATTERN: ${pattern}`);
  const expression = pattern
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${expression}$`).test(path);
}

function migration(root: string, old?: SeamManifest): SeamManifest["migration"] {
  if (old?.migration) return old.migration;
  const bytes = readFileSync(LEGACY);
  const legacy = JSON.parse(bytes.toString("utf8")) as {
    rules: LegacyRule[];
    resolutions: Resolution[];
  };
  if (!Array.isArray(legacy.rules) || !Array.isArray(legacy.resolutions))
    throw Error("INVALID_LEGACY_SEAMS");
  const folder = existsSync(join(root, "docs/throughline/capabilities"))
    ? join(root, "docs/throughline/capabilities")
    : CAPS;
  const capabilities = readdirSync(folder, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .flatMap((item) => {
      const source = join(folder, item.name, "Capability.json");
      if (!existsSync(source)) return [];
      const data = read<{ name: string; rule: string; paths: string[] }>(source);
      if (
        !text(data.name) ||
        !text(data.rule) ||
        !Array.isArray(data.paths) ||
        data.paths.some((path) => !validPath(path))
      )
        throw Error(`INVALID_CAPABILITY: ${source}`);
      return [{ ...data, source, sha256: hash(readFileSync(source)) }];
    });
  return {
    ship_seams: {
      source: LEGACY,
      sha256: hash(bytes),
      rules: legacy.rules,
      resolutions: legacy.resolutions,
    },
    projector: { source: PROJECTOR, sha256: hash(readFileSync(PROJECTOR)) },
    capabilities,
  };
}

function generate(root: string, head: string, old?: SeamManifest): SeamManifest {
  const upstream = old?.upstream.sha ?? git(root, "rev-parse", "upstream/main").trim();
  const mergeBase = git(root, "merge-base", head, upstream).trim();
  const files = classifyFork(root, mergeBase, head);
  const mounts = historicalMountLines(
    root,
    mergeBase,
    head,
    [...files].filter(([, file]) => file.cls === "upstream-edit").map(([path]) => path),
  );
  const inputs = migration(root, old);
  const previous = new Map((old?.entries ?? []).map((entry) => [entry.path, entry]));
  const entries = [...files]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, file]): SeamEntry => {
      const saved = previous.get(path);
      const rules = inputs.ship_seams.rules.filter(
        (rule) =>
          matches(rule.pattern, path) ||
          (file.renamedFrom && matches(rule.pattern, file.renamedFrom)),
      );
      const protectedBy = inputs.capabilities.filter(
        (cap) =>
          cap.paths.includes(path) || (file.renamedFrom && cap.paths.includes(file.renamedFrom)),
      );
      if (protectedBy.length > 1) throw Error(`AMBIGUOUS_CAPABILITY: ${path}`);
      const reason = saved?.reason_source === "authored" ? saved.reason : file.commits.join("\n");
      if (!text(reason)) throw Error(`NO_COMMIT_PROVENANCE: ${path}`);
      const conflict = protectedBy
        .map((cap) => `Capability ${cap.name}: ${cap.rule}. retain-fork-and-run-capability-tests.`)
        .concat(rules.map((rule) => rule.rule));
      return {
        path,
        class: file.cls,
        ...(file.renamedFrom ? { renamed_from: file.renamedFrom } : {}),
        reason,
        reason_source: saved?.reason_source === "authored" ? "authored" : "commit-subjects",
        imported_private_symbols: saved?.imported_private_symbols ?? [],
        schema_assumptions: saved?.schema_assumptions ?? [],
        contract_inspection:
          saved?.contract_inspection ??
          "not-reviewed: empty symbol/schema lists do not assert absence; behavior coverage is separately capability-gated",
        conflict_rule:
          saved?.conflict_rule_source === "authored"
            ? saved.conflict_rule
            : conflict.length
              ? [...new Set(conflict)].join("\n")
              : "review",
        conflict_rule_source:
          saved?.conflict_rule_source === "authored"
            ? "authored"
            : protectedBy.length
              ? "capability"
              : rules.length
                ? "legacy"
                : "review",
        conflict_rule_inferred:
          saved?.conflict_rule_source === "authored" || protectedBy.length > 0
            ? false
            : rules.some((rule) => rule.inferred),
        marker: file.marker,
        commits: file.commits,
        ...(protectedBy[0] ? { capability: protectedBy[0].name } : {}),
        legacy_rules: rules,
        ...(file.cls === "upstream-edit" ? mounts.get(path) : {}),
        ...(file.cls === "fork-added"
          ? {
              relocation:
                saved?.relocation ??
                (path === FILE || path.startsWith("scripts/throughline/") ? "kept" : "planned"),
              relocation_reason:
                saved?.relocation_reason ??
                (path === FILE || path.startsWith("scripts/throughline/")
                  ? "Repository-level seam contract/control script explicitly placed here by T2.01/T2.02."
                  : "Candidate for namespace relocation at a later merge; verify consumer/tooling paths first. No file move performed by T2.02."),
            }
          : {}),
      };
    });
  const forkPaths = new Set(
    entries.flatMap((entry) => [entry.path, ...(entry.renamed_from ? [entry.renamed_from] : [])]),
  );
  const upstreamPaths = git(root, "diff", "--name-only", "-z", mergeBase, upstream)
    .split("\0")
    .filter(Boolean);
  const collisions = new Set(upstreamPaths.filter((path) => forkPaths.has(path)));
  // Historical resolutions survive byte-faithfully as data, even when that path no longer collides.
  for (const resolution of inputs.ship_seams.resolutions) collisions.add(resolution.file);
  const previousChanges = new Map(
    (old?.upstream_changes ?? []).map((change) => [change.path, change]),
  );
  const upstream_changes = [...collisions].sort().map((path) => {
    const resolutions = inputs.ship_seams.resolutions.filter(
      (resolution) => resolution.file === path,
    );
    const protectedBy = inputs.capabilities.find((cap) => cap.paths.includes(path));
    const saved = previousChanges.get(path);
    return {
      path,
      upstream_commits: git(root, "log", "--format=%H %s", `${mergeBase}..${upstream}`, "--", path)
        .split("\n")
        .filter(Boolean),
      decision: protectedBy ? ("retain" as const) : (saved?.decision ?? ("defer" as const)),
      reason: protectedBy
        ? `Retain the protected ${protectedBy.name} capability and run its pinned tests: ${protectedBy.rule}`
        : (saved?.reason ??
          `Review the current upstream change before choosing a resolution.${resolutions.length ? " Historical resolutions are attached, not promoted to acceptance of this upstream SHA." : ""}`),
      legacy_resolutions: resolutions,
    };
  });
  return {
    schema: "throughline.seam-manifest.v1",
    upstream: { remote_url: UPSTREAM_URL, sha: upstream },
    fork: { sha: head },
    merge_base: mergeBase,
    counts: count(files),
    ...(old?.admitted ? { admitted: old.admitted } : {}),
    entries,
    upstream_changes,
    conflict_rules: { default: "review", capability_paths: "retain-fork-and-run-capability-tests" },
    migration: inputs,
  };
}

function historyFloor(
  root: string,
):
  | Pick<Admission, "upstream_edit_count" | "fork_added_count" | "uncovered_fork_path_count">
  | undefined {
  let floor:
    | Pick<Admission, "upstream_edit_count" | "fork_added_count" | "uncovered_fork_path_count">
    | undefined;
  for (const sha of git(root, "log", "--format=%H", "HEAD", "--", FILE)
    .trim()
    .split("\n")
    .filter(Boolean)) {
    const past = JSON.parse(git(root, "show", `${sha}:${FILE}`)) as SeamManifest;
    if (!past.admitted) continue;
    if (
      ![
        past.admitted.upstream_edit_count,
        past.admitted.fork_added_count,
        past.admitted.uncovered_fork_path_count,
      ].every((value) => Number.isInteger(value) && value >= 0)
    )
      throw Error(`INVALID_COMMITTED_ADMISSION: ${sha}`);
    floor = {
      upstream_edit_count: Math.min(
        floor?.upstream_edit_count ?? Infinity,
        past.admitted.upstream_edit_count,
      ),
      fork_added_count: Math.min(
        floor?.fork_added_count ?? Infinity,
        past.admitted.fork_added_count,
      ),
      uncovered_fork_path_count: Math.min(
        floor?.uncovered_fork_path_count ?? Infinity,
        past.admitted.uncovered_fork_path_count,
      ),
    };
  }
  return floor;
}

function coverageInputs(root: string, manifest: SeamManifest): CapabilityInput[] {
  const folder = join(root, "docs/throughline/capabilities");
  if (!existsSync(folder)) return manifest.migration.capabilities;
  return readdirSync(folder, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .flatMap((item) => {
      const file = join(folder, item.name, "Capability.json");
      if (!existsSync(file)) return [];
      const value = read<CapabilityInput>(file);
      if (!Array.isArray(value.paths) || value.paths.some((path) => !validPath(path)))
        throw Error(`INVALID_COVERAGE_CAPABILITY: ${file}`);
      return [value];
    });
}

function uncoveredPaths(root: string, manifest: SeamManifest): string[] {
  const covered = new Set(coverageInputs(root, manifest).flatMap((capability) => capability.paths));
  return [
    ...new Set(manifest.entries.map((entry) => entry.path).filter((path) => !covered.has(path))),
  ].sort();
}

function firstAdmissionSha(root: string): string | undefined {
  for (const commit of git(root, "log", "--reverse", "--format=%H", "HEAD", "--", FILE)
    .trim()
    .split("\n")
    .filter(Boolean)) {
    const past = JSON.parse(git(root, "show", `${commit}:${FILE}`)) as SeamManifest;
    if (past.admitted) return past.admitted.fork_sha ?? past.fork.sha;
  }
  return undefined;
}

function admissionViolations(root: string, manifest: SeamManifest): string[] {
  const admitted = manifest.admitted;
  if (
    !admitted ||
    !text(admitted.admitted_at) ||
    !text(admitted.admitted_by) ||
    ![
      admitted.upstream_edit_count,
      admitted.fork_added_count,
      admitted.uncovered_fork_path_count,
    ].every((value) => Number.isInteger(value) && value >= 0)
  )
    return [`NOT_ADMITTED: ${FILE}`];
  const violations: string[] = [];
  if (!SHA.test(admitted.fork_sha ?? "")) violations.push("ADMITTED_FORK_SHA_MISSING");
  const frozen = firstAdmissionSha(root);
  if (frozen && frozen !== admitted.fork_sha)
    violations.push(`ADMITTED_FORK_SHA_CHANGED: ${admitted.fork_sha} != first ${frozen}`);
  if (
    manifest.counts.upstream_edit + manifest.counts.upstream_removed >
    admitted.upstream_edit_count
  )
    violations.push(
      `COUNT_EXCEEDS_ADMISSION: upstream_edit_count ${manifest.counts.upstream_edit + manifest.counts.upstream_removed} > ${admitted.upstream_edit_count}`,
    );
  if (manifest.counts.fork_added > admitted.fork_added_count)
    violations.push(
      `COUNT_EXCEEDS_ADMISSION: fork_added_count ${manifest.counts.fork_added} > ${admitted.fork_added_count}`,
    );
  const uncovered = uncoveredPaths(root, manifest).length;
  if (uncovered > admitted.uncovered_fork_path_count)
    violations.push(
      `COUNT_EXCEEDS_ADMISSION: uncovered_fork_path_count ${uncovered} > ${admitted.uncovered_fork_path_count}`,
    );
  const floor = historyFloor(root);
  if (floor)
    for (const field of [
      "upstream_edit_count",
      "fork_added_count",
      "uncovered_fork_path_count",
    ] as const)
      if (admitted[field] > floor[field])
        violations.push(
          `ADMISSION_INCREASE: ${field} ${admitted[field]} > committed ${floor[field]}`,
        );
  return violations;
}

function validate(
  root: string,
  head: string,
  manifest: SeamManifest,
  requireAdmission = true,
): string[] {
  if (manifest.schema !== "throughline.seam-manifest.v1") return ["INVALID_SCHEMA"];
  if (manifest.upstream?.remote_url !== UPSTREAM_URL) return ["INVALID_UPSTREAM_URL"];
  for (const sha of [manifest.upstream.sha, manifest.fork?.sha, manifest.merge_base]) {
    if (!SHA.test(sha ?? "")) return [`INVALID_COMMIT: ${sha}`];
    git(root, "cat-file", "-e", `${sha}^{commit}`);
  }
  const violations: string[] = [];
  if (manifest.admitted?.fork_sha) {
    try {
      git(root, "merge-base", "--is-ancestor", manifest.admitted.fork_sha, head);
    } catch {
      violations.push("ADMITTED_FORK_SHA_NOT_ANCESTOR");
    }
  }
  if (
    git(root, "merge-base", manifest.fork.sha, manifest.upstream.sha).trim() !== manifest.merge_base
  )
    violations.push("MERGE_BASE_MISMATCH");
  try {
    git(root, "merge-base", "--is-ancestor", manifest.fork.sha, head);
  } catch {
    violations.push("FORK_NOT_ANCESTOR_OF_HEAD");
  }
  const actual = classifyFork(root, manifest.merge_base, manifest.fork.sha);
  const entries = new Map<string, SeamEntry>();
  for (const entry of manifest.entries ?? []) {
    if (!validPath(entry.path) || entries.has(entry.path))
      violations.push(`INVALID_OR_DUPLICATE_PATH: ${entry.path}`);
    entries.set(entry.path, entry);
    const file = actual.get(entry.path);
    if (!file || file.cls !== entry.class || file.renamedFrom !== entry.renamed_from)
      violations.push(`CLASS_MISMATCH: ${entry.path}`);
    if (
      !text(entry.reason) ||
      !["authored", "commit-subjects"].includes(entry.reason_source) ||
      !Array.isArray(entry.imported_private_symbols) ||
      !Array.isArray(entry.schema_assumptions) ||
      !text(entry.conflict_rule)
    )
      violations.push(`MISSING_METADATA: ${entry.path}`);
    if (file && entry.marker !== file.marker) violations.push(`MARKER_MISMATCH: ${entry.path}`);
  }
  for (const [path] of actual) if (!entries.has(path)) violations.push(`UNLISTED_PATH: ${path}`);
  const actualCounts = count(actual);
  if (
    Object.keys(actualCounts).some(
      (key) => actualCounts[key as keyof Counts] !== manifest.counts?.[key as keyof Counts],
    )
  )
    violations.push("COUNT_MISMATCH");
  if (
    manifest.conflict_rules?.default !== "review" ||
    manifest.conflict_rules?.capability_paths !== "retain-fork-and-run-capability-tests"
  )
    violations.push("INVALID_CONFLICT_DEFAULTS");
  const rows = new Map<string, SeamManifest["upstream_changes"][number]>();
  for (const row of manifest.upstream_changes ?? []) {
    if (
      rows.has(row.path) ||
      !["adopt", "retain", "replace", "defer"].includes(row.decision) ||
      !text(row.reason)
    )
      violations.push(`INVALID_UPSTREAM_DECISION: ${row.path}`);
    rows.set(row.path, row);
  }
  const forkPaths = new Set(
    [...actual].flatMap(([path, file]) => [path, ...(file.renamedFrom ? [file.renamedFrom] : [])]),
  );
  for (const path of git(
    root,
    "diff",
    "--name-only",
    "-z",
    manifest.merge_base,
    manifest.upstream.sha,
  )
    .split("\0")
    .filter(Boolean))
    if (forkPaths.has(path) && !rows.has(path))
      violations.push(`UNCLAIMED_UPSTREAM_CHANGE: ${path}`);
  for (const cap of manifest.migration?.capabilities ?? [])
    for (const path of cap.paths) {
      const entry = entries.get(path);
      if (
        entry &&
        (entry.capability !== cap.name ||
          !entry.conflict_rule.includes(cap.rule) ||
          entry.conflict_rule.includes("take-upstream"))
      )
        violations.push(`CAPABILITY_RULE_INVALID: ${path}`);
    }
  if (requireAdmission) {
    violations.push(...admissionViolations(root, manifest));
    const current = classifyFork(root, manifest.merge_base, head);
    for (const change of nameStatuses(
      git(root, "diff", "--name-status", "-z", "-M", manifest.fork.sha),
    )) {
      if (change.path === FILE) continue; // Updating this facts contract does not amend upstream behavior.
      const prior = actual.get(change.path);
      const now = current.get(change.path);
      let upstream =
        prior?.cls === "upstream-edit" ||
        prior?.cls === "upstream-removed" ||
        now?.cls === "upstream-edit" ||
        now?.cls === "upstream-removed";
      try {
        git(root, "cat-file", "-e", `${manifest.merge_base}:${change.renamedFrom ?? change.path}`);
        upstream = true;
      } catch {}
      // Counts and path registration belong here; line-level mount admission belongs to T2.02.
      if (upstream && !entries.has(change.path))
        violations.push(`UNLISTED_UPSTREAM_EDIT: ${change.path}`);
      if (change.renamedFrom) current.delete(change.renamedFrom);
      if (change.status === "D" && !upstream) current.delete(change.path);
      else
        current.set(change.path, {
          cls: upstream
            ? change.status === "D"
              ? "upstream-removed"
              : "upstream-edit"
            : classifyAdded(change.path),
          commits: [],
          marker: false,
        });
    }
    const currentCounts = count(current);
    if (
      manifest.admitted &&
      currentCounts.upstream_edit + currentCounts.upstream_removed >
        manifest.admitted.upstream_edit_count
    )
      violations.push(
        `COUNT_EXCEEDS_ADMISSION: current upstream edits ${currentCounts.upstream_edit + currentCounts.upstream_removed} > ${manifest.admitted.upstream_edit_count}`,
      );
    for (const path of git(root, "ls-files", "--others", "--exclude-standard", "-z")
      .split("\0")
      .filter(Boolean))
      if (path !== FILE && classifyAdded(path) === "fork-added") currentCounts.fork_added++;
    if (manifest.admitted && currentCounts.fork_added > manifest.admitted.fork_added_count)
      violations.push(
        `COUNT_EXCEEDS_ADMISSION: current fork-added ${currentCounts.fork_added} > ${manifest.admitted.fork_added_count}`,
      );
  }
  return [...new Set(violations)];
}

function selfTest(
  root: string,
  head: string,
): { refusals: { path: string; stdout: string; stderr: string }[] } {
  const temporary = mkdtempSync(join(tmpdir(), "throughline-seam-self-test-"));
  const clone = join(temporary, "repo");
  try {
    execFileSync("/usr/bin/git", ["clone", "--shared", "--no-checkout", "--quiet", root, clone]);
    git(clone, "checkout", "--quiet", "--detach", head);
    git(clone, "remote", "set-url", "origin", ORIGIN_URL);
    git(clone, "remote", "add", "upstream", UPSTREAM_URL);
    const source = read<SeamManifest>(join(root, FILE));
    git(clone, "update-ref", "refs/remotes/upstream/main", source.upstream.sha);
    git(clone, "config", "user.name", "ThroughLine seam self-test");
    git(clone, "config", "user.email", "seam-self-test@invalid");
    const script = join(clone, "scripts/throughline/check-seam.ts");
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [script, "--repo", clone, ...args], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
    // Fixtures initialize their own admission; the bound branch's draft is never admitted here.
    const draft = { ...source };
    delete draft.admitted;
    writeFileSync(join(clone, FILE), JSON.stringify(draft, null, 2) + "\n");
    git(clone, "add", "--", FILE);
    if (git(clone, "diff", "--cached", "--name-only", "--", FILE).trim())
      git(clone, "commit", "--quiet", "-m", "self-test: record draft", "--", FILE);
    for (const mode of ["--write", "--admit"]) {
      const result = run(mode);
      if (result.status !== 0) throw Error(`SELF_TEST_SETUP: ${mode}: ${result.stderr}`);
    }
    git(clone, "add", "--", FILE);
    git(clone, "commit", "--quiet", "-m", "self-test: admit fixture", "--", FILE);
    const positive = run("--json");
    if (positive.status !== 0)
      throw Error(`SELF_TEST_POSITIVE_FAILED: ${positive.stdout} ${positive.stderr}`);
    const fixture = read<SeamManifest>(join(clone, FILE));
    const listed = new Set(fixture.entries.map((entry) => entry.path));
    const path = git(clone, "ls-tree", "-r", "--name-only", "-z", fixture.merge_base)
      .split("\0")
      .find(
        (path) =>
          path.startsWith("apps/server/src/") &&
          path.endsWith(".ts") &&
          !listed.has(path) &&
          existsSync(join(clone, path)),
      );
    if (!path) throw Error("SELF_TEST_NO_UPSTREAM_FILE");
    const original = readFileSync(join(clone, path));
    appendFileSync(join(clone, path), "\n// ThroughLine seam self-test: unlisted line\n");
    const edited = run("--json");
    if (edited.status !== 1 || !edited.stdout.includes(`UNLISTED_UPSTREAM_EDIT: ${path}`))
      throw Error(`SELF_TEST_EDIT_NOT_REFUSED: ${edited.status} ${edited.stdout} ${edited.stderr}`);
    writeFileSync(join(clone, path), original);
    const raised = run(
      "--admit",
      "--upstream-edit-count",
      String(fixture.admitted!.upstream_edit_count + 1),
    );
    if (raised.status !== 1 || !(raised.stdout + raised.stderr).includes("ADMISSION_INCREASE"))
      throw Error(
        `SELF_TEST_RAISE_NOT_REFUSED: ${raised.status} ${raised.stdout} ${raised.stderr}`,
      );
    return {
      refusals: [
        { path, stdout: edited.stdout, stderr: edited.stderr },
        { path: "admitted.upstream_edit_count", stdout: raised.stdout, stderr: raised.stderr },
      ],
    };
  } finally {
    rmSync(clone, { recursive: true, force: true });
    rmSync(temporary, { recursive: true, force: true });
  }
}

function mountSelfTest(root: string, head: string) {
  const temporary = mkdtempSync(join(tmpdir(), "throughline-mount-self-test-"));
  const clone = join(temporary, "repo");
  try {
    execFileSync("/usr/bin/git", ["clone", "--shared", "--no-checkout", "--quiet", root, clone]);
    git(clone, "checkout", "--quiet", "--detach", head);
    git(clone, "remote", "set-url", "origin", ORIGIN_URL);
    git(clone, "remote", "add", "upstream", UPSTREAM_URL);
    const source = read<SeamManifest>(join(root, FILE));
    git(clone, "update-ref", "refs/remotes/upstream/main", source.upstream.sha);
    git(clone, "config", "user.name", "ThroughLine mount self-test");
    git(clone, "config", "user.email", "mount-self-test@invalid");
    git(clone, "config", "commit.gpgsign", "false");
    const script = join(clone, "scripts/throughline/check-seam.ts");
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [script, "--repo", clone, ...args], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
    const draft = { ...source };
    delete draft.admitted;
    writeFileSync(join(clone, FILE), JSON.stringify(draft, null, 2) + "\n");
    git(clone, "add", "--", FILE);
    if (git(clone, "diff", "--cached", "--name-only", "--", FILE).trim())
      git(clone, "commit", "--quiet", "-m", "mount fixture draft", "--", FILE);
    for (const mode of ["--write", "--admit"]) {
      const result = run(mode);
      if (result.status !== 0)
        throw Error(`MOUNT_SELF_TEST_SETUP: ${mode}: ${result.stdout} ${result.stderr}`);
    }
    git(clone, "add", "--", FILE);
    git(clone, "commit", "--quiet", "-m", "mount fixture admission", "--", FILE);
    const path = "apps/server/src/ws.ts";
    if (!source.entries.some((entry) => entry.path === path && entry.class === "upstream-edit"))
      throw Error(`MOUNT_FIXTURE_PATH_NOT_ADMITTED: ${path}`);
    const original = readFileSync(join(clone, path));
    appendFileSync(
      join(clone, path),
      "\n" +
        Array.from({ length: 10 }, (_, i) => `export const mountFixture${i} = ${i};\n`).join(""),
    );
    git(clone, "add", "--", path);
    git(clone, "commit", "--quiet", "-m", "mount fixture ten-line edit", "--", path);
    const bad = run("--mounts", "--json");
    if (bad.status !== 1 || !(bad.stdout + bad.stderr).includes(`MOUNT_VIOLATION: ${path}`))
      throw Error(`MOUNT_SELF_TEST_NEGATIVE_FAILED: ${bad.status} ${bad.stdout} ${bad.stderr}`);
    writeFileSync(join(clone, path), original);
    appendFileSync(join(clone, path), 'import "./throughline/rewind/claudeTranscriptParent.ts";\n');
    git(clone, "add", "--", path);
    git(clone, "commit", "--quiet", "-m", "mount fixture one-line namespace import", "--", path);
    const good = run("--mounts", "--json");
    if (good.status !== 0)
      throw Error(`MOUNT_SELF_TEST_POSITIVE_FAILED: ${good.stdout} ${good.stderr}`);
    return {
      result:
        "self-test-mounts: ten-line upstream edit refused; one-line namespace import admitted",
      admission_scope: "disposable clone only",
      negative: { exit_code: bad.status, stdout: bad.stdout, stderr: bad.stderr },
      positive: { exit_code: good.status, stdout: good.stdout, stderr: good.stderr },
    };
  } finally {
    rmSync(clone, { recursive: true, force: true });
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };
  const flags = new Set([
    "--write",
    "--admit",
    "--json",
    "--self-test",
    "--mounts",
    "--self-test-mounts",
  ]);
  for (let i = 0; i < args.length; i++) {
    if (
      [
        "--repo",
        "--upstream-edit-count",
        "--fork-added-count",
        "--uncovered-fork-path-count",
      ].includes(args[i]!)
    ) {
      if (!args[++i] || args[i]!.startsWith("--"))
        throw new RepositoryBindingError("Missing option value");
    } else if (!flags.has(args[i]!)) throw new RepositoryBindingError(`Unknown option: ${args[i]}`);
  }
  if (["--write", "--admit", "--self-test"].filter((flag) => args.includes(flag)).length > 1)
    throw new RepositoryBindingError("Choose one of --write, --admit or --self-test");
  if (args.includes("--self-test-mounts") && !args.includes("--mounts"))
    throw new RepositoryBindingError("--self-test-mounts requires --mounts");
  if (
    args.includes("--mounts") &&
    ["--write", "--admit", "--self-test"].some((flag) => args.includes(flag))
  )
    throw new RepositoryBindingError("Mount checks do not mutate or mix admission modes");
  const { root, head } = bindRepository(value("--repo") ?? "");
  const file = join(root, FILE);
  const old = existsSync(file) ? read<SeamManifest>(file) : undefined;
  if (args.includes("--self-test-mounts")) {
    if (!old) throw Error(`MISSING_MANIFEST: ${file}`);
    const result = mountSelfTest(root, head);
    if (args.includes("--json")) console.log(JSON.stringify({ root, head, ...result }));
    else
      console.log(
        "self-test-mounts: ten-line upstream edit refused; one-line namespace import admitted (fixture only)",
      );
    return;
  }
  if (args.includes("--self-test")) {
    if (!old) throw Error(`MISSING_MANIFEST: ${file}`);
    const result = selfTest(root, head);
    if (args.includes("--json"))
      console.log(
        JSON.stringify({ root, head, ...result, result: "self-test: 2 of 2 refusals observed" }),
      );
    else console.log("self-test: 2 of 2 refusals observed");
    return;
  }
  let manifest = old;
  if (args.includes("--write") || args.includes("--admit")) {
    if (old?.admitted) {
      const refusals = admissionViolations(root, old);
      if (refusals.length) throw Error(refusals.join("\n"));
    }
    manifest = generate(root, head, old);
    if (args.includes("--admit")) {
      const floor = historyFloor(root) ?? old?.admitted;
      const upstream_edit_count = Number(
        value("--upstream-edit-count") ??
          manifest.counts.upstream_edit + manifest.counts.upstream_removed,
      );
      const fork_added_count = Number(value("--fork-added-count") ?? manifest.counts.fork_added);
      const expectedUncovered = uncoveredPaths(root, manifest);
      const coverageModule = join(root, "scripts/throughline/capability-coverage.ts");
      if (existsSync(coverageModule)) {
        const helper = (await import(pathToFileURL(coverageModule).href)) as {
          uncoveredForkPaths: (manifest: SeamManifest, capabilities: CapabilityInput[]) => string[];
        };
        const observed = helper.uncoveredForkPaths(manifest, coverageInputs(root, manifest));
        if (JSON.stringify(observed) !== JSON.stringify(expectedUncovered))
          throw Error("COVERAGE_MEASUREMENT_MISMATCH");
      }
      const uncovered_fork_path_count = Number(
        value("--uncovered-fork-path-count") ?? expectedUncovered.length,
      );
      if (
        floor &&
        (upstream_edit_count > floor.upstream_edit_count ||
          fork_added_count > floor.fork_added_count ||
          uncovered_fork_path_count > floor.uncovered_fork_path_count)
      )
        throw Error(
          `ADMISSION_INCREASE: requested ${upstream_edit_count}/${fork_added_count}/${uncovered_fork_path_count}, committed ceiling ${floor.upstream_edit_count}/${floor.fork_added_count}/${floor.uncovered_fork_path_count}`,
        );
      if (
        !floor &&
        (upstream_edit_count !== manifest.counts.upstream_edit + manifest.counts.upstream_removed ||
          fork_added_count !== manifest.counts.fork_added ||
          uncovered_fork_path_count !== expectedUncovered.length)
      )
        throw Error("FIRST_ADMISSION_MUST_EQUAL_MEASURED_COUNTS");
      manifest.admitted = {
        upstream_edit_count,
        fork_added_count,
        uncovered_fork_path_count,
        fork_sha: old?.admitted?.fork_sha ?? firstAdmissionSha(root) ?? head,
        admitted_at: new Date().toISOString(),
        admitted_by: process.env.CODEX_THREAD_ID ?? git(root, "config", "user.name").trim(),
      };
    }
    const violations = validate(root, head, manifest, Boolean(manifest.admitted));
    if (violations.length) throw Error(violations.join("\n"));
    writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  }
  if (!manifest) throw Error(`MISSING_MANIFEST: ${file}`);
  const violations =
    args.includes("--write") && !manifest.admitted
      ? validate(root, head, manifest, false)
      : validate(root, head, manifest);
  if (args.includes("--mounts") && manifest.admitted && violations.length === 0) {
    for (const violation of mountLineViolations(root, manifest.admitted.fork_sha, head, manifest))
      violations.push(`MOUNT_VIOLATION: ${violation.path}: ${JSON.stringify(violation)}`);
  }
  const result = {
    root,
    head,
    fork: manifest.fork.sha,
    upstream: manifest.upstream.sha,
    merge_base: manifest.merge_base,
    counts: manifest.counts,
    uncovered_fork_path_count: uncoveredPaths(root, manifest).length,
    admitted: manifest.admitted ?? null,
    violations,
    ok: violations.length === 0,
  };
  if (args.includes("--json")) console.log(JSON.stringify(result));
  else if (violations.length) console.error(violations.join("\n"));
  else
    console.log(
      `${args.includes("--write") && !manifest.admitted ? "draft generated (not admitted)" : "seam check: PASS"}: ${JSON.stringify(manifest.counts)}`,
    );
  if (violations.length) process.exitCode = 1;
}

const invoked = (() => {
  try {
    return (
      realpathSync.native(fileURLToPath(import.meta.url)) ===
      realpathSync.native(process.argv[1] ?? "")
    );
  } catch {
    return false;
  }
})();
if (invoked) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (process.argv.includes("--json"))
      console.log(JSON.stringify({ ok: false, violations: [message] }));
    else console.error(message);
    process.exitCode = error instanceof RepositoryBindingError ? 2 : 1;
  }
}

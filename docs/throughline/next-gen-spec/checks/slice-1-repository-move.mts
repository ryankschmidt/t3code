// Slice 1 checks on this Mac's real disk: the repository move, builds outside the vault, one pipeline from the new home.
// Written before any build (ledger item NG-138) and revised after judge round 1 (Oct 7, 2026): every check compares against the
// move record or the live thing, fails closed when a command fails, and never accepts an empty listing as proof.
// Run: node slice-1-repository-move.mts [--only S1-C01 S1-C03 …]      exit 1 on any FAIL
import { existsSync, readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, basename, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  canonical,
  under,
  archiveRows,
  archiveMatches,
  matchesAny,
  same,
  hashBytes,
  publicationBytes,
  parseMarkdown,
  manifestOf,
  expectedStep,
  pipelinePaths,
} from "./slice-1-contracts.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const specFlag = process.argv.indexOf("--spec");
const spec = JSON.parse(
  readFileSync(specFlag >= 0 ? process.argv[specFlag + 1] : join(HERE, "..", "spec.json"), "utf8"),
);
const beforeClose = process.argv.includes("--before-close");
const stageFlag = process.argv.indexOf("--stage");
const stage = stageFlag >= 0 ? process.argv[stageFlag + 1] : "final";
const R = spec.repository as Record<string, any>;
const HOME: string = R.home,
  WORKTREES: string = R.worktrees,
  VAULT: string = R.vault,
  OLD_HOME: string = R.old_home;
const EVIDENCE_ROOT: string = R.evidence_root,
  BACKUP_OLD: string = R.old_backup_root,
  BACKUP_NEW: string = R.backup_root,
  T3CODE: string = R.retired_folder;
const PIPELINE: string = R.pipeline_definition,
  VAULT_COPY: string = R.vault_copy.destination,
  MONOREPO: string = R.monorepo,
  COMPONENT: string = R.component_folder;
const MOVE_RECORD: string = R.move_record,
  ARCHIVE_LEDGER: string = R.archive_ledger,
  ORIGIN: string = R.origin,
  NEXT_RELEASE: string = R.next_release;
// R02 (GitHub rename, carried out Oct 9, 2026): a move record frozen before the rename names the old origin
const FROZEN_ORIGINS = new Set<string>([
  ORIGIN,
  ...((spec.ryan_decisions_pending ?? []).find((x: any) => x.id === "R02")?.carried_out
    ?.renamed_from
    ? [
        (spec.ryan_decisions_pending as any[]).find((x: any) => x.id === "R02").carried_out
          .renamed_from,
      ]
    : []),
]);
// a tag is compared by its own target type: commit (peeled_commit) or tree/blob (peeled_object, peeled_commit null)
const tagType = (t: any): string => t.peeled_object_type ?? t.object_type ?? "commit";
const tagPeeled = (t: any): string | null =>
  tagType(t) === "commit" ? t.peeled_commit : t.peeled_object;
const SPEC_REPO: string = R.spec_home_in_repository,
  SPEC_VAULT: string = R.spec_home_until_then,
  SHIP_TOOL_INSTALLED = `${MONOREPO}/src/tools/throughline-ship`;
const BUILD_EXT: string[] = R.build_extensions,
  BUILD_MARK: string[] = R.build_dir_markers,
  DESIGN_START: string = spec.design_start_commit;
const APP = "/Applications/ThroughLine.app";
const SHA40 = /^[0-9a-f]{40}$/,
  SHA256 = /^[0-9a-f]{64}$/,
  VERSION = /^\d+\.\d+\.\d+$/;
const ACCEPTED_ARCHIVE = new Set(["ARCHIVED_AND_REMOVED"]);
const PINNED_TESTS: Array<[string, string]> = [
  [
    "apps/server/src/vcs/GitVcsDriverCore.test.ts",
    "prepareCommitContext without file paths leaves the index untouched and reports working-tree changes",
  ],
  [
    "apps/server/src/vcs/GitVcsDriverCore.test.ts",
    "commit without file paths stages the working-tree set by explicit pathspec at commit time",
  ],
  [
    "apps/server/src/git/GitManager.test.ts",
    "commit-all through GitManager commits the working-tree changes without staging during preparation",
  ],
];

const only = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 ? new Set(process.argv.slice(i + 1)) : null;
})();
type Fail = string;
const results: Array<{ id: string; title: string; fails: Fail[] }> = [];
const titles = new Map<string, string>(spec.checks.map((c: any) => [c.id, c.title]));
const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
const tryGit = (repo: string, ...args: string[]) => {
  try {
    return git(repo, ...args);
  } catch {
    return null;
  }
};
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const moveRecord = () => {
  if (!existsSync(MOVE_RECORD)) throw new Error(`no move record at ${MOVE_RECORD}`);
  return readJson(MOVE_RECORD);
};
const ledgerRows = (): any[] =>
  existsSync(ARCHIVE_LEDGER) ? archiveRows(readFileSync(ARCHIVE_LEDGER, "utf8")) : [];
const WORKTREE_ANNOTATIONS = join(dirname(MOVE_RECORD), "Worktree-Move-Annotations.jsonl");
const worktreeAnnotations = (): any[] =>
  existsSync(WORKTREE_ANNOTATIONS)
    ? readFileSync(WORKTREE_ANNOTATIONS, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
const FP_KEYS = ["sha256", "file_count", "symlink_count", "entry_count", "bytes"] as const;
const present = (p: string) => {
  try {
    lstatSync(p);
    return true;
  } catch (e: any) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
};
const regularFile = (p: unknown): p is string =>
  typeof p === "string" && isAbsolute(p) && existsSync(p) && lstatSync(p).isFile();
const oldHomeAliasFindings = (m: any): Fail[] => {
  if (m.admission_state === "moved") {
    if (!present(OLD_HOME)) return ["old-home compatibility alias is required while moved"];
    if (!lstatSync(OLD_HOME).isSymbolicLink() || canonical(OLD_HOME) !== canonical(HOME))
      return ["old-home compatibility alias does not resolve to the repository"];
  }
  if (m.admission_state === "closed" && present(OLD_HOME))
    return ["old-home alias remains after closure"];
  return [];
};
const boundDisposition = (m: any, row: any) => {
  const frozen = (m.worktrees ?? []).find((w: any) => w.path === row.before);
  const fingerprint = (m.fingerprints ?? []).find((fp: any) => fp.path === row.before);
  return (
    frozen &&
    frozen.head === row.frozen_head &&
    (frozen.branch ?? null) === (row.branch ?? null) &&
    (!fingerprint || FP_KEYS.every((k) => row.fingerprint?.[k] === fingerprint[k]))
  );
};
const annotationFindings = (m: any, rows: any[]): Fail[] => {
  const f: Fail[] = [],
    bases = new Set<string>();
  for (const row of rows) {
    if (
      row.schema !== "throughline.worktree-move-annotation.v1" ||
      !Number.isFinite(Date.parse(row.observed_at))
    ) {
      f.push(`worktree annotation malformed: ${row.path ?? row.before}`);
      continue;
    }
    if (row.kind === "rebased") {
      if (
        !isAbsolute(row.path ?? "") ||
        !SHA40.test(row.previous_head) ||
        !SHA40.test(row.new_head) ||
        !regularFile(row.custody_evidence)
      )
        f.push(`rebase row incomplete: ${row.path}`);
      try {
        if (!regularFile(row.review)) throw Error("missing review file");
        const review = readJson(row.review);
        if (review.verdict !== "PASS" || review.head !== row.new_head)
          throw Error("review must pass the exact new head");
      } catch {
        f.push(`rebase review missing, failing or for another head: ${row.path}`);
      }
    } else if (row.kind === "disposition" || row.kind === "addition-freeze") {
      const path = row.kind === "disposition" ? row.before : row.path;
      if (
        typeof path !== "string" ||
        !isAbsolute(path) ||
        bases.has(path) ||
        typeof row.evidence?.command !== "string"
      )
        f.push(`worktree annotation base missing or repeated: ${path}`);
      bases.add(path);
      if (
        row.kind === "disposition" &&
        (!boundDisposition(m, row) ||
          !["moved", "kept", "retired-and-archived"].includes(row.disposition) ||
          (row.disposition === "moved" &&
            (typeof row.after !== "string" || !isAbsolute(row.after))) ||
          (row.disposition === "retired-and-archived" && !row.archive && !row.retirement_receipt))
      )
        f.push(`worktree disposition is not bound to its frozen witness: ${path}`);
      if (
        row.kind === "addition-freeze" &&
        (!SHA40.test(row.head) ||
          !(row.branch === null || typeof row.branch === "string") ||
          !under(path, WORKTREES) ||
          (m.worktrees ?? []).some((w: any) => w.path === path))
      )
        f.push(`worktree addition-freeze malformed: ${path}`);
    } else f.push(`unknown worktree annotation kind: ${row.kind}`);
  }
  return f;
};
const preservedTarget = (m: any, fp: any, rows: any[]): string | null => {
  const path = fp.target ?? fp.path;
  // Compare historical path strings, not realpaths: the old checkout can be a compatibility link.
  const moved = rows
    .filter(
      (row) =>
        row.kind === "disposition" &&
        row.disposition === "moved" &&
        boundDisposition(m, row) &&
        typeof row.after === "string" &&
        (resolve(path) === resolve(row.before) ||
          resolve(path).startsWith(resolve(row.before) + sep)),
    )
    .sort((a, b) => b.before.length - a.before.length)[0];
  return moved ? join(moved.after, relative(moved.before, path)) : (fp.target ?? null);
};
const preservedFindings = (m: any, fp: any): Fail[] => {
  const target = preservedTarget(m, fp, worktreeAnnotations());
  if (!target || !existsSync(target) || !under(target, WORKTREES))
    return [`preserved target missing: ${fp.path}`];
  const got = manifestOf(target);
  return FP_KEYS.every((k) => got[k as keyof typeof got] === fp[k])
    ? []
    : [`preserved tree fingerprint drift: ${target}`];
};
// The frozen witness stays read-only; subsequent dispositions and new-container freezes are separate files.
const ANNOTATIONS = join(dirname(MOVE_RECORD), "Archive-Annotations.jsonl");
const ADDENDUM = join(dirname(MOVE_RECORD), "Archive-Fingerprint-Addendum.jsonl");
const jsonlRows = (p: string): any[] =>
  existsSync(p)
    ? readFileSync(p, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
const sameFingerprint = (a: any, b: any): boolean =>
  !!a && !!b && FP_KEYS.every((k) => a[k] === b[k]);
const validFingerprint = (x: any): boolean =>
  !!x && SHA256.test(x.sha256) && FP_KEYS.slice(1).every((k) => Number.isFinite(x[k]) && x[k] >= 0);
// shape of both files (S1-C09)
const annotationShapeFindings = (m: any): Fail[] => {
  const f: Fail[] = [],
    ann = jsonlRows(ANNOTATIONS),
    add = jsonlRows(ADDENDUM),
    byPath = new Map<string, any>();
  const frozen = new Set<string>((m.fingerprints ?? []).map((x: any) => x.path));
  for (const a of ann) {
    if (
      a.schema !== "throughline.archive-annotation.v1" ||
      typeof a.path !== "string" ||
      !validFingerprint(a.fingerprint) ||
      !["archived-and-removed", "moved-and-preserved"].includes(a.disposition) ||
      typeof a.is_container !== "boolean" ||
      typeof a.record_container !== "string"
    ) {
      f.push(`annotation row malformed: ${a.path}`);
      continue;
    }
    if (byPath.has(a.path)) f.push(`two annotation rows for one path: ${a.path}`);
    byPath.set(a.path, a);
    if (
      a.is_container &&
      (a.record_container !== a.path ||
        typeof a.archive !== "string" ||
        a.verification !== "PASS" ||
        typeof a.archive_ledger_source !== "string")
    )
      f.push(`container annotation incomplete: ${a.path}`);
  }
  for (const a of ann)
    if (a.is_container === false) {
      const c = byPath.get(a.record_container);
      if (!c?.is_container || !under(a.path, a.record_container) || a.path === a.record_container)
        f.push(`covered child does not point at its ancestor container row: ${a.path}`);
    }
  for (const d of add)
    if (
      d.schema !== "throughline.archive-fingerprint-addendum.v1" ||
      typeof d.path !== "string" ||
      !validFingerprint(d.fingerprint) ||
      !Number.isFinite(Date.parse(d.observed_at)) ||
      typeof d.measurement !== "string" ||
      frozen.has(d.path)
    )
      f.push(`addendum row malformed or already in the frozen witness: ${d.path}`);
  return f;
};
// S1-C06 joins dispositions to the frozen witness, the addendum and the archive ledger.
const archiveFindings = (m: any, rows: any[]): { fails: Fail[]; archivedContainers: string[] } => {
  const f: Fail[] = [],
    ann = jsonlRows(ANNOTATIONS),
    add = jsonlRows(ADDENDUM),
    legacyArchived: string[] = [];
  const byPath = new Map<string, any>(ann.map((a: any) => [a.path, a])),
    addendum = new Map<string, any>(add.map((d: any) => [d.path, d]));
  const frozen = new Map<string, any>((m.fingerprints ?? []).map((x: any) => [x.path, x]));
  const ledgerPasses = (a: any, fp: any) =>
    archiveMatches(
      rows.find((r) => r.source === a.archive_ledger_source && r.archive === a.archive),
      { ...fp, path: a.archive_ledger_source, archive: a.archive },
    );
  for (const [path, fp] of frozen) {
    const a = byPath.get(path);
    const linkArchive =
      !a &&
      rows.find(
        (row) =>
          row.source === path &&
          fp.file_count === 0 &&
          fp.symlink_count === 1 &&
          fp.entry_count === 1 &&
          archiveMatches(row, { ...fp, archive: row.archive }),
      );
    if (linkArchive) {
      if (present(path)) f.push(`archived staging link still present: ${path}`);
    } else if (a) {
      if (!sameFingerprint(a.fingerprint, fp))
        f.push(`annotation does not match the frozen entry on path and fingerprint: ${path}`);
      else if (a.disposition === "archived-and-removed") {
        if (present(path)) f.push(`archived entry still present: ${path}`);
        if (a.is_container && !ledgerPasses(a, fp))
          f.push(`container has no passing archive ledger row: ${path}`);
      } else if (a.disposition === "moved-and-preserved") {
        f.push(...preservedFindings(m, fp));
      }
    } else if (fp.disposition === "archived-and-removed") {
      legacyArchived.push(path);
      if (
        present(path) ||
        !archiveMatches(
          rows.find((row) => row.source === path && row.archive === fp.archive),
          fp,
        )
      )
        f.push(`removed tree lacks exact verified archive identity: ${path}`);
    } else if (fp.disposition === "moved-and-preserved") {
      f.push(...preservedFindings(m, fp));
    } else f.push(`frozen entry has no annotation row and no preserved disposition: ${path}`);
  }
  for (const a of ann)
    if (a.is_container && a.disposition === "archived-and-removed" && !frozen.has(a.path)) {
      const d = addendum.get(a.path);
      if (!d)
        f.push(`container has neither a frozen entry nor a pre-copy addendum freeze: ${a.path}`);
      else if (!sameFingerprint(a.fingerprint, d.fingerprint))
        f.push(`container does not match its pre-copy freeze: ${a.path}`);
      else {
        if (present(a.path)) f.push(`archived container still present: ${a.path}`);
        if (!ledgerPasses(a, d.fingerprint))
          f.push(`container has no passing archive ledger row: ${a.path}`);
      }
    }
  for (const d of add)
    if (!byPath.get(d.path)?.is_container)
      f.push(`addendum freeze has no container annotation row: ${d.path}`);
  return {
    fails: f,
    archivedContainers: [
      ...legacyArchived,
      ...ann
        .filter((a: any) => a.is_container && a.disposition === "archived-and-removed")
        .map((a: any) => a.path),
    ],
  };
};
const rpiPipelineFindings = (p: any): Fail[] => {
  const f: Fail[] = [];
  // spec 0.4.12: the Raspberry Pi contract is either present at its root or removed and recorded under deferred.rpi with Ryan's pause
  {
    const RPI_STEPS = [
        "build-rpi",
        "gate-rpi",
        "stage-rpi-headless",
        "install-rpi-headless",
        "rpi-cold-turn",
      ],
      d = p.deferred?.rpi;
    if (p.rpi) {
      if (!same(p.rpi?.remote_root, R.rpi_build_root)) f.push("exact pipeline field mismatch: rpi");
    } else {
      if (
        !d?.ruling?.words ||
        d.ruling?.date !== "2026-10-09" ||
        !d.contract ||
        d.counted_as_passed !== false
      )
        f.push(
          "Raspberry Pi contract removed without its deferred.rpi record (ruling, template, counted_as_passed false)",
        );
      if (!same([...(d?.steps ?? []).map((s: any) => s.id)].sort(), [...RPI_STEPS].sort()))
        f.push("deferred.rpi does not keep the five Raspberry Pi step templates");
      for (const id of RPI_STEPS)
        if ((p.steps ?? []).some((s: any) => s.id === id) || (p.required_steps ?? []).includes(id))
          f.push(`deferred Raspberry Pi step still active: ${id}`);
      const order = ["install-tower", "install-phone", "install-mac"].map((id) =>
        (p.required_steps ?? []).indexOf(id),
      );
      if (order.some((i) => i < 0) || !(order[0] < order[1] && order[1] < order[2]))
        f.push("install order is not tower, then iPhone, then Mac");
    }
  }
  return f;
};
const installedVersion = () => {
  const r = spawnSync(
    "defaults",
    ["read", `${APP}/Contents/Info.plist`, "CFBundleShortVersionString"],
    { encoding: "utf8" },
  );
  const v = r.stdout.trim();
  if (!VERSION.test(v)) throw new Error(`installed version reads ${v || r.stderr.trim()}`);
  return v;
};
const semverGt = (a: string, b: string) => {
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
const isBuildFile = (name: string) => BUILD_EXT.some((e) => name.endsWith(e));
const isBuildDir = (name: string) => BUILD_MARK.some((m) => name === m || name.endsWith(m));
const sha256 = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const ancestor = (repo: string, a: string, b: string) =>
  tryGit(repo, "merge-base", "--is-ancestor", a, b) !== null;
const latestAttempt = (run: string, step: string) => {
  const f = readdirSync(run)
    .map((x) => new RegExp(`^${step}\\.attempt-(\\d+)\\.json$`).exec(x))
    .filter(Boolean)
    .sort((p, q) => Number(q![1]) - Number(p![1]));
  return f.length ? readJson(join(run, f[0]![0])) : null;
};
const walkBuildOutputs = (roots: string[]) => {
  const out: Array<{ path: string; reason: string }> = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      out.push({ path: dir, reason: "unreadable" });
      return;
    }
    for (const name of names) {
      const p = join(dir, name);
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(p);
      } catch {
        out.push({ path: p, reason: "unreadable" });
        continue;
      }
      if (st.isSymbolicLink()) {
        out.push({ path: p, reason: "symlink" });
        continue;
      }
      if (st.isDirectory()) {
        if (isBuildDir(name)) out.push({ path: p, reason: "build-output" });
        else walk(p);
      } else if (isBuildFile(name)) out.push({ path: p, reason: "build-output" });
    }
  };
  for (const root of roots) {
    try {
      const st = lstatSync(root);
      if (st.isSymbolicLink()) out.push({ path: root, reason: "symlink-root" });
      else if (st.isDirectory()) walk(root);
      else out.push({ path: root, reason: "non-directory-root" });
    } catch (e: any) {
      if (e.code !== "ENOENT") out.push({ path: root, reason: "unreadable-root" });
    }
  }
  return out;
};
const worktrees = (repo: string) => {
  const out: Array<{
    path: string;
    head: string;
    branch: string | null;
    detached: boolean;
    prunable: boolean;
  }> = [];
  for (const block of git(repo, "worktree", "list", "--porcelain").split("\n\n")) {
    const lines = block.split("\n").filter(Boolean);
    if (!lines.length) continue;
    const e = {
      path: "",
      head: "",
      branch: null as string | null,
      detached: false,
      prunable: false,
    };
    for (const l of lines) {
      if (l.startsWith("worktree ")) e.path = l.slice(9);
      else if (l.startsWith("HEAD ")) e.head = l.slice(5);
      else if (l.startsWith("branch ")) e.branch = l.slice(7).replace(/^refs\/heads\//, "");
      else if (l === "detached") e.detached = true;
      else if (l.startsWith("prunable")) e.prunable = true;
    }
    out.push(e);
  }
  if (!out.length) throw new Error("worktree list returned nothing");
  return out;
};
const check = async (id: string, fn: () => Fail[] | Promise<Fail[]>) => {
  if (only && !only.has(id)) return;
  let fails: Fail[];
  try {
    fails = await fn();
  } catch (e) {
    fails = [`threw: ${(e as Error).message.split("\n")[0]}`];
  }
  results.push({ id, title: titles.get(id) ?? id, fails });
};

export async function runSliceChecks() {
  await check("S1-C01", () => {
    const m = moveRecord(),
      f: Fail[] = [];
    if (!existsSync(join(HOME, ".git"))) return [`no repository at ${HOME}`];
    if (
      git(HOME, "rev-parse", "--show-toplevel") !== HOME ||
      git(HOME, "branch", "--show-current") !== "main"
    )
      f.push("home/current branch mismatch");
    const common = canonical(
      git(HOME, "rev-parse", "--git-common-dir").startsWith("/")
        ? git(HOME, "rev-parse", "--git-common-dir")
        : join(HOME, git(HOME, "rev-parse", "--git-common-dir")),
    );
    const st = lstatSync(common);
    if (
      !m.repository_identity ||
      st.dev !== m.repository_identity.device ||
      st.ino !== m.repository_identity.inode
    )
      f.push("common Git directory is not the frozen/moved repository identity");
    if (!ancestor(HOME, m.head, "HEAD") || !ancestor(HOME, DESIGN_START, "HEAD"))
      f.push("HEAD is not bound to frozen/design head");
    if (git(HOME, "remote", "get-url", "origin") !== ORIGIN || !FROZEN_ORIGINS.has(m.origin_url))
      f.push("exact origin mismatch");
    if (m.branches?.find((b: any) => b.name === "main")?.sha !== m.head)
      f.push("frozen main/head mismatch");
    for (const b of m.branches ?? []) {
      const tip = tryGit(HOME, "rev-parse", `refs/heads/${b.name}`);
      if (!tip || !ancestor(HOME, b.sha, tip)) f.push(`branch not preserved: ${b.name}`);
    }
    for (const t of m.tags ?? []) {
      const object = tryGit(HOME, "rev-parse", `refs/tags/${t.name}`),
        peeled = tryGit(HOME, "rev-parse", `refs/tags/${t.name}^{commit}`);
      if (object !== t.object_sha || peeled !== t.peeled_commit)
        f.push(`tag object/peeled identity drift: ${t.name}`);
    }
    return f;
  });

  await check("S1-C02", () => {
    const f: Fail[] = [];
    for (const dir of [T3CODE, dirname(T3CODE)])
      if (existsSync(dir))
        for (const name of readdirSync(dir))
          if (/^t3-upstream/.test(name) || name === "t3code-build")
            f.push(`retired entry remains: ${join(dir, name)}`);
    const repo = existsSync(join(HOME, ".git"))
      ? HOME
      : existsSync(join(OLD_HOME, ".git"))
        ? OLD_HOME
        : null;
    if (!repo) return [...f, "no repository at old or new home"];
    for (const w of worktrees(repo))
      if (under(w.path, VAULT)) f.push(`registered worktree under vault: ${w.path}`);
    const scan = (dir: string, depth: number) => {
      try {
        const root = lstatSync(dir);
        if (root.isSymbolicLink()) {
          f.push(`symlink scan root: ${dir}`);
          return;
        }
        if (!root.isDirectory()) return;
      } catch (e: any) {
        if (e.code !== "ENOENT") f.push(`unreadable scan root: ${dir}`);
        return;
      }
      if (existsSync(join(dir, ".git"))) {
        const url = tryGit(dir, "remote", "get-url", "origin");
        if (url === null) f.push(`origin lookup failed: ${dir}`);
        else if (url === ORIGIN) f.push(`clone under vault: ${dir}`);
      }
      if (depth <= 0) return;
      for (const name of readdirSync(dir)) {
        if (name === ".git" || name === "node_modules") continue;
        const p = join(dir, name);
        try {
          const st = lstatSync(p);
          if (st.isSymbolicLink()) f.push(`unresolved scan alias: ${p}`);
          else if (st.isDirectory()) scan(p, depth - 1);
        } catch {
          f.push(`unreadable clone candidate: ${p}`);
        }
      }
    };
    scan(T3CODE, 3);
    scan(COMPONENT, 3);
    return f;
  });

  await check("S1-C03", () => {
    const m = moveRecord(),
      f: Fail[] = [];
    if (!existsSync(join(HOME, ".git"))) return ["no moved repository"];
    const common = canonical(join(HOME, git(HOME, "rev-parse", "--git-common-dir"))),
      list = worktrees(HOME),
      version = installedVersion();
    if (!list.some((w) => canonical(w.path) === canonical(HOME) && w.branch === "main"))
      f.push("main worktree absent");
    if (
      !list.some(
        (w) =>
          canonical(w.path) === canonical(join(WORKTREES, version)) &&
          w.branch === `release/${version}`,
      )
    )
      f.push("installed-release worktree absent");
    const annotations = worktreeAnnotations();
    f.push(...annotationFindings(m, annotations));
    f.push(...oldHomeAliasFindings(m));
    for (const row of annotations.filter((row) => row.kind === "rebased"))
      if (!list.some((w) => canonical(w.path) === canonical(row.path)))
        f.push(`rebase row has no current worktree: ${row.path}`);
    for (const w of list) {
      if (w.prunable || !existsSync(w.path)) {
        f.push(`invalid worktree: ${w.path}`);
        continue;
      }
      const mapping = (m.worktree_mapping ?? []).find(
        (x: any) => canonical(x.after) === canonical(w.path),
      );
      const disposition = annotations.find(
        (row) =>
          row.kind === "disposition" &&
          boundDisposition(m, row) &&
          ((row.disposition === "moved" && canonical(row.after) === canonical(w.path)) ||
            (row.disposition === "kept" && canonical(row.before) === canonical(w.path))),
      );
      const addition = annotations.find(
        (row) => row.kind === "addition-freeze" && canonical(row.path) === canonical(w.path),
      );
      if (disposition && addition) f.push(`multiple worktree annotation bases: ${w.path}`);
      const binding = disposition
        ? { branch: disposition.branch ?? null, head: disposition.frozen_head }
        : mapping
          ? { branch: mapping.branch ?? null, head: mapping.frozen_head }
          : addition
            ? { branch: addition.branch, head: addition.head }
            : null;
      if (!binding) {
        f.push(`unbound worktree mapping: ${w.path}`);
        continue;
      }
      const chain = annotations.filter(
        (row) => row.kind === "rebased" && canonical(row.path) === canonical(w.path),
      );
      let expectedHead = binding.head;
      for (const row of chain) {
        if (row.previous_head !== expectedHead)
          f.push(`rebase chain does not join its previous head: ${w.path}`);
        const base = disposition ?? addition;
        if (base && annotations.indexOf(row) < annotations.indexOf(base))
          f.push(`rebase precedes its freeze row: ${w.path}`);
        expectedHead = row.new_head;
      }
      if (chain.length && expectedHead !== w.head)
        f.push(`latest rebase head does not match current HEAD: ${w.path}`);
      try {
        const actualCommon = git(w.path, "rev-parse", "--git-common-dir");
        if (
          canonical(actualCommon.startsWith("/") ? actualCommon : join(w.path, actualCommon)) !==
            common ||
          (binding.branch === null
            ? !w.detached || w.head !== expectedHead
            : w.detached ||
              git(w.path, "branch", "--show-current") !== binding.branch ||
              (chain.length ? w.head !== expectedHead : !ancestor(w.path, binding.head, "HEAD"))) ||
          git(w.path, "rev-parse", "HEAD") !== w.head
        )
          f.push(`worktree repository/branch/head mismatch: ${w.path}`);
      } catch {
        f.push(`broken worktree Git pointer: ${w.path}`);
      }
      if (
        canonical(w.path) !== canonical(HOME) &&
        !under(w.path, WORKTREES) &&
        disposition?.disposition !== "kept"
      )
        f.push(`worktree outside collection: ${w.path}`);
    }
    return f;
  });

  await check("S1-C04", () => {
    const m = moveRecord(),
      repo = existsSync(join(HOME, ".git")) ? HOME : OLD_HOME,
      f: Fail[] = [];
    const remote = new Map<string, string>();
    for (const line of git(repo, "ls-remote", "--heads", "--tags", "origin")
      .split("\n")
      .filter(Boolean)) {
      const [sha, ref] = line.split("\t");
      remote.set(ref, sha);
    }
    for (const b of m.branches ?? []) {
      const tip = remote.get(`refs/heads/${b.name}`);
      if (!tip || (tip !== b.sha && !ancestor(repo, b.sha, tip)))
        f.push(
          `remote branch lacks pinned object/ancestry (preparation must acquire objects): ${b.name}`,
        );
    }
    for (const t of m.tags ?? [])
      if (
        remote.get(`refs/tags/${t.name}`) !== t.object_sha ||
        (remote.get(`refs/tags/${t.name}^{}`) ?? remote.get(`refs/tags/${t.name}`)) !== tagPeeled(t)
      )
        f.push(`remote tag object/peeled drift (${tagType(t)}): ${t.name}`);
    const remoteMain = remote.get("refs/heads/main");
    if (!remoteMain || remoteMain !== git(repo, "rev-parse", "main"))
      f.push(
        "current intended main differs from live remote main; no fetch performed by acceptance",
      );
    return f;
  });

  await check("S1-C05", async () => {
    const f: Fail[] = [],
      p = readJson(PIPELINE);
    const version = readJson(SHIP_TOOL_INSTALLED + "/package.json").version;
    if (!(version === "0.4.1" || semverGt(version, "0.4.1")))
      f.push(
        "installed ship tool is older than the required contract (0.4.1 or later; 0.4.0 shipped with a scanner defect)",
      );
    try {
      const core: any = await import(pathToFileURL(SHIP_TOOL_INSTALLED + "/dist/core.js").href);
      core.validatePipeline(p);
    } catch (e) {
      f.push(`owning validator refused: ${(e as Error).message}`);
    }
    f.push(...pipelinePaths(p, R));
    for (const [field, got, want] of [
      ["checkout", p.checkout, HOME],
      ["worktrees_root", p.source?.worktrees_root, WORKTREES],
      ["release_checkout", p.source?.release_checkout, `${WORKTREES}/{release}`],
      ["backup_root", p.backup_root, BACKUP_NEW],
      ["move_record", p.move_record, MOVE_RECORD],
      ["patterns", p.vault_copy?.patterns, R.vault_copy.patterns],
      ["exclude", p.vault_copy?.exclude, R.vault_copy.exclude],
      ["tower", p.tower?.remote_root, R.tower_build_root],
    ] as const)
      if (!same(got, want)) f.push(`exact pipeline field mismatch: ${field}`);
    f.push(...rpiPipelineFindings(p));
    if (p.source?.upstream_mode_by_release?.[NEXT_RELEASE] !== "preserve-base")
      f.push("admitted next release is not preserve-base");
    const byId = new Map<string, any>((p.steps ?? []).map((s: any) => [s.id, s]));
    for (const id of ["vault-clean", "publish-docs"] as const) {
      const got = byId.get(id),
        expected = expectedStep(id, SHIP_TOOL_INSTALLED);
      for (const [key, value] of Object.entries(expected))
        if (!same(got?.[key], value)) f.push(`${id}: exact ${key} mismatch`);
      const after = expected.requires[0];
      if ((p.required_steps ?? []).indexOf(id) !== (p.required_steps ?? []).indexOf(after) + 1)
        f.push(`${id}: required step position`);
    }
    if (
      !same(byId.get("upstream-sync")?.requires, ["vault-clean"]) ||
      !same(byId.get("restart-courtesy")?.requires, ["publish-docs"])
    )
      f.push("downstream dependencies not rewired");
    for (const s of p.steps ?? [])
      for (const cmd of [s.command, s.completion_command])
        for (const arg of cmd ?? []) {
          if (typeof arg !== "string") continue;
          if (arg.includes(OLD_HOME) || arg.includes(R.old_release_checkout))
            f.push(`retired checkout consumer: ${s.id}`);
          if (
            arg.includes("{evidence}/") &&
            (BUILD_EXT.some((e) => arg.endsWith(e)) ||
              BUILD_MARK.some((m) => arg.split("/").some((seg) => seg === m || seg.endsWith(m))))
          )
            f.push(`artifact under records: ${s.id}`);
        }
    if (
      byId.get("capture-phone")?.command?.find((a: string) => a.endsWith("/run-gate.mts")) !==
        T3CODE + "/src/ios-simulator-gate/run-gate.mts" ||
      byId
        .get("testflight-readback")
        ?.command?.find((a: string) => a.endsWith("/asc-testflight.mts")) !==
        T3CODE + "/src/apple-signing/asc-testflight.mts"
    )
      f.push("retained helper producer/consumer bindings differ");
    const m = moveRecord(),
      proof = m.pipeline_rehearsal;
    if (!proof?.path || !existsSync(proof.path) || sha256(proof.path) !== proof.sha256)
      return [...f, "no hash-bound owning pipeline rehearsal"];
    const r = readJson(proof.path);
    if (
      r.pipeline_sha256 !== sha256(PIPELINE) ||
      r.core_sha256 !== sha256(SHIP_TOOL_INSTALLED + "/dist/core.js") ||
      !r.commands?.length ||
      r.commands.some(
        (c: any) =>
          c.exit_code !== 0 ||
          !(c.measured_cases > 0) ||
          !c.output_path ||
          !existsSync(c.output_path) ||
          sha256(c.output_path) !== c.output_sha256,
      ) ||
      !["vault-clean", "publish-docs"].every((id) => r.executed_steps?.includes(id))
    )
      f.push("pipeline rehearsal measured no bound functional cases/new steps");
    return f;
  });

  await check("S1-C06", () => {
    const f: Fail[] = [],
      found = walkBuildOutputs([EVIDENCE_ROOT, BACKUP_OLD, T3CODE]);
    const m = moveRecord(),
      rows = ledgerRows(),
      archived = new Set<string>();
    const aliasFindings = oldHomeAliasFindings(m);
    f.push(...aliasFindings);
    for (const x of found)
      if (
        !(
          x.reason === "symlink" &&
          x.path === OLD_HOME &&
          m.admission_state === "moved" &&
          aliasFindings.length === 0
        )
      )
        f.push(`${x.reason}: ${x.path}`);
    // T1.05 record_retention (spec 0.4.7): records of each archived container are retained at a local record address with a manifest
    const rr = (spec.tasks.find((t: any) => t.id === "T1.05") ?? {}).record_retention;
    if (!rr?.address || !rr?.manifest)
      f.push("T1.05 record_retention address or manifest undeclared");
    const archives = archiveFindings(m, rows);
    f.push(...archives.fails);
    for (const path of archives.archivedContainers) archived.add(path);
    if (rr?.address && rr?.manifest) {
      const lines: any[] | null = existsSync(rr.manifest)
        ? readFileSync(rr.manifest, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l))
        : null;
      if (archived.size && !lines) f.push(`record manifest missing: ${rr.manifest}`);
      const declared = new Map<string, number>(),
        counted = new Map<string, number>(),
        seen = new Set<string>();
      for (const x of lines ?? []) {
        if (x.schema !== "throughline.retained-record.v1") {
          f.push("record manifest row without its schema");
          continue;
        }
        if (x.kind === "container") {
          if (!archived.has(x.container))
            f.push(
              `record manifest names a container with no archived fingerprint: ${x.container}`,
            );
          declared.set(x.container, x.record_count);
          continue;
        }
        if (x.kind === "dropped") {
          if (typeof x.reason !== "string" || !x.reason.trim())
            f.push(`dropped record without a one-line reason: ${x.new_path}`);
          if (typeof x.new_path === "string" && present(x.new_path))
            f.push(`dropped record still present: ${x.new_path}`);
          continue;
        }
        if (x.kind !== "record") {
          f.push(`record manifest row of unknown kind: ${x.kind}`);
          continue;
        }
        counted.set(x.container, (counted.get(x.container) ?? 0) + 1);
        // A dropped third-party copy still belongs to the historical container count.
        if (
          typeof x.original_path === "string" &&
          typeof x.container === "string" &&
          x.original_path
            .slice(x.container.length + 1)
            .split("/")
            .some((seg: string) => (rr.excluded_dependency_trees ?? []).includes(seg))
        ) {
          if (
            !(lines ?? []).some((row: any) => row.kind === "dropped" && row.new_path === x.new_path)
          )
            f.push(`third-party dependency file kept as a record: ${x.original_path}`);
          continue;
        }
        const rel =
          typeof x.new_path === "string" && x.new_path.startsWith(rr.address + "/")
            ? x.new_path.slice(rr.address.length + 1)
            : null;
        if (
          rel === null ||
          rel.split("/").some((seg: string) => isBuildDir(seg) || isBuildFile(seg))
        ) {
          f.push(`record address outside ${rr.address} or build-named: ${x.new_path}`);
          continue;
        }
        if (seen.has(x.new_path)) f.push(`two records share one address: ${x.new_path}`);
        seen.add(x.new_path);
        if (!existsSync(x.new_path) || sha256(x.new_path) !== x.sha256)
          f.push(`record missing or changed at its new path: ${x.new_path}`);
      }
      for (const c of archived)
        if (!declared.has(c))
          f.push(`archived container has no record manifest container row: ${c}`);
      for (const [c, n] of declared)
        if ((counted.get(c) ?? 0) !== n)
          f.push(`record count mismatch for ${c}: declared ${n}, rows ${counted.get(c) ?? 0}`);
    }
    return f;
  });

  await check("S1-C07", () => {
    const f: Fail[] = [],
      mp = join(VAULT_COPY, "repository.json");
    if (!existsSync(mp)) return ["publication manifest absent"];
    const m = readJson(mp);
    if (
      m.schema !== "throughline.repository-copy.v1" ||
      !SHA40.test(m.commit) ||
      m.release !== installedVersion()
    )
      f.push("publication identity mismatch");
    if (!same(m.patterns, R.vault_copy.patterns) || !same(m.exclude, R.vault_copy.exclude))
      f.push("manifest narrowed or changed immutable declared set");
    const tree = git(HOME, "ls-tree", "-r", "--name-only", "-z", m.commit)
        .split("\0")
        .filter(Boolean),
      wanted = tree.filter(
        (p) => matchesAny(p, R.vault_copy.patterns) && !matchesAny(p, R.vault_copy.exclude),
      );
    const listed = (m.files ?? []).map((x: any) => x.source_path);
    if (
      !wanted.length ||
      new Set(listed).size !== listed.length ||
      !same([...wanted].sort(), [...listed].sort())
    )
      f.push("publication set is empty/duplicated/incomplete");
    const date = git(HOME, "show", "-s", "--format=%aI", m.commit).slice(0, 10);
    const approved = new Set(["README.md", "repository.json"]);
    for (const row of m.files ?? []) {
      if (
        !wanted.includes(row.source_path) ||
        row.path !== `tree/${row.source_path}` ||
        row.path.split("/").includes("..") ||
        row.path.startsWith("/")
      ) {
        f.push("publication path escape/unexpected source");
        continue;
      }
      const path = join(VAULT_COPY, row.path);
      approved.add(row.path);
      if (!under(path, VAULT_COPY) || lstatSync(path).isSymbolicLink()) {
        f.push(`publication alias: ${row.path}`);
        continue;
      }
      const source = execFileSync("git", ["-C", HOME, "show", `${m.commit}:${row.source_path}`], {
        maxBuffer: 64 * 1024 * 1024,
      });
      const expected = row.source_path.endsWith(".md")
        ? Buffer.from(
            publicationBytes(source.toString("utf8"), {
              path: row.source_path,
              repository: ORIGIN,
              commit: m.commit,
              release: m.release,
              date,
            }),
          )
        : source;
      if (!readFileSync(path).equals(expected) || row.sha256 !== hashBytes(expected))
        f.push(`written bytes/independent source transform mismatch: ${row.path}`);
      if (row.source_path.endsWith(".md")) {
        const fm = parseMarkdown(readFileSync(path, "utf8")).metadata;
        for (const k of [
          "title",
          "description",
          "type",
          "status",
          "created",
          "last_updated",
          "source_repository",
          "source_path",
          "source_commit",
          "release",
        ])
          if (!fm[k]) f.push(`parsed frontmatter lacks ${k}: ${row.path}`);
      }
    }
    const readme = join(VAULT_COPY, "README.md");
    if (!existsSync(readme)) f.push("generated root README absent");
    else {
      const r = readFileSync(readme, "utf8");
      if (![m.commit, m.release, "read-only", "tree/"].every((x) => r.includes(x)))
        f.push("generated README lacks current manifest/read-only layout");
    }
    const walk = (dir: string, rel: string) => {
      if (lstatSync(dir).isSymbolicLink()) throw Error("symlink publication root");
      for (const n of readdirSync(dir)) {
        const path = join(dir, n),
          r = rel ? rel + "/" + n : n,
          st = lstatSync(path);
        if (st.isSymbolicLink()) f.push(`publication symlink: ${r}`);
        else if (st.isDirectory()) walk(path, r);
        else if (!approved.has(r)) f.push(`unmanifested publication file: ${r}`);
      }
    };
    walk(VAULT_COPY, "");
    return f;
  });

  await check("S1-C08", () => {
    const f: Fail[] = [];
    const exclude = join(MONOREPO, ".git", "info", "exclude");
    if (existsSync(exclude))
      for (const line of readFileSync(exclude, "utf8").split("\n"))
        if (line.includes("t3code/t3-upstream") || line.includes("t3code-build"))
          f.push(`exclude line still present: ${line.trim()}`);
    for (const name of ["infra", "tools"])
      if (existsSync(join(WORKTREES, name)))
        f.push(`stale folder still present: ${join(WORKTREES, name)}`);
    if (existsSync(`${T3CODE}-build`)) f.push(`${T3CODE}-build still exists`);
    const readme = join(T3CODE, "README.md");
    if (!existsSync(readme) || !readFileSync(readme, "utf8").includes(HOME))
      f.push("the retired folder's README does not name the new home");
    return f;
  });
  await check("S1-C09", () => {
    const m = moveRecord(),
      f: Fail[] = [];
    if (
      m.schema !== "throughline.move-record.v1" ||
      !["frozen", "moved", "closed"].includes(m.admission_state) ||
      !SHA40.test(m.head) ||
      !FROZEN_ORIGINS.has(m.origin_url) ||
      !Number.isFinite(m.origin_ahead) ||
      m.origin_ahead < 0 ||
      !Number.isFinite(Date.parse(m.started_at))
    )
      f.push("move identity/admission/count malformed");
    if (
      !m.repository_identity ||
      !Number.isFinite(m.repository_identity.device) ||
      !Number.isFinite(m.repository_identity.inode)
    )
      f.push("frozen repository directory identity missing");
    if (!m.branches?.length || m.branches.find((b: any) => b.name === "main")?.sha !== m.head)
      f.push("complete branch inventory/frozen main missing");
    for (const b of m.branches ?? []) if (!b.name || !SHA40.test(b.sha)) f.push("invalid branch");
    if (!Array.isArray(m.tags)) f.push("tag inventory absent");
    for (const t of m.tags ?? []) {
      const ty = tagType(t);
      if (
        !t.name ||
        !SHA40.test(t.object_sha) ||
        !["commit", "tree", "blob"].includes(ty) ||
        (ty === "commit"
          ? !SHA40.test(t.peeled_commit)
          : !SHA40.test(t.peeled_object) || t.peeled_commit !== null)
      )
        f.push(`tag object/peeled identity missing (${ty}): ${t.name}`);
    }
    if (!m.worktrees?.length || !m.worktree_mapping?.length)
      f.push("frozen worktrees/mappings missing");
    const dispositions = worktreeAnnotations();
    for (const w of m.worktrees ?? [])
      if (
        !w.path ||
        !(typeof w.branch === "string" || (w.branch == null && w.detached === true)) ||
        !SHA40.test(w.head) ||
        w.clean !== true ||
        !Array.isArray(w.ignored_entries) ||
        !(
          m.worktree_mapping?.some(
            (x: any) => x.before === w.path && x.branch === w.branch && x.frozen_head === w.head,
          ) ||
          dispositions.some(
            (row) =>
              row.kind === "disposition" && row.before === w.path && boundDisposition(m, row),
          )
        )
      )
        f.push(`unbound/unclean frozen worktree: ${w.path}`);
    f.push(...annotationFindings(m, dispositions));
    if (
      !m.installed_app?.payloads?.length ||
      !m.installed_app.payloads.some((x: any) => x.path === APP + "/Contents/MacOS/ThroughLine") ||
      !m.installed_app.payloads.some((x: any) => x.path === APP + "/Contents/Resources/app.asar")
    )
      f.push("installed executable/resources fingerprints missing");
    if (!m.fingerprints?.length) f.push("fingerprints absent");
    for (const x of m.fingerprints ?? [])
      if (
        !x.path ||
        !SHA256.test(x.sha256) ||
        !["file_count", "symlink_count", "entry_count", "bytes"].every(
          (k) => Number.isFinite(x[k]) && x[k] >= 0,
        ) ||
        !["moved-and-preserved", "archived-and-removed"].includes(x.disposition)
      )
        f.push("invalid fingerprint/disposition");
    f.push(...annotationShapeFindings(m));
    const old = {
      home: OLD_HOME,
      release_checkout: R.old_release_checkout,
      backup_root: BACKUP_OLD,
      tower_remote_root: "/home/twr/build/workbench/infra/t3code/t3-{release}",
      rpi_remote_root: "/home/rpi/build/workbench/infra/t3code/t3-{release}",
      spec_folder: SPEC_VAULT,
    };
    const next = {
      home: HOME,
      release_checkout: R.release_checkout,
      backup_root: BACKUP_NEW,
      tower_remote_root: R.tower_build_root,
      rpi_remote_root: R.rpi_build_root,
      spec_folder: HOME + "/" + SPEC_REPO,
    };
    if (!same(m.old_paths, old) || !same(m.new_paths, next))
      f.push("six exact old/new path maps mismatch");
    const witness = m.frozen_inventory;
    if (!witness?.path || !existsSync(witness.path) || sha256(witness.path) !== witness.sha256)
      f.push("command-derived freeze inventory witness missing");
    else {
      const w = readJson(witness.path);
      for (const k of ["head", "origin_url", "branches", "tags", "worktrees", "fingerprints"])
        if (!same(w[k], m[k])) f.push(`freeze witness mismatch: ${k}`);
      if (
        !w.commands?.length ||
        w.commands.some(
          (c: any) =>
            c.exit_code !== 0 ||
            !c.argv?.length ||
            !c.output_path ||
            !existsSync(c.output_path) ||
            sha256(c.output_path) !== c.output_sha256,
        )
      )
        f.push("freeze witness lacks real bound command outputs");
    }
    return f;
  });

  await check("S1-C10", () => {
    if (!existsSync(join(HOME, ".git"))) return [`no repository at ${HOME}`];
    const f: Fail[] = [];
    const dir = join(HOME, SPEC_REPO);
    for (const rel of [
      "spec-data.mts",
      "contracts-data.mts",
      "build-spec.mts",
      "check-spec.mts",
      "test-check-spec.mts",
      "render-spec.mts",
      "spec.json",
      "Spec-Map.html",
      "Spec-Map.png",
      "Seam-Baseline.json",
      "README.md",
      "checks/slice-1-repository-move.mts",
      "checks/slice-1-contracts.mts",
      "checks/test-slice-1-checks.mts",
    ])
      if (tryGit(HOME, "ls-files", "--error-unmatch", `${SPEC_REPO}/${rel}`) === null)
        f.push(`not tracked: ${rel}`);
    if (git(HOME, "status", "--porcelain", "--", SPEC_REPO))
      f.push("uncommitted changes under the spec folder");
    if (existsSync(join(dir, "_meta"))) f.push("_meta was copied into the repository");
    if (existsSync(join(dir, "Move-Record.json")))
      f.push("Move-Record.json was copied into the repository");
    if (existsSync(dir))
      for (const name of readdirSync(dir))
        if (/^Check-Run-/.test(name)) f.push(`run record copied: ${name}`);
    const r = spawnSync("node", [join(dir, "check-spec.mts")], { encoding: "utf8" });
    if (r.status !== 0) f.push(`check-spec in the repository exited ${r.status}`);
    const vaultReadme = join(SPEC_VAULT, "README.md");
    if (
      !existsSync(vaultReadme) ||
      !readFileSync(vaultReadme, "utf8").includes(`${HOME}/${SPEC_REPO}`)
    )
      f.push("the vault folder's README does not point at the repository copy");
    return f;
  });
  await check("S1-C11", () => {
    if (!existsSync(join(HOME, ".git"))) return ["repository not moved; no product tests run"];
    const f: Fail[] = [];
    const src = readFileSync(join(HOME, "apps/server/src/vcs/GitVcsDriverCore.ts"), "utf8");
    if (/\[\s*"add",\s*"-A"\s*\]/.test(src) || src.includes("prepareCommitContext.addAll"))
      f.push("bare add-all preparation remains");
    const run = spawnSync(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "src/vcs/GitVcsDriverCore.test.ts",
        "src/git/GitManager.test.ts",
        "--reporter=json",
      ],
      { cwd: join(HOME, "apps/server"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (run.status !== 0) return [...f, `driver/manager runner exit ${run.status}`];
    let report: any;
    try {
      report = JSON.parse(run.stdout.trim());
    } catch {
      return [...f, "runner did not emit structured test execution evidence"];
    }
    const assertions = (report.testResults ?? []).flatMap((x: any) => x.assertionResults ?? []);
    if (!assertions.length) f.push("runner measured zero tests");
    for (const [, title] of PINNED_TESTS)
      if (!assertions.some((x: any) => x.title === title && x.status === "passed"))
        f.push(`named test did not execute successfully: ${title}`);
    const m = moveRecord(),
      review = m.pinned_test_review;
    if (!review?.path || !existsSync(review.path) || sha256(review.path) !== review.sha256)
      return [...f, "independent assertion/source review absent"];
    const r = readJson(review.path);
    if (
      !r.reviewer_session ||
      !r.builder_sessions?.length ||
      r.builder_sessions.includes(r.reviewer_session) ||
      r.staged_entry_equality !== "PASS" ||
      r.caller_commit_all !== "PASS" ||
      r.unborn_and_empty_selection !== "PASS"
    )
      f.push("assertion review does not prove the declared behavior");
    for (const [file] of PINNED_TESTS)
      if (r.hashes?.[file] !== sha256(join(HOME, file)))
        f.push(`assertion review source drift: ${file}`);
    return f;
  });

  await check("S1-C12", () => {
    const m = moveRecord(),
      f: Fail[] = [];
    if (
      !beforeClose &&
      (!Number.isFinite(Date.parse(m.completed_at)) ||
        Date.parse(m.completed_at) <= Date.parse(m.started_at) ||
        m.admission_state !== "closed")
    )
      f.push("final closure timestamp/state missing");
    if (beforeClose && (m.completed_at || m.admission_state !== "moved"))
      f.push("pre-close check must run before completion in moved state");
    if (
      !SHA40.test(m.final_head ?? git(HOME, "rev-parse", "main")) ||
      !ancestor(HOME, m.head, "main")
    )
      f.push("final head not bound to frozen repository");
    for (const path of [OLD_HOME, T3CODE + "/t3-upstream-0.0.51", T3CODE + "/t3-upstream-0.0.56"])
      if (existsSync(path)) f.push(`retired path remains: ${path}`);
    for (const path of [HOME, WORKTREES, BACKUP_NEW, WORKTREES + "/README.md"])
      if (!existsSync(path)) f.push(`destination absent: ${path}`);
    const rows = ledgerRows();
    for (const fp of m.fingerprints ?? []) {
      if (fp.disposition === "archived-and-removed") {
        if (
          !archiveMatches(
            rows.find((r) => r.source === fp.path && r.archive === fp.archive),
            fp,
          )
        )
          f.push(`archive identity/count mismatch: ${fp.path}`);
      } else if (fp.disposition === "moved-and-preserved") {
        if (!fp.target || !existsSync(fp.target) || !under(fp.target, WORKTREES))
          f.push("preserved tree missing");
        else {
          const got = manifestOf(fp.target);
          if (
            !["sha256", "file_count", "symlink_count", "entry_count", "bytes"].every(
              (k) => got[k as keyof typeof got] === fp[k],
            )
          )
            f.push("preserved tree content/count drift");
        }
      } else f.push("unknown retained/archive disposition");
    }
    const version = installedVersion();
    if (version === m.installed_app?.version) {
      for (const x of m.installed_app.payloads ?? [])
        if (!existsSync(x.path) || sha256(x.path) !== x.sha256)
          f.push(`installed payload changed without release: ${x.path}`);
    } else {
      const a = latestAttempt(
        EVIDENCE_ROOT + "/release-" + version.replaceAll(".", "-"),
        "install-mac",
      );
      if (
        a?.row?.outcome !== "passed" ||
        !a.installed_payloads?.length ||
        a.installed_payloads.some((x: any) => !existsSync(x.path) || sha256(x.path) !== x.sha256)
      )
        f.push("changed installed payload lacks exact owning install receipt");
    }
    const proofs = m.task_done_receipts ?? [];
    for (const id of [
      "T1.01",
      "T1.02",
      "T1.03",
      "T1.04",
      "T1.05",
      "T1.06",
      "T1.08",
      "T1.09",
      "T1.10",
    ]) {
      const r = proofs.find((x: any) => x.task === id);
      if (
        !r?.path ||
        !existsSync(r.path) ||
        sha256(r.path) !== r.sha256 ||
        r.exit_code !== 0 ||
        !Number.isFinite(Date.parse(r.finished_at)) ||
        (!beforeClose && Date.parse(r.finished_at) >= Date.parse(m.completed_at))
      )
        f.push(`task proof missing or not before closure: ${id}`);
    }
    if (!beforeClose) {
      const j = m.joined_preclose;
      if (
        !j?.path ||
        !existsSync(j.path) ||
        sha256(j.path) !== j.sha256 ||
        j.exit_code !== 0 ||
        Date.parse(j.finished_at) >= Date.parse(m.completed_at)
      )
        f.push("joined suite did not pass before completion");
    }
    return f;
  });

  await check("S1-C13", () => {
    const f: Fail[] = [],
      version = installedVersion();
    if (version !== NEXT_RELEASE)
      return [`installed ${version}, acceptance release is ${NEXT_RELEASE}`];
    const run = EVIDENCE_ROOT + "/release-" + version.replaceAll(".", "-");
    if (!existsSync(run)) return ["release evidence absent"];
    const pipeline = readJson(PIPELINE);
    f.push(...rpiPipelineFindings(pipeline));
    const sc = readJson(join(run, "source-commit.json")),
      commit = sc.commit,
      closure = readJson(join(run, "Release-Closure.json"));
    if (
      !SHA40.test(commit) ||
      closure.release !== version ||
      closure.source_commit !== commit ||
      closure.run_id !== sc.run_id ||
      closure.outcome !== "passed"
    )
      f.push("owning closure/release/run/source identity mismatch");
    const wt = join(WORKTREES, version);
    if (
      tryGit(wt, "rev-parse", "HEAD") !== commit ||
      tryGit(wt, "branch", "--show-current") !== `release/${version}`
    )
      f.push("release worktree not exactly the frozen source");
    for (const step of [
      "vault-clean",
      "install-tower",
      "install-tower-headless",
      ...(pipeline.rpi ? ["install-rpi-headless"] : []),
      "install-phone",
      "install-mac",
      "publish-docs",
      "rewind-live-proof",
    ]) {
      const a = latestAttempt(run, step);
      if (
        a?.row?.outcome !== "passed" ||
        a.source_commit !== commit ||
        a.release !== version ||
        a.run_id !== closure.run_id
      )
        f.push(`step does not bind current release/source/run: ${step}`);
    }
    if (!closure.artifacts?.length || !closure.installed_readbacks?.length)
      f.push("no actual artifact/installed payload readbacks");
    for (const a of closure.artifacts ?? [])
      if (
        !a.path ||
        !existsSync(a.path) ||
        sha256(a.path) !== a.sha256 ||
        !under(a.path, join(wt, "release"))
      )
        f.push("artifact digest/address mismatch");
    for (const x of closure.installed_readbacks ?? [])
      if (
        x.release !== version ||
        x.source_commit !== commit ||
        !x.payload_sha256 ||
        !x.receipt_path ||
        !existsSync(x.receipt_path) ||
        sha256(x.receipt_path) !== x.receipt_sha256
      )
        f.push("installed target identity/readback not bound");
    for (const file of ["apps/server/src/vcs/GitVcsDriverCore.ts", SPEC_REPO + "/spec.json"])
      if (
        !closure.shipped_source_hashes?.[file] ||
        hashBytes(execFileSync("git", ["-C", HOME, "show", commit + ":" + file])) !==
          closure.shipped_source_hashes[file]
      )
        f.push(`T1.08/T1.09 source not in shipped identity: ${file}`);
    const m = readJson(join(VAULT_COPY, "repository.json"));
    if (m.commit !== commit || m.release !== version)
      f.push("publication is not this frozen release");
    for (const x of walkBuildOutputs([run])) f.push(`build output in record folder: ${x.path}`);
    return f;
  });

  await check("S1-C14", () => {
    const f: Fail[] = [],
      version = installedVersion(),
      path = COMPONENT + "/_meta/repository-move-2026-10-07/Staging-Probe-" + version + ".json";
    if (!existsSync(path)) return ["non-builder installed-server staging probe absent"];
    const p = readJson(path),
      m = moveRecord();
    if (
      p.schema !== "throughline.staging-probe.v1" ||
      p.installed_version !== version ||
      p.project !== HOME ||
      !p.thread_id ||
      !p.server?.pid ||
      !p.server?.started_at ||
      !p.server?.native_session ||
      p.prepared_state !== "one modified tracked file and one untracked file" ||
      !p.dirty_fixture?.tracked_path ||
      !p.dirty_fixture?.untracked_path ||
      !p.observed_by?.session_id ||
      (m.builder_sessions ?? []).includes(p.observed_by.session_id)
    )
      f.push("probe lacks dirty fixture/server/thread/non-builder identity");
    if (!m.builder_sessions?.length) f.push("implementation provenance sessions absent");
    const live = spawnSync("ps", ["-p", String(p.server?.pid ?? 0), "-o", "lstart=,comm="], {
      encoding: "utf8",
    });
    if (live.status !== 0 || !live.stdout.trim()) f.push("bound server process is not live");
    else {
      const started = Date.parse(live.stdout.trim().slice(0, 24));
      if (!Number.isFinite(started) || Math.abs(started - Date.parse(p.server.started_at)) > 2000)
        f.push("live process start differs from probe binding");
    }
    if (p.interval_seconds !== 2 || !Array.isArray(p.samples) || p.samples.length < 30)
      f.push("not thirty structured samples at the declared two-second interval");
    for (let i = 0; i < (p.samples ?? []).length; i++) {
      const s = p.samples[i];
      if (
        !s ||
        !Array.isArray(s.index_entries) ||
        typeof s.staged_patch_sha256 !== "string" ||
        !s.preparation_event_id ||
        s.server_pid !== p.server?.pid ||
        s.thread_id !== p.thread_id ||
        !Number.isFinite(Date.parse(s.at))
      )
        f.push("sample lacks actual consumer preparation event and index bytes");
      if (i > 0) {
        const prev = p.samples[i - 1];
        if (
          Math.abs(Date.parse(s.at) - Date.parse(prev.at) - 2000) > 250 ||
          !same(s.index_entries, prev.index_entries) ||
          s.staged_patch_sha256 !== prev.staged_patch_sha256
        )
          f.push("sample cadence/index bytes drift");
      }
    }
    if (
      !p.server?.binding_receipt ||
      !existsSync(p.server.binding_receipt) ||
      sha256(p.server.binding_receipt) !== p.server.binding_sha256
    )
      f.push("server/process binding witness missing");
    if (
      p.samples?.length &&
      (!same(p.started_at, p.samples[0].at) ||
        Date.parse(p.finished_at) < Date.parse(p.samples.at(-1).at))
    )
      f.push("probe duration does not bind sample timestamps");
    return f;
  });

  await check("S1-G01", () => {
    const f: Fail[] = [];
    if (!existsSync(`${APP}/Contents/MacOS/ThroughLine`)) f.push("no installed executable");
    try {
      installedVersion();
    } catch (e) {
      f.push((e as Error).message);
    }
    const r = spawnSync(
      "curl",
      [
        "-s",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "-m",
        "5",
        "http://127.0.0.1:3773/api/auth/session",
      ],
      { encoding: "utf8" },
    );
    if (r.stdout.trim() !== "200") f.push(`local server answered ${r.stdout.trim() || "nothing"}`);
    return f;
  });

  await check("S1-M01", () => {
    const m = moveRecord(),
      f: Fail[] = [];
    if (!["moved", "closed"].includes(m.admission_state)) f.push("move not physically admitted");
    if (!existsSync(join(HOME, ".git"))) f.push("new repository move incomplete");
    f.push(...oldHomeAliasFindings(m));
    for (const w of worktrees(HOME))
      if (canonical(w.path) !== canonical(HOME) && !under(w.path, WORKTREES))
        f.push("worktree outside new collection");
    return f;
  });
  await check("S1-A01", () => {
    const run = EVIDENCE_ROOT + "/release-0-0-56";
    if (!existsSync(run)) return ["prior run absent"];
    const a = latestAttempt(run, "rewind-live-proof");
    if (a?.row?.outcome === "passed" && existsSync(join(run, "Release-Closure.md"))) return [];
    const abort = existsSync(join(run, "Abort-Receipt.json"))
      ? readJson(join(run, "Abort-Receipt.json"))
      : null;
    return abort?.run_id === "release-0-0-56" &&
      abort.attempt === a?.attempt &&
      abort.outcome === "aborted" &&
      Number.isFinite(Date.parse(abort.at))
      ? []
      : [
          "latest prior run attempt is not exactly closed/aborted; process absence never grants release exclusion",
        ];
  });

  let green = 0;
  for (const r of results) {
    if (r.fails.length === 0) {
      green++;
      console.log(`PASS  ${r.id} ${r.title}`);
    } else {
      console.log(`FAIL  ${r.id} ${r.title}  (${r.fails.length})`);
      for (const x of r.fails.slice(0, 8)) console.log(`        - ${x}`);
      if (r.fails.length > 8) console.log(`        - … ${r.fails.length - 8} more`);
    }
  }
  console.log(
    `\n${green} of ${results.length} checks green  (${new Date().toISOString()}, ${basename(HERE)})`,
  );
  return { exit: green === results.length ? 0 : 1, results };
}

// Isolated repository-move fixture suite; no operator state is written.
async function runRepositoryMoveFixtures(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const {
    chmodSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmdirSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
  } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { manifestOf } = await import("./slice-1-contracts.mts");
  // Real disposable repositories and files; no operator repository or archive is mutated.

  const HERE = dirname(fileURLToPath(import.meta.url));
  const root = realpathSync(mkdtempSync(join(tmpdir(), "repository-move-fixtures-")));
  const originalSpec = JSON.parse(readFileSync(join(HERE, "../spec.json"), "utf8"));
  const file = (p: string, text: string) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  const json = (p: string, value: unknown) => file(p, JSON.stringify(value));
  const git = (repo: string, ...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const home = join(root, "home"),
    trees = join(root, "worktrees"),
    records = join(root, "records");
  mkdirSync(home);
  mkdirSync(trees);
  mkdirSync(records);
  git(home, "init", "-q", "-b", "main");
  git(home, "config", "user.name", "Move fixture");
  git(home, "config", "user.email", "fixture@example.invalid");
  file(join(home, "file.txt"), "initial\n");
  git(home, "add", "--", "file.txt");
  git(home, "commit", "-qm", "initial");
  const a = git(home, "rev-parse", "HEAD");
  const release = join(trees, "1.2.3"),
    task = join(trees, "task");
  git(home, "worktree", "add", "-qb", "release/1.2.3", release);
  git(home, "worktree", "add", "-qb", "task", task);
  // Two rewritten tips: neither is a descendant of the frozen commit.
  const tree = git(home, "rev-parse", "HEAD^{tree}");
  const b = git(home, "commit-tree", tree, "-m", "first replay");
  const c = git(home, "commit-tree", tree, "-m", "second replay");
  git(task, "update-ref", "refs/heads/task", c);
  const defaults = join(root, "bin/defaults");
  file(defaults, '#!/usr/bin/env node\nconsole.log("1.2.3");\n');
  chmodSync(defaults, 0o755);
  const movePath = join(records, "Move-Record.json"),
    annotations = join(records, "Worktree-Move-Annotations.jsonl");
  const reviewB = join(records, "review-b.json"),
    reviewC = join(records, "review-c.json"),
    custody = join(records, "custody.json");
  json(reviewB, { verdict: "PASS", head: b });
  json(reviewC, { verdict: "PASS", head: c });
  json(custody, { previous_head: a, new_head: b });
  const schema = "throughline.worktree-move-annotation.v1",
    at = "2026-10-10T08:00:00.000Z";
  const freeze = {
    schema,
    kind: "addition-freeze",
    path: task,
    head: a,
    branch: "task",
    observed_at: at,
    reason: "fixture",
    evidence: { command: "git worktree list --porcelain", output_path: custody },
  };
  const chain = [
    freeze,
    {
      schema,
      kind: "rebased",
      path: task,
      previous_head: a,
      new_head: b,
      review: reviewB,
      custody_evidence: custody,
      observed_at: at,
    },
    {
      schema,
      kind: "rebased",
      path: task,
      previous_head: b,
      new_head: c,
      review: reviewC,
      custody_evidence: custody,
      observed_at: at,
    },
  ];
  const move = {
    worktrees: [
      { path: home, head: a, branch: "main" },
      { path: release, head: a, branch: "release/1.2.3" },
    ],
    worktree_mapping: [
      { before: home, after: home, frozen_head: a, branch: "main" },
      { before: release, after: release, frozen_head: a, branch: "release/1.2.3" },
    ],
    fingerprints: [],
  };
  const spec = structuredClone(originalSpec);
  Object.assign(spec.repository, {
    home,
    worktrees: trees,
    move_record: movePath,
    archive_ledger: join(records, "archive.json"),
    evidence_root: join(root, "evidence"),
    old_backup_root: join(root, "backup"),
    retired_folder: join(root, "retired"),
    old_home: join(root, "retired/old-home"),
  });
  const rr = spec.tasks.find((t: any) => t.id === "T1.05").record_retention;
  rr.address = join(root, "retained");
  rr.manifest = join(records, "retained.jsonl");
  const specPath = join(root, "spec.json");
  json(specPath, spec);
  const rows = (values: unknown[]) =>
    file(annotations, values.map((x) => JSON.stringify(x)).join("\n") + "\n");
  const run = (id: string, expected: number, reason?: string) => {
    const r = spawnSync(
      process.execPath,
      [join(HERE, "slice-1-repository-move.mts"), "--spec", specPath, "--only", id],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: join(root, "bin") + ":" + process.env.PATH },
      },
    );
    assert.equal(r.status, expected, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^${expected === 0 ? "PASS" : "FAIL"}  ${id} `, "m"));
    if (reason) assert.ok(r.stdout.includes(reason), r.stdout);
  };
  const cases: Array<[string, () => void]> = [];
  const test = (name: string, fn: () => void) => cases.push([name, fn]);
  test("S1-C03 valid two-rebase chain with exact passing reviews", () => {
    json(movePath, move);
    rows(chain);
    run("S1-C03", 0);
  });
  test("S1-C03 an existing frozen mapping accepts the same reviewed chain", () => {
    json(movePath, {
      ...move,
      worktree_mapping: [
        ...move.worktree_mapping,
        { before: task, after: task, frozen_head: a, branch: "task" },
      ],
    });
    rows(chain.slice(1));
    run("S1-C03", 0);
  });
  test("S1-C03 ordinary frozen mapping still passes without a rebase", () => {
    git(task, "update-ref", "refs/heads/task", a);
    try {
      json(movePath, move);
      rows([freeze]);
      run("S1-C03", 0);
    } finally {
      git(task, "update-ref", "refs/heads/task", c);
    }
  });
  for (const [name, patch] of [
    ["missing review", { review: undefined }],
    ["nonexistent review", { review: join(records, "absent.json") }],
    ["missing custody evidence", { custody_evidence: join(records, "absent.json") }],
    ["head does not match current HEAD", { new_head: b }],
    ["disconnected chain", { previous_head: a }],
  ] as const)
    test(`S1-C03 ${name} refuses`, () => {
      json(movePath, move);
      rows([chain[0], chain[1], { ...chain[2], ...patch }]);
      run("S1-C03", 1, "rebase");
    });
  test("S1-C03 an earlier failing review cannot be hidden by a newer pass", () => {
    json(movePath, move);
    rows(chain);
    json(reviewB, { verdict: "FAIL", head: b });
    try {
      run("S1-C03", 1, "review");
    } finally {
      json(reviewB, { verdict: "PASS", head: b });
    }
  });
  test("S1-C03 passing review for a different head refuses", () => {
    json(movePath, move);
    rows(chain);
    json(reviewC, { verdict: "PASS", head: b });
    try {
      run("S1-C03", 1, "review");
    } finally {
      json(reviewC, { verdict: "PASS", head: c });
    }
  });
  test("S1-C03 duplicate freeze cannot reset a bad chain", () => {
    json(movePath, move);
    rows([freeze, { ...chain[1], review: join(records, "absent.json") }, { ...freeze, head: c }]);
    run("S1-C03", 1);
  });
  test("S1-C03 frozen detached addition stays valid at its head", () => {
    git(task, "checkout", "--detach", c);
    try {
      json(movePath, move);
      rows([{ ...freeze, head: c, branch: null }]);
      run("S1-C03", 0);
    } finally {
      git(task, "checkout", "task");
    }
  });

  for (const id of ["S1-C03", "S1-M01", "S1-C06"]) {
    test(id + " moved stage requires the compatibility alias", () => {
      json(movePath, { ...move, admission_state: "moved" });
      rows(chain);
      run(id, 1, "alias");
    });
    test(id + " moved stage accepts the compatibility alias pointing to the repository", () => {
      mkdirSync(dirname(spec.repository.old_home), { recursive: true });
      symlinkSync(home, spec.repository.old_home);
      try {
        json(movePath, { ...move, admission_state: "moved" });
        rows(chain);
        run(id, 0);
      } finally {
        unlinkSync(spec.repository.old_home);
      }
    });
    test(id + " closed stage requires the alias gone", () => {
      json(movePath, { ...move, admission_state: "closed" });
      rows(chain);
      run(id, 0);
      symlinkSync(home, spec.repository.old_home);
      try {
        run(id, 1, "alias");
      } finally {
        unlinkSync(spec.repository.old_home);
      }
    });
  }
  test("S1-C03 alias-removed is not an accepted row kind", () => {
    json(movePath, { ...move, admission_state: "moved" });
    rows([
      ...chain,
      {
        schema,
        kind: "alias-removed",
        path: spec.repository.old_home,
        observed_at: at,
        evidence: { command: "unlink", output_path: custody },
      },
    ]);
    run("S1-C03", 1);
  });

  const oldRelease = join(root, "old-release"),
    preserved = join(release, "release");
  file(join(preserved, "app.dmg"), "preserved bytes\n");
  const fp = {
    path: join(oldRelease, "release"),
    target: join(oldRelease, "release"),
    disposition: "moved-and-preserved",
    ...manifestOf(preserved),
  };
  const moved = {
    schema,
    kind: "disposition",
    before: oldRelease,
    after: release,
    frozen_head: a,
    branch: "release/1.2.3",
    disposition: "moved",
    observed_at: at,
    evidence: { command: "git worktree move", output_path: custody },
  };
  const preservedMove = {
    ...move,
    worktrees: [...move.worktrees, { path: oldRelease, head: a, branch: "release/1.2.3" }],
    fingerprints: [fp],
  };
  test("S1-C06 preserved release follows its move annotation", () => {
    json(movePath, preservedMove);
    rows([moved]);
    run("S1-C06", 0);
  });
  test("S1-C06 moved release with changed bytes refuses", () => {
    json(movePath, preservedMove);
    rows([moved]);
    file(join(preserved, "app.dmg"), "changed bytes\n");
    try {
      run("S1-C06", 1, "fingerprint drift");
    } finally {
      file(join(preserved, "app.dmg"), "preserved bytes\n");
    }
  });
  test("S1-C06 unbound move annotation refuses", () => {
    json(movePath, preservedMove);
    rows([{ ...moved, frozen_head: b }]);
    run("S1-C06", 1);
  });

  const alias = join(root, "staging/Applications"),
    target = join(root, "applications");
  mkdirSync(target);
  file(join(target, "untouched.txt"), "do not follow\n");
  mkdirSync(dirname(alias));
  symlinkSync(target, alias);
  const aliasFp = {
    path: alias,
    target: alias,
    disposition: "moved-and-preserved",
    ...manifestOf(alias),
  };
  unlinkSync(alias);
  const archived = {
    source: alias,
    archive: "rpi:/mnt/storage/archives/staging/Applications",
    ...manifestOf(target),
    ...aliasFp,
    status: "ARCHIVED_AND_REMOVED",
    verify_result: "PASS",
    rsync_checksum_verified: true,
    remote_file_count: aliasFp.file_count,
    remote_symlink_count: aliasFp.symlink_count,
  };
  test("S1-C06 removed staging link with exact passing archive ledger is archived", () => {
    json(movePath, { ...move, fingerprints: [aliasFp] });
    rows([]);
    json(spec.repository.archive_ledger, {
      schema: "mac-disk-archive-ledger.v1",
      moves: [archived],
    });
    run("S1-C06", 0);
    assert.equal(readFileSync(join(target, "untouched.txt"), "utf8"), "do not follow\n");
  });
  test("S1-C06 staging link with failed archive proof refuses", () => {
    json(movePath, { ...move, fingerprints: [aliasFp] });
    rows([]);
    json(spec.repository.archive_ledger, {
      schema: "mac-disk-archive-ledger.v1",
      moves: [{ ...archived, verify_result: "FAIL" }],
    });
    run("S1-C06", 1);
  });
  test("S1-C06 retained dangling staging link is not archived", () => {
    symlinkSync(join(root, "absent-target"), alias);
    try {
      json(movePath, { ...move, fingerprints: [aliasFp] });
      rows([]);
      json(spec.repository.archive_ledger, {
        schema: "mac-disk-archive-ledger.v1",
        moves: [archived],
      });
      run("S1-C06", 1);
    } finally {
      unlinkSync(alias);
    }
  });

  test("every done_when has safe core-root install and server-relative checker folders", () => {
    for (const task of originalSpec.tasks) {
      const command = task.done_when.command;
      if (command.includes("pnpm -C /Users/Admin/core-root install")) {
        assert.ok(command.startsWith("cd /Users/Admin/core-root && "), task.id);
        assert.ok(
          !/node \.\/checks\//.test(command),
          task.id + " checker would run from core-root",
        );
      }
      if (/cd [^&]*apps\/server.*node \.\/checks\//.test(command))
        assert.match(command, /\(cd [^&]*apps\/server && [^)]*\) && node \.\/checks\//, task.id);
    }
  });
  for (const id of ["T1.04", "T1.09", "T2.03"])
    test(`${id} literal done_when executes each command in its intended folder`, () => {
      const d = join(root, id),
        repo = join(d, "repo"),
        core = join(d, "core"),
        design = join(repo, "docs/throughline/next-gen-spec"),
        log = join(d, "calls.jsonl");
      mkdirSync(join(repo, "apps/server"), { recursive: true });
      mkdirSync(core);
      mkdirSync(design, { recursive: true });
      const recordCall =
        '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.CALL_LOG, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),file:process.argv[1]})+"\\n");\n';
      const pnpm = join(d, "bin/pnpm");
      file(pnpm, recordCall);
      chmodSync(pnpm, 0o755);
      for (const checker of ["slice-1-repository-move.mts", "slice-2-seam.mts"])
        file(
          join(design, "checks", checker),
          'import fs from "node:fs"; fs.appendFileSync(process.env.CALL_LOG, JSON.stringify({cwd:process.cwd(),checker:import.meta.url})+"\\n");\n',
        );
      const command = originalSpec.tasks
        .find((t: any) => t.id === id)
        .done_when.command.replaceAll("/Users/Admin/throughline", repo)
        .replaceAll("/Users/Admin/core-root", core);
      const r = spawnSync("/bin/sh", ["-c", command], {
        cwd: design,
        encoding: "utf8",
        env: { ...process.env, CALL_LOG: log, PATH: dirname(pnpm) + ":" + process.env.PATH },
      });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((x) => JSON.parse(x));
      assert.equal(calls.filter((x) => x.checker).length, 1);
      if (id === "T1.09")
        assert.equal(calls.find((x) => x.args?.includes("test"))?.cwd, join(repo, "apps/server"));
      else assert.equal(calls.find((x) => x.args?.includes("install"))?.cwd, core);
    });

  let bad = 0;
  try {
    for (const [name, fn] of cases) {
      try {
        fn();
        console.log("OK   " + name);
      } catch (e) {
        bad++;
        console.log("BAD  " + name + ": " + (e as Error).message);
      }
    }
  } finally {
    const clean = (p: string) => {
      const s = lstatSync(p);
      if (s.isDirectory() && !s.isSymbolicLink()) {
        for (const n of readdirSync(p)) clean(join(p, n));
        rmdirSync(p);
      } else unlinkSync(p);
    };
    clean(root);
  }
  console.log(`\n${cases.length - bad} of ${cases.length} repository-move fixtures behaved`);
  process.exitCode = bad ? 1 : 0;
}

// Isolated archive-readers fixture suite; no operator state is written.
async function runArchiveReaderFixtures(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    writeFileSync,
    unlinkSync,
    rmdirSync,
    readdirSync,
    lstatSync,
    realpathSync,
  } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { createHash } = await import("node:crypto");
  const { spawnSync } = await import("node:child_process");
  const { manifestOf } = await import("./slice-1-contracts.mts");
  // Archive-reader regressions use disposable recorded evidence; no real archive or witness is edited.

  const HERE = dirname(fileURLToPath(import.meta.url));
  const root = realpathSync(mkdtempSync(join(tmpdir(), "archive-reader-fixtures-")));
  const template = JSON.parse(readFileSync(join(HERE, "../spec.json"), "utf8"));
  const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
  const file = (p: string, text: string) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  const json = (p: string, x: unknown) => file(p, JSON.stringify(x));
  const jsonl = (p: string, rows: unknown[]) =>
    file(p, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
  const head = "a".repeat(40),
    at = "2026-10-10T08:40:00.000Z";
  const cases: Array<[string, () => void]> = [];
  const test = (name: string, fn: () => void) => cases.push([name, fn]);
  let count = 0;
  const fixture = () => {
    const d = join(root, String(++count)),
      spec = structuredClone(template);
    mkdirSync(d);
    const R = spec.repository;
    Object.assign(R, {
      home: join(d, "home"),
      worktrees: join(d, "worktrees"),
      old_home: join(d, "old-home"),
      evidence_root: join(d, "evidence"),
      old_backup_root: join(d, "backup-old"),
      backup_root: join(d, "backup"),
      retired_folder: join(d, "retired"),
      move_record: join(d, "Move-Record.json"),
      archive_ledger: join(d, "Archive-Ledger.jsonl"),
    });
    const source = join(d, "container"),
      child = join(source, "payload.bin");
    file(child, "frozen archive payload\n");
    const fingerprint = manifestOf(source),
      childFingerprint = manifestOf(child);
    unlinkSync(child);
    rmdirSync(source);
    const fp = { path: source, ...fingerprint, disposition: "moved-and-preserved", target: source };
    const archive = "rpi:/mnt/storage/archives/disposable-container";
    const annotation = {
      schema: "throughline.archive-annotation.v1",
      path: source,
      fingerprint,
      disposition: "archived-and-removed",
      archive,
      record_container: source,
      is_container: true,
      verification: "PASS",
      archive_ledger_source: source,
    };
    const ledger = {
      source,
      archive,
      ...fingerprint,
      status: "ARCHIVED_AND_REMOVED",
      verify_result: "PASS",
      rsync_checksum_verified: true,
      remote_file_count: fingerprint.file_count,
      remote_symlink_count: fingerprint.symlink_count,
    };
    const rr = spec.tasks.find((t: any) => t.id === "T1.05").record_retention;
    Object.assign(rr, {
      address: join(d, "retained"),
      manifest: join(d, "Record-Manifest.jsonl"),
      excluded_dependency_trees: [
        "node_modules",
        "Pods",
        "SourcePackages",
        "checkouts",
        "Carthage",
      ],
    });
    const detached = {
      path: join(d, "old-detached"),
      branch: null,
      detached: true,
      head,
      clean: true,
      ignored_entries: [],
    };
    const m: any = {
      schema: "throughline.move-record.v1",
      admission_state: "frozen",
      head,
      origin_url: R.origin,
      origin_ahead: 0,
      started_at: at,
      repository_identity: { device: 1, inode: 2 },
      branches: [{ name: "main", sha: head }],
      tags: [],
      worktrees: [
        { path: R.old_home, branch: "main", head, clean: true, ignored_entries: [] },
        detached,
      ],
      worktree_mapping: [{ before: R.old_home, after: R.home, branch: "main", frozen_head: head }],
      fingerprints: [fp],
      installed_app: {
        payloads: [
          { path: "/Applications/ThroughLine.app/Contents/MacOS/ThroughLine" },
          { path: "/Applications/ThroughLine.app/Contents/Resources/app.asar" },
        ],
      },
      old_paths: {
        home: R.old_home,
        release_checkout: R.old_release_checkout,
        backup_root: R.old_backup_root,
        tower_remote_root: "/home/twr/build/workbench/infra/t3code/t3-{release}",
        rpi_remote_root: "/home/rpi/build/workbench/infra/t3code/t3-{release}",
        spec_folder: R.spec_home_until_then,
      },
      new_paths: {
        home: R.home,
        release_checkout: R.release_checkout,
        backup_root: R.backup_root,
        tower_remote_root: R.tower_build_root,
        rpi_remote_root: R.rpi_build_root,
        spec_folder: R.home + "/" + R.spec_home_in_repository,
      },
    };
    const output = join(d, "freeze-output.txt");
    file(output, "Disposable fixture inventory\n");
    const worktrees = [
      {
        schema: "throughline.worktree-move-annotation.v1",
        kind: "disposition",
        before: detached.path,
        frozen_head: head,
        branch: null,
        disposition: "kept",
        observed_at: at,
        evidence: { command: "fixture inventory", output_path: output },
      },
    ];
    const recordRows: any[] = [
      {
        schema: "throughline.retained-record.v1",
        kind: "container",
        container: source,
        archive,
        record_count: 0,
      },
    ];
    const annotations: any[] = [annotation],
      addendum: any[] = [],
      ledgerRows: any[] = [ledger];
    const run = (id: string, expected: number, reason?: string) => {
      const witness: any = Object.fromEntries(
        ["head", "origin_url", "branches", "tags", "worktrees", "fingerprints"].map((k) => [
          k,
          m[k],
        ]),
      );
      witness.commands = [
        {
          argv: ["fixture", "inventory"],
          exit_code: 0,
          output_path: output,
          output_sha256: sha(readFileSync(output)),
        },
      ];
      const witnessPath = join(d, "frozen.json");
      json(witnessPath, witness);
      m.frozen_inventory = { path: witnessPath, sha256: sha(readFileSync(witnessPath)) };
      json(R.move_record, m);
      json(join(d, "spec.json"), spec);
      jsonl(join(d, "Archive-Annotations.jsonl"), annotations);
      jsonl(join(d, "Archive-Fingerprint-Addendum.jsonl"), addendum);
      jsonl(join(d, "Worktree-Move-Annotations.jsonl"), worktrees);
      jsonl(rr.manifest, recordRows);
      json(R.archive_ledger, { schema: "mac-disk-archive-ledger.v1", moves: ledgerRows });
      const frozenBefore = readFileSync(witnessPath),
        recordBefore = readFileSync(R.move_record);
      const r = spawnSync(
        process.execPath,
        [join(HERE, "slice-1-repository-move.mts"), "--spec", join(d, "spec.json"), "--only", id],
        { encoding: "utf8" },
      );
      assert.equal(r.status, expected, r.stdout + r.stderr);
      if (reason) assert.ok(r.stdout.includes(reason), r.stdout);
      assert.deepEqual(readFileSync(witnessPath), frozenBefore);
      assert.deepEqual(readFileSync(R.move_record), recordBefore);
    };
    return {
      d,
      m,
      spec,
      source,
      child,
      childFingerprint,
      annotation,
      fingerprint,
      annotations,
      addendum,
      ledgerRows,
      recordRows,
      rr,
      worktrees,
      run,
    };
  };
  test("S1-C06 formerly-preserved container follows its verified archive annotation", () =>
    fixture().run("S1-C06", 0));
  test("S1-C06 an annotated covered child follows its frozen ancestor container", () => {
    const f = fixture();
    f.m.fingerprints.push({
      path: f.child,
      ...f.childFingerprint,
      disposition: "moved-and-preserved",
      target: f.child,
    });
    f.annotations.push({
      ...f.annotation,
      path: f.child,
      fingerprint: f.childFingerprint,
      is_container: false,
    });
    f.run("S1-C06", 0);
  });
  test("S1-C06 changed annotation fingerprint refuses", () => {
    const f = fixture();
    f.annotation.fingerprint = { ...f.fingerprint, bytes: 999 };
    f.run("S1-C06", 1, "fingerprint");
  });
  test("S1-C06 failed ledger verification refuses", () => {
    const f = fixture();
    f.ledgerRows[0].verify_result = "FAIL";
    f.run("S1-C06", 1, "archive ledger");
  });
  test("S1-C06 archived path still present refuses", () => {
    const f = fixture();
    file(f.child, "still here");
    f.run("S1-C06", 1, "still present");
  });
  test("S1-C06 container absent from the original freeze follows its addendum", () => {
    const f = fixture();
    f.m.fingerprints = [];
    f.addendum.push({
      schema: "throughline.archive-fingerprint-addendum.v1",
      path: f.source,
      fingerprint: f.fingerprint,
      observed_at: at,
      measurement: "fixture manifestOf before removal",
    });
    f.run("S1-C06", 0);
  });
  test("S1-C06 unbound new container without addendum refuses", () => {
    const f = fixture();
    f.m.fingerprints = [];
    f.run("S1-C06", 1, "addendum");
  });
  test("S1-C06 new container with a mismatched pre-copy freeze refuses", () => {
    const f = fixture();
    f.m.fingerprints = [];
    f.addendum.push({
      schema: "throughline.archive-fingerprint-addendum.v1",
      path: f.source,
      fingerprint: { ...f.fingerprint, bytes: 999 },
      observed_at: at,
      measurement: "fixture",
    });
    f.run("S1-C06", 1, "pre-copy freeze");
  });
  const thirdParty = () => {
    const f = fixture(),
      p = join(f.rr.address, "vendor-README.md");
    f.recordRows[0].record_count = 1;
    f.recordRows.push({
      schema: "throughline.retained-record.v1",
      kind: "record",
      container: f.source,
      original_path: join(f.source, "node_modules/pkg/README.md"),
      new_path: p,
      sha256: sha("withdrawn copy"),
      bytes: 14,
    });
    f.recordRows.push({
      schema: "throughline.retained-record.v1",
      kind: "dropped",
      new_path: p,
      reason: "Third-party payload remains in its verified whole-container archive.",
    });
    return { ...f, p };
  };
  test("S1-C06 dropped third-party copy remains counted historically but need not exist", () =>
    thirdParty().run("S1-C06", 0));
  test("S1-C06 third-party record without a dropped row refuses", () => {
    const f = thirdParty();
    f.recordRows.pop();
    f.run("S1-C06", 1, "third-party dependency");
  });
  test("S1-C06 dropped row without a reason refuses", () => {
    const f = thirdParty();
    f.recordRows[2].reason = "";
    f.run("S1-C06", 1, "without a one-line reason");
  });
  test("S1-C06 dropped copy still on disk refuses", () => {
    const f = thirdParty();
    file(f.p, "withdrawn copy");
    f.run("S1-C06", 1, "dropped record still present");
  });
  test("S1-C06 own-run records cannot be exempted as third-party payload", () => {
    const f = thirdParty();
    f.recordRows[1].original_path = join(f.source, "own-run.json");
    f.run("S1-C06", 1, "record missing or changed");
  });
  test("S1-C09 detached frozen worktree binds through its disposition", () =>
    fixture().run("S1-C09", 0));
  test("S1-C09 missing frozen-worktree disposition refuses", () => {
    const f = fixture();
    f.worktrees.length = 0;
    f.run("S1-C09", 1, "unbound/unclean");
  });
  test("S1-C09 disposition for another frozen head refuses", () => {
    const f = fixture();
    f.worktrees[0].frozen_head = "b".repeat(40);
    f.run("S1-C09", 1, "unbound/unclean");
  });
  test("S1-C09 duplicate archive annotation refuses", () => {
    const f = fixture();
    f.annotations.push({ ...f.annotation });
    f.run("S1-C09", 1, "two annotation rows");
  });
  test("S1-C09 covered child without its ancestor container refuses", () => {
    const f = fixture();
    f.annotation.is_container = false;
    f.run("S1-C09", 1, "ancestor container");
  });
  test("S1-C09 addendum cannot replace an original frozen entry", () => {
    const f = fixture();
    f.addendum.push({
      schema: "throughline.archive-fingerprint-addendum.v1",
      path: f.source,
      fingerprint: f.fingerprint,
      observed_at: at,
      measurement: "fixture",
    });
    f.run("S1-C09", 1, "already in the frozen witness");
  });

  const annotatedPreserved = () => {
    const f = fixture(),
      target = join(f.spec.repository.worktrees, "preserved");
    const worktreeRows = f.worktrees as Array<Record<string, any>>;
    f.annotation.disposition = "moved-and-preserved";
    f.ledgerRows.length = 0;
    f.recordRows.length = 0;
    f.m.worktrees.push({
      path: f.source,
      branch: "preserved",
      head,
      clean: true,
      ignored_entries: [],
    });
    worktreeRows.push({
      schema: "throughline.worktree-move-annotation.v1",
      kind: "disposition",
      before: f.source,
      after: target,
      frozen_head: head,
      branch: "preserved",
      fingerprint: { ...f.fingerprint },
      disposition: "moved",
      observed_at: at,
      evidence: { command: "fixture worktree move", output_path: join(f.d, "freeze-output.txt") },
    });
    file(join(target, "payload.bin"), "frozen archive payload\n");
    return { ...f, worktrees: worktreeRows, target };
  };
  test("S1-C06 annotated preserved target follows its move and proves actual bytes", () => {
    annotatedPreserved().run("S1-C06", 0);
  });
  test("S1-C06 annotated preserved missing target refuses", () => {
    const f = annotatedPreserved();
    unlinkSync(join(f.target, "payload.bin"));
    rmdirSync(f.target);
    f.run("S1-C06", 1, "preserved target missing");
  });
  test("S1-C06 annotated preserved changed bytes refuse", () => {
    const f = annotatedPreserved();
    file(join(f.target, "payload.bin"), "changed bytes\n");
    f.run("S1-C06", 1, "fingerprint drift");
  });
  test("S1-C06 annotated preserved target outside the worktree collection refuses", () => {
    const f = annotatedPreserved(),
      outside = join(f.d, "outside-collection");
    file(join(outside, "payload.bin"), "frozen archive payload\n");
    f.worktrees.at(-1)!.after = outside;
    f.run("S1-C06", 1, "preserved target missing");
  });
  for (const key of ["sha256", "file_count", "symlink_count", "entry_count", "bytes"] as const)
    test(`S1-C06 annotated preserved proof checks the actual ${key}`, () => {
      const f = annotatedPreserved();
      const wrong = key === "sha256" ? "b".repeat(64) : f.fingerprint[key] + 1;
      f.m.fingerprints[0][key] = wrong;
      f.annotation.fingerprint = { ...f.fingerprint, [key]: wrong };
      f.worktrees.at(-1)!.fingerprint = { ...f.fingerprint, [key]: wrong };
      f.run("S1-C06", 1, "fingerprint drift");
    });

  let bad = 0;
  try {
    for (const [name, fn] of cases) {
      try {
        fn();
        console.log("OK   " + name);
      } catch (e) {
        bad++;
        console.log("BAD  " + name + ": " + (e as Error).message);
      }
    }
  } finally {
    const clean = (p: string) => {
      const st = lstatSync(p);
      if (st.isDirectory() && !st.isSymbolicLink()) {
        for (const n of readdirSync(p)) clean(join(p, n));
        rmdirSync(p);
      } else unlinkSync(p);
    };
    clean(root);
  }
  console.log(`\n${cases.length - bad} of ${cases.length} archive-reader fixtures behaved`);
  process.exitCode = bad ? 1 : 0;
}

// Isolated deferred-rpi fixture suite; no operator state is written.
async function runDeferredRpiFixtures(): Promise<void> {
  const { default: assert } = await import("node:assert/strict");
  const {
    chmodSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmdirSync,
    unlinkSync,
    writeFileSync,
  } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { createHash } = await import("node:crypto");
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { expectedStep } = await import("./slice-1-contracts.mts");
  // Reader fixtures only. All state, package metadata, receipts and Git repositories are disposable.
  // The owning tool's validator is a fixture stand-in; its already-passing suite is not duplicated here.

  const HERE = dirname(fileURLToPath(import.meta.url));
  const root = realpathSync(mkdtempSync(join(tmpdir(), "deferred-rpi-reader-")));
  const original = JSON.parse(readFileSync(join(HERE, "../spec.json"), "utf8"));
  const RPI_STEPS = [
    "build-rpi",
    "gate-rpi",
    "stage-rpi-headless",
    "install-rpi-headless",
    "rpi-cold-turn",
  ];
  const file = (p: string, text: string) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  const json = (p: string, value: unknown) => file(p, JSON.stringify(value));
  const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("/usr/bin/git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  let sequence = 0;
  const fixture = () => {
    const d = join(root, String(++sequence)),
      spec = structuredClone(original),
      R = spec.repository;
    mkdirSync(d);
    Object.assign(R, {
      home: join(d, "home"),
      worktrees: join(d, "worktrees"),
      monorepo: join(d, "monorepo"),
      vault: join(d, "vault"),
      old_home: join(d, "old-home"),
      old_release_checkout: join(d, "old-release"),
      evidence_root: join(d, "records"),
      backup_root: join(d, "backups"),
      retired_folder: join(d, "retired"),
      move_record: join(d, "move.json"),
      pipeline_definition: join(d, "pipeline.json"),
      next_release: "0.0.60",
      vault_copy: { ...R.vault_copy, destination: join(d, "vault-copy") },
    });
    const installed = join(R.monorepo, "src/tools/throughline-ship"),
      core = join(installed, "dist/core.js");
    json(join(installed, "package.json"), { type: "module", version: "0.4.6" });
    file(
      core,
      "export function validatePipeline() { /* fixture stand-in: reader branch only */ }\n",
    );
    const deferred = {
      ruling: {
        words:
          "Raspberry Pi paused, from Ryan: install nothing on the Raspberry Pi in this release.",
        date: "2026-10-09",
      },
      contract: { remote_root: R.rpi_build_root },
      counted_as_passed: false,
      steps: RPI_STEPS.map((id) => ({ id })),
    };
    const p: any = {
      checkout: R.home,
      source: {
        worktrees_root: R.worktrees,
        release_checkout: R.worktrees + "/{release}",
        upstream_mode_by_release: { "0.0.60": "preserve-base" },
      },
      backup_root: R.backup_root,
      move_record: R.move_record,
      evidence_root: R.evidence_root,
      forbidden_roots: [R.vault],
      vault_copy: R.vault_copy,
      tower: { remote_root: R.tower_build_root },
      deferred: { rpi: deferred },
      steps: [
        expectedStep("vault-clean", installed),
        expectedStep("publish-docs", installed),
        { id: "upstream-sync", requires: ["vault-clean"] },
        { id: "restart-courtesy", requires: ["publish-docs"] },
        {
          id: "capture-phone",
          command: ["node", R.retired_folder + "/src/ios-simulator-gate/run-gate.mts"],
        },
        {
          id: "testflight-readback",
          command: ["node", R.retired_folder + "/src/apple-signing/asc-testflight.mts"],
        },
      ],
      required_steps: [
        "preflight",
        "vault-clean",
        "install-tower",
        "install-phone",
        "install-mac",
        "publish-docs",
      ],
    };
    const output = join(d, "fixture-measurement.txt"),
      proof = join(d, "fixture-rehearsal.json");
    file(output, "Disposable fixture rehearsal record\n");
    const defaults = join(d, "bin/defaults");
    file(defaults, '#!/usr/bin/env node\nconsole.log("0.0.60");\n');
    chmodSync(defaults, 0o755);
    const run = (id: string, expected: number, reason?: string) => {
      json(R.pipeline_definition, p);
      json(proof, {
        pipeline_sha256: sha(R.pipeline_definition),
        core_sha256: sha(core),
        commands: [
          { exit_code: 0, measured_cases: 1, output_path: output, output_sha256: sha(output) },
        ],
        executed_steps: ["vault-clean", "publish-docs"],
      });
      json(R.move_record, { pipeline_rehearsal: { path: proof, sha256: sha(proof) } });
      json(join(d, "spec.json"), spec);
      const r = spawnSync(
        process.execPath,
        [join(HERE, "slice-1-repository-move.mts"), "--spec", join(d, "spec.json"), "--only", id],
        {
          encoding: "utf8",
          env: { ...process.env, PATH: join(d, "bin") + ":" + process.env.PATH },
        },
      );
      assert.equal(r.status, expected, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp(`^${expected === 0 ? "PASS" : "FAIL"}  ${id} `, "m"));
      if (reason) assert.ok(r.stdout.includes(reason), r.stdout);
    };
    const release = (includeRpiReceipt = false) => {
      mkdirSync(R.home);
      mkdirSync(R.worktrees);
      git(R.home, "init", "-q", "-b", "main");
      git(R.home, "config", "user.name", "Release reader fixture");
      git(R.home, "config", "user.email", "fixture@example.invalid");
      const sources = [
        "apps/server/src/vcs/GitVcsDriverCore.ts",
        R.spec_home_in_repository + "/spec.json",
      ];
      for (const source of sources) file(join(R.home, source), "fixture source\n");
      git(R.home, "add", "--", ...sources);
      git(R.home, "commit", "-qm", "disposable release fixture");
      const commit = git(R.home, "rev-parse", "HEAD"),
        wt = join(R.worktrees, "0.0.60"),
        runId = "fixture-release",
        runDir = join(R.evidence_root, "release-0-0-60");
      git(R.home, "worktree", "add", "-qb", "release/0.0.60", wt);
      json(join(runDir, "source-commit.json"), { commit, run_id: runId });
      const artifact = join(wt, "release/fixture.dmg"),
        readback = join(runDir, "readback.json");
      file(artifact, "fixture installer bytes\n");
      json(readback, { fixture: true });
      json(join(runDir, "Release-Closure.json"), {
        release: "0.0.60",
        source_commit: commit,
        run_id: runId,
        outcome: "passed",
        artifacts: [{ path: artifact, sha256: sha(artifact) }],
        installed_readbacks: [
          {
            release: "0.0.60",
            source_commit: commit,
            payload_sha256: sha(artifact),
            receipt_path: readback,
            receipt_sha256: sha(readback),
          },
        ],
        shipped_source_hashes: Object.fromEntries(
          sources.map((source) => [source, sha(join(R.home, source))]),
        ),
      });
      const steps = [
        "vault-clean",
        "install-tower",
        "install-tower-headless",
        "install-phone",
        "install-mac",
        "publish-docs",
        "rewind-live-proof",
        ...(includeRpiReceipt ? ["install-rpi-headless"] : []),
      ];
      for (const step of steps)
        json(join(runDir, step + ".attempt-1.json"), {
          row: { outcome: "passed" },
          source_commit: commit,
          release: "0.0.60",
          run_id: runId,
        });
      json(join(R.vault_copy.destination, "repository.json"), { commit, release: "0.0.60" });
    };
    return { spec, p, deferred, run, release };
  };
  const cases: Array<[string, () => void]> = [];
  const test = (name: string, fn: () => void) => cases.push([name, fn]);
  test("S1-C05 explicit deferral with five retained templates is accepted without active hardware", () =>
    fixture().run("S1-C05", 0));
  test("S1-C05 existing active Raspberry Pi contract remains accepted at its declared root", () => {
    const f = fixture();
    f.p.rpi = { remote_root: f.spec.repository.rpi_build_root };
    delete f.p.deferred;
    f.run("S1-C05", 0);
  });
  test("S1-C05 active contract at the wrong root refuses", () => {
    const f = fixture();
    f.p.rpi = { remote_root: "/wrong" };
    f.run("S1-C05", 1, "field mismatch: rpi");
  });
  for (const [name, mutate] of [
    [
      "missing deferral",
      (f: any) => {
        delete f.p.deferred;
      },
    ],
    [
      "missing ruling",
      (f: any) => {
        delete f.deferred.ruling;
      },
    ],
    [
      "wrong ruling date",
      (f: any) => {
        f.deferred.ruling.date = "2026-10-08";
      },
    ],
    [
      "missing retained contract",
      (f: any) => {
        delete f.deferred.contract;
      },
    ],
    [
      "deferral counted as passed",
      (f: any) => {
        f.deferred.counted_as_passed = true;
      },
    ],
  ] as const)
    test(`S1-C05 ${name} refuses`, () => {
      const f = fixture();
      mutate(f);
      f.run("S1-C05", 1, "deferred.rpi record");
    });
  test("S1-C05 incomplete template set refuses", () => {
    const f = fixture();
    f.deferred.steps.pop();
    f.run("S1-C05", 1, "five Raspberry Pi step templates");
  });
  test("S1-C05 duplicated template cannot replace a missing template", () => {
    const f = fixture();
    f.deferred.steps[0] = f.deferred.steps[1];
    f.run("S1-C05", 1, "five Raspberry Pi step templates");
  });
  for (const step of RPI_STEPS) {
    test(`S1-C05 deferred ${step} still active refuses`, () => {
      const f = fixture();
      f.p.steps.push({ id: step });
      f.run("S1-C05", 1, "still active");
    });
    test(`S1-C05 deferred ${step} still required refuses`, () => {
      const f = fixture();
      f.p.required_steps.push(step);
      f.run("S1-C05", 1, "still active");
    });
  }
  test("S1-C05 missing admitted install target refuses", () => {
    const f = fixture();
    f.p.required_steps = f.p.required_steps.filter((id: string) => id !== "install-phone");
    f.run("S1-C05", 1, "install order");
  });
  test("S1-C05 incorrect tower/iPhone/Mac order refuses", () => {
    const f = fixture();
    [f.p.required_steps[2], f.p.required_steps[3]] = [f.p.required_steps[3], f.p.required_steps[2]];
    f.run("S1-C05", 1, "install order");
  });
  test("S1-C13 paused hardware needs no fabricated Raspberry Pi installation receipt", () => {
    const f = fixture();
    f.release();
    f.run("S1-C13", 0);
  });
  test("S1-C13 active hardware still needs its actual installation receipt", () => {
    const f = fixture();
    f.p.rpi = { remote_root: f.spec.repository.rpi_build_root };
    delete f.p.deferred;
    f.release();
    f.run("S1-C13", 1, "install-rpi-headless");
  });
  test("S1-C13 active hardware with its receipt still passes", () => {
    const f = fixture();
    f.p.rpi = { remote_root: f.spec.repository.rpi_build_root };
    delete f.p.deferred;
    f.release(true);
    f.run("S1-C13", 0);
  });
  test("S1-C13 invalid deferral cannot waive required proof", () => {
    const f = fixture();
    f.deferred.counted_as_passed = true;
    f.release();
    f.run("S1-C13", 1, "deferred.rpi record");
  });

  let bad = 0;
  try {
    for (const [name, fn] of cases) {
      try {
        fn();
        console.log("OK   " + name);
      } catch (e) {
        bad++;
        console.log("BAD  " + name + ": " + (e as Error).message);
      }
    }
  } finally {
    const clean = (p: string) => {
      const st = lstatSync(p);
      if (st.isDirectory() && !st.isSymbolicLink()) {
        for (const n of readdirSync(p)) clean(join(p, n));
        rmdirSync(p);
      } else unlinkSync(p);
    };
    clean(root);
  }
  console.log(`\n${cases.length - bad} of ${cases.length} deferred-Raspberry-Pi fixtures behaved`);
  process.exitCode = bad ? 1 : 0;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const fixtureFlag = process.argv.indexOf("--fixtures");
  if (fixtureFlag >= 0) {
    const suites: Record<string, () => Promise<void>> = {
      "repository-move": runRepositoryMoveFixtures,
      "archive-readers": runArchiveReaderFixtures,
      "deferred-rpi": runDeferredRpiFixtures,
    };
    const suite = suites[process.argv[fixtureFlag + 1]];
    if (!suite) {
      console.error("Unknown fixture suite");
      process.exitCode = 2;
    } else await suite();
  } else {
    const result = await runSliceChecks();
    process.exit(result.exit);
  }
}

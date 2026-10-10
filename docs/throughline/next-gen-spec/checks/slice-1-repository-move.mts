// Slice 1 checks on this Mac's real disk: the repository move, builds outside the vault, one pipeline from the new home.
// Written before any build (ledger item NG-138) and revised after judge round 1 (Oct 7, 2026): every check compares against the
// move record or the live thing, fails closed when a command fails, and never accepts an empty listing as proof.
// Run: node slice-1-repository-move.mts [--only S1-C01 S1-C03 …]      exit 1 on any FAIL
import { existsSync, readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve, basename, sep } from "node:path";
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
    for (const w of list) {
      if (w.prunable || w.detached || !existsSync(w.path)) {
        f.push(`invalid worktree: ${w.path}`);
        continue;
      }
      const mapping = (m.worktree_mapping ?? []).find(
        (x: any) => canonical(x.after) === canonical(w.path),
      );
      if (!mapping) {
        f.push(`unbound worktree mapping: ${w.path}`);
        continue;
      }
      try {
        const actualCommon = git(w.path, "rev-parse", "--git-common-dir");
        if (
          canonical(actualCommon.startsWith("/") ? actualCommon : join(w.path, actualCommon)) !==
            common ||
          git(w.path, "branch", "--show-current") !== mapping.branch ||
          !ancestor(w.path, mapping.frozen_head, "HEAD") ||
          git(w.path, "rev-parse", "HEAD") !== w.head
        )
          f.push(`worktree repository/branch/head mismatch: ${w.path}`);
      } catch {
        f.push(`broken worktree Git pointer: ${w.path}`);
      }
      if (canonical(w.path) !== canonical(HOME) && !under(w.path, WORKTREES))
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
      ["rpi", p.rpi?.remote_root, R.rpi_build_root],
    ] as const)
      if (!same(got, want)) f.push(`exact pipeline field mismatch: ${field}`);
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
    for (const x of found) f.push(`${x.reason}: ${x.path}`);
    const m = moveRecord(),
      rows = ledgerRows(),
      archived = new Set<string>();
    // T1.05 record_retention (spec 0.4.7): records of each archived container are retained at a local record address with a manifest
    const rr = (spec.tasks.find((t: any) => t.id === "T1.05") ?? {}).record_retention;
    if (!rr?.address || !rr?.manifest)
      f.push("T1.05 record_retention address or manifest undeclared");
    for (const fp of m.fingerprints ?? [])
      if (fp.disposition === "archived-and-removed") {
        archived.add(fp.path);
        if (
          existsSync(fp.path) ||
          !archiveMatches(
            rows.find((r) => r.source === fp.path && r.archive === fp.archive),
            fp,
          )
        )
          f.push(`removed tree lacks exact verified archive identity: ${fp.path}`);
      } else if (fp.disposition === "moved-and-preserved") {
        if (!fp.target || !existsSync(fp.target) || !under(fp.target, WORKTREES))
          f.push(`preserved target missing: ${fp.path}`);
        else {
          const got = manifestOf(fp.target);
          if (
            !["sha256", "file_count", "symlink_count", "entry_count", "bytes"].every(
              (k) => got[k as keyof typeof got] === fp[k],
            )
          )
            f.push(`preserved tree fingerprint drift: ${fp.target}`);
        }
      } else f.push(`fingerprint disposition missing: ${fp.path}`);
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
        if (x.kind !== "record") {
          f.push(`record manifest row of unknown kind: ${x.kind}`);
          continue;
        }
        counted.set(x.container, (counted.get(x.container) ?? 0) + 1);
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
    for (const w of m.worktrees ?? [])
      if (
        !w.path ||
        !w.branch ||
        !SHA40.test(w.head) ||
        w.clean !== true ||
        !Array.isArray(w.ignored_entries) ||
        !m.worktree_mapping?.some(
          (x: any) => x.before === w.path && x.branch === w.branch && x.frozen_head === w.head,
        )
      )
        f.push("unbound/unclean frozen worktree");
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
      "install-rpi-headless",
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
    if (!existsSync(join(HOME, ".git")) || existsSync(OLD_HOME))
      f.push("old/new repository move incomplete");
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
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const result = await runSliceChecks();
  process.exit(result.exit);
}

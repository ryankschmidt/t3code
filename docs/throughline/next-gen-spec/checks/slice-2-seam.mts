// Slice 2 checks: the code seam between upstream T3 Code and the ThroughLine fork, read from the real repository.
// Proposed by worker-specprep-5656ab0a on Oct 9, 2026 for the delivery lead to place at <spec>/checks/slice-2-seam.mts.
// The repository root is never ambient: --repo <absolute path> is required and validated (top level, origin, upstream,
// descends from the design start commit). Run: node slice-2-seam.mts --repo <abs> [--spec <spec.json>] [--only S2-C01 …]
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export type CheckDef = {
  id: string;
  title: string;
  kind: "real-disk" | "unit" | "structural" | "guard";
  expected_today: "FAIL" | "PASS";
};
export const CHECK_DEFS: CheckDef[] = [
  {
    id: "S2-C01",
    kind: "real-disk",
    expected_today: "FAIL",
    title:
      "the seam manifest throughline-seam.json sits at the repository root with schema throughline.seam-manifest.v1, its upstream, fork and merge-base SHAs are real commits, the merge base is the true merge base of the two, and the fork SHA is HEAD or an ancestor of it",
  },
  {
    id: "S2-C02",
    kind: "real-disk",
    expected_today: "FAIL",
    title:
      "the manifest entries equal the real diff between the merge base and the fork SHA, each with the right class (upstream-edit, upstream-removed, fork-added, fork-namespace), and every upstream edit or removal carries a reason with its source and its imported-private-symbol and schema-assumption lists",
  },
  {
    id: "S2-C03",
    kind: "real-disk",
    expected_today: "FAIL",
    title:
      "the counts only fall: the manifest counts equal the computed classes, neither the upstream-edit count nor the fork-added-outside-namespace count exceeds its admitted value, and no admitted value rose since the previous committed manifest",
  },
  {
    id: "S2-C04",
    kind: "real-disk",
    expected_today: "FAIL",
    title:
      "every path changed both upstream and in the fork has one adopt, retain, replace or defer row with a reason, and no conflict rule takes upstream for a path listed in a capability manifest",
  },
  {
    id: "S2-C05",
    kind: "real-disk",
    expected_today: "FAIL",
    title:
      "the fork namespace is classified and the mount rule is recorded: namespace paths are fork-namespace, every fork-added entry carries planned or kept relocation, every upstream edit carries its mount line count, and the mount-line checker exists",
  },
  {
    id: "S2-C06",
    kind: "real-disk",
    expected_today: "FAIL",
    title:
      "capability manifests live in the repository under docs/throughline/capabilities, each valid, every listed path present, every pinned case present verbatim in its test file, and a manifest touching apps/mobile pins at least one apps/mobile case",
  },
  {
    id: "S2-C07",
    kind: "real-disk",
    expected_today: "FAIL",
    title:
      "the ship lane enforces the seam: the pipeline seam file is the checkout's throughline-seam.json, a seam-check step runs check-seam.ts with --repo after upstream-sync and before the first signed build, and every repository capability has a regression step before the first signed build",
  },
  {
    id: "S2-C08",
    kind: "real-disk",
    expected_today: "FAIL",
    title:
      "the seam decision tree and view exist: seam-side.ts and seam-view.ts are present and docs/throughline/seam-view.html carries the sha256 of the current manifest",
  },
  {
    id: "S2-C09",
    kind: "real-disk",
    expected_today: "FAIL",
    title:
      "the installed release carries the seam: the vault copy of the installed release names a commit whose tree holds throughline-seam.json and the rewind capability manifest",
  },
  {
    id: "S2-G01",
    kind: "guard",
    expected_today: "PASS",
    title:
      "guard: every pinned rewind regression case still appears verbatim in its test file, read from the repository copy of the manifest when it exists and from the vault copy otherwise",
  },
];

type Fail = string;
const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SHA40 = /^[0-9a-f]{40}$/;
const NAMESPACE = [/^packages\/throughline-[^/]+\//, /^apps\/[^/]+\/src\/throughline\//];
const CAP_DIR = "docs/throughline/capabilities";

function bindRepository(repoArg: string | undefined, spec: any): { repo: string; head: string } {
  if (!repoArg || !repoArg.startsWith("/"))
    throw new Error("--repo <absolute path> is required; no working-directory fallback");
  const real = realpathSync.native(repoArg);
  const git = (...a: string[]) =>
    execFileSync("git", ["-C", real, ...a], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (realpathSync.native(git("rev-parse", "--show-toplevel")) !== real)
    throw new Error(`${real} is not a repository top level`);
  if (git("remote", "get-url", "origin") !== spec.repository.origin)
    throw new Error(`origin of ${real} is not ${spec.repository.origin}`);
  if (git("remote", "get-url", "upstream") !== spec.repository.upstream)
    throw new Error(`upstream remote of ${real} is not ${spec.repository.upstream}`);
  try {
    git("merge-base", "--is-ancestor", spec.design_start_commit, "HEAD");
  } catch {
    throw new Error(`HEAD of ${real} does not descend from ${spec.design_start_commit}`);
  }
  return { repo: real, head: git("rev-parse", "HEAD") };
}

export type SeamClass = "upstream-edit" | "upstream-removed" | "fork-added" | "fork-namespace";
export function classify(
  repo: string,
  mergeBase: string,
  forkSha: string,
): Map<string, { cls: SeamClass; renamed_from?: string }> {
  const out = new Map<string, { cls: SeamClass; renamed_from?: string }>();
  const raw = execFileSync("git", ["-C", repo, "diff", "--name-status", "-M", mergeBase, forkSha], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  for (const line of raw.split("\n").filter(Boolean)) {
    const [status, a, b] = line.split("\t");
    if (status.startsWith("R")) out.set(b, { cls: "upstream-edit", renamed_from: a });
    else if (status === "M" || status.startsWith("T")) out.set(a, { cls: "upstream-edit" });
    else if (status === "D") out.set(a, { cls: "upstream-removed" });
    else if (status === "A")
      out.set(a, { cls: NAMESPACE.some((re) => re.test(a)) ? "fork-namespace" : "fork-added" });
    else throw new Error(`unhandled diff status ${status} for ${a}`);
  }
  return out;
}

function main(): void {
  const specPath = arg("--spec") ?? join(HERE, "..", "spec.json");
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const { repo, head } = bindRepository(arg("--repo"), spec);
  console.log(`bound repository ${repo} at ${head}`);
  const only = (() => {
    const i = process.argv.indexOf("--only");
    return i >= 0 ? new Set(process.argv.slice(i + 1).filter((x) => /^S2-/.test(x))) : null;
  })();
  const git = (...a: string[]) =>
    execFileSync("git", ["-C", repo, ...a], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  const isCommit = (s: unknown) => {
    if (typeof s !== "string" || !SHA40.test(s)) return false;
    try {
      git("cat-file", "-e", `${s}^{commit}`);
      return true;
    } catch {
      return false;
    }
  };
  const manifestPath = join(repo, "throughline-seam.json");
  const manifest = (): any => {
    if (!existsSync(manifestPath)) throw new Error(`no manifest at ${manifestPath}`);
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  };
  // The conflict rule must bind before the manifests move into the repository, so S2-C04 falls back to the vault copies.
  const capabilities = (fallbackToVault = false): Array<{ name: string; file: string; m: any }> => {
    const inRepo = join(repo, CAP_DIR);
    const dir =
      existsSync(inRepo) || !fallbackToVault
        ? inRepo
        : join(spec.repository.component_folder, "capabilities");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((n) => existsSync(join(dir, n, "Capability.json")))
      .map((n) => ({
        name: n,
        file: join(dir, n, "Capability.json"),
        m: JSON.parse(readFileSync(join(dir, n, "Capability.json"), "utf8")),
      }));
  };
  const results: Array<{ id: string; title: string; fails: Fail[] }> = [];
  const check = (id: string, fn: () => Fail[]) => {
    if (only && !only.has(id)) return;
    const def = CHECK_DEFS.find((d) => d.id === id)!;
    let fails: Fail[];
    try {
      fails = fn();
    } catch (e) {
      fails = [`threw: ${(e as Error).message}`];
    }
    results.push({ id, title: def.title, fails });
  };

  check("S2-C01", () => {
    const m = manifest();
    const f: Fail[] = [];
    if (m.schema !== "throughline.seam-manifest.v1") f.push(`schema ${m.schema}`);
    for (const [k, v] of [
      ["upstream.sha", m.upstream?.sha],
      ["fork.sha", m.fork?.sha],
      ["merge_base", m.merge_base],
    ] as const)
      if (!isCommit(v)) f.push(`${k} is not a commit in the repository`);
    if (f.length) return f;
    if (git("merge-base", m.fork.sha, m.upstream.sha) !== m.merge_base)
      f.push("merge_base is not the merge base of the fork and upstream SHAs");
    try {
      git("merge-base", "--is-ancestor", m.fork.sha, "HEAD");
    } catch {
      f.push("fork.sha is not HEAD or an ancestor of HEAD");
    }
    if (m.upstream?.remote_url !== spec.repository.upstream)
      f.push("upstream.remote_url differs from the spec");
    return f;
  });
  check("S2-C02", () => {
    const m = manifest();
    const f: Fail[] = [];
    const want = classify(repo, m.merge_base, m.fork.sha);
    const have = new Map<string, any>((m.entries ?? []).map((e: any) => [e.path, e]));
    for (const [p, w] of want) {
      const e = have.get(p);
      if (!e) f.push(`missing entry ${p} (${w.cls})`);
      else if (e.class !== w.cls) f.push(`${p}: class ${e.class}, real ${w.cls}`);
    }
    for (const p of have.keys()) if (!want.has(p)) f.push(`entry ${p} is not in the real diff`);
    for (const e of m.entries ?? [])
      if (e.class === "upstream-edit" || e.class === "upstream-removed") {
        if (!e.reason || String(e.reason).trim() === "") f.push(`${e.path}: empty reason`);
        if (!["authored", "commit-subjects"].includes(e.reason_source))
          f.push(`${e.path}: reason_source ${e.reason_source}`);
        if (!Array.isArray(e.imported_private_symbols) || !Array.isArray(e.schema_assumptions))
          f.push(`${e.path}: symbol or schema list missing`);
      }
    return f;
  });
  check("S2-C03", () => {
    const m = manifest();
    const f: Fail[] = [];
    const computed: Record<string, number> = {
      "upstream-edit": 0,
      "upstream-removed": 0,
      "fork-added": 0,
      "fork-namespace": 0,
    };
    for (const v of classify(repo, m.merge_base, m.fork.sha).values()) computed[v.cls]++;
    const c = m.counts ?? {};
    if (
      c.upstream_edit !== computed["upstream-edit"] ||
      c.upstream_removed !== computed["upstream-removed"] ||
      c.fork_added !== computed["fork-added"] ||
      c.fork_namespace !== computed["fork-namespace"]
    )
      f.push(`counts ${JSON.stringify(c)} differ from computed ${JSON.stringify(computed)}`);
    const a = m.admitted ?? {};
    if (!Number.isInteger(a.upstream_edit_count) || !Number.isInteger(a.fork_added_count))
      return [...f, "admitted counts missing"];
    if (computed["upstream-edit"] + computed["upstream-removed"] > a.upstream_edit_count)
      f.push(
        `upstream edits ${computed["upstream-edit"] + computed["upstream-removed"]} exceed admitted ${a.upstream_edit_count}`,
      );
    if (computed["fork-added"] > a.fork_added_count)
      f.push(`fork-added files ${computed["fork-added"]} exceed admitted ${a.fork_added_count}`);
    const prev = git("log", "-2", "--format=%H", "--", "throughline-seam.json")
      .split("\n")
      .filter(Boolean)[1];
    if (prev) {
      const p = JSON.parse(git("show", `${prev}:throughline-seam.json`));
      if (
        a.upstream_edit_count > p.admitted?.upstream_edit_count ||
        a.fork_added_count > p.admitted?.fork_added_count
      )
        f.push(`an admitted count rose against ${prev.slice(0, 10)}`);
    }
    return f;
  });
  check("S2-C04", () => {
    const m = manifest();
    const f: Fail[] = [];
    const forkPaths = new Set<string>();
    for (const e of m.entries ?? []) {
      forkPaths.add(e.path);
      if (e.renamed_from) forkPaths.add(e.renamed_from);
    }
    const upstreamChanged = git("diff", "--name-only", m.merge_base, m.upstream.sha)
      .split("\n")
      .filter(Boolean);
    const rows = new Map<string, any>((m.upstream_changes ?? []).map((r: any) => [r.path, r]));
    for (const p of upstreamChanged)
      if (forkPaths.has(p)) {
        const r = rows.get(p);
        if (!r) f.push(`no upstream_changes row for colliding path ${p}`);
        else if (!["adopt", "retain", "replace", "defer"].includes(r.decision) || !r.reason)
          f.push(`${p}: decision ${r.decision} or empty reason`);
      }
    if (m.conflict_rules?.capability_paths !== "retain-fork-and-run-capability-tests")
      f.push("conflict_rules.capability_paths is not retain-fork-and-run-capability-tests");
    const capPaths = new Set<string>(capabilities(true).flatMap((c) => c.m.paths ?? []));
    for (const e of m.entries ?? [])
      if (capPaths.has(e.path) && /take-upstream/.test(String(e.conflict_rule ?? "")))
        f.push(`${e.path} is under a capability and its rule takes upstream`);
    if (/take-upstream/.test(String(m.conflict_rules?.default ?? "")))
      f.push(
        "the default conflict rule takes upstream; capability paths must be carved out explicitly and the default named",
      );
    return f;
  });
  check("S2-C05", () => {
    const m = manifest();
    const f: Fail[] = [];
    for (const e of m.entries ?? []) {
      if (
        NAMESPACE.some((re) => re.test(e.path)) &&
        e.class !== "fork-namespace" &&
        e.class !== "upstream-edit"
      )
        f.push(`${e.path}: inside the namespace but class ${e.class}`);
      if (e.class === "fork-added" && !["planned", "kept"].includes(e.relocation))
        f.push(`${e.path}: relocation ${e.relocation}`);
      if (e.class === "fork-added" && e.relocation === "kept" && !e.relocation_reason)
        f.push(`${e.path}: kept without a reason`);
      if (e.class === "upstream-edit" && !Number.isInteger(e.mount_lines))
        f.push(`${e.path}: mount_lines missing`);
    }
    if (!existsSync(join(repo, "scripts/throughline/seam/mount-lines.ts")))
      f.push("scripts/throughline/seam/mount-lines.ts missing");
    return f;
  });
  check("S2-C06", () => {
    const caps = capabilities();
    const f: Fail[] = [];
    if (!caps.some((c) => c.name === "rewind")) f.push(`no rewind manifest under ${CAP_DIR}`);
    for (const c of caps) {
      if (c.m.schema !== "throughline.capability.v1") f.push(`${c.name}: schema ${c.m.schema}`);
      for (const p of c.m.paths ?? [])
        if (!existsSync(join(repo, p))) f.push(`${c.name}: listed path missing ${p}`);
      for (const r of c.m.regression ?? []) {
        const p = join(repo, r.file);
        if (!existsSync(p)) {
          f.push(`${c.name}: regression file missing ${r.file}`);
          continue;
        }
        const t = readFileSync(p, "utf8");
        for (const k of r.cases ?? [])
          if (!t.includes(k)) f.push(`${c.name}: case not found in ${r.file}: ${k.slice(0, 60)}`);
      }
      if (
        (c.m.paths ?? []).some((p: string) => p.startsWith("apps/mobile/")) &&
        !(c.m.regression ?? []).some((r: any) => r.package === "apps/mobile")
      )
        f.push(`${c.name}: touches apps/mobile but pins no apps/mobile case`);
    }
    return f;
  });
  check("S2-C07", () => {
    const p = JSON.parse(readFileSync(spec.repository.pipeline_definition, "utf8"));
    const f: Fail[] = [];
    const steps: any[] = p.steps ?? [];
    const cmd = (s: any) => (Array.isArray(s.command) ? s.command : [s.command]).join(" ");
    const sync = steps.findIndex((s) => s.id === "upstream-sync");
    const firstBuild = steps.findIndex((s) => s.kind === "signed-build");
    const seam = steps.findIndex((s) => /check-seam\.ts/.test(cmd(s)) && /--repo/.test(cmd(s)));
    if (!String(p.seam_file ?? "").endsWith("throughline-seam.json"))
      f.push(`seam_file is ${p.seam_file}`);
    if (seam < 0) f.push("no step runs check-seam.ts with --repo");
    else if (!(sync < seam && seam < firstBuild))
      f.push(
        `seam-check step at ${seam} is not between upstream-sync ${sync} and the first signed build ${firstBuild}`,
      );
    for (const c of capabilities()) {
      const i = steps.findIndex(
        (s) => /capability-regression/.test(cmd(s)) && cmd(s).split(" ").includes(c.name),
      );
      if (i < 0 || i > firstBuild)
        f.push(`capability ${c.name} has no regression step before the first signed build`);
    }
    return f;
  });
  check("S2-C08", () => {
    const f: Fail[] = [];
    for (const s of ["scripts/throughline/seam-side.ts", "scripts/throughline/seam-view.ts"])
      if (!existsSync(join(repo, s))) f.push(`${s} missing`);
    const html = join(repo, "docs/throughline/seam-view.html");
    if (!existsSync(html)) return [...f, "docs/throughline/seam-view.html missing"];
    if (!existsSync(manifestPath)) return [...f, "no manifest to bind the view to"];
    const want = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
    const got = /name="seam-manifest-sha256" content="([0-9a-f]{64})"/.exec(
      readFileSync(html, "utf8"),
    )?.[1];
    if (got !== want)
      f.push(`view bound to ${got?.slice(0, 12) ?? "nothing"}, manifest is ${want.slice(0, 12)}`);
    return f;
  });
  check("S2-C09", () => {
    const mp = join(spec.repository.vault_copy.destination, "repository.json");
    if (!existsSync(mp)) return [`no vault copy manifest at ${mp}`];
    const m = JSON.parse(readFileSync(mp, "utf8"));
    if (!isCommit(m.commit)) return [`vault copy commit ${m.commit} is not in the repository`];
    const f: Fail[] = [];
    for (const p of ["throughline-seam.json", `${CAP_DIR}/rewind/Capability.json`]) {
      try {
        git("cat-file", "-e", `${m.commit}:${p}`);
      } catch {
        f.push(`installed release ${m.release} at ${String(m.commit).slice(0, 10)} lacks ${p}`);
      }
    }
    return f;
  });
  check("S2-G01", () => {
    const repoCopy = join(repo, CAP_DIR, "rewind", "Capability.json");
    const file = existsSync(repoCopy)
      ? repoCopy
      : join(spec.repository.component_folder, "capabilities", "rewind", "Capability.json");
    const m = JSON.parse(readFileSync(file, "utf8"));
    const f: Fail[] = [];
    for (const r of m.regression ?? []) {
      const p = join(repo, r.file);
      if (!existsSync(p)) {
        f.push(`missing ${r.file}`);
        continue;
      }
      const t = readFileSync(p, "utf8");
      for (const k of r.cases ?? [])
        if (!t.includes(k)) f.push(`case gone from ${r.file}: ${k.slice(0, 60)}`);
    }
    return f;
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
  console.log(`\n${green} of ${results.length} checks green  (${new Date().toISOString()})`);
  process.exit(green === results.length ? 0 : 1);
}

// Compare real paths: /tmp and other symlinked folders would otherwise skip main() and exit 0 with no checks run.
const invokedDirectly = (() => {
  try {
    return (
      realpathSync.native(fileURLToPath(import.meta.url)) ===
      realpathSync.native(process.argv[1] ?? "")
    );
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  try {
    main();
  } catch (e) {
    console.error(`BINDING REFUSED: ${(e as Error).message}`);
    process.exit(2);
  }
}

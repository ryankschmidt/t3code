// Shared check contracts and disposable-fixture operations; never a product installer.
import {
  existsSync,
  lstatSync,
  realpathSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve, basename, sep } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
const { load: yamlLoad, dump: yamlDump } = createRequire(import.meta.url)("js-yaml");
export const SHA40 = /^[0-9a-f]{40}$/,
  SHA256 = /^[0-9a-f]{64}$/;
export const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);
export const hashBytes = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
export const canonical = (path: string): string => {
  let p = resolve(path);
  const suffix: string[] = [];
  while (true) {
    try {
      lstatSync(p);
      return join(realpathSync.native(p), ...suffix.reverse());
    } catch (e: any) {
      // A broken symlink exists by lstat, so realpath's ENOENT must not be treated as a missing leaf.
      try {
        lstatSync(p);
        throw Error(`unresolvable existing ancestor: ${p}`);
      } catch (x: any) {
        if (x.code !== "ENOENT") throw x;
      }
      if (e.code !== "ENOENT") throw e;
      const parent = dirname(p);
      if (parent === p) throw e;
      suffix.push(basename(p));
      p = parent;
    }
  }
};
export const under = (path: string, root: string) => {
  const p = canonical(path),
    r = canonical(root);
  return p === r || p.startsWith(r + sep);
};
export const globToRegex = (g: string) => {
  let s = "^";
  for (let i = 0; i < g.length; i++) {
    if (g[i] === "*" && g[i + 1] === "*") {
      i++;
      if (g[i + 1] === "/") {
        i++;
        s += "(?:.*/)?";
      } else s += ".*";
    } else if (g[i] === "*") s += "[^/]*";
    else if (g[i] === "?") s += "[^/]";
    else s += g[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(s + "$");
};
export const matchesAny = (p: string, globs: string[]) => globs.some((g) => globToRegex(g).test(p));
export function archiveRows(text: string): any[] {
  const d = JSON.parse(text);
  if (d.schema !== "mac-disk-archive-ledger.v1" || !Array.isArray(d.moves))
    throw Error("archive ledger must be the owning object-with-moves format");
  return d.moves;
}
export function archiveMatches(row: any, fp: any): boolean {
  return (
    !!row &&
    row.source === fp.path &&
    row.archive === fp.archive &&
    row.status === "ARCHIVED_AND_REMOVED" &&
    row.verify_result === "PASS" &&
    row.rsync_checksum_verified === true &&
    ["sha256", "file_count", "symlink_count", "entry_count", "bytes"].every(
      (k) => row[k] === fp[k],
    ) &&
    row.remote_file_count === fp.file_count &&
    row.remote_symlink_count === fp.symlink_count
  );
}
export const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
export function selectedPaths(
  repo: string,
  paths?: readonly string[],
): { paths: string[]; argv: string[]; stdin: string; unborn: boolean } {
  const head = spawnSync("git", ["-C", repo, "rev-parse", "--verify", "HEAD"], {
    encoding: "utf8",
  });
  const unborn = head.status !== 0;
  if (
    unborn &&
    spawnSync("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" })
      .status !== 0
  )
    throw Error("not a repository");
  const explicit = paths?.length ? [...paths] : undefined;
  const tracked =
    explicit ??
    (unborn ? git(repo, "ls-files", "-z") : git(repo, "diff", "--name-only", "-z", "HEAD"))
      .split("\0")
      .filter(Boolean);
  const others = explicit
    ? []
    : git(repo, "ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
  const set = [...new Set([...tracked, ...others])];
  if (set.some((p) => p.includes("\0"))) throw Error("NUL in path");
  return {
    paths: set,
    argv: set.length
      ? ["--literal-pathspecs", "add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"]
      : [],
    stdin: set.length ? set.join("\0") + "\0" : "",
    unborn,
  };
}
export const indexEntries = (repo: string) => git(repo, "ls-files", "--stage", "-z");
export const tagIdentity = (repo: string, name: string) => {
  const ref = `refs/tags/${name}`,
    object_sha = git(repo, "rev-parse", ref).trim(),
    peeled_object = git(repo, "rev-parse", `${ref}^{}`).trim(),
    target_type = git(repo, "cat-file", "-t", peeled_object).trim();
  if (!["commit", "tree", "blob"].includes(target_type)) throw Error("unsupported tag target type");
  return {
    object_sha,
    target_type,
    peeled_object,
    peeled_commit: target_type === "commit" ? peeled_object : null,
  };
};
export function admissionAllowed(m: any, release: string, run: string): boolean {
  return (
    (m?.admission_state === "closed" ||
      (m?.admission_state === "moved" && m.admitted_release === release)) &&
    (!m.release_in_flight || m.release_in_flight === run)
  );
}
export function pipelinePaths(p: any, R: any): string[] {
  const f: string[] = [];
  for (const [field, value] of [
    ["checkout", p.checkout],
    ["worktrees_root", p.source?.worktrees_root],
    ["release_checkout", p.source?.release_checkout?.replaceAll("{release}", "0.0.0")],
    ["backup_root", p.backup_root],
  ] as const) {
    if (typeof value !== "string" || !value.startsWith("/")) {
      f.push(`${field}: not absolute`);
      continue;
    }
    for (const root of p.forbidden_roots ?? [])
      if (under(value, root)) f.push(`${field}: forbidden physical path`);
  }
  if (
    p.source?.worktrees_root &&
    p.checkout &&
    (under(p.source.worktrees_root, p.checkout) || under(p.checkout, p.source.worktrees_root))
  )
    f.push("worktrees root nested with checkout");
  for (const [field, value, root] of [
    ["move_record", p.move_record, dirname(R.move_record)],
    ["evidence_root", p.evidence_root, R.evidence_root],
    ["vault_copy", p.vault_copy?.destination, R.vault_copy.destination],
  ] as const)
    if (!value || !root || !under(value, root))
      f.push(`${field}: outside its record/publication boundary`);
  return f;
}
export function expectedStep(id: "vault-clean" | "publish-docs", installed: string) {
  return {
    id,
    action: "execute",
    platform: "fork",
    kind: id === "vault-clean" ? "rehearsal" : "parity-proof",
    privilege: "none",
    capabilities: [id === "vault-clean" ? "read-vault" : "write-vault-copy"],
    gate:
      id === "vault-clean"
        ? "No build output (installer, archive, object file, derived data or node_modules tree) sits under the evidence root, the retired vault backup root or the retired t3code folder; symlinks and unreadable entries are findings"
        : "The declared repository documents from the frozen source commit are copied into the vault copy folder with generated frontmatter and a manifest whose commit equals the frozen commit and whose release equals {release}",
    command: ["node", installed + "/dist/cli.js", "internal-step", id],
    requires: [id === "vault-clean" ? "preflight" : "install-mac"],
  };
}
export function parseMarkdown(text: string): { metadata: any; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return { metadata: {}, body: text };
  const metadata = yamlLoad(m[1]);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw Error("frontmatter must be a YAML mapping");
  return { metadata, body: text.slice(m[0].length) };
}
export function publicationBytes(
  source: string,
  o: { path: string; repository: string; commit: string; release: string; date: string },
): string {
  if (!o.path.endsWith(".md")) return source;
  const { metadata: fm, body } = parseMarkdown(source);
  const author = {
    title: fm.title ?? /^#\s+(.+)$/m.exec(body)?.[1] ?? basename(o.path),
    description:
      fm.description ??
      `Copied from the ThroughLine repository at release ${o.release}, path ${o.path}`,
    type: fm.type ?? "reference",
    status: fm.status ?? "active",
    created: fm.created ?? o.date,
    last_updated: fm.last_updated ?? o.date,
  };
  const metadata = {
    ...fm,
    ...author,
    source_repository: o.repository,
    source_path: o.path,
    source_commit: o.commit,
    release: o.release,
  };
  return (
    "---\n" + yamlDump(metadata, { lineWidth: -1, noRefs: true, sortKeys: true }) + "---\n" + body
  );
}
export function publishSibling(
  pending: string,
  destination: string,
  previous: string,
  afterRename: (n: number) => void = () => {},
) {
  if (
    [pending, previous].some(
      (p) => dirname(resolve(p)) !== dirname(resolve(destination)) || p === destination,
    ) ||
    under(pending, destination)
  )
    throw Error("publication staging must be a distinct sibling");
  let saved = false,
    installed = false;
  try {
    if (existsSync(destination)) {
      renameSync(destination, previous);
      saved = true;
      afterRename(1);
    }
    renameSync(pending, destination);
    installed = true;
    afterRename(2);
    return { installed: true, previous: saved ? previous : null };
  } catch (e) {
    if (installed) renameSync(destination, pending);
    if (saved) renameSync(previous, destination);
    throw e;
  }
}
export function emptyDirectoryPlan(root: string): string[] {
  const s = lstatSync(root);
  if (!s.isDirectory() || s.isSymbolicLink()) throw Error("root is not a real directory");
  const dirs: string[] = [];
  for (const n of readdirSync(root)) {
    const p = join(root, n),
      st = lstatSync(p);
    if (!st.isDirectory() || st.isSymbolicLink()) throw Error(`non-directory residue: ${p}`);
    dirs.push(...emptyDirectoryPlan(p));
  }
  dirs.push(root);
  return dirs;
}
// Only test code calls this; the real checker is read-only and never removes a path.
export const removeEmptyDirectories = (root: string) => {
  const plan = emptyDirectoryPlan(root);
  for (const d of plan) rmdirSync(d);
  return plan;
};
export function manifestOf(root: string) {
  const digest = createHash("sha256");
  let file_count = 0,
    symlink_count = 0,
    entry_count = 0,
    bytes = 0;
  const walk = (p: string, relative: string) => {
    // Refuse credential-shaped input rather than ever opening it.
    const name = basename(p).toLowerCase();
    if (
      (relative &&
        /(?:^|\/)(?:\.ssh|\.aws|\.env(?:\..*)?|credentials|secrets)(?:\/|$)/i.test(relative)) ||
      [".npmrc", ".netrc", ".pypirc"].includes(name) ||
      /(?:credentials?|secrets?|oauth|auth|tokens?)(?:[-_.].*)?\.json$|\.p12$|\.pfx$|^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.|$)|private.*\.(?:pem|key)$/.test(
        name,
      )
    )
      throw Error(`credential-shaped fingerprint input: ${relative}`);
    const s = lstatSync(p);
    entry_count++;
    if (s.isSymbolicLink()) {
      symlink_count++;
      digest.update(JSON.stringify([relative, "link", readlinkSync(p)]) + "\n");
    } else if (s.isDirectory()) {
      digest.update(JSON.stringify([relative, "directory"]) + "\n");
      for (const n of readdirSync(p).sort()) walk(join(p, n), relative ? relative + "/" + n : n);
    } else if (s.isFile()) {
      const hash = hashBytes(readFileSync(p));
      file_count++;
      bytes += s.size;
      digest.update(JSON.stringify([relative, "file", s.size, hash]) + "\n");
    } else throw Error("special fingerprint entry");
  };
  walk(root, "");
  return { sha256: digest.digest("hex"), file_count, symlink_count, entry_count, bytes };
}

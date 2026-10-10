// Archive-reader regressions use disposable recorded evidence; no real archive or witness is edited.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
  readdirSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { manifestOf } from "./slice-1-contracts.mts";

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
    excluded_dependency_trees: ["node_modules", "Pods", "SourcePackages", "checkouts", "Carthage"],
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
      ["head", "origin_url", "branches", "tags", "worktrees", "fingerprints"].map((k) => [k, m[k]]),
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

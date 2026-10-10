// Builds spec.json from spec-data.mts and the design ledger.
// Every decision's Ryan quote is copied byte-true from the ledger item it names; the build fails if a named item has no Ryan-spoken source.
// Run: node build-spec.mts
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  BACKUP_NEW,
  BACKUP_OLD,
  BUILD_DIR_MARKERS,
  BUILD_EXTENSIONS,
  CHECKS,
  COMPONENT,
  DECISIONS,
  DESIGN_START_COMMIT,
  EVIDENCE_ROOT,
  GOAL,
  HOME,
  JUDGE_RULE,
  LEDGER,
  MANAGER,
  MONOREPO,
  OLD_HOME,
  OLD_RELEASE_CHECKOUT,
  ORIGIN,
  PIPELINE,
  RPI_BUILD,
  RYAN_DECISIONS_PENDING,
  SHIP_TOOL,
  SLICES,
  SPEC_FOLDER_REPO,
  SPEC_FOLDER_VAULT,
  T3CODE_FOLDER,
  TASKS,
  TOWER_BUILD,
  UPSTREAM,
  VAULT,
  VAULT_COPY,
  VAULT_COPY_SET,
  WORKTREES,
  ASTRA,
  SOL,
  OPUS_MED,
  MOVE_RECORD,
  ARCHIVE_LEDGER,
  NEXT_RELEASE,
  VAULT_COPY_EXCLUDE,
  WATCHER_SERVER_REBOOT_DELTA,
  INSTRUCTION_COVERAGE,
} from "./spec-data.mts";
import {
  ACCEPTANCE,
  AUDIT,
  CONTRACTS,
  DECISION_SOURCES,
  DEVICE_MATRIX,
  DEVICE_ROLES,
  LEDGER as LEDGER_DISPOSITIONS_AUTHORED,
} from "./contracts-data.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const SOURCE_FILES = ["spec-data.mts", "contracts-data.mts", "build-spec.mts"].map((f) => ({
  path: `./${f}`,
  sha256: sha(join(HERE, f)),
}));
// Design references travel with the spec; records and source quotations keep their physical vault addresses.
const localCheckPath = (p: string) => {
  for (const root of [SPEC_FOLDER_VAULT, HERE]) {
    if (p === `${root}/check-spec.mts`) return "./check-spec.mts";
    if (p.startsWith(`${root}/checks/`)) return `./checks/${p.slice(`${root}/checks/`.length)}`;
  }
  return p;
};
const localCheckCommand = (command: string) => {
  for (const root of [SPEC_FOLDER_VAULT, HERE])
    command = command
      .replaceAll(`${root}/checks/`, "./checks/")
      .replaceAll(`${root}/check-spec.mts`, "./check-spec.mts");
  return command;
};
const ledgerBytes = readFileSync(LEDGER);
const ledger = JSON.parse(ledgerBytes.toString("utf8")) as {
  items: Array<{
    id: string;
    title: string;
    status: string;
    sources?: Array<{
      speaker?: string;
      quote?: string;
      thread_id?: string;
      message_id?: string;
      created_at?: string;
    }>;
  }>;
};
const byId = new Map(ledger.items.map((i) => [i.id, i]));
const { threadMessages } = await import(
  pathToFileURL(join(dirname(LEDGER), "ledger-source.mts")).href
);

const decisions = DECISIONS.map((d) => {
  const source = DECISION_SOURCES[d.id];
  if (!source) throw new Error(`decision ${d.id} has no source role (K15)`);
  let ryan_quote: {
    quote: string;
    thread_id?: string;
    message_id?: string;
    created_at?: string;
    ledger_item: string;
  } | null = null;
  if (d.quote_from) {
    const item = byId.get(d.quote_from);
    if (!item)
      throw new Error(`decision ${d.id} names ledger item ${d.quote_from}, which does not exist`);
    const src = (item.sources ?? []).find(
      (s) =>
        s.speaker === "ryan" &&
        s.quote &&
        s.quote.trim().length > 0 &&
        (!source.quote_from_message || s.message_id === source.quote_from_message),
    );
    if (!src)
      throw new Error(
        `decision ${d.id}: ledger item ${d.quote_from} has no Ryan-spoken source quote`,
      );
    const quote = source.quote_text ?? src.quote!;
    if (source.quote_from_message) {
      const m = threadMessages(src.thread_id!).find((m: any) => m.messageId === src.message_id);
      if (!m || m.role !== "user" || !m.text.includes(quote))
        throw Error(
          `${d.id}: selected complete quote is not byte-true in the admitted Ryan message`,
        );
    }
    ryan_quote = {
      quote,
      thread_id: src.thread_id,
      message_id: src.message_id,
      created_at: src.created_at,
      ledger_item: d.quote_from,
    };
  }
  if (!ryan_quote && !d.fable_call)
    throw new Error(`decision ${d.id} has neither a Ryan quote nor a Fable call`);
  const { quote_from, ...rest } = d;
  const later_sources =
    source.later_source_message && d.quote_from
      ? (byId.get(d.quote_from)!.sources ?? []).filter(
          (s: any) =>
            s.message_id === source.later_source_message && s.speaker === "sender-unverified",
        )
      : [];
  if (source.later_source_message && !later_sources.length)
    throw Error(`${d.id}: sender-unverified later source missing; never promote it to Ryan`);
  return {
    ...rest,
    ryan_quote,
    source_role: source.role,
    source_note: source.note,
    ...(source.quote_from_message
      ? {
          quote_selection: {
            message_id: source.quote_from_message,
            quote: source.quote_text ?? ryan_quote!.quote,
            speaker: "ryan",
          },
        }
      : {}),
    ...(source.previous_selection ? { quote_history: [source.previous_selection] } : {}),
    ...(later_sources.length ? { later_sources } : {}),
    ...(source.reselect_from ? { reselect_quote_from: source.reselect_from } : {}),
  };
});

// K16: every ledger item has a disposition. Implemented is derived from serves (tasks, slices, decisions, contracts); the rest is authored.
const servesBy = new Map<string, Set<string>>();
const addServe = (id: string, by: string) => {
  if (!servesBy.has(id)) servesBy.set(id, new Set());
  servesBy.get(id)!.add(by);
};
for (const t of TASKS) for (const id of t.serves) addServe(id, t.id);
for (const s of SLICES) for (const id of s.serves) addServe(id, s.id);
for (const d of DECISIONS) for (const id of d.serves) addServe(id, d.id);
for (const k of CONTRACTS) for (const id of k.serves) addServe(id, k.id);
const authored = new Map(LEDGER_DISPOSITIONS_AUTHORED.map((l) => [l.id, l]));
const ledger_dispositions = ledger.items.map((i) => {
  const by = [...(servesBy.get(i.id) ?? [])].sort();
  const a = authored.get(i.id);
  if (a)
    return {
      id: i.id,
      title: i.title,
      status: i.status,
      kind: a.kind,
      by: [...new Set([...a.by, ...by])],
      note: a.note,
      consumption_test: a.consumption_test ?? null,
      acceptance:
        a.kind === "implemented"
          ? "the done checks of the named tasks and the tests of the named contracts"
          : a.kind === "external-capability"
            ? (a.consumption_test ?? null)
            : null,
    };
  if (by.length)
    return {
      id: i.id,
      title: i.title,
      status: i.status,
      kind: "implemented",
      by,
      note: "named by serves",
      consumption_test: null,
      acceptance: "the done checks of the named tasks and the tests of the named contracts",
    };
  return {
    id: i.id,
    title: i.title,
    status: i.status,
    kind: "MISSING",
    by: [],
    note: "",
    consumption_test: null,
    acceptance: null,
  };
});
const missingDisp = ledger_dispositions.filter((x) => x.kind === "MISSING").map((x) => x.id);
if (missingDisp.length)
  throw new Error(
    `K16: ${missingDisp.length} ledger items have no disposition: ${missingDisp.join(", ")}`,
  );
for (const l of LEDGER_DISPOSITIONS_AUTHORED)
  if (!byId.has(l.id)) throw new Error(`authored disposition names unknown ledger item ${l.id}`);

// Seam accounting: every file edit across every task, by side; the upstream-edit count is computed from the spec and may only fall.
const sideCounts: Record<string, number> = {};
const upstreamEdits = new Set<string>();
for (const t of TASKS)
  for (const f of t.files) {
    if (f.action === "read") continue;
    sideCounts[f.side] = (sideCounts[f.side] ?? 0) + 1;
    if (f.side === "upstream-edit") upstreamEdits.add(f.path);
  }

const spec = {
  schema: "throughline.next-gen-spec.v1",
  version: "0.4.21",
  instruction_coverage: INSTRUCTION_COVERAGE,
  watcher_server_reboot_delta: WATCHER_SERVER_REBOOT_DELTA,
  revision: {
    from: "0.4.20",
    reason:
      "Current 0.4.21: apply Fable's R3 verbatim for independent review F1-F3 of 0.4.20 (Review-Spec-0.4.20-8c4bf0d8fd.json): T4.07 reads environment names only through the source-owned env-names helper (authored by T4.05, contract and seven fixtures bound byte-equal by X21) and proves the Raspberry Pi provider route with a route-probe thread during its turn, depending on T4.04 and T4.05 and never on the T12.08 responder; T12.08 cites that receipt; T4.06 relocates the record TLS certificate and key to /etc/throughline/record-tls/ (root:throughline-record) in the same batch with rehearsal, old-home rejection under ProtectHome=yes and rollback; T4.01 states the two ssl_*_file lines that do not travel unchanged. Prior unlanded 0.4.20: bind B1 built-candidate browser-preview cold capture tests, mandatory failed-before/passing-after screenshot pair and same-diagnosis reopen before final install; no screenshot fix claimed. Prior unlanded 0.4.19: apply the final R2 state-scoped rehearsal probe and rehearsal-only twr grant; preserve production-unit isolation, before/after receipts and every prior fixture. Prior unlanded 0.4.18: apply Ryan instruction coverage IC-049/052/056/002/008: Phase 4 upstream reconciliation first, installed target-ID-only succession after provider adapters, one target API for Claude/Codex/Pi, command grammar and caller preservation, and Raspberry Pi pause with archive/watcher exceptions. Also incorporate R2 source follow-through. Prior unlanded 0.4.17: Apply corrected watcher/server/reboot design delta: locked server and record accounts, the Raspberry Pi responder recovery island and provider route, explicit tiered incidents, encrypted-disk reboot constraints and a non-install unlock proposal. Source decisions remain pinned; no runtime change is claimed. 0.4.16 was: Fixture path consolidation preserves every case inside the admitted slice-1 checker and removes the separate fixture paths without changing seam ceilings or the self-test. S1-C05 ports the approved deferred.rpi contract from frozen 0.4.12; S1-C13 follows the same explicit deferral instead of demanding a paused-device install receipt. T1.10 carries the original pause declaration; hardware and pipeline remain untouched. 0.4.15 was: Disposition proof correction for independent review F1 (Review-Spec-Archive-Readers-de292cef67.json): annotated and unannotated preserved entries share the same real-target existence, collection-containment and all-five-fingerprint proof. The failed head and its evidence remain preserved. 0.4.14 was: Reader-only repair: S1-C06 consumes archive annotations, pre-copy addenda and dropped third-party record rows; S1-C09 recognizes bound frozen-worktree dispositions and detached freezes and validates archive annotation shapes. Existing rebase custody and retained-link checks are unchanged; frozen witnesses stay read-only. 0.4.13 was: Three approved repository-spec changes, preserving the required old-home compatibility link while moved and its removal at closure: append-only reviewed rebase rows (including the prerequisite worktree annotation contract from the frozen 0.4.12 record); preserved release targets follow move annotations and archived staging links retain exact ledger proof; done_when commands preserve their intended folders. Repository baseline was 0.4.7; unrelated frozen-record amendments are not imported. 0.4.7 was: T1.05 record retention (execution/phase-03/delivery-2026-10-09/Move-Remainder-Receipt.json, question records-inside-build-output): each build container is archived whole with its frozen fingerprint; its records are first copied to retained-records under the evidence root with sanitized names and a manifest; S1-C06 checks no build-named directory, a passing ledger row per container, and every record at its new path with its SHA-256. 0.4.6 was: Rename on Ryan's direction: the vendored relay is @ryan/agent-mcp-relay at apps/server/vendor/agent-mcp-relay-0.3.0.tgz (was @ryan/coms-net at apps/server/vendor/ryan-coms-net-0.3.0-legacy-mcp-relay.tgz); T1.04 and T7.04, including the T7.04 gone-check, use the new names. 0.4.5 was: Release tool literal (execution/phase-03/Delivery-State.json): Ship Warden binds one payload per version, so T1.04 and S1-C05 accept throughline-ship 0.4.1 or later instead of 0.4.0. 0.4.4 was: Path correction (execution/phase-03/delivery-2026-10-09/Order-Coms-Net-Vendor.txt): the vendored relay tarball and its README live under apps/server/vendor/, where pnpm resolves file:vendor/...; every path in T1.04 and T7.04, including the T7.04 gone-check, now names apps/server/vendor/. 0.4.3 was: @ryan/coms-net (the legacy MCP relay, not ComsNet) is a frozen tarball in the repository, decision D3 (execution/phase-03/delivery-2026-10-09/D3-Coms-Net-Decision.json): T1.04 drops the rpi-coms-net.tar transfer and the tower coms-net presence check; T7.04 deletes the tarball, vendor/README.md and the dependency line and checks they are gone. 0.4.2 was: GitHub repository renamed ryankschmidt/t3code to ryankschmidt/throughline on Oct 9, 2026 under Ryan's order (execution/phase-03/repo-home-2026-10-09/Repo-Home-Receipt.json): origin and the publish-docs source_repository literal, R02 carried out, S1-C01 and S1-C09 accept the pre-rename frozen origin, S1-C04 and S1-C09 compare tags by target type, T1.04 records the Mac node 24.13.1 selection. 0.4.1 was: Exit-check corrections, Oct 9, 2026 (execution/phase-02/closeout-2026-10-09/P2-Exit-Check-0.4.0.json defects P2-01, P2-02, P2-03): T3.06 deferred outside the first-install graph on K03, the T10.04 edge removed and the first-install acceptance limited to live input unavailable on the Mac; T6.02 no longer waits on slice 13 and depends on T1.10, provider evidence stays with its owners; T3.01 refuses HTTP turn starts at the decorator through the unchanged http.ts with a behavioral test and checks non-increase against the real stock-file set. 0.4.0 was: Phase 2 close-out, Oct 9, 2026, single design writer (thread a96357c8): G2 five-target acceptance contract (T13.04, X20), G3 one Codex provider and no auto-compaction for Claude, Codex and Pi (T8.02, T10.10, T11.02), G4 map wording, G5 real starting state and release 0.0.60 (T1.01, T1.04, T1.10, fork_state), G6 provider enforcement folds, G1 second-look folds, and Fable-Delta-Enforcement.json and Fable-Delta-Hosts.json applied verbatim (new outline task T3.06); record in execution/phase-02/closeout-2026-10-09/Writer-Changes-0.4.0.json. 0.3.0 was: second pass, Oct 8, 2026: every item of the fidelity review (F01-F13), the architecture review (A01-A14), its addenda (A15-A18), the slice-1 judge round 2 and the overlapping shape-alignment items carries a disposition; seventeen cross-cutting contracts settle the consequential choices; every ledger item has a disposition; the five-device matrix, the decision source roles and the whole-design acceptance node are added; the checker gains closed enums and unique ids, the combined task-slice-precondition graph, a baseline non-increase and rendered-generation binding",
    audits: [
      `${SPEC_FOLDER_VAULT}/_meta/fidelity-review-01a11989/Initial-Findings.json`,
      `${SPEC_FOLDER_VAULT}/_meta/architecture-review-01a1198a/Initial-Findings.json`,
      `${SPEC_FOLDER_VAULT}/_meta/architecture-review-01a1198a/Follow-Through.json`,
      `${SPEC_FOLDER_VAULT}/_meta/review-slice-1-2026-10-07/Review-Verdict-Spec-Slice-1-Round-2-2026-10-08.md`,
      `${SPEC_FOLDER_VAULT}/_meta/shape-alignment-01a119be/Findings.json`,
    ],
    previous: {
      from: "0.1.0",
      to: "0.2.0",
      reason:
        "repairs after the outside review of slice 1 by judge-ngspec1-6b3c6154 on Oct 7, 2026 (verdict FAIL, six sections); every finding is answered in the slice-1 tasks, the checks and the pending-decision authority records",
      verdict: `${SPEC_FOLDER_VAULT}/_meta/review-slice-1-2026-10-07/Review-Verdict-Spec-Slice-1-2026-10-07.md`,
      outcome:
        "round-2 verdict FAIL on 0.2.0; its findings are disposed as J2 in audit_dispositions",
    },
  },
  generated_at: new Date().toISOString(),
  generated_by: {
    note: "the seat that ran the builder, read from its environment at build time; the design author is authored_by",
    runtime: process.env.CODEX_THREAD_ID ? "codex" : "claude",
    session_uuid: process.env.CLAUDE_CODE_SESSION_ID ?? process.env.CODEX_THREAD_ID ?? "unknown",
    builder: "build-spec.mts",
    source_files: SOURCE_FILES,
  },
  authored_by: {
    role: "lead-seat",
    agent_name: "fable-throughline-design",
    runtime: "claude",
    model: "claude-fable-5-1[1m]",
    session_uuid: "03e03b3e-0e2e-4706-a992-4444e0026b17",
    transcript:
      "/Users/Admin/.claude/projects/-Users-Admin/03e03b3e-0e2e-4706-a992-4444e0026b17.jsonl",
    throughline_thread: "44973766-bbeb-4c80-b506-a4b171273e33",
  },
  goal: GOAL,
  ledger: {
    path: LEDGER,
    sha256: createHash("sha256").update(ledgerBytes).digest("hex"),
    items: ledger.items.length,
    rule: "every task names the ledger ids it serves; the ledger is the picture of what is decided, this spec is the campaign; the two never drift because they join by id",
  },
  design_start_commit: DESIGN_START_COMMIT,
  repository: {
    old_home: OLD_HOME,
    home: HOME,
    worktrees: WORKTREES,
    origin: ORIGIN,
    upstream: UPSTREAM,
    old_release_checkout: OLD_RELEASE_CHECKOUT,
    release_checkout: `${WORKTREES}/{release}`,
    old_backup_root: BACKUP_OLD,
    backup_root: BACKUP_NEW,
    evidence_root: EVIDENCE_ROOT,
    build_output_rule:
      "build outputs land in <release worktree>/release/ (the fork already ignores release/); the evidence root receives records only; the Mac keeps the last successful build and earlier builds are archived to rpi:/mnt/storage/archives/throughline-builds (Ryan, Oct 7, 2026)",
    build_extensions: BUILD_EXTENSIONS,
    build_dir_markers: BUILD_DIR_MARKERS,
    tower_build_root: TOWER_BUILD,
    rpi_build_root: RPI_BUILD,
    move_record: MOVE_RECORD,
    archive_ledger: ARCHIVE_LEDGER,
    next_release: NEXT_RELEASE,
    vault_copy: {
      destination: VAULT_COPY,
      patterns: VAULT_COPY_SET,
      exclude: VAULT_COPY_EXCLUDE,
      layout: "README.md (generated), repository.json, tree/<source path>",
      mechanism:
        "publish-docs pipeline step after install-mac; frontmatter generated at byte 0 of every markdown copy",
      why_not_symlinks:
        "the vault link router returned 403 for a symlinked file and 200 for a plain file on Oct 7, 2026",
    },
    spec_home_in_repository: SPEC_FOLDER_REPO,
    spec_home_until_then: SPEC_FOLDER_VAULT,
    component_folder: COMPONENT,
    pipeline_definition: PIPELINE,
    ship_tool: SHIP_TOOL,
    retired_folder: T3CODE_FOLDER,
    monorepo: MONOREPO,
    vault: VAULT,
  },
  roles: {
    note: "preferences as of Oct 7, 2026; the live id comes from `ryan model list --json` at every launch; names move only through `ryan model roll`; judges run at medium effort or lower",
    manager: MANAGER,
    implementers: [SOL, OPUS_MED],
    reviewer: ASTRA,
    judge_rule: JUDGE_RULE,
    rule: "Sol never chooses a design: a task with detail_state outline is not executable; Fable details each slice before the manager starts it",
  },
  decisions,
  ryan_decisions_pending: RYAN_DECISIONS_PENDING.map((r) => {
    if (r.authority.kind !== "ryan-quote") return r;
    const item = byId.get(r.authority.ledger_item!);
    if (!item)
      throw new Error(
        `pending decision ${r.id} names ledger item ${r.authority.ledger_item}, which does not exist`,
      );
    const src = (item.sources ?? []).find(
      (s) => s.speaker === "ryan" && s.quote && s.quote.trim().length > 0,
    );
    if (!src)
      throw new Error(
        `pending decision ${r.id}: ledger item ${r.authority.ledger_item} has no Ryan-spoken source quote`,
      );
    return {
      ...r,
      authority: {
        ...r.authority,
        quote: src.quote,
        thread_id: src.thread_id,
        message_id: src.message_id,
        created_at: src.created_at,
      },
    };
  }),
  slices: SLICES.map((s) => ({
    ...s,
    ...(s.precondition
      ? { precondition: { ...s.precondition, command: localCheckCommand(s.precondition.command) } }
      : {}),
    tasks: TASKS.filter((t) => t.slice === s.id).map((t) => t.id),
  })),
  tasks: TASKS.map((t) => ({
    ...t,
    done_when: { ...t.done_when, command: localCheckCommand(t.done_when.command) },
  })),
  checks: CHECKS.map((c) => ({
    ...c,
    file: localCheckPath(c.file),
    command: localCheckCommand(c.command),
  })),
  seam: {
    rule: "the edited-upstream count is computed from this spec and may only fall; every file edit carries its side",
    sides: [
      "fork-namespace",
      "upstream-edit",
      "config",
      "vault",
      "outside-tool",
      "host-filesystem",
    ],
    edits_by_side: sideCounts,
    upstream_edit_files_in_spec: [...upstreamEdits].sort(),
    upstream_edit_count_in_spec: upstreamEdits.size,
    measured_baseline: {
      date: "2026-10-07",
      fork_edited_stock_files: 210,
      upstream_commits_since_merge_base: 243,
      fork_commits_since_merge_base: 180,
      merge_base_date: "2026-09-27",
      note: "measured by git on this Mac during the Oct 7 audit; slice 2 writes the manifest and the check",
    },
  },
  move_record: MOVE_RECORD,
  contracts: CONTRACTS.map((k) => ({
    ...k,
    inherited_by: TASKS.filter(
      (t) => k.binds_slices.includes(t.slice) || (k.binds_tasks ?? []).includes(t.id),
    ).map((t) => t.id),
  })),
  audit_dispositions: {
    rule: "every item of the named audits has exactly one disposition from the closed set already-resolved | consequential-choice | bounded-repair | evidence-needed; answered_by names contracts, decisions, tasks, checks or pending decisions that exist; a bounded-repair carries the correction an implementer makes; an evidence-needed carries the smallest test",
    sources: {
      fidelity: "F01-F13",
      architecture: "A01-A14",
      "architecture-addenda": "A15-A18",
      "judge-round-2": "J2 (the Oct 8, 2026 verdict on 0.2.0)",
      "shape-alignment":
        "the IA items that overlap the two reviews; the full shape audit is a separate governing input",
    },
    items: AUDIT,
  },
  ledger_dispositions: {
    rule: "K16: implemented is derived from serves; inherited-constraint, external-capability (with a consumption test), deferred-exploration and superseded are authored; the checker refuses a missing one",
    counts: Object.fromEntries(
      [
        "implemented",
        "inherited-constraint",
        "external-capability",
        "deferred-exploration",
        "superseded",
      ].map((k) => [k, ledger_dispositions.filter((x) => x.kind === k).length]),
    ),
    items: ledger_dispositions,
  },
  device_matrix: {
    roles: DEVICE_ROLES,
    rule: "K09: every required cell has an owner task and a cold test fired by a non-builder on the real device; every not-applicable cell carries a role reason",
    rows: DEVICE_MATRIX,
  },
  acceptance: {
    ...ACCEPTANCE,
    depends_on: {
      tasks: TASKS.map((t) => t.id),
      slices: SLICES.map((s) => s.id),
      preconditions: SLICES.filter((s) => s.precondition).map((s) => s.precondition!.id),
      device_cells: DEVICE_MATRIX.flatMap((r) =>
        r.cells
          .filter((c) => c.state === "required")
          .map((c) => `${r.key ?? r.capability.split(":")[0]}@${c.device}`),
      ),
    },
  },
};

const out = join(HERE, "spec.json");
writeFileSync(out, JSON.stringify(spec, null, 2) + "\n");
console.log(
  `wrote ${out}: ${spec.slices.length} slices, ${spec.tasks.length} tasks (${spec.tasks.filter((t) => t.detail_state === "detailed").length} detailed), ${spec.checks.length} checks, ${spec.decisions.length} decisions; ledger sha256 ${spec.ledger.sha256.slice(0, 12)}; upstream-edit files named ${upstreamEdits.size}`,
);

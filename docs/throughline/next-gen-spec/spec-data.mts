// The ThroughLine next-generation implementation spec, authored as typed data.
// Edit this file, run `node build-spec.mts`, never edit spec.json by hand.
// Every hard decision names the ledger item whose first Ryan-spoken source quote the builder copies byte-true.

export type Side =
  | "fork-namespace"
  | "upstream-edit"
  | "config"
  | "vault"
  | "outside-tool"
  | "host-filesystem";
export type Action = "add" | "edit" | "move" | "remove" | "read" | "run";
export type Host = "mac" | "twr" | "rpi";
export interface FileEdit {
  path: string;
  side: Side;
  action: Action;
  note?: string;
  host?: Host;
  surface?: "authoring" | "build-output" | "verification" | "deployment";
  owning_component?: string;
  delivery_path?: string;
}
export interface PendingDecision {
  id: string;
  what: string;
  brought_as: string;
  default: string;
  serves: string[];
  blocks: string;
  authority: {
    kind: "ryan-quote" | "standard" | "proposal";
    ledger_item?: string;
    source?: string;
    quote?: string;
    note?: string;
    ryan_required?: boolean;
  };
}
export interface Executor {
  role: "manager" | "implementer" | "implementer-light" | "reviewer" | "judge";
  model_preference: string;
  effort: "medium" | "high" | "xhigh";
}
export interface Precondition {
  id: string;
  what: string;
  command: string;
  expect: string;
}
export interface Task {
  id: string;
  slice: string;
  title: string;
  serves: string[];
  detail_state: "detailed" | "outline";
  what: string;
  files: FileEdit[];
  signatures: string[];
  failing_checks: string[];
  done_when: { command: string; expect: string };
  depends_on: string[];
  executor: Executor;
  reviewer?: Executor;
  risk: string[];
  rollback: string;
  [key: string]: unknown;
  ryan_act?: string | Record<string, unknown>;
  governing_shapes?: string[];
  completion_condition?: string;
  proof_limits?: string[];
  service_binding?: {
    host: Host;
    owner: string;
    scope: "user" | "state-dependent";
    unit: string;
    fragment: string;
    readback_source: string;
    configuration_at_intake: string;
  };
  observer?: {
    host: Host;
    owner: string;
    owning_component: string;
    availability: string;
    status_path: string;
    notification_owner: string;
    independent_delivery: string;
    acceptance: string;
  };
  acceptance_prerequisites?: Array<{
    id: string;
    owner: string;
    first_action: string;
    test: string;
    status: "required";
  }>;
}
export interface Check {
  id: string;
  slice: string;
  title: string;
  kind: "real-disk" | "unit" | "structural" | "guard";
  file: string;
  expected_today: "FAIL" | "PASS";
  command: string;
}
export interface Slice {
  id: string;
  n: number;
  title: string;
  serves: string[];
  state: "detailed" | "outline";
  depends_on: string[];
  precondition?: Precondition;
  why_this_order: string;
}
export interface Decision {
  id: string;
  title: string;
  statement: string;
  serves: string[];
  quote_from?: string;
  fable_call?: string;
  alternative?: string;
  ryan_decides?: boolean;
}

// ---------- addresses (one place; every task and check reads these) ----------
export const VAULT = "/Users/Admin/core-root/vault";
export const MONOREPO = "/Users/Admin/core-root";
export const COMPONENT = `${VAULT}/01_Projects/workbench/infra/throughline`;
export const OLD_HOME = `${VAULT}/01_Projects/workbench/infra/t3code/t3-upstream`;
export const OLD_RELEASE_CHECKOUT = `${VAULT}/01_Projects/workbench/infra/t3code/t3-upstream-{release}`;
export const HOME = "/Users/Admin/throughline";
export const WORKTREES = "/Users/Admin/throughline-worktrees";
export const BACKUP_OLD = `${COMPONENT}/_versions`;
export const BACKUP_NEW = `${WORKTREES}/_versions`;
export const EVIDENCE_ROOT = `${COMPONENT}/_meta/ship-runs`;
export const PIPELINE = `${COMPONENT}/Ship-Pipeline.json`;
export const SHIP_TOOL = `${VAULT}/01_Projects/workbench/tools/throughline-ship`;
export const SHIP_TOOL_INSTALLED = `${MONOREPO}/src/tools/throughline-ship`;
export const VAULT_COPY = `${COMPONENT}/references/repository`;
export const VAULT_COPY_EXCLUDE = ["**/_meta/**"];
export const MOVE_RECORD = `${COMPONENT}/_meta/repository-move-2026-10-07/Move-Record.json`;
export const ARCHIVE_LEDGER = `${COMPONENT}/_meta/repository-move-2026-10-07/Archive-Ledger.jsonl`;
export const NEXT_RELEASE = "0.0.60";
export const SPEC_FOLDER_VAULT = `${COMPONENT}/plans/next-gen-spec-2026-10-07`;
export const SPEC_FOLDER_REPO = "docs/throughline/next-gen-spec";
export const TOWER_BUILD = "/home/twr/build/throughline/{release}";
export const RPI_BUILD = "/home/rpi/build/throughline/{release}";
export const T3CODE_FOLDER = `${VAULT}/01_Projects/workbench/infra/t3code`;
export const LEDGER = `${SPEC_FOLDER_VAULT}/intent/ledger/ThroughLine-Next-Gen-Ledger.json`;
export const DESIGN_START_COMMIT = "fa95283df6";
export const ORIGIN = "https://github.com/ryankschmidt/throughline.git";
export const UPSTREAM = "https://github.com/pingdotgg/t3code.git";
export const BUILD_EXTENSIONS = [
  ".dmg",
  ".ipa",
  ".AppImage",
  ".tar",
  ".tar.gz",
  ".tgz",
  ".tar.xz",
  ".zip",
  ".pkg",
  ".xip",
  ".o",
  ".a",
  ".pcm",
  ".swiftmodule",
  ".blockmap",
  ".deb",
  ".dia",
  ".hmap",
  ".stringsdata",
];
export const BUILD_DIR_MARKERS = [
  ".xcarchive",
  ".app",
  "node_modules",
  "__node_modules",
  "phone-simulator-derived",
  "phone-export",
  "DerivedData",
  "Intermediates.noindex",
  "dist-electron",
];
export const VAULT_COPY_SET = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "docs/**",
  "apps/desktop/CHANGELOG.md",
  `${SPEC_FOLDER_REPO}/**`,
];

// ---------- roles (preferences as of Oct 7, 2026; the live id comes from `ryan model list --json`; names move only through `ryan model roll`) ----------
export const MANAGER: Executor = {
  role: "manager",
  model_preference: "claude-opus-5-5",
  effort: "high",
};
export const SOL: Executor = {
  role: "implementer",
  model_preference: "gpt-6.1-sol",
  effort: "high",
};
export const OPUS_MED: Executor = {
  role: "implementer-light",
  model_preference: "claude-opus-5-5",
  effort: "medium",
};
export const ASTRA: Executor = {
  role: "reviewer",
  model_preference: "gpt-6-astra",
  effort: "medium",
};
export const JUDGE_RULE =
  "a visible ThroughLine seat that did not build the slice, at medium effort or lower, fires the done_when command cold and writes the acceptance receipt; the builder never certifies its own work";

const CHECKS_FILE = new URL("./checks/slice-1-repository-move.mts", import.meta.url).pathname;
const S1 = (
  id: string,
  title: string,
  expected_today: "FAIL" | "PASS" = "FAIL",
  kind: Check["kind"] = "real-disk",
): Check => ({
  id,
  slice: "slice-1",
  title,
  kind,
  file: CHECKS_FILE,
  expected_today,
  command: `node ${CHECKS_FILE} --only ${id}`,
});

export const CHECKS: Check[] = [
  {
    id: "S1-C01",
    slice: "slice-1",
    title:
      "Moved repository identity and frozen head/refs are preserved, including annotated tag objects and peeled commits",
    kind: "real-disk",
    file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
    expected_today: "FAIL",
    command:
      "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C01",
  },
  S1(
    "S1-C02",
    "the vault holds no ThroughLine checkout: no t3-upstream* or t3code-build folder under the retired folder or its parent, no registered worktree under the vault (a failed worktree listing is a failure, not an empty list), and no unregistered clone of the repository under the retired folder or the component folder to three levels",
  ),
  {
    id: "S1-C03",
    slice: "slice-1",
    title:
      "Every worktree preserves its repository and branch; reviewed append-only rebase chains bind the current head",
    kind: "real-disk",
    file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
    expected_today: "FAIL",
    command:
      "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C03",
  },
  {
    id: "S1-C04",
    slice: "slice-1",
    title:
      "Live remote refs preserve the pinned branch/tag identities; acceptance performs no fetch",
    kind: "real-disk",
    file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
    expected_today: "FAIL",
    command:
      "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C04",
  },
  {
    id: "S1-C05",
    slice: "slice-1",
    title:
      "Exact executable pipeline records, physical path classes, retained helpers and non-vacuous owning rehearsal agree",
    kind: "real-disk",
    file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
    expected_today: "FAIL",
    command:
      "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C05",
  },
  {
    id: "S1-C06",
    slice: "slice-1",
    title:
      "Build outputs leave the vault: preserved trees follow bound move annotations, removed staging links match passing archive fingerprints, and archived containers and retained records keep their evidence",
    kind: "real-disk",
    file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
    expected_today: "FAIL",
    command:
      "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C06",
  },
  {
    id: "S1-C07",
    slice: "slice-1",
    title:
      "Publication pins the declared set and independently compares transformed source bytes, parsed YAML and generated README",
    kind: "real-disk",
    file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
    expected_today: "FAIL",
    command:
      "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C07",
  },
  S1(
    "S1-C08",
    "the monorepo no longer excludes a ThroughLine checkout, the empty stale folders beside the monorepo and the empty t3code-build folder are gone, and the retired folder's README names the new home",
  ),
  {
    id: "S1-C09",
    slice: "slice-1",
    title:
      "Complete command-derived frozen inventory binds repository identity, exact path maps and nonnegative counts",
    kind: "real-disk",
    file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
    expected_today: "FAIL",
    command:
      "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C09",
  },
  {
    id: "S1-C10",
    slice: "slice-1",
    title:
      "The exact complete design file set, including PNG and fixture/helper files, is copied without run records",
    kind: "real-disk",
    file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
    expected_today: "FAIL",
    command:
      "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C10",
  },
  {
    id: "S1-C11",
    slice: "slice-1",
    title:
      "Structured runner evidence and independent source assertions prove the pinned staging and caller tests executed",
    kind: "real-disk",
    file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
    expected_today: "FAIL",
    command:
      "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C11",
  },
  {
    id: "S1-C12",
    slice: "slice-1",
    title:
      "Final closure follows all task and joined-suite receipts; preserved and archived trees and installed payload bytes agree",
    kind: "real-disk",
    file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
    expected_today: "FAIL",
    command:
      "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C12",
  },
  {
    id: "S1-C13",
    slice: "slice-1",
    title:
      "The pinned acceptance release binds owning run, exact frozen source, real artifacts and installed readbacks",
    kind: "real-disk",
    file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
    expected_today: "FAIL",
    command:
      "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C13",
  },
  {
    id: "S1-C14",
    slice: "slice-1",
    title:
      "A non-builder probe binds a live server, dirty fixture, actual preparation events and unchanged index bytes at the declared cadence",
    kind: "real-disk",
    file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
    expected_today: "FAIL",
    command:
      "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C14",
  },
  {
    id: "S1-G01",
    slice: "slice-1",
    title:
      "Guard: installed Mac executable/version and loopback server are alive; this is not payload-integrity or UI acceptance",
    kind: "guard",
    file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
    expected_today: "PASS",
    command:
      "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-G01",
  },
];

// ---------- preconditions ----------
export const P0: Precondition = {
  id: "release-0.0.56-closed",
  what: "Release 0.0.56 (built from main at fa95283df6 by the release seat) is terminal: the highest-numbered attempt of its final step rewind-live-proof has a receipt row reading passed and its run folder carries Release-Closure.md, or a sibling folder starting release-0-0-56-aborted carries a README naming the run; and no ship-tool process is running. The move and every pipeline mutation never run under a release in flight, because the pipeline builds in a sibling of the checkout it would be moving.",
  command: `node -e 'const fs=require("fs");const {execSync}=require("child_process");const root="${EVIDENCE_ROOT}";const d=root+"/release-0-0-56/";let terminal=false;if(fs.existsSync(d)){const f=fs.readdirSync(d).map(x=>/^rewind-live-proof\\.attempt-(\\d+)\\.json$/.exec(x)).filter(Boolean).sort((a,b)=>Number(b[1])-Number(a[1]));if(f.length){const j=JSON.parse(fs.readFileSync(d+f[0][0],"utf8"));terminal=j.row?.outcome==="passed"&&fs.existsSync(d+"Release-Closure.md")}}const aborted=fs.readdirSync(root).filter(x=>x.startsWith("release-0-0-56-aborted")).some(x=>fs.existsSync(root+"/"+x+"/README.md"));let running="";try{running=execSync("pgrep -f throughline-ship/dist/cli.js",{encoding:"utf8"}).trim()}catch{}process.exit((terminal||aborted)&&!running?0:1)'`,
  expect: "exit 0",
};

// ---------- slices ----------
CHECKS.push({
  id: "S1-M01",
  slice: "slice-1",
  title:
    "Intermediate physical move is bound to repository identity and mapped worktrees, without demanding later cleanup",
  kind: "real-disk",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
  expected_today: "FAIL",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --stage moved --only S1-M01",
});
CHECKS.push({
  id: "S1-A01",
  slice: "slice-1",
  title:
    "Prior release terminal evidence names the exact run and latest attempt; process absence is never the release lock",
  kind: "real-disk",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
  expected_today: "FAIL",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-A01",
});

CHECKS.push({
  id: "S1-F01",
  slice: "slice-1",
  title:
    "Disposable slice-1 counterexample fixtures preserve all original checks and exercise both polarities",
  kind: "unit",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/test-slice-1-checks.mts",
  expected_today: "PASS",
  command: "node checks/test-slice-1-checks.mts",
});

const ORIGINAL_SLICES: Slice[] = [
  {
    id: "slice-1",
    n: 1,
    title:
      "The repository move: ThroughLine out of the vault, builds outside it, one pipeline from the new home",
    serves: ["NG-122", "NG-199", "NG-120", "NG-131", "NG-127"],
    state: "detailed",
    depends_on: [],
    precondition: {
      id: "release-0.0.56-closed",
      what: "Release 0.0.56 is terminal by the exact latest-attempt closed/aborted receipt. An abort names that run and attempt and its timestamp; a prefix README or pgrep failure never admits work. The same owned move/release record supplies exclusion and later frozen/moved/closed state.",
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-A01",
      expect: "exit 0",
    },
    why_this_order:
      "Ryan decided it on Oct 7, 2026: every later slice ships through the new pipeline, so the pipeline must exist at the new home before anything else is built.",
  },
  {
    id: "slice-2",
    n: 2,
    title:
      "The seam: one fork namespace, a committed manifest of every upstream edit, a count that only falls, feature tests a sync must keep green",
    serves: ["NG-123", "NG-124", "NG-125", "NG-126", "NG-130", "NG-131"],
    state: "outline",
    depends_on: ["slice-1"],
    why_this_order:
      "Every slice after this one edits the fork; the manifest and the count check must exist first so each edit is counted on its seam side and the upstream-edit count can only fall.",
  },
  {
    id: "slice-3",
    n: 3,
    title:
      "Phase 4 entry: fresh upstream reconciliation, then one admission point and the Absurd record",
    serves: [
      "NG-007",
      "NG-008",
      "NG-009",
      "NG-010",
      "NG-011",
      "NG-012",
      "NG-015",
      "NG-112",
      "NG-137",
      "NG-027",
    ],
    state: "outline",
    depends_on: ["slice-2"],
    why_this_order:
      "T3.07 is the first Phase 4 task after the 0.0.60 source/release foundation and seam proof. The admission/schema tasks depend on it; storage, identity and launcher follow transitively. The substrate is the whole design; the three doors that skip the rail today (HTTP dispatch, the comsnet handler, the importer) close here, and every later binding writes through this point.",
  },
  {
    id: "slice-4",
    n: 4,
    title: "One Absurd Postgres on the tower over the tailnet; the Mac keeps none",
    serves: ["NG-016", "NG-066", "NG-008", "NG-128"],
    state: "outline",
    depends_on: ["slice-3"],
    why_this_order:
      "Once every write goes through the admission point, the record can move to the tower without a second write path to migrate.",
  },
  {
    id: "slice-5",
    n: 5,
    title:
      "Identity: one public id, native ids as aliases, the sender on every message, one address format, the identity join",
    serves: ["NG-055", "NG-056", "NG-057", "NG-058", "NG-059", "NG-060", "NG-061"],
    state: "outline",
    depends_on: ["slice-3"],
    why_this_order:
      "Targets, messaging and thread families all key on these ids; they are columns on the record slice 3 creates.",
  },
  {
    id: "slice-6",
    n: 6,
    title: "The launcher and one Linux account per agent on the tower; the Mac adapter",
    serves: [
      "NG-062",
      "NG-067",
      "NG-068",
      "NG-069",
      "NG-070",
      "NG-197",
      "NG-116",
      "NG-050",
      "NG-054",
    ],
    state: "outline",
    depends_on: ["slice-4", "slice-5"],
    why_this_order:
      "The launcher writes the identity join (slice 5) and the socket endpoint depends on kernel-authenticated accounts; Ryan installs the root-owned supervisor once.",
  },
  {
    id: "slice-7",
    n: 7,
    title:
      "ComsNet socket messaging on the rail: the envelope, four tools, kernel-authenticated peers, the MCP comsnet retired",
    serves: [
      "NG-017",
      "NG-018",
      "NG-019",
      "NG-020",
      "NG-021",
      "NG-022",
      "NG-023",
      "NG-024",
      "NG-026",
      "NG-027",
      "NG-028",
      "NG-043",
      "NG-088",
      "NG-195",
    ],
    state: "outline",
    depends_on: ["slice-6"],
    why_this_order:
      "Peers are found across accounts and authenticated by the kernel, so the accounts must exist; the message is a task and its reply a result, so the admission point must exist.",
  },
  {
    id: "slice-8",
    n: 8,
    title:
      "The ThroughLine Claude mod: binding, compaction and re-entry (folds the Opus seat's lite-lifecycle design)",
    serves: [
      "NG-044",
      "NG-045",
      "NG-046",
      "NG-047",
      "NG-048",
      "NG-049",
      "NG-053",
      "NG-196",
      "NG-131",
    ],
    state: "outline",
    depends_on: ["slice-7"],
    why_this_order:
      "The mod registers the four coms tools and writes every row through the admission point; both exist after slice 7. Compaction comes back on in this slice.",
  },
  {
    id: "slice-9",
    n: 9,
    title:
      "Targets and JEV: the target as an Absurd task, JEV before a target is saved, finished computed, check-first enforced",
    serves: [
      "NG-073",
      "NG-074",
      "NG-075",
      "NG-076",
      "NG-077",
      "NG-078",
      "NG-079",
      "NG-080",
      "NG-081",
      "NG-083",
      "NG-084",
      "NG-085",
      "NG-086",
      "NG-087",
      "NG-089",
      "NG-090",
      "NG-091",
      "NG-092",
      "NG-093",
      "NG-138",
      "NG-139",
    ],
    state: "outline",
    depends_on: ["slice-5", "slice-7"],
    why_this_order:
      "A target is a task on the record keyed by the public id; JEV rides the messaging rail.",
  },
  {
    id: "slice-10",
    n: 10,
    title:
      "Threads and the app: rewind on every device and provider, families and lineage, what waits on Ryan, copy ids, the terminal tool, voice, Agent Instruments folded",
    serves: [
      "NG-094",
      "NG-095",
      "NG-096",
      "NG-097",
      "NG-098",
      "NG-100",
      "NG-101",
      "NG-103",
      "NG-104",
      "NG-105",
      "NG-106",
      "NG-107",
      "NG-108",
      "NG-109",
      "NG-110",
      "NG-111",
      "NG-113",
      "NG-114",
      "NG-115",
      "NG-180",
      "NG-187",
      "NG-192",
      "NG-198",
      "NG-013",
      "NG-014",
    ],
    state: "outline",
    depends_on: ["slice-5", "slice-7"],
    why_this_order:
      "Thread families, lineage columns and waits read the record and the ids; Agent Instruments folds as waits and subscriptions only once the rail carries replies.",
  },
  {
    id: "slice-11",
    n: 11,
    title:
      "Provider binding: Pi bound the way the lab bound it, Codex through its approvals, the picker shows the model that answers, model calls through the access broker",
    serves: [
      "NG-029",
      "NG-030",
      "NG-031",
      "NG-032",
      "NG-033",
      "NG-034",
      "NG-035",
      "NG-036",
      "NG-037",
      "NG-038",
      "NG-039",
      "NG-040",
      "NG-041",
      "NG-132",
      "NG-133",
    ],
    state: "outline",
    depends_on: ["slice-3", "slice-8"],
    why_this_order:
      "Each provider binds to the admission point; Claude's binding is the mod (slice 8), so the other two follow the same core.",
  },
  {
    id: "slice-12",
    n: 12,
    title:
      "Durability, pairing and the outside tools: every service survives a reboot and is watched, pairing without Tailscale, logins renew, every outside tool folded, kept or retired",
    serves: ["NG-128", "NG-129", "NG-131", "NG-114", "NG-142"],
    state: "outline",
    depends_on: ["slice-6"],
    why_this_order:
      "The watched-watchers requirement covers the new units slice 6 adds; the outside-tools table closes once the mod, the CLI and the pipeline exist.",
  },
  {
    id: "slice-13",
    n: 13,
    title: "One version from one commit on Mac, tower, iOS and Android; Raspberry Pi deferred",
    serves: ["NG-119", "NG-118", "NG-120", "NG-121"],
    state: "outline",
    depends_on: ["slice-2", "slice-12"],
    why_this_order:
      "Ryan's done state: installed from a single commit on the Mac, the tower, the Raspberry Pi, iOS and Android. Android rides the pipeline once every other slice ships through it.",
  },
];
export const SLICES: Slice[] = ORIGINAL_SLICES.map((s) => ({ ...s, state: "detailed" }));

// ---------- slice 1 tasks (detailed: files, signatures, checks fixed by Fable; revised after judge round 1, Oct 7, 2026) ----------
const T1: Task[] = [
  {
    id: "T1.01",
    fork_state: [
      {
        ref: "f030dbe543",
        disposition: "keep",
        reason:
          "Retain the installed 0.0.56 version stamp as history and rollback baseline; a future slice release must stamp its own new version.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "2a1cc95b1c",
        disposition: "keep",
        reason:
          "Retain source/installed-release ancestry; first-parent delta is only six version surfaces, not a fresh implementation batch.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "a5429f8466",
        disposition: "keep",
        reason:
          "Retain installed-version ancestry and version metadata; no new architecture is implemented by this merge.",
        source: "G5-Fork-State.json A.main_commits",
      },
    ],
    starting_state: {
      source:
        "G5-Fork-State.json section C and E, Codex seat thread 01a122f8-7b1a-7cf2-9ce9-f19f7429cc89, written 2026-10-09T23:32:01Z",
      move_base: {
        sha: "47065c2a65f0265fb9c6ccfaa7f4574e0c1fd193",
        tree: "6d0ad78833faaefd33c40749b7cdeb5a1c49483b",
        rule: "Start the filesystem repository move from this exact main tip, not fa95283df6, f03e6ad350, or release/0.0.56. Preserve all 38 intervening commits and side refs; apply reviewed missing branch deltas/reworks after the move. This is a preservation base, not a typecheck-green or installable candidate.",
      },
      not_the_base: ["fa95283df6 (design start)", "f03e6ad350", "release/0.0.56"],
      installed_mac: {
        version: "0.0.56",
        release_source_ref: "release/0.0.56",
        release_source_sha: "f030dbe5439fab3442b2b89078f2590a4995864d",
      },
      next_release: {
        value: "0.0.60",
        why: "0.0.57 and 0.0.58 already have distinct release refs and attempted pipeline records; 0.0.59 is already a reserved candidate/watch/type-repair release identity. Do not recycle an interim number just because no installation was accepted.",
      },
      interim_candidates: [
        {
          branch: "release/0.0.57",
          sha: "af60be0f620fdb9441d233f6dcce1461f452b796",
          action:
            "Archive as abandoned, uninstalled candidate after fingerprint/backup; preserve its source/receipt lineage.",
        },
        {
          branch: "release/0.0.58",
          sha: "42ae55f982624a3daac3e1d1f07324668c2d9ca1",
          action:
            "Archive as abandoned, uninstalled candidate after fingerprint/backup; preserve its source/receipt lineage.",
        },
        {
          branch: "release/0.0.59",
          sha: null,
          action:
            "Archive the observed 059 repair/watch/staging evidence as an abandoned candidate; do not invent or delete a nonexistent local release ref.",
        },
      ],
      typecheck_at_move_base: {
        command: "pnpm typecheck (pipeline step tests)",
        result: "FAIL",
        first_error:
          "src/rpc.test.ts(58,11): error TS2353: Object literal may only specify known properties, and 'future_field' does not exist in type '{ readonly protocol_version: number; readonly release: string; readonly commit: string | null; readonly platform: string; readonly capabilities: readonly string[]; readonly last_cursor: number | null; }'.",
        fix_carried_by:
          "rpc.test.ts unknown-field decode correction on upgrade/hello-absurd-types-059-20261009 and upgrade/hello-typecheck-059-20261009 (G5 rework rows, T3.04 and T3.05)",
      },
      worker_branches:
        "Many upgrade branches are unmerged by SHA even though their patches were manually composed or cherry-picked into main; git cherry equivalence is recorded and must not be confused with missing functionality. A different patch ID also does not prove the functionality is absent. Never merge all old worker branches into the move base.",
    },
    slice: "slice-1",
    title: "Freeze and fingerprint the state the move starts from",
    serves: ["NG-122", "NG-120"],
    detail_state: "detailed",
    what: "Record, before anything moves, the exact state of the fork at /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream and of the installed Mac app, as data every later check compares against: HEAD; every branch and tag with its tip; every worktree with its path, branch, head, a clean status and its ignored entries; how far main is ahead of origin; the exact origin URL; the installed app's version and the SHA-256 of its main executable; and SHA-256 tree fingerprints of the two release worktrees' release/ subtrees and of every build output under the evidence root and the old backup root. Write Move-Record.json under the component's _meta folder; it is a record and never ships. Nothing is moved or removed in this task.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Move-Record.json",
        side: "vault",
        action: "add",
        note: "a record under _meta; stays in the vault; never copied into the repository",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream",
        side: "host-filesystem",
        action: "read",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/disk-archive.ts",
        side: "outside-tool",
        action: "read",
        note: "treeManifest(root, excluded?, nodes?) returns { sha256, file_count, symlink_count, entry_count, bytes, latest_mtime_ms }",
      },
    ],
    signatures: [
      "Move-Record.json schema throughline.move-record.v1: admission_state frozen|moved|closed; admitted_release; release_in_flight run id; started_at; head/origin_url/origin_ahead; complete branches {name,sha}, tags {name,object_sha,peeled_commit}, clean worktrees including ignored entries and explicit worktree_mapping {before,after,branch,frozen_head}; repository_identity {device,inode} captured from the common Git directory lstat so a replacement clone cannot stand in for the moved repository; installed_app {version,payloads:[{path,sha256}]} includes executable AND Contents/Resources/app.asar.",
      "Every fingerprint carries the owning treeManifest sha256/file_count/symlink_count/entry_count/bytes, source path, and disposition moved-and-preserved with target OR archived-and-removed with exact recorded rpi: archive address. The retained installed-release build moves intact and needs a preserved fingerprint, not a fabricated archive receipt. No secret file contents are read; retained secret residue prevents deletion.",
      "frozen_inventory {path,sha256}: save actual argv, exit code, output paths/hashes and command-derived head/origin/branches/tags/worktrees/fingerprints. Compare its complete lists to the move record; main branch sha equals frozen head; all numeric counts are finite/nonnegative. Freeze precedes any backup/move act.",
      "old_paths and new_paths, all six keys required: home /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream → /Users/Admin/throughline; release_checkout /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream-{release} → /Users/Admin/throughline-worktrees/{release}; backup_root /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_versions → /Users/Admin/throughline-worktrees/_versions; tower_remote_root /home/twr/build/workbench/infra/t3code/t3-{release} → /home/twr/build/throughline/{release}; rpi_remote_root /home/rpi/build/workbench/infra/t3code/t3-{release} → /home/rpi/build/throughline/{release}; spec_folder /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07 → /Users/Admin/throughline/docs/throughline/next-gen-spec",
      "refused with MOVE_RECORD_DIRTY_WORKTREE when any worktree's git status --porcelain=v1 --untracked-files=all is nonempty: the record is not written and nothing downstream starts",
    ],
    failing_checks: ["S1-C09"],
    done_when: {
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C09",
      expect: "exit 0",
    },
    depends_on: [],
    executor: {
      role: "implementer-light",
      model_preference: "claude-opus-5-5",
      effort: "medium",
    },
    risk: ["read-only"],
    rollback: "none needed; the task writes one JSON file under _meta",

    command_grammar: "IC-002",
  },
  {
    id: "T1.02",
    slice: "slice-1",
    title: "Push every frozen ref to origin so the repository is backed up before it moves",
    serves: ["NG-122", "NG-120"],
    detail_state: "detailed",
    what: "The main branch is already on origin at 7a0a75f18f (dated observation Oct 8, 2026, 3:40 AM PDT); this is not a claim about every ref. The release/0.0.47 through release/0.0.51 branches, archive branches and tags were not yet backed up at that observation. After T1.01 freezes the exact complete inventory, use its pinned branch/tag objects for backup and save current live remote readback, including annotated tag-object and peeled commit identities. Object acquisition belongs to this preparation task, never to an acceptance check. No historical observation becomes an unmeasured current invariant.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream",
        side: "host-filesystem",
        action: "run",
        note: "git push only; no file edits",
      },
    ],
    signatures: [
      "git -C /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream push origin main --follow-tags",
      "git -C /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream push origin 'refs/heads/release/*:refs/heads/release/*' 'refs/heads/archive/*:refs/heads/archive/*'",
      "verify live: git -C /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream ls-remote --heads --tags origin lists every branch and tag in Move-Record.json with the recorded sha",
      "The acceptance query uses git ls-remote --heads --tags origin read-only. Record tag object sha separately from peeled commit; acquire missing remote objects in preparation, then compare pinned ancestry without fetch during judgment.",
    ],
    failing_checks: ["S1-C04"],
    done_when: {
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C04",
      expect: "exit 0",
    },
    depends_on: ["T1.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [
      "github-write-credential: the push needs write access to ryankschmidt/t3code; if the Mac holds no git credential for it, the credential is the access broker's and the push is a broker operation, never a token handed to the seat",
    ],
    rollback: "none needed; a push adds refs; git push origin --delete <ref> removes a wrong one",

    command_grammar: "IC-002",
  },
  {
    id: "T1.04",
    fork_state: [
      {
        ref: "upgrade/observer-http-20261009",
        disposition: "rework",
        reason:
          "Keep observer cache guards, but move waiting to record admission and port the mixed packaging/throughline-ship-source RPi unit checks to the owning ship-tool source/new release contract instead of AF60/0.0.57 constants.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-1",
    title:
      "Re-point the release pipeline and ship the release tool 0.4.1 or later: new home, worktrees collection, build outputs beside the release, evidence records only, a hold while a move is open",
    serves: ["NG-122", "NG-120", "NG-121"],
    detail_state: "detailed",
    what: "The pipeline definition and the ship tool assume the fork sits in the vault, that a release checkout is a sibling of the main checkout, and that build outputs (the Xcode archive, the IPA export, the simulator's derived data, installers) land in the evidence folder. Change the definition to the new addresses; change the tool so a release checkout is created inside the worktrees collection, every build output lands under the release checkout's own ignored release/ folder, and every evidence write goes through one guarded function that refuses a build output; add the two steps vault-clean (after preflight) and publish-docs (after the Mac install) as complete step records; make preflight refuse frozen/closed state, another active run, an unadmitted release or a missing checkout; moved state admits the pinned acceptance release before final closure. Ship the tool as 0.4.1 or later through the Ship Warden inbox (Ship Warden binds one payload per version; 0.4.0 shipped with a scanner defect and the corrected payload ships as 0.4.1). Authoring and tests may run any time; the Warden ship and the pipeline edit run only after release 0.0.56 is closed, because the running pipeline reads the installed tool and the definition. The pipeline definition records, beside the operator-presence step, that its scope is the routine install quit only; no step of the slice-1 release is changed by this note. Node selection (Oct 9, 2026): on the Mac, the tests and build steps select node 24.13.1 through the existing Step.environment PATH field, with /Users/Admin/.nvm/versions/node/v24.13.1/bin first; the tower and the Raspberry Pi keep their host node.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-contracts.mts",
        side: "vault",
        action: "edit",
        exists_now: true,
        note: 'admissionAllowed today refuses a closed record; it admits any release once closed, and checks/test-slice-1-checks.mts changes its "frozen and closed refuse" case to the three cases of T1.04-closed-next-release.',
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Pipeline.json",
        side: "config",
        action: "edit",
        note: "every field named in the signatures below; nothing else",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/core.ts",
        side: "outside-tool",
        action: "edit",
        note: "Pipeline type gains forbidden_roots, move_record, vault_copy and source.worktrees_root; validatePipeline keeps its signature and gains the containment refusals",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/release-source.ts",
        side: "outside-tool",
        action: "edit",
        note: "prepareRelease gains worktreesRoot and forbiddenRoots; the sibling rule becomes the collection rule",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/phone.ts",
        side: "outside-tool",
        action: "edit",
        note: "archive and export under buildRoot/phone; evidence receives phone-manifest.json through evidenceFile",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/tower.ts",
        side: "outside-tool",
        action: "edit",
        note: "line 8: the remote_root prefix check becomes /home/twr/build/throughline/",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/rpi.ts",
        side: "outside-tool",
        action: "edit",
        note: "line 28: the remote_root prefix check becomes /home/rpi/build/throughline/",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/cli.ts",
        side: "outside-tool",
        action: "edit",
        note: "buildRoot, the {build_root} and {remote_root} replacements, the two preflight refusals, internal-step vault-clean and publish-docs, every evidence write through evidenceFile",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/snapshot.ts",
        side: "outside-tool",
        action: "edit",
        note: "unchanged behavior; its mkdirSync(root) is what creates the new backup root on first use",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/evidence-guard.ts",
        side: "outside-tool",
        action: "add",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/publish-docs.ts",
        side: "outside-tool",
        action: "add",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/release-source.test.ts",
        side: "outside-tool",
        action: "edit",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/core.test.ts",
        side: "outside-tool",
        action: "edit",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/phone.test.ts",
        side: "outside-tool",
        action: "edit",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/cli.test.ts",
        side: "outside-tool",
        action: "edit",
        note: "the two preflight refusals",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/evidence-guard.test.ts",
        side: "outside-tool",
        action: "add",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/publish-docs.test.ts",
        side: "outside-tool",
        action: "add",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/TOOL.md",
        side: "outside-tool",
        action: "edit",
        note: "version 0.4.1 or later; the two new steps and the two refusals documented",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/package.json",
        side: "outside-tool",
        action: "edit",
        note: "version 0.4.1 or later",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/runtime-targets.json",
        side: "outside-tool",
        action: "edit",
        note: "version 0.4.1 or later; dist/evidence-guard.js and dist/publish-docs.js listed as payload",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/CHANGELOG.md",
        side: "outside-tool",
        action: "edit",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/rewind-proof.ts",
        side: "outside-tool",
        action: "edit",
        note: "named evidence-write guard and relocated build-artifact consumers; owning component source only",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/report-gate.ts",
        side: "outside-tool",
        action: "edit",
        note: "named evidence-write guard and relocated build-artifact consumers; owning component source only",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/capability-steps.ts",
        side: "outside-tool",
        action: "edit",
        note: "named evidence-write guard and relocated build-artifact consumers; owning component source only",
      },
    ],
    signatures: [
      'Ship-Pipeline.json field changes, exact: checkout = "/Users/Admin/throughline"; source.worktrees_root (new) = "/Users/Admin/throughline-worktrees"; source.release_checkout = "/Users/Admin/throughline-worktrees/{release}"; backup_root = "/Users/Admin/throughline-worktrees/_versions"; forbidden_roots (new) = ["/Users/Admin/core-root/vault"]; move_record (new) = "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Move-Record.json"; vault_copy (new) = { "destination": "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/references/repository", "patterns": ["README.md","AGENTS.md","CLAUDE.md","CONTRIBUTING.md","docs/**","apps/desktop/CHANGELOG.md","docs/throughline/next-gen-spec/**"], "exclude": ["**/_meta/**"] }; tower.remote_root = "/home/twr/build/throughline/{release}"; rpi.remote_root = "/home/rpi/build/throughline/{release}"; the inline ssh commands of gate-tower and install-tower (today lines 278 and 557) use {remote_root} in place of the literal path; build-phone-simulator -derivedDataPath = "{build_root}/phone-simulator-derived"; capture-phone app path = "{build_root}/phone-simulator-derived/Build/Products/Release-iphonesimulator/ThroughLine.app"; install-phone IPA path = "{build_root}/phone/export/ThroughLine.ipa"; source.upstream_mode_by_release gains "0.0.60": "preserve-base"; source.carry_branches drops "upgrade/ship-fallback-057-af60" (a stamp-only abandoned candidate; G5 revert row) and must not carry any 0.0.57 or 0.0.58 version stamp; required_steps gains "vault-clean" after "preflight" and "publish-docs" after "install-mac"; upstream-sync.requires = ["vault-clean"]; restart-courtesy.requires = ["publish-docs"]',
      'step record, complete: { "id": "vault-clean", "action": "execute", "platform": "fork", "kind": "rehearsal", "privilege": "none", "capabilities": ["read-vault"], "gate": "No build output (installer, archive, object file, derived data or node_modules tree) sits under the evidence root, the retired vault backup root or the retired t3code folder; symlinks and unreadable entries are findings", "command": ["node", "/Users/Admin/core-root/src/tools/throughline-ship/dist/cli.js", "internal-step", "vault-clean"], "requires": ["preflight"] }',
      'step record, complete: { "id": "publish-docs", "action": "execute", "platform": "fork", "kind": "parity-proof", "privilege": "none", "capabilities": ["write-vault-copy"], "gate": "The declared repository documents from the frozen source commit are copied into the vault copy folder with generated frontmatter and a manifest whose commit equals the frozen commit and whose release equals {release}", "command": ["node", "/Users/Admin/core-root/src/tools/throughline-ship/dist/cli.js", "internal-step", "publish-docs"], "requires": ["install-mac"] }',
      "internal-step vault-clean and internal-step publish-docs read the run context (release, evidence folder, checkout) exactly the way internal-step preflight reads it today; publish-docs reads the commit from source-commit.json in the evidence folder and fails with PUBLISH_NO_FROZEN_COMMIT when it is absent",
      'core.ts: interface Pipeline gains forbidden_roots: string[]; move_record: string; vault_copy: { destination: string; patterns: string[]; exclude: string[] }; source gains worktrees_root: string. validatePipeline(input: unknown): asserts input is Pipeline keeps its signature and adds: forbidden_roots must be a nonempty array of absolute paths containing "/Users/Admin/core-root/vault" (INVALID_PIPELINE_FORBIDDEN_ROOTS); for each of checkout, source.worktrees_root, source.release_checkout with {release} replaced by "0.0.0", backup_root (build/checkout/backup roots only; move_record and evidence are allowed record-class paths): contained(path, root) for any forbidden root throws PIPELINE_PATH_UNDER_FORBIDDEN_ROOT(<field>, <path>); contained(a, b) = canonical(a) === canonical(b) || canonical(a).startsWith(canonical(b) + sep), canonical(p) resolves the nearest existing ancestor with realpathSync.native then rejoins the missing suffix; lstat/realpath failure on an existing, inaccessible or broken alias refuses; source.worktrees_root contained in checkout or checkout contained in source.worktrees_root throws PIPELINE_WORKTREES_ROOT_NESTED; vault_copy.destination must be absolute and inside "/Users/Admin/core-root/vault" (INVALID_PIPELINE_VAULT_COPY)',
      "release-source.ts: export function prepareRelease(repo: string, base: string, version: string, destination: string, worktreesRoot: string, forbiddenRoots: string[]): string — throws RELEASE_DESTINATION unless canonical(destination) === join(canonical(worktreesRoot), version); throws WORKTREES_ROOT_NESTED when canonical(worktreesRoot) is contained in canonical(repo), canonical(repo) is contained in canonical(worktreesRoot), or canonical(worktreesRoot) is contained in any forbidden root (same contained and canonical as core.ts); otherwise unchanged (branch release/<version>, worktree add from base, RELEASE_CHECKOUT_MISMATCH on reuse)",
      'evidence-guard.ts: export const BUILD_EXTENSIONS = [".dmg",".ipa",".AppImage",".tar",".tar.gz",".tgz",".tar.xz",".zip",".pkg",".xip",".o",".a",".pcm",".swiftmodule",".blockmap",".deb",".dia",".hmap",".stringsdata"] as const; export const BUILD_DIR_MARKERS = [".xcarchive",".app","node_modules","__node_modules","phone-simulator-derived","phone-export","DerivedData","Intermediates.noindex","dist-electron"] as const; export function isBuildOutput(path: string): boolean — true when any path segment equals a marker or the basename ends with any extension (compound suffixes such as .tar.gz included); export function evidenceFile(evidenceRoot: string, relative: string): string — throws EVIDENCE_PATH_ESCAPE when relative is absolute, contains a ".." segment, or resolve(evidenceRoot, relative) is not contained in evidenceRoot; throws EVIDENCE_BUILD_OUTPUT(<relative>) when isBuildOutput(relative); returns join(evidenceRoot, relative); export function vaultBuildOutputs(roots: string[]): { path: string; reason: "build-output" | "symlink" | "unreadable" }[] — walks every root without following symlinks; a symlink is a finding, an unreadable entry is a finding, nothing is skipped',
      'publish-docs.ts: export function publishDocs(o: { repo: string; commit: string; release: string; patterns: string[]; exclude: string[]; destination: string; publishedAt: string }): { manifest: string; files: number } — source set = git ls-tree -r --name-only <commit> matched by the union of patterns (each path once) minus every path matching exclude; PUBLISH_EMPTY_SET when empty; content = git show <commit>:<path>; for a *.md source that begins with "---\\n", parse its YAML mapping, preserve author title/description/type/status/created/last_updated, and always refresh source_repository/source_path/source_commit/release from the current publication; serialized transformed bytes are deterministic and independently checked, otherwise a block is prepended: title (the first H1 text, else the file name), description ("Copied from the ThroughLine repository at release <release>, path <path>" when the source has none), type: reference, status: active, created and last_updated (the commit\'s author date as YYYY-MM-DD), source_repository: "https://github.com/ryankschmidt/throughline.git", source_path, source_commit, release; layout: destination/README.md (generated: "repository holds the vault-visible copies of the ThroughLine repository\'s documents at release <release>; it does not hold source, builds or records", with the manifest summary), destination/repository.json, destination/tree/<source path>; writes everything into a sibling destination.pending-<uuid>, then renames the current destination to destination.previous-<uuid> and the pending folder to destination, and removes the previous folder only after the rename succeeded; after a first-rename failure restore previous to destination; after a second-rename failure move any newly installed generation back to its sibling pending path and restore previous; keep the old generation until both renames and verification pass, including first publication; PUBLISH_DESTINATION_SYMLINK when destination or any existing parent is a symlink; PUBLISH_PATH_ESCAPE when a source path contains ".." or starts with "/"; repository.json = { schema: "throughline.repository-copy.v1", release, commit, published_at, patterns, exclude, files: { path: "tree/<source path>", source_path, sha256 (of the written bytes) }[] }',
      'cli.ts: buildRoot = join(checkout, "release"); the replacements map gains "{build_root}": buildRoot and "{remote_root}": the host\'s remote_root with {release} replaced; preflight refuses MOVE_IN_PROGRESS(<move_record>) when the owned admission record is frozen, when it is moved and the release differs from admitted_release, or when another run holds release_in_flight; the moved state admits only the pinned acceptance release before final completion; once T1.07 sets the record closed, every normal later release is admitted and admitted_release no longer restricts it, and PIPELINE_CHECKOUT_MISSING(<checkout>) when pipeline.checkout is not a directory; internal-step vault-clean → vaultBuildOutputs([pipeline.evidence_root, "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_versions", "/Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code"]) must be empty, else outcome failed listing every finding (uncapped) in the step log; internal-step publish-docs → publishDocs({ repo: checkout, commit: frozen.commit, release, patterns: pipeline.vault_copy.patterns, exclude: pipeline.vault_copy.exclude, destination: pipeline.vault_copy.destination, publishedAt: now })',
      'pinned unit tests, by title: "prepareRelease refuses a destination outside the worktrees collection"; "prepareRelease refuses a worktrees root nested in the repository, containing it, or under a forbidden root"; "validatePipeline refuses a checkout equal to or under a forbidden root, after symlink resolution"; "validatePipeline refuses a worktrees root nested in the checkout"; "phone build writes the archive and export under the build root and only phone-manifest.json under evidence"; "evidenceFile refuses every build extension, every directory marker, a compound suffix and a path escape"; "vaultBuildOutputs reports a symlink and an unreadable entry as findings"; "every evidence write goes through evidenceFile"; "publishDocs copies exactly the declared set, keeps existing frontmatter, prepends frontmatter otherwise, excludes _meta, refuses a symlinked destination, and leaves the old copy untouched on failure"; "preflight refuses while a move record is open and when the checkout is missing"',
      "Evidence guards are behavioral: exercise a real write with a nonexistent leaf under an existing symlinked parent and refuse any physical escape/build output. Static greps are supporting evidence, never proof. Record destinations stay under the owning records boundary; no build artifact is allowed there.",
      "tower.ts TowerBuild gains build_root: absolute local authoring/build output. towerBuildCommands writes source.tar under build_root/tower/source.tar and retrieves ThroughLine-<release>-x86_64.AppImage under build_root/tower/, with the frozen commit and remote_root. rpi.ts rpiBuildCommands gains build_root and writes rpi-source.tar under build_root/rpi/; it writes and transfers no rpi-coms-net.tar, and tower.ts drops its coms-net presence check, because the repository carries @ryan/agent-mcp-relay as apps/server/vendor/agent-mcp-relay-0.3.0.tgz with a file: specifier and installs by itself on every host (decision D3); CLI producers, scp consumers, install/capability/report readbacks consume those exact locations. evidence receives only manifests/receipts. No additional system cluster, account or installation is added by this contract repair.",
      "capture-phone retains the existing t3code/src/ios-simulator-gate/run-gate.mts helper, consuming the new simulator app path. testflight-readback retains t3code/src/apple-signing/asc-testflight.mts with verify-build marketing-version/build-number arguments; it has no IPA argument. Retained helper sources are distinguished from the retired t3-upstream checkout, not indiscriminately forbidden.",
      "A real component-owned rehearsal executes the exact complete vault-clean and publish-docs step records and prescribed positive pipeline. Save pipeline/core payload hashes, actual argv/exit/output hashes, nonzero measured cases and executed step ids in pipeline_rehearsal; empty rc=0 evidence fails. Frozen-stage validation does not require later cleanup or final completion.",
    ],
    planned_checks: [
      {
        id: "T1.04-closed-next-release",
        kind: "contract-test",
        command:
          "preflight against a move record with admission_state closed and release 0.0.61, no run in flight; then against admission_state moved with release 0.0.61",
        expect:
          "closed: admitted; moved: MOVE_IN_PROGRESS because 0.0.61 differs from admitted_release; frozen: MOVE_IN_PROGRESS for any release",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["S1-C05"],
    done_when: {
      command:
        "cd /Users/Admin/core-root && pnpm -C /Users/Admin/core-root install --frozen-lockfile >/dev/null && pnpm -C /Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship run test && node /Users/Admin/throughline/docs/throughline/next-gen-spec/checks/slice-1-repository-move.mts --stage frozen --only S1-C05",
      expect:
        "tests green and exit 0; the installed copy at /Users/Admin/core-root/src/tools/throughline-ship reads 0.4.1 or later after the Ship Warden ship",
    },
    depends_on: ["T1.01", "release-0.0.56-closed"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6-astra",
      effort: "medium",
    },
    risk: [
      "ship-warden-lane: the tool reaches /Users/Admin/core-root/src/tools/throughline-ship only through the warden inbox request; a version mismatch across TOOL.md, package.json and runtime-targets.json is refused",
      "hold: once the pipeline points at the new home and the checkout does not exist yet, every release attempt refuses with PIPELINE_CHECKOUT_MISSING until T1.03 moves the repository and atomically admits the moved state; that window is deliberate",
    ],
    rollback:
      "git revert of the tool commits in core-root (path-limited) and a Ship Warden ship of the previous version; Ship-Pipeline.json restored from the core-root history",

    command_grammar: "IC-002",
  },
  {
    id: "T1.03",
    slice: "slice-1",
    title:
      "Move the repository to /Users/Admin/throughline and the installed release's worktree into /Users/Admin/throughline-worktrees; retire the previous release's worktree without losing a byte",
    serves: ["NG-122"],
    detail_state: "detailed",
    what: "Rename the main checkout out of the vault in one filesystem move on the same volume (node_modules travel with it), repair the worktree pointers, move the worktree of the installed release into the worktrees collection, and retire the worktree of the previous release only after its build outputs are archived to the Raspberry Pi archive drive by the ship tool's own archive function and the whole worktree is proven clean. Add the boundary sentence the folder grammar requires to the repository's README (a file the fork already edits, so the upstream-edit count does not rise). The release worktree folders are 12 GB each and about 293,000 files each; the main checkout is 17 GB and 317,471 files (measured Oct 7, 2026). Worktree-Move-Annotations.jsonl preserves the frozen witness: dispositions bind moved, kept and retired worktrees, additions have their own freeze, and reviewed rebases append a chain from the frozen head to the current head. No old row is rewritten.",
    worktree_move_annotations: {
      path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Worktree-Move-Annotations.jsonl",
      schema: "throughline.worktree-move-annotation.v1",
      writer: "the move worker; append-only; Move-Record.json stays the immutable frozen witness",
      exact_keys: {
        disposition_row: {
          schema: '"throughline.worktree-move-annotation.v1"',
          kind: '"disposition"',
          before: "the frozen worktree path, equal to a Move-Record.json worktrees[].path",
          frozen_head: "the frozen head, equal to that entry's head (40 hex)",
          branch:
            "the frozen branch, equal to that entry's branch; null for a worktree frozen detached",
          fingerprint:
            "the Move-Record.json fingerprints[] entry for that path, copied exactly, when one exists; omitted otherwise",
          disposition: '"moved" | "retired-and-archived" | "kept"',
          after: "the worktree path now (required for moved)",
          archive:
            "the Archive-Annotations.jsonl container path (retired-and-archived: archive or retirement_receipt required)",
          retirement_receipt: "absolute path of the retirement receipt (retired-and-archived)",
          observed_at: "ISO time the row was written",
          evidence:
            "{command, output_path}: the command whose output shows the disposition, and where that output is saved",
        },
        addition_freeze_row: {
          schema: '"throughline.worktree-move-annotation.v1"',
          kind: '"addition-freeze"',
          path: "the post-freeze worktree path, under the worktrees collection",
          head: "its head at observed_at (40 hex)",
          branch: "its branch at observed_at; null when detached",
          observed_at: "ISO time of this freeze",
          reason: "why the worktree was created",
          evidence: "{command, output_path}",
        },
        rebased_row: {
          schema: '"throughline.worktree-move-annotation.v1"',
          kind: '"rebased"',
          path: "absolute current worktree path",
          previous_head: "40-hex head named by the preceding freeze/disposition or rebased row",
          new_head: "40-hex head after the reviewed rebase",
          review:
            "absolute path of an existing JSON review: verdict PASS and head exactly new_head",
          custody_evidence: "absolute path of an existing custody evidence file",
          observed_at: "ISO time the row was appended",
        },
      },
      coordination:
        "keys adopted from the move worker's proposal (execution/phase-03/delivery-2026-10-09/Worktree-Annotation-Census.json), with the lead's three dispositions; \"removed-with-reason\" is not a disposition",
      rules: [
        "each frozen worktree entry (path plus fingerprint) maps through a frozen row to its new path or disposition; the checks match frozen entries through it",
        "a worktree frozen as detached (branch null) is valid when it is still detached at the same head",
        "integration worktrees created after the freeze are additions with their own freeze row, not failures",
        "Rebase rows are appended in chain order; previous_head must equal the preceding bound head, each review must pass its exact new_head, and the newest rebase row must name the current HEAD. Never rewrite an old row or replace the freeze to hide a failed review.",
        "Unrebased branch worktrees retain the frozen-head ancestry check. A frozen detached worktree must stay detached at its bound head; a reviewed rebase chain binds its new exact head without changing branch or common-repository identity.",
        "The old-home compatibility symlink must resolve to repository.home while the move state is moved and must be physically gone when closed (T1.07). S1-C03, S1-M01 and S1-C06 enforce the same rule; no annotation may waive it.",
      ],
    },
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Worktree-Move-Annotations.jsonl",
        side: "vault",
        action: "add",
        note: "append-only worktree dispositions, addition freezes and reviewed rebase chains; the move worker writes these rows",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream",
        side: "host-filesystem",
        action: "move",
        note: "→ /Users/Admin/throughline",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream-0.0.56",
        side: "host-filesystem",
        action: "move",
        note: "→ /Users/Admin/throughline-worktrees/0.0.56 (the installed release; its release/ folder holds the current build outputs)",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream-0.0.51",
        side: "host-filesystem",
        action: "remove",
        note: "the previous release; its release/ outputs are archived by archiveTree, its node_modules (ignored, reproducible) removed, then git worktree remove without --force",
      },
      {
        path: "README.md",
        side: "upstream-edit",
        action: "edit",
        note: "a fork-owned block at the top: the boundary sentence; README.md is already fork-edited (8 lines against the merge-base)",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Archive-Ledger.jsonl",
        side: "vault",
        action: "add",
        note: "existing owning pretty-printed object-with-moves JSON; extension is historical, not a JSONL format",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/disk-archive.ts",
        side: "outside-tool",
        action: "read",
        note: "archiveTree(source, destination, ledger): Move — destination must start with /mnt/storage/archives/ (the function adds the rpi: host itself); it verifies SHA-256 trees, removes the verified non-secret files itself and returns status ARCHIVED_AND_REMOVED or ARCHIVED_NONSECRET_FILES_REMOVED_SECRET_PATHS_RETAINED; secret paths are retained",
      },
    ],
    signatures: [
      "mv /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream /Users/Admin/throughline",
      "git -C /Users/Admin/throughline worktree repair /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream-0.0.51 /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream-0.0.56",
      "mkdir -p /Users/Admin/throughline-worktrees && git -C /Users/Admin/throughline worktree move /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream-0.0.56 /Users/Admin/throughline-worktrees/0.0.56",
      "retire 0.0.51, in this order, each step refused on failure: (1) git -C /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream-0.0.51 status --porcelain=v1 --untracked-files=all must be empty (RETIRE_DIRTY); (2) git status --porcelain --ignored is recorded into the move record's worktree entry as ignored_entries and must contain only node_modules/ and release/ (RETIRE_UNKNOWN_IGNORED); (3) const move = archiveTree('/Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream-0.0.51/release', '/mnt/storage/archives/throughline-builds/0.0.51/release', '/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Archive-Ledger.jsonl') must return status ARCHIVED_AND_REMOVED; ARCHIVED_NONSECRET_FILES_REMOVED_SECRET_PATHS_RETAINED refuses the retirement (RETIRE_RESIDUE) and the retained paths are listed in the step log; (4) rm -rf /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream-0.0.51/node_modules; (5) git -C /Users/Admin/throughline worktree remove /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream-0.0.51 without --force; a refusal from git is the terminal state, never overridden",
      "git -C /Users/Admin/throughline worktree prune && git -C /Users/Admin/throughline worktree list --porcelain → main and the installed-release worktree are present; every other worktree is bound by its mapping, disposition or addition-freeze and any reviewed rebase chain, none prunable",
      "README.md, first lines, a fork-owned block: \"<!-- throughline: fork-owned block --> **ThroughLine** holds Ryan's fork of T3 Code and everything built on it: the apps, the server, the fork-owned packages and the design documents under docs/throughline; it does not hold release builds (they live in the release worktrees' release/ folders), records of runs (they live in the vault component's _meta folder) or the vault. <!-- end fork-owned block -->\"",
      'the move record\'s fingerprints entry for /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream-0.0.51/release gains archive = "/mnt/storage/archives/throughline-builds/0.0.51/release"',
      "Consume archiveTree’s existing object-with-moves ledger. Match source, recorded archive address, verify_result=PASS, rsync_checksum_verified, exact tree digest/file/symlink/entry counts and bytes. Never replace its writer with a JSON-line writer. Record moved-and-preserved and archived-and-removed separately.",
      "After repository and worktrees reach their exact maps, atomically change the owned move admission record from frozen to moved, admitting only the pinned acceptance release; no completed_at is written. The critical section uses that same move/release exclusion record, not pgrep as a lock.",
    ],
    failing_checks: ["S1-C01", "S1-C02", "S1-C03"],
    done_when: {
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --stage moved --only S1-C01 S1-C03 S1-M01",
      expect:
        "exit 0 on physical repository/worktree identity and mappings; complete vault cleanup is a later T1.07 obligation",
    },
    depends_on: ["release-0.0.56-closed", "T1.01", "T1.02", "T1.04"],
    executor: {
      role: "implementer-light",
      model_preference: "claude-opus-5-5",
      effort: "medium",
    },
    risk: [
      "destructive-remove: the 0.0.51 worktree is removed only when its status is empty, its ignored set is exactly node_modules and release, and archiveTree returned ARCHIVED_AND_REMOVED; an unmounted drive refuses inside archiveTree before anything is removed",
      "release-in-flight: refused unless the precondition release-0.0.56-closed passes, and T1.04 has already made preflight refuse while the move record is open",
    ],
    rollback:
      "mv /Users/Admin/throughline /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream && git -C /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/t3-upstream worktree repair; the archived 0.0.51 outputs are restored from the archive path the ledger row names",

    command_grammar: "IC-002",
  },
  {
    id: "T1.05",
    archive_annotations: {
      frozen_witness:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Move-Record.json (fingerprints[]), never edited after the freeze",
      annotations: {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Archive-Annotations.jsonl",
        schema: "throughline.archive-annotation.v1",
        fields: {
          path: "absolute path of the frozen or added entry",
          fingerprint: "{sha256, file_count, symlink_count, entry_count, bytes}",
          disposition: "archived-and-removed | moved-and-preserved",
          archive: "archive destination, for an archived container",
          record_container:
            "the whole container this entry was archived in; equals path for a container",
          is_container:
            "true for a whole archived container; false for a covered child entry, which points at its ancestor container",
          verification: "PASS for a container",
          archive_ledger_source:
            "the source path the Archive-Ledger.jsonl row names for this container",
        },
      },
      addendum: {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Archive-Fingerprint-Addendum.jsonl",
        schema: "throughline.archive-fingerprint-addendum.v1",
        fields: {
          path: "a container absent from the frozen witness",
          fingerprint: "its live full-tree freeze taken before any record copy or archive",
          observed_at: "ISO time of the freeze",
          measurement: "how the freeze was taken",
        },
      },
      rules: [
        "A moved-and-preserved annotation changes which evidence is followed; it never eliminates preservation proof. Resolve the actual target through its bound worktree move, require existence and worktree-collection containment, and compare sha256, file_count, symlink_count, entry_count and bytes against the frozen fingerprint.",
        "each frozen witness entry that has an annotation row is matched by path and by all five fingerprint fields",
        "a container row (is_container true, archived-and-removed) has a passing Archive-Ledger.jsonl row: source = archive_ledger_source, archive equal, ARCHIVED_AND_REMOVED, verify PASS, rsync checksum verified, the same five fingerprint fields",
        "a covered child row (is_container false) points at a container row that is its ancestor; the child path is gone with the container",
        "a container absent from the frozen witness has an addendum row and is verified against that pre-copy freeze; a container row with neither a witness entry nor an addendum row has no frozen origin and fails",
      ],
    },
    record_retention: {
      rule: "Each build container (a path the build-output walk reports under the evidence root, or a pre-* snapshot folder under the old backup root) is archived whole, records included, with archiveTree, and verified against its frozen full-tree fingerprint. Before archiveTree removes it, every record file inside it is copied to the record address below.",
      containers: {
        evidence:
          "each path P that vaultBuildOutputs reports under a run folder R of /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/ship-runs",
        rollback:
          "each snapshot folder S matching /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_versions/pre-*",
      },
      record_extensions: [
        ".json",
        ".jsonl",
        ".txt",
        ".md",
        ".log",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
      ],
      record_files:
        "files our own runs wrote (ship-run receipts, logs, manifests, screenshots): regular files (not symlinks) inside the container whose name ends with a record extension and whose path inside the container has no segment naming a third-party dependency tree (node_modules, Pods, SourcePackages, checkouts, Carthage)",
      address:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/ship-runs/retained-records",
      layout: {
        evidence:
          "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/ship-runs/retained-records/evidence/<name of R>/<sanitized path of the record relative to R>",
        rollback:
          "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/ship-runs/retained-records/rollback/<name of S>/<sanitized path of the record relative to S>",
      },
      sanitize:
        'Every path segment after the layout prefix that the build-output walk would flag (it equals or ends with a repository.build_dir_markers entry, or ends with a repository.build_extensions entry) becomes that segment with every "." replaced by "_", followed by "-records" (ThroughLine.app -> ThroughLine_app-records, DerivedData -> DerivedData-records, phone-export -> phone-export-records); every other segment is unchanged. Two records that sanitize to the same address refuse the container with RECORD_ADDRESS_COLLISION before anything is copied.',
      manifest:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/ship-runs/retained-records/Record-Manifest.jsonl",
      manifest_rows: {
        record:
          '{"schema":"throughline.retained-record.v1","kind":"record","container":<absolute container path>,"original_path":<absolute>,"new_path":<absolute, under the address>,"sha256":<hex of the copied bytes>,"bytes":<n>}',
        container:
          '{"schema":"throughline.retained-record.v1","kind":"container","container":<absolute container path>,"archive":<archive destination>,"record_count":<n>}',
        dropped:
          '{"schema":"throughline.retained-record.v1","kind":"dropped","new_path":<the withdrawn copy\'s address>,"reason":<one line>}: withdraws a record copied before this rule; the move worker removes the copy',
      },
      order: [
        "the container's full-tree fingerprint (sha256, file_count, symlink_count, entry_count, bytes) is its frozen entry in Move-Record.json or, for a container absent from that witness, its pre-copy freeze in Archive-Fingerprint-Addendum.jsonl; its Archive-Annotations.jsonl row carries that fingerprint, the disposition and the archive destination; Move-Record.json is never edited",
        "each record is copied to its address, its SHA-256 recomputed from the copy equals the original, and its record row is appended",
        "the container row is appended with the record count",
        "archiveTree(container, archive, /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Archive-Ledger.jsonl) returns ARCHIVED_AND_REMOVED with verify PASS and the frozen fingerprint; no second removal is ever run",
      ],
      source:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-03/delivery-2026-10-09/Move-Remainder-Receipt.json routing question records-inside-build-output; record definition: lead orchestrator ruling, /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-03/delivery-2026-10-09/Archive-Commit-20261010034006431-04.stdout.txt",
      excluded_dependency_trees: [
        "node_modules",
        "Pods",
        "SourcePackages",
        "checkouts",
        "Carthage",
      ],
      payload_rule:
        "third-party dependency files inside a build container (Swift package checkouts such as Nuke's CHANGELOG and migration guides, node_modules, Pods, SourcePackages) are payload, not records: they stay inside the verified whole-container archive on the Raspberry Pi drive and are never copied into retained-records",
    },
    slice: "slice-1",
    title:
      "Move the existing build outputs and rollback snapshots out of the vault with receipts; create the new backup root and the worktrees collection's README",
    serves: ["NG-122"],
    detail_state: "detailed",
    what: "The evidence root holds 43 GB in about 206,000 files, almost all Xcode archives, exported IPAs, AppImages, source tarballs and installers from past releases; the old backup root holds 1.5 GB of pre-release snapshots (measured Oct 7, 2026). Archive every build output under both roots to the Raspberry Pi archive drive with the ship tool's archiveTree, which verifies the copy and removes the verified files itself and writes a ledger row per tree; each build container under the evidence root and the old backup root is archived whole, records included, and verified against its frozen full-tree fingerprint; before archiveTree removes it, its record files are copied to the local record address /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/ship-runs/retained-records, whose path contains no build-named segment (record_retention gives the address, the layout, the name-sanitizing rule and the manifest), with a manifest mapping each original path to its new path and SHA-256. Create the new backup root and the worktrees collection's README with its boundary and retention sentences.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/ship-runs/retained-records",
        side: "vault",
        action: "add",
        exists_now: false,
        note: "local record address: evidence/<run>/... and rollback/<snapshot>/... with sanitized segments; no build-named segment",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/ship-runs/retained-records/Record-Manifest.jsonl",
        side: "vault",
        action: "add",
        exists_now: false,
        note: "one record row per retained record and one container row per archived container",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/ship-runs",
        side: "vault",
        action: "remove",
        note: "build outputs only, per release run folder, removed by archiveTree after verification",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_versions",
        side: "vault",
        action: "remove",
        note: "the pre-0.0.51 and pre-0.0.56 snapshot folders, archived then removed by archiveTree; the folder itself stays for the version-record history",
      },
      {
        path: "/Users/Admin/throughline-worktrees/_versions",
        side: "host-filesystem",
        action: "add",
        note: "mkdir -p; the rollback-snapshot step also creates it on first use (snapshot.ts line 14)",
      },
      {
        path: "/Users/Admin/throughline-worktrees/README.md",
        side: "host-filesystem",
        action: "add",
        note: "boundary sentence: throughline-worktrees holds one worktree per ThroughLine release, named by its version and removed when that version is retired, and _versions, the frozen rollback snapshots the pipeline takes before each install, kept until the release they protect is itself retired; it does not hold the repository, records or the vault",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Archive-Ledger.jsonl",
        side: "vault",
        action: "edit",
        note: "one row per archived tree",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Move-Record.json",
        side: "vault",
        action: "edit",
        note: "fingerprints[].archive filled for every archived tree",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/disk-archive.ts",
        side: "outside-tool",
        action: "read",
      },
    ],
    signatures: [
      "for each container C (evidence path P or rollback snapshot S), before its archiveTree call: retainRecords(C, layout prefix, /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/ship-runs/retained-records/Record-Manifest.jsonl) copies every record file of C to its sanitized address, verifies each copy's SHA-256, appends one record row per file and one container row, and refuses with RECORD_ADDRESS_COLLISION when two records sanitize to the same address",
      "for each run folder R under /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/ship-runs and each path P that vaultBuildOutputs reports under R: archiveTree(P, '/mnt/storage/archives/throughline-builds/evidence/<basename of R>/<path of P relative to R>', '/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Archive-Ledger.jsonl') → status must be ARCHIVED_AND_REMOVED; ARCHIVED_NONSECRET_FILES_REMOVED_SECRET_PATHS_RETAINED stops the task and the retained paths are listed in the step log",
      "for each snapshot folder S matching /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_versions/pre-*: archiveTree(S, '/mnt/storage/archives/throughline-builds/rollback/<basename of S>', '/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Archive-Ledger.jsonl') → ARCHIVED_AND_REMOVED",
      "mkdir -p /Users/Admin/throughline-worktrees/_versions",
      "no second removal is ever run after archiveTree; the function's own removal is the only one",
    ],
    failing_checks: ["S1-C06"],
    done_when: {
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C06",
      expect: "exit 0",
    },
    depends_on: ["T1.03", "T1.04"],
    executor: {
      role: "implementer-light",
      model_preference: "claude-opus-5-5",
      effort: "medium",
    },
    risk: [
      "destructive-remove: every removal is archiveTree's own, after its verification; the Raspberry Pi drive must be mounted or it refuses first",
      "disk and time: about 44 GB cross the tailnet to the Raspberry Pi; resumable per run folder because each tree is its own ledger row",
    ],
    rollback: "restore any tree from the archive path its ledger row names",

    command_grammar: "IC-002",
  },
  {
    id: "T1.06",
    slice: "slice-1",
    title:
      "The vault reaches only the declared repository documents: the contract, and the component README that points at it",
    serves: ["NG-122"],
    detail_state: "detailed",
    what: "Ryan's words: \"only link the ThroughLine files that should Be accessible to the vault.\" Measured Oct 7, 2026: the vault's link router returns 403 for a file reached through a symlink and 200 for a plain vault file, so a link cannot be a symlink. The mechanism is release-bound copies made by the publish-docs step (T1.04) into the component's references folder, which the folder grammar already reserves for inputs and source material a project reads; the copies are inputs the component reads from the repository, so no new kind word is needed. The folder's README is generated by the step itself, so no hand-written README collides with the copied repository README, which lands under tree/. This task updates the component's README children and the design decision; the first publication happens in T1.10, the first release from the new home.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/README.md",
        side: "vault",
        action: "edit",
        note: "children gains references/repository/ and plans/next-gen-spec-2026-10-07/; last_updated moves",
      },
    ],
    signatures: [
      "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/references/repository is written only by the publish-docs step; its layout is README.md (generated), repository.json, tree/<source path>",
      'grep -q "references/repository/" /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/README.md',
      "Publication uses deterministic YAML parsing/serialization; preserve authored metadata, refresh owning provenance keys, pin immutable pattern/exclusion arrays, generate a read-only root README with current commit/release/tree layout, and independently compare every copied byte to git show plus the declared transformation.",
    ],
    failing_checks: ["S1-C07"],
    done_when: {
      command:
        'grep -q "references/repository/" /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/README.md && cd /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07 && node check-spec.mts',
      expect: "exit 0; S1-C07 itself turns green at T1.10",
    },
    depends_on: ["T1.04"],
    executor: {
      role: "implementer-light",
      model_preference: "claude-opus-5-5",
      effort: "medium",
    },
    risk: ["none; one README edit"],
    rollback: "revert the README edit",

    command_grammar: "IC-002",
  },
  {
    id: "T1.08",
    slice: "slice-1",
    title:
      "Move the spec into the repository at docs/throughline/next-gen-spec and bind its checks to the code; records stay in the vault",
    serves: ["NG-122", "NG-138"],
    detail_state: "detailed",
    what: "Copy the spec's design files into the repository under docs/throughline/next-gen-spec, a fork-owned subfolder of docs (the same namespace rule as apps/*/src/throughline; docs/operations is upstream's runbook folder and is not used so the fork's design never mixes with upstream prose). Only the design travels: spec-data.mts, build-spec.mts, check-spec.mts, render-spec.mts, checks/, spec.json, Spec-Map.html, Spec-Map.png and README.md. Nothing under _meta (the review, the repair fragments, the check runs) and not Move-Record.json; those are records and stay in the vault. Commit on main with a pathspec, rebuild spec.json there, and leave a pointer in the vault folder's README. From then on the spec is edited in the repository and the checks file path resolves from the spec's own location.",
    files: [
      {
        path: "/Users/Admin/throughline/docs/throughline/next-gen-spec/",
        side: "fork-namespace",
        action: "add",
        note: "spec-data.mts, build-spec.mts, check-spec.mts, render-spec.mts, checks/, spec.json, Spec-Map.html, Spec-Map.png, README.md",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/README.md",
        side: "vault",
        action: "edit",
        note: "pointer to the repository copy; status moved",
      },
    ],
    signatures: [
      "rsync -a --exclude '_meta/' --exclude 'Check-Run-*' /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/ /Users/Admin/throughline/docs/throughline/next-gen-spec/ && cd /Users/Admin/throughline/docs/throughline/next-gen-spec && node build-spec.mts && node check-spec.mts",
      'git -C /Users/Admin/throughline add -- docs/throughline/next-gen-spec && git -C /Users/Admin/throughline commit -m "docs(throughline): the next-generation implementation spec" -- docs/throughline/next-gen-spec',
      'the vault README\'s body gains one paragraph: "Moved on <date>: the spec is edited in the ThroughLine repository at /Users/Admin/throughline/docs/throughline/next-gen-spec; this folder keeps the records under _meta."',
      "Exact copied design-file set includes contracts-data.mts, test-check-spec.mts, Seam-Baseline.json, Spec-Map.png, checks/slice-1-contracts.mts and checks/test-slice-1-checks.mts in addition to the existing source/build/render/check/spec/README files. No _meta, execution, Move-Record or Check-Run evidence is copied. js-yaml is an explicit checker dependency available from the owning repository toolchain; receipt source/ledger inputs remain at their physical vault addresses.",
    ],
    failing_checks: ["S1-C10"],
    done_when: {
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C10",
      expect: "exit 0",
    },
    depends_on: ["T1.03"],
    executor: {
      role: "implementer-light",
      model_preference: "claude-opus-5-5",
      effort: "medium",
    },
    risk: ["none beyond a pathspec commit"],
    rollback: "git revert of that one commit",

    command_grammar: "IC-002",
  },
  {
    id: "T1.09",
    fork_state: [
      {
        ref: "6fa7bda869",
        disposition: "keep",
        reason:
          "Matches the contract: no-file-list preparation reads without staging, and commit stages an explicit current path set; explicit-file-list behavior is intentionally retained.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/recover-typecheck-059-20261009",
        disposition: "keep",
        reason:
          "Keep the faithful git/websocket fixture type repairs at 2cd49588; inherited release stamps are archive-only and must not be copied into the next release.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/staging-20261009",
        disposition: "keep",
        reason:
          "Patch-equivalent to main 6fa7bda869; retain the main no-file-list read-only preparation fix rather than reapply it.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-1",
    title:
      "The server never stages a project's whole tree: commit preparation reads the working tree, and commit-all stages its explicit set at commit time",
    serves: ["NG-199"],
    detail_state: "detailed",
    what: "Today prepareCommitContext runs git add -A when no file list is given (GitVcsDriverCore.ts line 2050), and its caller in GitManager (line 1851) then commits whatever is staged (line 1984). The fork already refuses this for the monorepo through a protected-root guard, but the ThroughLine repository at its new home is not protected, so a thread pointed at it would move its staged set every few seconds, the pattern Ryan rejected. Fix it structurally in two places so the caller still works: with no file list, preparation never touches the index and reads the working tree for the summary and the patch; and the commit step, with no file list, stages exactly the paths the working tree holds at commit time by explicit pathspec, never a bare add -A. With a file list both keep today's explicit-pathspec behavior. Write the failing tests first, in both the driver and the manager test files.",
    files: [
      {
        path: "apps/server/src/vcs/GitVcsDriverCore.test.ts",
        side: "upstream-edit",
        action: "edit",
        note: "the two pinned driver tests first; the tests at today's lines 3026, 3098, 3139, 3173 and 3211 that assert add-all staging move to the new contract",
      },
      {
        path: "apps/server/src/vcs/GitVcsDriverCore.ts",
        side: "upstream-edit",
        action: "edit",
        note: "prepareCommitContext and commit",
      },
      {
        path: "apps/server/src/vcs/GitVcsDriver.ts",
        side: "upstream-edit",
        action: "edit",
        note: "GitCommitOptions gains filePaths?: readonly string[]",
      },
      {
        path: "apps/server/src/git/GitManager.ts",
        side: "upstream-edit",
        action: "edit",
        note: "the commit call at line 1984 passes filePaths through",
      },
      {
        path: "apps/server/src/git/GitManager.test.ts",
        side: "upstream-edit",
        action: "edit",
        note: "the pinned caller-level test first",
      },
    ],
    signatures: [
      "prepareCommitContext(cwd: string, filePaths?: readonly string[]) — signature unchanged; filePaths undefined or an empty array both mean no selection",
      'no selection: summary = the rows of git diff --name-status -z HEAD (tracked changes) plus one "A\\t<path>" row per path from git ls-files --others --exclude-standard -z; patch = git diff --no-ext-diff --patch --minimal HEAD, then for each untracked path git diff --no-index --no-ext-diff -- /dev/null <path>, where exit code 1 means a diff was produced and only exit codes above 1 are errors; the shared byte limit PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES applies to the concatenated patch and the truncation marker is appended once; an unborn HEAD uses the empty tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904 as the diff base; preparation never mutates the index; read-only diff/ls-files may consult it; returns null when both the summary and the patch are empty',
      "with a selection: unchanged (git reset, then --literal-pathspecs add -A -- <paths>, then the cached summary and patch)",
      "operation ids: GitVcsDriver.prepareCommitContext.workingTreeSummary, .untrackedList, .workingTreePatch, .untrackedPatch; the id GitVcsDriver.prepareCommitContext.addAll no longer exists anywhere in the server",
      'commit(cwd, subject, body, options?: GitCommitOptions & { filePaths?: readonly string[] }) — with a nonempty normalized options.filePaths: --literal-pathspecs add -A -- <paths> immediately before git commit; undefined and [] are normalized to no selection; without: the paths are computed at commit time as the union of git diff --name-only -z HEAD and git ls-files --others --exclude-standard -z, staged by exact argv ["--literal-pathspecs","add","-A","--pathspec-from-file=-","--pathspec-file-nul"] with the selected paths as NUL-delimited stdin; never combine command-line paths/-- with --pathspec-from-file, then git commit; a pre-existing staged entry not in that set is left as it is and is committed with the rest, which is today\'s behavior for a staged index; the operation ids are GitVcsDriver.commit.stageSelected and GitVcsDriver.commit.stageWorkingTree',
      "GitManager.ts line 1984: gitCore.commit(cwd, suggestion.subject, suggestion.body, { timeoutMs, progress, ...(filePaths?.length ? { filePaths } : {}) })",
      'pinned driver test 1, title exactly: "prepareCommitContext without file paths leaves the index untouched and reports working-tree changes" — with one modified tracked file, one untracked file and one unrelated file already staged: after the call, git ls-files --stage -z and the staged patch bytes equal the pre-call snapshot exactly, including a partially staged blob with the same filename, the summary names the modified and the untracked files, and the patch carries both',
      'pinned driver test 2, title exactly: "commit without file paths stages the working-tree set by explicit pathspec at commit time" — the commit contains the modified and the untracked files, and no add -A without a pathspec was run (the executed git arguments are recorded by the test driver)',
      'pinned manager test, title exactly: "commit-all through GitManager commits the working-tree changes without staging during preparation" — a project with one modified tracked file and one untracked file: the index is empty after the suggestion is prepared, and after commit both files are in HEAD',
      "run: cd /Users/Admin/throughline/apps/server && pnpm run test -- src/vcs/GitVcsDriverCore.test.ts src/git/GitManager.test.ts",
      "The same unborn-HEAD fallback applies to preparation AND commit. For an unborn repository compute staged tracked paths with ls-files and untracked paths with ls-files --others, retaining NUL boundaries; make the initial commit through the explicit computed set. For an empty computed set do not run git add; commit an existing staged set if present, otherwise return the existing no-changes outcome. Add fixtures for undefined versus [], no computed paths, partially staged bytes, filenames with spaces/newlines and the caller’s normalization.",
      "S1-C11 consumes structured runner assertionResults with each exact pinned title status=passed and a nonzero executed population. An independent assertion review binds both test-source hashes and proves staged-entry/patch equality, caller commit-all, and unborn/empty outcomes; comment titles, skipped parent suites and empty assertions cannot stand in for execution proof.",
    ],
    failing_checks: ["S1-C11"],
    done_when: {
      command:
        "(cd /Users/Admin/throughline/apps/server && pnpm run test -- src/vcs/GitVcsDriverCore.test.ts src/git/GitManager.test.ts) && node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C11",
      expect: "tests green and exit 0; the installed proof is S1-C14 after T1.10",
    },
    depends_on: ["T1.03"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6-astra",
      effort: "medium",
    },
    risk: [
      "upstream-edit: GitVcsDriverCore.ts and its test are already fork-edited (the protected-root guard); GitVcsDriver.ts, GitManager.ts and GitManager.test.ts are three new upstream edits, each one line or one test, recorded on the seam",
      "behavior: the source-control panel's commit-message suggestion now reads the working tree; commit-all commits the same set it did, computed at commit time",
    ],
    rollback: "git revert on main; the release that carries it is T1.10",

    command_grammar: "IC-002",
  },
  {
    id: "T1.10",
    fork_state: [
      {
        ref: "f030dbe543",
        disposition: "keep",
        reason:
          "Retain the installed 0.0.56 version stamp as history and rollback baseline; a future slice release must stamp its own new version.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/model-types-059-20261009",
        disposition: "revert",
        reason:
          "No model type repair exists on this branch: its only non-main commits are 0.0.57 and 0.0.58 version stamps; exclude them from the active next release and retain them only in the archive.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/ship-fallback-057-af60",
        disposition: "revert",
        reason:
          "This is the 0.0.57 stamp-only fallback branch; remove it from future pipeline carry_branches and preserve it as an abandoned candidate, never merge that version into 0.0.60.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-1",
    title:
      "One release from the new home through the re-pointed pipeline (0.0.60), carrying the staging fix, installed on every host",
    starting_note:
      "Measured Oct 9, 2026 at the move base 47065c2a65: pnpm typecheck fails with one error in packages/contracts/src/rpc.test.ts line 58 (TS2353, future_field). The tests step refuses until the reviewed unknown-field decoder correction from the 059 type-repair branches lands on main (T3.04/T3.05 rework rows in fork_state). Release 0.0.60 never carries the 0.0.57 or 0.0.58 version stamps.",
    serves: ["NG-120", "NG-122", "NG-199", "NG-119"],
    detail_state: "detailed",
    what: "Ryan's rule: every later slice ships through the new pipeline. The proof that the pipeline works from the new home is one release through it: 0.0.60, built from main at the commit that carries T1.09 and the spec (T1.08), in the same build-from-main mode 0.0.56 used (preserve-base). It runs the new vault-clean step, builds in the release worktree inside the collection with every output under that worktree's release/ folder, installs on the tower, then the iPhone, then the Mac through the existing steps; the Raspberry Pi contract and its five actions (build-rpi, gate-rpi, stage-rpi-headless, install-rpi-headless, rpi-cold-turn) are removed from the 0.0.60 pipeline and recorded under deferred.rpi with Ryan's Oct 9, 2026 pause, template and history kept, never counted as passed, runs publish-docs after the Mac install, and ends at the rewind proof. After the install, a seat that did not build the fix records the staging probe for S1-C14: the installed server bundle carries the new operation ids, and the staged set of a project an idle thread points at does not change over thirty samples two seconds apart.",
    deferred_rpi_pipeline: {
      field: "Ship-Pipeline.json deferred.rpi",
      shape: {
        ruling: '{date: "2026-10-09", words: Ryan\'s pause in his own words}',
        contract: "the removed rpi section, kept unchanged as a template",
        steps:
          "the five removed step records, kept unchanged as templates: build-rpi, gate-rpi, stage-rpi-headless, install-rpi-headless, rpi-cold-turn",
        counted_as_passed: false,
      },
      rules: [
        "none of the five step ids appears in steps or required_steps",
        "no receipt is written or synthesized for a deferred step, and a deferred step never counts as passed",
        "prior run receipts that mention the Raspberry Pi stay as history",
        "required_steps install order: install-tower, then install-phone, then install-mac",
      ],
      ruling: {
        date: "2026-10-09",
        time: "Oct 9, 2026, about 7:45 PM PDT",
        words:
          "I would prefer we take Raspberry Pi off the list and focus on Mac, tower, and iOS as priority, and when those three are done, then Android, number four. For Raspberry Pi, I think I want to pause",
        words_2:
          "We don't really have a use case for Raspberry Pi right now... I just think maybe we pause the Raspberry Pi aspect of this build and focus on the important things: the tower, Mac, iOS. Then android",
      },
    },
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Pipeline.json",
        side: "config",
        action: "edit",
        note: 'source.upstream_mode_by_release "0.0.60": "preserve-base" (already written by T1.04)',
      },
      {
        path: "/Users/Admin/throughline-worktrees/0.0.60",
        side: "host-filesystem",
        action: "add",
        note: "created by the pipeline's upstream-sync step through prepareRelease",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/ship-runs/release-0-0-60",
        side: "vault",
        action: "add",
        note: "records only",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/references/repository",
        side: "vault",
        action: "add",
        note: "written by the publish-docs step",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Staging-Probe-0.0.60.json",
        side: "vault",
        action: "add",
        note: "written by the non-builder seat after the install",
      },
    ],
    signatures: [
      "ryan throughline ship 0.0.60 --json (the installed spelling today; its rename is pending decision R01)",
      'installed bundle check: grep -rl "prepareCommitContext.addAll" /Applications/ThroughLine.app/Contents/Resources returns nothing and grep -rl "prepareCommitContext.workingTreeSummary" returns at least one file',
      "Staging-Probe schema throughline.staging-probe.v1 binds installed_version, project, live server pid/start/native-session plus a hashed binding receipt, actual thread id and preparation event id, a known modified tracked/untracked fixture, builder session ids and a distinct observing session. samples is an array of at/index_entries/staged_patch_sha256/server_pid/thread_id/preparation_event_id records, at least thirty at exactly two-second intervals with <=250ms measured jitter; started_at/finished_at bind the samples, and exact index bytes are unchanged. No clean/unused project or builder self-observation passes.",
      "Owning Release-Closure.json and every latest step receipt bind exact NEXT_RELEASE, frozen source commit and run id; release worktree HEAD equals that commit, artifacts have real sha256/address under its release folder, and all installed readbacks bind target payload digests/receipt hashes. shipped_source_hashes includes T1.08 design and T1.09 driver source; manifest source/release equal the frozen run. DMG names or ancestry alone are never installed proof. Append the new release worktree’s creator/run/frozen-head mapping to Move-Record.",
    ],
    failing_checks: ["S1-C13", "S1-C14", "S1-C07"],
    done_when: {
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --only S1-C13 S1-C14 S1-C07",
      expect: "exit 0",
    },
    depends_on: ["T1.03", "T1.04", "T1.05", "T1.08", "T1.09"],
    executor: {
      role: "implementer-light",
      model_preference: "claude-opus-5-5",
      effort: "medium",
    },
    risk: [
      "this is a full release: it restarts ThroughLine on Ryan's Mac under the pipeline's own presence and courtesy steps, installs on the tower under the agent account (the Raspberry Pi is deferred by Ryan's Oct 9, 2026 pause), and uploads to TestFlight; the pipeline's rollback snapshot and the Mac installer's retained previous build are the rollback",
      "the staging probe needs a seat that did not build T1.09, at medium effort or lower",
    ],
    rollback:
      "the pipeline's own rollback snapshot and the Mac installer's retained previous build; the tower and Raspberry Pi keep their previous app folders",

    command_grammar: "IC-002",
  },
  {
    id: "T1.07",
    slice: "slice-1",
    title:
      "Close the move: retire the monorepo's exclude lines and the stale folders, point the retired folder at the new home, complete the move record",
    serves: ["NG-122"],
    detail_state: "detailed",
    what: "Final slice task, after all other done receipts: remove stale exclude lines and only proven-empty directory trees by a checked bottom-up directory plan that refuses symlinks, special files, unexpected entries and traversal errors. Run the joined suite with --before-close while admission_state is moved and completed_at is absent; save its passed output/hash, then write completed_at/final_head and admission_state=closed LAST. The moved state—not completed_at—already admitted the pinned acceptance release. Rerun post-closure acceptance to attest task/ joined-suite timestamps precede completion. No recursive deletion based on a regular-file count.",
    files: [
      {
        path: "/Users/Admin/core-root/.git/info/exclude",
        side: "host-filesystem",
        action: "edit",
        note: "remove the lines naming t3code/t3-upstream/ and t3code-build/",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code-build",
        side: "vault",
        action: "remove",
        note: "full lstat/readdir plan first; every entry must be a real directory; rmdir bottom-up only, no recursive removal or file-count permission",
      },
      {
        path: "/Users/Admin/throughline-worktrees/infra",
        side: "host-filesystem",
        action: "remove",
        note: "full lstat/readdir plan first; every entry must be a real directory; rmdir bottom-up only, no recursive removal or file-count permission",
      },
      {
        path: "/Users/Admin/throughline-worktrees/tools",
        side: "host-filesystem",
        action: "remove",
        note: "full lstat/readdir plan first; every entry must be a real directory; rmdir bottom-up only, no recursive removal or file-count permission",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/README.md",
        side: "vault",
        action: "edit",
        note: "one line under the retired banner: the fork now lives at /Users/Admin/throughline; last_updated moves",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/repository-move-2026-10-07/Move-Record.json",
        side: "vault",
        action: "edit",
        note: "completed_at and final_head",
      },
    ],
    signatures: [
      "Plan the whole tree with lstat/readdir first; any non-directory/symlink/unreadable entry refuses before any removal. Remove only the checked real empty directories in postorder with rmdir, which remains fail-closed on new residue.",
      "Remove only the named exclude lines for the retired checkout/build paths; point the retained /Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/README.md at /Users/Admin/throughline.",
      "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts --before-close: every final endpoint predicate runs while moved and without completed_at. Save a hash-bound joined_preclose record with exit_code 0 and finished_at later than every named task_done_receipt. Only then write completed_at/final_head and closed state; post-closure C12 verifies that temporal order.",
    ],
    failing_checks: ["S1-C08", "S1-C12"],
    done_when: {
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-1-repository-move.mts",
      expect: "exit 0: every slice-1 check green, including the guard",
    },
    depends_on: ["T1.03", "T1.04", "T1.05", "T1.06", "T1.08", "T1.09", "T1.10"],
    executor: {
      role: "implementer-light",
      model_preference: "claude-opus-5-5",
      effort: "medium",
    },
    risk: [
      "destructive-remove: only folders the task measured at 0 files immediately before removal, recorded in the move record",
    ],
    rollback:
      "the exclude lines are two lines of text; the folders were empty; completed_at is one field",

    command_grammar: "IC-002",
  },
];

// ---------- outline tasks for slices 2 to 13 (files from the ledger's evidence; signatures fixed when each slice is detailed) ----------
const outline = (
  id: string,
  slice: string,
  title: string,
  serves: string[],
  what: string,
  files: FileEdit[],
  depends_on: string[],
  executor: Executor = SOL,
): Task => ({
  id,
  slice,
  title,
  serves,
  detail_state: "outline",
  what,
  files,
  signatures: [],
  failing_checks: [],
  done_when: {
    command:
      "fixed when the slice is detailed; the first act is a failing check on the installed thing (NG-138)",
    expect: "",
  },
  depends_on,
  executor,
  risk: ["outline: not executable until Fable details it; Sol never chooses a design"],
  rollback: "fixed when detailed",
});
const F = (path: string, side: Side, action: Action = "edit", note?: string): FileEdit => ({
  path,
  side,
  action,
  ...(note ? { note } : {}),
});

const OUTLINE: Task[] = [
  {
    id: "T2.01",
    slice: "slice-2",
    detail_state: "detailed",
    title: "The seam manifest and the count check in the repository",
    serves: ["NG-123", "NG-124", "NG-126"],
    what: "Add throughline-seam.json at the repository root (schema throughline.seam-manifest.v1) bound to the pinned upstream SHA, the fork SHA and their true merge base, generated from the real diff (git diff --name-status -M merge_base fork_sha) by scripts/throughline/check-seam.ts --write and then authored. Each entry has path, class (upstream-edit for M, T or R; upstream-removed for D; fork-namespace for added files under packages/throughline-*/ or apps/*/src/throughline/; fork-added for every other added file), renamed_from, reason with reason_source (authored, or commit-subjects seeded from the fork commits that touched the path, never an empty placeholder), imported_private_symbols, schema_assumptions, conflict_rule, and the ThroughLine marker flag the fork-map projector already computes. counts holds the four class counts; admitted holds upstream_edit_count (upstream-edit plus upstream-removed) and fork_added_count; check-seam.ts --admit may lower an admitted count and refuses to raise one. upstream_changes has one adopt, retain, replace or defer row with a reason for every path changed both upstream (merge_base..upstream.sha) and in the fork. conflict_rules.capability_paths is retain-fork-and-run-capability-tests and conflict_rules.default is review (never take-upstream); Ship-Seams.json's 244 rules and 41 resolutions fold into entries[].conflict_rule and upstream_changes. The fork-map projector's classification and commit lookup move into scripts/throughline/seam/classify.ts; the ship tool reads the manifest instead of Ship-Seams.json (core.ts rule matching, capability.ts tag checks) and ships through Ship Warden; Ship-Pipeline.json seam_file becomes {checkout}/throughline-seam.json. When the first manifest is admitted, Seam-Baseline.json in the vault is retired by its own rule.",
    files: [
      {
        path: "throughline-seam.json",
        side: "fork-namespace",
        action: "add",
        note: "to create; first generation from the merge base d15210cd3d measured 167 upstream edits, 0 removals, 12 namespace files and 176 other fork files (E03)",
      },
      {
        path: "scripts/throughline/check-seam.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "scripts/throughline/seam/classify.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create from the projector's split of edited and added files",
      },
      {
        path: "scripts/throughline/seam/repo-binding.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create; the --repo validation every slice-2 script shares",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/fork-tax-projector/project-fork-map.ts",
        side: "outside-tool",
        action: "move",
        note: "exists today (19107 bytes); folds into scripts/throughline/seam/classify.ts",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Seams.json",
        side: "outside-tool",
        action: "move",
        note: "exists today; rules and resolutions fold into the manifest (E06)",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/core.ts",
        side: "outside-tool",
        action: "edit",
        note: "exists today; seam rules read from the manifest at line 75",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Pipeline.json",
        side: "config",
        action: "edit",
        note: "seam_file only; the seam-check step is T2.04",
      },
    ],
    signatures: [
      "node scripts/throughline/check-seam.ts --repo <abs> [--write | --admit] [--json] [--self-test]   exit 0 ok, 1 violation named per path, 2 binding refused",
      "export function bindRepository(path: string): { root: string; head: string }   // scripts/throughline/seam/repo-binding.ts; refuses a non-top-level path, a different origin or upstream URL, or a HEAD not descending from fa95283df6",
      "export type SeamClass = 'upstream-edit' | 'upstream-removed' | 'fork-added' | 'fork-namespace'",
      "export function classifyFork(root: string, mergeBase: string, forkSha: string): Map<string, { cls: SeamClass; renamedFrom?: string; commits: string[]; marker: boolean }>   // scripts/throughline/seam/classify.ts",
      "export interface SeamManifest { schema: 'throughline.seam-manifest.v1'; upstream: { remote_url: string; sha: string }; fork: { sha: string }; merge_base: string; counts: { upstream_edit: number; upstream_removed: number; fork_added: number; fork_namespace: number }; admitted: { upstream_edit_count: number; fork_added_count: number; admitted_at: string; admitted_by: string }; entries: SeamEntry[]; upstream_changes: Array<{ path: string; upstream_commits: string[]; decision: 'adopt' | 'retain' | 'replace' | 'defer'; reason: string }>; conflict_rules: { default: 'review'; capability_paths: 'retain-fork-and-run-capability-tests' } }",
      "export function loadSeamManifest(file: string): SeamManifest   // /Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/core.ts, replacing the Ship-Seams reader",
      "check-seam.ts --self-test: in a temporary git clone --shared of the bound root, (a) add one unlisted line to an upstream file and expect exit 1 naming it, (b) run --admit with a higher count and expect a refusal; prints 'self-test: 2 of 2 refusals observed' and exits 0 only then",
    ],
    failing_checks: ["S2-C01", "S2-C02", "S2-C03", "S2-C04"],
    done_when: {
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts --repo /Users/Admin/throughline --only S2-C01 S2-C02 S2-C03 S2-C04 S2-G01 && node /Users/Admin/throughline/scripts/throughline/check-seam.ts --repo /Users/Admin/throughline --self-test",
      expect: "exit 0 from both; the self-test prints 'self-test: 2 of 2 refusals observed'",
    },
    depends_on: ["T1.08"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [
      "reasons seeded from commit subjects are real but thin; authored reasons replace them over later merges, and reason_source shows which is which",
      "the ship tool change ships through Ship Warden; until it lands, the pipeline still reads Ship-Seams.json, so the move of Ship-Seams.json waits for that ship",
    ],
    rollback:
      "path-limited git revert of the commit that adds throughline-seam.json and scripts/throughline/; Ship-Pipeline.json seam_file and the vault Ship-Seams.json and projector restored from core-root history; the previous ship tool version re-shipped through Ship Warden",
    annotations: {
      evidence: ["E02", "E03", "E06"],
      discriminating_failure:
        "an unlisted edit to an upstream file, or a raised admitted count, is refused by name (self-test)",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T2.02",
    slice: "slice-2",
    detail_state: "detailed",
    title: "The fork namespace and one mount line per upstream entry point",
    serves: ["NG-123", "NG-124"],
    what: "Extend the namespace that already exists (E05) rather than add it: packages/throughline-<name> for shared fork packages and apps/<app>/src/throughline/ inside apps. No mass relocation inside the 24-hour window: every fork-added entry outside the namespace carries relocation planned or kept with a reason, and fork_added_count may only fall, so files move onto our side at merges. Every upstream-edit entry records mount_lines, the count of added lines that are not imports from the namespace. scripts/throughline/seam/mount-lines.ts enforces the rule incrementally on the diff between the admitted fork SHA and HEAD: a new edit to an upstream file is at most three added lines, all importing from or calling into the namespace; the 167 edits that predate admission are recorded, not failed. Slice 3 builds its new modules under apps/server/src/throughline/ and packages/throughline-record as the first users.",
    files: [
      {
        path: "packages/throughline-*",
        side: "fork-namespace",
        action: "edit",
        note: "no package exists today; packages/throughline-record is created by T3.02",
      },
      {
        path: "apps/*/src/throughline/",
        side: "fork-namespace",
        action: "edit",
        note: "exists today: apps/server/src/throughline/{identity,operatorProfile,rewind}, apps/web/src/throughline/OperatorWordmark.tsx",
      },
      {
        path: "scripts/throughline/seam/mount-lines.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "throughline-seam.json",
        side: "fork-namespace",
        action: "edit",
        note: "relocation, relocation_reason and mount_lines fields",
      },
    ],
    signatures: [
      "node scripts/throughline/check-seam.ts --repo <abs> --mounts [--self-test-mounts]   exit 1 names each upstream file whose new edit breaks the mount rule",
      "export function mountLineViolations(root: string, admittedForkSha: string, head: string, manifest: SeamManifest): Array<{ path: string; addedLines: number; nonNamespaceLines: number }>",
      "SeamEntry gains relocation: 'planned' | 'kept', relocation_reason?: string, mount_lines: number",
    ],
    failing_checks: ["S2-C05"],
    done_when: {
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts --repo /Users/Admin/throughline --only S2-C05 && node /Users/Admin/throughline/scripts/throughline/check-seam.ts --repo /Users/Admin/throughline --mounts --self-test-mounts",
      expect:
        "exit 0; the mount self-test shows a ten-line edit to an upstream file refused and a one-line import from apps/server/src/throughline admitted",
    },
    depends_on: ["T2.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [
      "the incremental rule leaves 167 historical edits in place; the falling counts, not this task, are what shrink them",
    ],
    rollback:
      "path-limited git revert of mount-lines.ts and the manifest fields; no file moves to undo",
    annotations: {
      evidence: ["E03", "E05"],
      discriminating_failure:
        "a ten-line edit to an upstream file after admission is refused; the same change as a one-line namespace import passes",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T2.03",
    fork_state: [
      {
        ref: "673f1f467c",
        disposition: "keep",
        reason:
          "Retain fork-namespace inspector-free rewind/source-population protections; extend capability pins for the new record path rather than discard existing native-provider safeguards.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "d96649b868",
        disposition: "keep",
        reason:
          "Retain release-custody-compatible artifact declarations and refusal tests; these do not authorize an interim release install.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/compiled-rewind-protection-20261009",
        disposition: "keep",
        reason:
          "Keep native navigation and compiled-consumer regression protections; main contains the composed 47bb/673f versions, so avoid importing older whole-file states.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/inspector-free-rewind-20261009",
        disposition: "keep",
        reason:
          "Keep isolated artifact/proof-population safeguards; main has the composed 673f version, so compare missing test deltas before any selective reuse.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/regress-20261009",
        disposition: "keep",
        reason:
          "Keep repository capability manifest/pin-preservation/report-runner code and mobile test pins; it belongs under docs/throughline and scripts/throughline and survives the move.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-2",
    detail_state: "detailed",
    title: "Feature tests an upstream sync must keep green, Android included",
    serves: ["NG-125"],
    what: "Move the capability manifests into the repository at docs/throughline/capabilities/<name>/Capability.json, starting with rewind byte-for-byte (E07), so the vault copy pipeline shows them. The ship tool reads the capability folder from a new Ship-Pipeline.json field capability_dir instead of dirname(seam_file). The sync gate lives here, not in T2.01, which removes the loop flagged in the readback: after upstream-sync, one capability-regression step per repository manifest runs before the first signed build, and the release refuses on any red or missing pinned case. Every task that adds a fork feature from slice 3 on adds or extends a capability manifest with its pinned tests (the turn-rail capability is added by T3.01). Android included means: a manifest whose paths touch apps/mobile pins at least one apps/mobile case, which runs in the React Native code shared by iOS and Android; device runs on Android stay with the slice-13 device matrix. The ship tool also reports uncovered fork paths (fork entries no capability lists) as a count that may only fall.",
    files: [
      {
        path: "docs/throughline/capabilities/rewind/Capability.json",
        side: "fork-namespace",
        action: "add",
        note: "to create by moving the vault manifest unchanged",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/capabilities/rewind/Capability.json",
        side: "vault",
        action: "move",
        note: "exists today, version 1.2.0",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/capability.ts",
        side: "outside-tool",
        action: "edit",
        note: "exists today; undeclaredCapabilities at line 60 derives the folder from the seam file",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Pipeline.json",
        side: "config",
        action: "edit",
        note: "capability_dir field; one capability-regression step per manifest before build-mac",
      },
    ],
    signatures: [
      "export function undeclaredCapabilities(capabilityDir: string, declared: string[]): string[]   // was (seamFile, declared)",
      "export function uncoveredForkPaths(manifest: SeamManifest, capabilities: LoadedCapability[]): string[]",
      'Ship-Pipeline.json: "capability_dir": "{checkout}/docs/throughline/capabilities"',
      "test /Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/capability-sync.test.ts › 'a sync whose pinned case was renamed is refused before the first signed build' (specified, not yet implemented)",
    ],
    failing_checks: ["S2-C06"],
    done_when: {
      command:
        "cd /Users/Admin/core-root && node /Users/Admin/throughline/docs/throughline/next-gen-spec/checks/slice-2-seam.mts --repo /Users/Admin/throughline --only S2-C06 S2-G01 && pnpm -C /Users/Admin/core-root install --frozen-lockfile >/dev/null && pnpm -C /Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship run test",
      expect: "exit 0; ship tool tests green including the renamed-case refusal test",
    },
    depends_on: ["T2.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [
      "the guard S2-G01 must stay green through the move; a failure there means a pinned rewind case was lost, which blocks the task",
    ],
    rollback:
      "move the manifest back to the vault folder from core-root history, revert the capability_dir field, re-ship the previous ship tool through Ship Warden",
    annotations: {
      evidence: ["E06", "E07"],
      already_green_invariant:
        "S2-G01 PASS today: every pinned rewind case is present in its test file",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T2.04",
    slice: "slice-2",
    detail_state: "detailed",
    title: "The decision-tree check the ship lane enforces and one view of what is custom",
    serves: ["NG-126", "NG-130"],
    what: "scripts/throughline/seam-side.ts --repo <abs> <path>... prints, for each path, its class from the manifest and git, and for a path not yet edited, where a new edit belongs (new behavior in the namespace; an upstream file gets a mount line only); it exits 1 for an upstream edit absent from the manifest. scripts/throughline/seam-view.ts renders docs/throughline/seam-view.html from the manifest only, with the manifest's sha256 in <meta name=\"seam-manifest-sha256\">, and marks an entry live when it is present at the installed release's commit from the vault copy's repository.json. The pipeline gains a seam-check step after upstream-sync and before build-mac running check-seam.ts, check-seam.ts --mounts and seam-view.ts --verify; a non-zero exit stops the release. The slice closes with one release through the pipeline whose installed commit carries the manifest (S2-C09).",
    files: [
      {
        path: "scripts/throughline/seam-side.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "scripts/throughline/seam-view.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "docs/throughline/seam-view.html",
        side: "fork-namespace",
        action: "add",
        note: "generated, committed",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Pipeline.json",
        side: "config",
        action: "edit",
        note: "seam-check step between upstream-sync and build-mac",
      },
    ],
    signatures: [
      "node scripts/throughline/seam-side.ts --repo <abs> <path>...   prints '<path>\\t<class>\\t<where a new edit belongs>' per path; exit 1 on an unlisted upstream edit",
      "node scripts/throughline/seam-view.ts --repo <abs> --out docs/throughline/seam-view.html [--verify] [--installed-commit <sha>]",
      'Ship-Pipeline.json step { "id": "seam-check", "kind": "unit-build", "command": ["node", "{checkout}/scripts/throughline/check-seam.ts", "--repo", "{checkout}"] } placed after upstream-sync',
    ],
    failing_checks: ["S2-C07", "S2-C08", "S2-C09"],
    done_when: {
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts --repo /Users/Admin/throughline",
      expect:
        "exit 0: every slice-2 check green, including the guard, after one release from the pipeline is installed",
    },
    depends_on: ["T2.01", "T2.02", "T2.03"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [
      "closing needs a full release run; the tower sudo step stays Ryan's per SHAPE-2026-10-04 and is prepared, tested and presented, never assumed",
    ],
    rollback:
      "remove the seam-check step from Ship-Pipeline.json (core-root history) and path-limited revert of the two scripts and the view",
    annotations: {
      executor_change: "was OPUS_MED; the alignment review requires the Sol High workhorse role",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T3.01",
    enforcement_evidence: [
      {
        id: "B02",
        score: 9,
        finding:
          "write_stdin sends fresh input without another PreToolUse. Hosted/specialized paths can opt out. A full-access persistent shell cannot be called universally gated by a tool hook.",
        correction:
          "Give terminal-input/write_stdin and hosted/specialized calls separate unsupported pre-veto cells. Refuse protected-building effects while check-first is pending unless a proven OS read-only/design-test-writable mode contains them, or route through the same admission service with a typed controlled executor. Never infer safety from cwd or original approval.",
        status:
          "open: scored 9; with the Fable design thread 44973766-bbeb-4c80-b506-a4b171273e33, whose decision lands at execution/phase-02/closeout-2026-10-09/Fable-Delta-Enforcement.json and is applied verbatim before 0.4.0 is final",
        source: "G6-Enforcement.json section B",
      },
      {
        id: "B08",
        score: 4,
        finding:
          "This read-only task establishes source/tooling capability and custody metadata, not live disconnected-record/refused-operation trials.",
        correction:
          "Fold as design evidence, not K03 acceptance. Keep counts null and A05 evidence-needed until pinned provider/host/profile trials cover failures, bypasses, child binding and actual side-effect witnesses.",
        status: "folded in 0.4.0",
        source: "G6-Enforcement.json section B",
      },
    ],
    fork_state: [
      {
        ref: "55ae2ab8b9",
        disposition: "rework",
        reason:
          "Keep the bounded observer cache, but replace ProviderService's in-memory wait/sleep with the I-01 headroom slot and durable request wait rows; resolve the existing broker route per host and join actual configured identities.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/hello-continuation-20261009",
        disposition: "rework",
        reason:
          "Reuse authenticated boolean-only RPC guards, but direct serverSettings.updateSettings is not record admission or cross-host intent propagation; move behavior into the namespace with a minimal ws mount.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-3",
    detail_state: "detailed",
    title:
      "Every command that can start a provider turn goes through one admission point; every bypass door closes",
    serves: ["NG-007", "NG-112", "NG-027"],
    what: "Add the turn-admission module at apps/server/src/throughline/admission/ (fork namespace). CommandAdmission.ts defines TURN_EFFECT_COMMAND_TYPES = [\"thread.turn.start\", \"thread.user-input.respond\"] (the only decider cases that can start a provider turn, guarded by S3-G05), the six routes client-ws, client-http, comsnet, history-import, absurd-worker and server-reissue, the marker throughline.admission.v1 (logged at boot so the bundle keeps it), and the service CommandAdmission with admit, dispatch and startTurn. Provenance is object identity: admit() registers the command object in a module-private WeakSet and returns an AdmittedCommand; no serializable field can forge it (K01). Route rules: history-import admits thread.history.import and refuses thread.turn.start; server-reissue requires causationCommandId of an already admitted turn; client-ws, client-http, comsnet and absurd-worker admit both turn-effect types. EngineAdmissionGuard.ts decorates OrchestrationEngineService.dispatch and refuses an unadmitted turn-effect command with a typed error; other command types pass unchanged. TurnRail.ts takes spawnTurnOnAbsurdRail and its readiness gate out of ws.ts unchanged, keeping the Exclude-typed direct arm (S3-G01). Doors (E08-E14): ws.ts calls CommandAdmission.dispatch; http.ts stays unchanged, and a thread.turn.start sent through its handler reaches the engine unadmitted and is refused by the mounted EngineAdmissionGuard; comsnet dispatches through admission with route comsnet, a stable message id comsnet:<requestId>, and ComsNetRedrive.ts re-drives at boot any request marked dispatched whose turn-start event is absent, deduplicated by the stable command id (S3-G02); the reactor's after-compaction re-issue is admitted with route server-reissue; user-input answers are admitted with route client-ws and dispatched to the engine (their nested turn becomes durable through the outbox in T3.03). History import (operator intent from the refinement: never replay old actions, never manufacture new admission for old work): the command-line importer writes thread.history.import with the message shape AgentSessionImporter.ts builds (E13) through the offline engine with route history-import, emits no turn-start event and no effect, and its live-server guard probes the port the selected profile's server is configured to use; the outside resume tool stops writing orchestration_events, projection_threads and provider_session_runtime rows and calls the importer instead. Admit accepts optional intent references (vocabulary.intent_metadata_carriage) and keeps them on the AdmittedCommand; T3.03 persists them. The turn-rail capability manifest with the new pinned tests goes under docs/throughline/capabilities/turn-rail/. Effect admission and K08 check-first (generation 3, Oct 9, 2026): the same module exposes admitEffect for per-effect requests from the provider adapters (interface I-01). classifyEffect builds and brands the request server-side and resolves its paths; an unbranded request is refused. Only the target-policy slot (T9.03) decides whether an effect is building or marking done, from engine-typed facts; T3.01 combines that answer with the K03 enforcement matrix, read as measured data, and records every decision with its inputs. Rules T3.01 enforces: (1) Prevention happens only before execution. A post-tool observation is recorded as observed-after-execution with prevented false; a building effect observed while check-first is pending is a recorded violation that stops the request and surfaces it, never counted as prevented. (2) An opaque effect whose write set the adapter cannot resolve before execution (shell, terminal input, an unknown tool call) is never admitted on its cwd. While check-first is pending, or with no target revision when it can reach protected product scope, it runs only under a read-only or design-and-test-writable mode that the K03 matrix measures as supported for that provider and host, or it is refused with a usable safe alternative named in the decision: run it under the enforced mode, write a design note, record the failing check first, or dispatch to a seat whose target has one. (3) No target revision is not permission. The default slot classifies engine-resolved paths against ProtectedScopeSlot (the bound product repository roots and the install and release step ids): writes inside, install steps and release steps are refused with the safe alternative 'admit a target and record its failing check'; writes outside, such as designs and scratch, are admitted, which is K08's own no-target test. (4) The test path stays open: writes to the target revision's declared check files and running its declared check command are admitted before the failing check is recorded. (5) Turn starts, seat launches, dispatches, reads and design writes are admitted in every state. A turn on a provider with no measured pre-execution control is admitted with enforcement none and preventable false recorded; its building effects are refused where the adapter sees them first and otherwise become violations; nothing is advertised as enforced that K03 has not measured. Caller fields such as exploration, mode, skip_gate or a file name never change an outcome; they are listed as ignoredCallerFields. The admission decorator admits shell starts as effect attempts with outcome unknown; live shell input is not admitted per keystroke and is never claimed gated; the thread's effect ledger receives the host's observed changed-path record for each open shell session, and the done computation reads it (K08). The decorator mounts once at the engine assembly point already edited by the fork; no new stock-file edit; the HTTP dispatch door is closed by that refusal; the comsnet door's retirement and its three fork-file removal proofs belong to T7.04. Route slot (D25): admit() for the turn-effect command types and the comsnet route evaluates a route slot before dispatch, in the same transaction as the admission decision; the decision row records route (no_model | light | standard | lead_only), the pass that decided it (code | jev | default), the code facts used, the JEV step id when one exists, and the floor-file version. no_model dispatches no turn: the command is admitted, the event is recorded, a record-built reply is enqueued on the rail when the sender expects one, and the recipient's pending digest gains one entry. light, standard and lead_only dispatch a turn carrying the route so the provider adapter launches or resumes the recipient at the routed model and effort; a route the adapter cannot honour (no such model on this host) falls back to standard and records the fallback. The slot is a policy input exactly as the headroom slot (T11.04) and the target-policy slot (T9.03) are; it never changes a seat's launch setting and never edits the floor file.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
        side: "vault",
        action: "edit",
        exists_now: true,
        note: "S3-C02 drops its http.ts orchestrationEngine.dispatch text predicate and instead runs the behavioral refusal test in CommandAdmission.test.ts through the unchanged handler and the mounted decorator; its other two clauses are unchanged.",
      },
      {
        path: "apps/server/src/throughline/admission/CommandAdmission.test.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
      {
        path: "apps/server/src/throughline/admission/ComsNetRedrive.test.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
      {
        path: "apps/server/src/throughline/admission/CheckFirstSeam.test.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
      {
        path: "apps/server/src/cli/import-claude-sessions.test.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
      {
        path: "apps/server/src/throughline/admission/CommandAdmission.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "apps/server/src/throughline/admission/EngineAdmissionGuard.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "apps/server/src/throughline/admission/TurnRail.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create from ws.ts lines 1874-1986",
      },
      {
        path: "apps/server/src/throughline/admission/ComsNetRedrive.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "docs/throughline/capabilities/turn-rail/Capability.json",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "apps/server/src/orchestration/runtimeLayer.ts",
        side: "upstream-edit",
        action: "edit",
        note: "exists, fork-edited +8 -1; one mount line wraps OrchestrationEngineLive with OrchestrationEngineAdmissionGuardLive",
      },
      {
        path: "apps/server/src/orchestration/http.ts",
        side: "upstream-edit",
        action: "read",
        note: "apps/server/src/orchestration/http.ts (upstream-edit, read: unchanged; its turn starts are refused by the decorator); was: exists, no fork edits today; lines 114-121 call CommandAdmission.dispatch(command, 'client-http')",
      },
      {
        path: "apps/server/src/ws.ts",
        side: "upstream-edit",
        action: "edit",
        note: "exists, fork-edited +355 -42; the rail moves out (net fork lines fall); lines 1702 and 2001-2018 call the admission service",
      },
      {
        path: "apps/server/src/orchestration/Layers/ProviderCommandReactor.ts",
        side: "upstream-edit",
        action: "edit",
        note: "exists, fork-edited +10 -3; lines 351-362 admit the re-issue with route server-reissue",
      },
      {
        path: "apps/server/src/mcp/toolkits/comsnet/handlers.ts",
        side: "fork-namespace",
        action: "edit",
        note: "fork file outside the namespace folders, mislabelled upstream-edit before (E04); lines 119-163",
      },
      {
        path: "apps/server/src/cli/import-claude-sessions.ts",
        side: "fork-namespace",
        action: "edit",
        note: "fork file outside the namespace folders; lines 321-352 and 490-500",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-session-resume/src/index.ts",
        side: "outside-tool",
        action: "edit",
        note: "exists in Tier 1; lines 72-110 and 458-462 stop writing state.sqlite; ships through Ship Warden",
      },
      {
        path: "apps/server/src/orchestration/decider.ts",
        side: "upstream-edit",
        action: "read",
        note: "lines 1390-1396, 1616, 1686-1716, 2008: the two turn-effect cases and the history import",
      },
      {
        path: "packages/contracts/src/environmentHttp.ts",
        side: "upstream-edit",
        action: "read",
        note: "line 533: the HTTP dispatch endpoint",
      },
      {
        path: "apps/server/src/throughline/admission/EffectAdmission.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create: classifyEffect, admitEffect, TargetPolicySlot, NoTargetRecordPolicyLive",
      },
    ],
    signatures: [
      "I-01 operation (Fable delta B02): admitShellStart(thread, turn, generation, command) -> effect_id | refusal",
      "I-01 operation (Fable delta B02): observeEffects(effect_id, changed_paths[], observed_at) -> void",
      "I-01 operation (Fable delta B02): reconcileEffect(effect_id, by_seat) -> void (non-builder only)",
      "I-01 operation (Fable delta B04): admitModelRequest(thread, turn, generation) -> token (bound to generation and lease, K04, K12)",
      "I-01 operation (Fable delta B04): verifyAdmission(token) -> { thread, turn, generation, valid: boolean, reason }",
      "I-01 operation (Fable delta F05+T3.02): openRun(thread, turn, generation) -> run_id (an Absurd 0.5.0 task)",
      "I-01 operation (Fable delta F05+T3.02): mintStep(run_id, kind: model | tool | callback, descriptor) -> step_id, minted before execution",
      "I-01 operation (Fable delta F05+T3.02): writeOutcome(step_id, outcome: succeeded | failed | unknown, payload_ref)",
      "I-01 operation (Fable delta F05+T3.02): waitOn(run_id, step_id, event) -> durable 0.5.0 event wait",
      'export const ADMISSION_MARKER = "throughline.admission.v1"',
      'export const TURN_EFFECT_COMMAND_TYPES = ["thread.turn.start", "thread.user-input.respond"] as const',
      'export type AdmissionRoute = "client-ws" | "client-http" | "comsnet" | "history-import" | "absurd-worker" | "server-reissue"',
      'export interface IntentRefs { readonly shapeIds: ReadonlyArray<string>; readonly resolvedBy: "intent-index" | "jev-advisory"; readonly indexRef?: string }',
      "export class AdmittedCommand { private constructor(); readonly command: OrchestrationCommand; readonly route: AdmissionRoute; readonly admittedAt: string; readonly intent?: IntentRefs; readonly causationCommandId?: CommandId }",
      'export class AdmissionRefusedError extends Schema.TaggedErrorClass<AdmissionRefusedError>()("AdmissionRefusedError", { reason: Schema.Literal("route-not-allowed", "history-as-turn", "causation-not-admitted", "rail-not-ready"), commandType: Schema.String, route: Schema.String }) {}',
      "export interface CommandAdmissionShape { readonly admit: (command: OrchestrationCommand, route: AdmissionRoute, options?: { readonly origin?: OrchestrationClientOrigin; readonly intent?: IntentRefs; readonly causationCommandId?: CommandId }) => Effect.Effect<AdmittedCommand, AdmissionRefusedError>; readonly dispatch: (command: OrchestrationCommand, route: AdmissionRoute, options?: { readonly origin?: OrchestrationClientOrigin; readonly intent?: IntentRefs }) => Effect.Effect<{ readonly sequence: number }, AdmissionRefusedError | OrchestrationDispatchCommandError>; readonly startTurn: (admitted: AdmittedCommand) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> }",
      "export const OrchestrationEngineAdmissionGuardLive: Layer.Layer<OrchestrationEngineService, never, OrchestrationEngineService | CommandAdmission>",
      "export const redriveUnadmittedComsNetRequests: Effect.Effect<{ readonly redriven: number; readonly alreadyLanded: number }, never, ComsNetTransport | CommandAdmission | OrchestrationEngineService>",
      "test apps/server/src/throughline/admission/CommandAdmission.test.ts › 'the engine refuses an unadmitted thread.turn.start and an unadmitted thread.user-input.respond' (specified, not yet implemented)",
      "test … › 'a payload field named admitted or provenance does not admit a command' (specified, not yet implemented)",
      "test … › 'route history-import refuses thread.turn.start and admits thread.history.import' (specified, not yet implemented)",
      "test … › 'route server-reissue is refused unless the causation command was admitted' (specified, not yet implemented)",
      "test … › 'a thread.turn.start sent through the unchanged http.ts handler reaches the mounted EngineAdmissionGuard and is refused with its unadmitted-command error (the signed-admission reason, K01); no turn-start event is written; the refusal is counted by request id' (specified, not yet implemented)",
      "test apps/server/src/throughline/admission/ComsNetRedrive.test.ts › 'a request marked dispatched whose turn never landed is redriven once; one whose turn landed is left alone' (specified, not yet implemented)",
      "test apps/server/src/cli/import-claude-sessions.test.ts › 'history imports as thread.history.import and emits no thread.turn-start-requested event' and › 'refuses while the profile's configured port answers' (specified, not yet implemented)",
      "test /Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-session-resume/src/index.test.ts › 'resume writes no orchestration rows and invokes the importer' (specified, not yet implemented)",
      'export type EffectKind = "file-write" | "file-delete" | "patch" | "shell-exec" | "file-read" | "mcp-call" | "seat-launch" | "message-dispatch" | "model-request" | "install-step" | "release-step" | "target-change" | "done-claim" | "terminal-io"',
      'export type OperationClass = "pre-model" | "pre-tool" | "post-tool" | "cancel" | "compaction" | "native-resume" | "model-route" | "headroom-read"',
      "export interface ClassifiedEffect { readonly conversationId: ThreadId; readonly requestId: string; readonly generation: number; readonly executionGeneration: number; readonly provider: string; readonly operationClass: OperationClass; readonly effectKind: EffectKind; readonly resolvedPaths: ReadonlyArray<string>; readonly cwdResolved: string | null; readonly stepId: string | null; readonly callerFields: Readonly<Record<string, unknown>> }   // built only by classifyEffect; branded by a module-private registry like AdmittedCommand",
      "export const classifyEffect: (native: { provider: string; operationClass: OperationClass; effectKind: EffectKind; rawPaths: ReadonlyArray<string>; rawCwd: string | null; stepId: string | null; ids: { conversationId: ThreadId; requestId: string; generation: number; executionGeneration: number }; callerFields?: Readonly<Record<string, unknown>> }) => Effect.Effect<ClassifiedEffect, AdmissionRefusedError>   // resolves paths and cwd to absolute real paths; used by server-side adapters only",
      'export interface TargetPolicyDecision { readonly gate: "none" | "requires-failing-check"; readonly targetRevisionId: string | null; readonly checkRecorded: boolean; readonly deliverableRoots: ReadonlyArray<string>; readonly declaredCheckPaths: ReadonlyArray<string>; readonly declaredCheckCommand: string | null; readonly reasonCode: string; readonly policyVersion: string }',
      'export class TargetPolicySlot extends Context.Service<TargetPolicySlot, { readonly decide: (input: Omit<ClassifiedEffect, "callerFields">) => Effect.Effect<TargetPolicyDecision> }>()("throughline/TargetPolicySlot") {}   // implemented by T9.03; T3.01 ships NoTargetRecordPolicyLive',
      'export interface AdmissionDecision { readonly outcome: "admitted" | "refused" | "observe-only" | "wait"; readonly reasonCode: string; readonly commandId: CommandId; readonly enforcement: { readonly mode: "none" | "read-only" | "design-and-test-writable"; readonly writableRoots: ReadonlyArray<string>; readonly enforcedBy: "pre-tool-veto" | "provider-sandbox" | "os-account" | null }; readonly preventable: boolean; readonly prevented: boolean; readonly violation: boolean; readonly safeAlternative: string | null; readonly policyInputsUsed: ReadonlyArray<{ readonly slot: string; readonly version: string; readonly value: unknown }>; readonly ignoredCallerFields: ReadonlyArray<string> }',
      "CommandAdmissionShape.admitEffect: (effect: ClassifiedEffect) => Effect.Effect<AdmissionDecision, AdmissionRefusedError, TargetPolicySlot | ProtectedScopeSlot | EnforcementMatrix>   // applies rules (1)-(5); records the decision in the same transaction as the admitted row",
      'export class ProtectedScopeSlot extends Context.Service<ProtectedScopeSlot, { readonly roots: Effect.Effect<ReadonlyArray<string>>; readonly protectedStepIds: Effect.Effect<ReadonlyArray<string>> }>()("throughline/ProtectedScopeSlot") {}   // default: the bound product repository root and the pipeline install and release step ids',
      'export class EnforcementMatrix extends Context.Service<EnforcementMatrix, { readonly cell: (provider: string, host: string, operationClass: OperationClass) => Effect.Effect<{ readonly state: "supported" | "observe-only" | "unsupported"; readonly modes: ReadonlyArray<"read-only" | "design-and-test-writable">; readonly measuredAt: string | null }> }>()("throughline/EnforcementMatrix") {}   // data from the K03 measurements owned by the provider tasks; an unmeasured cell reads unsupported',
      "test apps/server/src/throughline/admission/CheckFirstSeam.test.ts › 'an opaque shell command whose write set cannot be resolved, in a thread whose target has no recorded failing check, is admitted only with an enforced mode when its K03 cell is measured supported and is otherwise refused with a safe alternative; a cwd outside the deliverable scope changes nothing' (specified, not yet implemented)",
      "test … › 'a post-tool observation of a building write while check-first is pending is recorded observed-after-execution with prevented false and a violation that stops the request' (specified, not yet implemented)",
      "test … › 'with no target revision, a write inside the bound product repository and an install step are refused with the safe alternative, while a design write outside it, a turn start, a seat launch and a dispatch are admitted' (specified, not yet implemented)",
      "test … › 'writes to the declared check files and the declared check command are admitted before the failing check is recorded; other writes in the deliverable scope wait' (specified, not yet implemented)",
      "test … › 'callerFields exploration=true, mode=design or a file name changes no outcome in any case above, and an unbranded request is refused' (specified, not yet implemented)",
      "I-01 operation (Fable delta D25): routeTurn(admitted, recipient_generation, floor) -> RouteDecision { route: no_model | light | standard | lead_only; decided_by: code | jev | default; facts: CodeFacts; jev_step_id?: string; reply?: RecordReply; floor_version: string }",
      "I-01 operation (Fable delta D25): coalesceWake(recipient_public_id, generation) -> WakeDigest { entries: AdmittedCommandRef[]; superseded: AdmittedCommandRef[]; one_turn: true }",
    ],
    failing_checks: ["S3-C01", "S3-C02", "S3-C03", "S3-C04", "S3-C05", "S3-C06", "S3-C12"],
    done_when: {
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C01 S3-C02 S3-C03 S3-C04 S3-C05 S3-C06 S3-C12 S3-G01 S3-G02 S3-G03 S3-G05 && cd /Users/Admin/throughline/apps/server && pnpm exec vp test run src/throughline/admission/CommandAdmission.test.ts src/throughline/admission/ComsNetRedrive.test.ts src/throughline/admission/CheckFirstSeam.test.ts src/cli/import-claude-sessions.test.ts && pnpm -C /Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-session-resume run test",
      expect:
        "exit 0; every named test present and green; the guards stay green; the live-input counterexample in K03 runs against the installed admission service: the observed write is on the record as an effect, no veto is claimed, and the done computation refuses until reconciled; the stock upstream files the fork edits after T3.01, read from the slice-2 seam manifest against the pinned upstream and fork SHAs (T2.01), are no more than the admitted stock-file set and do not include apps/server/src/orchestration/http.ts; a turn start through the HTTP endpoint is refused with the signed-admission reason, counted; the six Oct 10, 2026 notice wakes replayed as fixtures through the admission module (observation mode, no provider) record route no_model with decided_by code and start zero turns; the lead ruling fixture records standard and starts one turn; Ryan's liveness fixture records no_model with a record-built reply",
    },
    depends_on: ["T2.01", "T2.02", "T3.07"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [
      "the comsnet transport is replaced in slice 7 (T7.04); the redrive sweep is small on purpose and dies with it",
      "the importer's provider_session_runtime resume binding stays a runtime table write; its re-entry meaning belongs to slice 8 (K06)",
      "the resume tool ships through Ship Warden on its own lane; until it ships, the operator procedure that uses it still writes SQLite, so it ships before the slice-3 release",
    ],
    rollback:
      "path-limited git revert of the admission module and the five call-site edits; the rail returns to ws.ts unchanged because it was moved verbatim; the resume tool's previous version re-shipped through Ship Warden",
    annotations: {
      evidence: ["E08", "E09", "E10", "E11", "E12", "E13", "E14", "E15"],
      title_change:
        "was 'the three bypass doors close'; the inspected code has more than three (door_inventory)",
      already_green_invariants: [
        "S3-G01 direct arm excludes turn starts by type",
        "S3-G02 stable comsnet command id",
        "S3-G03 imported-session ids refused as turns",
        "S3-G05 only two command types can start a turn",
      ],
      discriminating_failure:
        "an unadmitted turn-effect command built in any new file is refused at the engine; the same command passed through admit() is accepted",
      k08_seam:
        "Owner split per Integration-Decisions.json check_first: T3.01 admits effects and records decisions; T9.03 supplies the target-policy slot; provider adapters (T8.01 and the slice-11 tasks) supply engine-typed facts and the K03 measurements behind EnforcementMatrix; on the tower, per-agent accounts (slice 6) may become an os-account enforcement once measured. The scope slot (owning identity) is supplied by T8.01; withdrawn T10.11 owns nothing here, and existing terminal effects keep their ownership checks and are opaque effects under rule (2). The headroom slot is T11.04. Those tasks depend on T3.01; T3.01 depends on none of them. Task id T3.05 is reserved for the capability negotiation task and is not used by this proposal.",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T3.02",
    fork_state: [
      {
        ref: "a63c8239e5",
        disposition: "rework",
        reason:
          "Keep typed trusted-sender serialization, but replace long-lived t3.thread-run/random command creation with request/generation workflows, deterministic task-step IDs and admission-owned durable context.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "55ae2ab8b9",
        disposition: "rework",
        reason:
          "Keep the bounded observer cache, but replace ProviderService's in-memory wait/sleep with the I-01 headroom slot and durable request wait rows; resolve the existing broker route per host and join actual configured identities.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/hello-absurd-types-059-20261009",
        disposition: "rework",
        reason:
          "Retain typed Effect/platform fixes and the rpc.test.ts unknown-field decode correction, but port to absurd-sdk exactly 0.5.0 and request workflows; do not import inherited 0.0.57/0.0.58 stamps.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-3",
    detail_state: "detailed",
    title:
      "One short Absurd workflow per request under the conversation; one recorded step per finished message; large tool results in a blob table",
    serves: ["NG-003", "NG-009", "NG-011", "NG-015"],
    what: "Build the record and the request workflow as a library with tests; T3.03 mounts it. New package packages/throughline-record (@throughline/record; it never imports server code, the same direction rule as absurd-runtime). Its migration creates schema throughline_record in the existing absurd database with seven tables: admitted_commands (command_id primary key, command_type, aggregate_kind, aggregate_id, route, admitted_at, origin, intent, causation_command_id, payload), events (the orchestration_events columns of E19, payload and metadata as jsonb, unique(stream_id, stream_version), command_id referencing admitted_commands), effect_attempts (effect_id, attempt, command_id, effect_kind, lease_owner, execution_generation, started_at, finished_at, outcome succeeded | failed | unknown, idempotent, detail; primary key effect_id and attempt), outbox (effect_id, command_id, effect_kind, request_id, generation, state pending | spawned | done, absurd_task_id), projection_cursors (consumer, last_sequence), admission_decisions (decision_id, command_id or effect_id, outcome, reason_code, policy_inputs_used, ignored_caller_fields, decided_at; written in the same transaction as the admitted row so a judge can replay a decision) and blobs (blob_id as sha256, size_bytes, media_type, custody, retention, bytes). RecordPort.appendAdmitted writes the command row, its events and their outbox rows in one transaction and is idempotent on command_id. An outbox row exists for every thread.turn-start-requested event (provider-turn effect); a settings-change command (alignment entry IA-04, NG-114) is admitted and recorded with events and no outbox row. beginEffect claims an attempt under a lease; an attempt whose lease expired without an outcome becomes unknown; a non-idempotent unknown stops its request and surfaces it, never retried silently (K01). Request workflow throughline.request (K02): one Absurd 0.5.0 run per admitted turn, with one step per managed model request, tool start and provider callback, the step id minted by I-01 before the action and carried by it, keyed request id (the admitted command id) and generation, steps ensure-started (claims the effect; starts the provider only if no attempt exists) then await-terminal (Absurd 0.5.0 durable event turn-terminal:<requestId>:<generation>, holding no worker slot), with ACK, progress, reply, terminal result and verified completion kept as distinct states, and a late or duplicate reply to a closed generation recorded and ignored. One recorded step per finished message: every finished assistant message is one event with its own effect id, so a crash mid-turn resumes after the last finished message. Tool results over the step payload limit are stored in blobs and the event carries the blob id; the limit is read from Absurd 0.5.0 or, if undocumented, set to the largest payload the record test proves stores and reloads, recorded as a named constant. The in-process transport derives created thread ids and command ids from the task id and step name (E16); the symphony campaign task t3.thread-run stays, now idempotent. Evidence pointer (D25): a tool result stored in blobs is addressable by the model through one read-back operation on the record, readBlob(blob_id, byte_range) -> bytes, so a provider adapter may hand the model an evidence summary with the blob id instead of the raw result and the model can still recover any original passage.",
    files: [
      {
        path: "packages/throughline-record/package.json",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "packages/throughline-record/src/record.sql",
        side: "fork-namespace",
        action: "add",
        note: "to create; schema throughline_record",
      },
      {
        path: "packages/throughline-record/src/RecordPort.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "packages/throughline-record/src/request-workflow.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "packages/absurd-runtime/src/in-process-transport.ts",
        side: "fork-namespace",
        action: "edit",
        note: "exists; lines 70-125",
      },
      {
        path: "packages/absurd-runtime/src/thread-driver.ts",
        side: "fork-namespace",
        action: "edit",
        note: "exists; the ThreadTransport methods gain the step context",
      },
      {
        path: "apps/server/src/orchestration/AbsurdRuntimeInProcess.ts",
        side: "fork-namespace",
        action: "edit",
        note: "fork file, mislabelled upstream-edit before (E04); registers throughline.request",
      },
    ],
    signatures: [
      "export interface AdmittedCommandRow { commandId: string; commandType: string; aggregateKind: string; aggregateId: string; route: string; admittedAt: string; origin: unknown; intent: unknown; causationCommandId: string | null; payload: unknown }",
      "export interface RecordPort { appendAdmitted(input: { admitted: AdmittedCommandRow; events: ReadonlyArray<EventRow>; effects: ReadonlyArray<OutboxRow> }): Promise<{ firstSequence: number; lastSequence: number; duplicate: boolean }>; readFromSequence(fromExclusive: number, limit?: number): AsyncIterable<EventRow>; beginEffect(effectId: string, lease: { owner: string; generation: number; idempotent: boolean }): Promise<{ attempt: number; prior: 'succeeded' | 'failed' | 'unknown' | null }>; finishEffect(effectId: string, attempt: number, outcome: 'succeeded' | 'failed'): Promise<void>; markUnknownOnLeaseLoss(owner: string): Promise<number>; putBlob(input: { bytes: Uint8Array; mediaType: string; custody: string; retention: string }): Promise<{ blobId: string }>; advanceCursor(consumer: string, sequence: number): Promise<void> }",
      "export function makePostgresRecordPort(config: { connectionFromServerConfig: true }): RecordPort   // reads the same connection setting the AbsurdRuntime layer uses; never from argv",
      'export const REQUEST_TASK = "throughline.request"; export function registerRequestWorkflow(app: Absurd, deps: { record: RecordPort; startProviderTurn: (effectId: string) => Promise<void> }): void',
      "ThreadTransport.resolveThread(params, step: { taskId: string; step: string }); ThreadTransport.dispatchTurn(threadId, prompt, turnCommand, step: { taskId: string; step: string })",
      "test packages/throughline-record/src/record.test.ts › 'appendAdmitted writes the command, its events and its outbox rows in one transaction; a repeated command id writes nothing' (specified, not yet implemented)",
      "test … › 'an attempt whose lease expired without an outcome is unknown and a non-idempotent unknown is never retried' (specified, not yet implemented)",
      "test … › 'a tool result over the step payload limit lands in blobs with custody and retention' (specified, not yet implemented)",
      "test … › 'a settings-change command records events and no outbox row' (specified, not yet implemented)",
      "test packages/throughline-record/src/request-workflow.test.ts › K02 verbatim: 'saturate worker concurrency, then send reply-before-wait, duplicate reply, late reply, timeout then reply, cancellation then result, and two simultaneous asks in one conversation: exactly one intended resume per request and no false target completion' (specified, not yet implemented)",
      "test packages/absurd-runtime/src/thread-driver.test.ts › 'a crash after dispatch-turn ran and before its checkpoint commits yields one thread and one turn on resume' (specified, not yet implemented)",
      "test packages/throughline-record/src/record.test.ts › 'an admission decision is written with its policy inputs in the same transaction as its admitted row' (specified, not yet implemented)",
      "RecordPort.readBlob(blobId: string, range?: { start: number; end: number }) -> Promise<{ bytes: Uint8Array; mediaType: string; size: number }>",
    ],
    failing_checks: ["S3-C08", "S3-C09"],
    done_when: {
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C08 S3-C09 && cd /Users/Admin/throughline/packages/throughline-record && pnpm exec vp test run && cd /Users/Admin/throughline/packages/absurd-runtime && pnpm exec vp test run src/thread-driver.test.ts",
      expect:
        "exit 0; every named test present and green; tests use a disposable database they create and drop; a kill between step-id mint and provider call, between provider call and outcome write, and during a durable wait each resumes with no re-executed step and the unknown step surfaced; the step ids on the record match the ids the broker and the hooks logged",
    },
    depends_on: ["T3.01", "T3.04"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [
      "nothing in the running server changes in this task; the record is exercised only by tests until T3.03 mounts it",
    ],
    rollback:
      "path-limited git revert of packages/throughline-record and the transport edits; drop schema throughline_record (it holds only test data at this point)",
    annotations: {
      evidence: ["E16", "E17", "E19"],
      title_change:
        "the old title said 'One Absurd task per thread', the design K02 rejected in favor of one short workflow per request",
      cross_cutting: [
        "IA-04: settings changes are admitted commands on the record (T10.04 now depends on T3.02)",
        "IA-02: intent references are stored in admitted_commands.intent and copied to events.metadata.intent",
      ],
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T3.03",
    fork_state: [
      {
        ref: "06d31c5452",
        disposition: "rework",
        reason:
          "Move SQLite identity_alias migration/binding into the authoritative Postgres record transaction with admitted commands, preserve existing rows in backfill/dual-write and retire the native-lineage resolver only after compatibility proof.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "30f8e3e388",
        disposition: "rework",
        reason:
          "Reuse authenticated-claim/refusal tests and sender payloads, but move engine/projection SQLite stamping into record-owned identity joins and admission; authenticate every ingress and retain MCP only until the CLI replacement is proven.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "f03e6ad350",
        disposition: "rework",
        reason:
          "Extract the large makeExistingSettingsConsumer adapter from OrchestrationEngine into the fork namespace and persist settings commands/events through RecordPort; retain exact receipt/environment comparison tests.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/ident-typecheck-059-20261009",
        disposition: "rework",
        reason:
          "Retain typed authorization/evidence encoding fixes, but the corrected makeExistingSettingsConsumer remains in OrchestrationEngine and must be extracted/rebound to RecordPort.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-3",
    detail_state: "detailed",
    title:
      "Absurd is the record; the screen's store is rebuilt from it; the per-message coverage check",
    serves: ["NG-010", "NG-137", "NG-012", "NG-008"],
    what: "Mount the record in the server with no edit to the engine file. apps/server/src/throughline/record/RecordBackedEventStore.ts implements the upstream OrchestrationEventStore and command-receipt service shapes over RecordPort, keeping the event vocabulary. RecordFirstTransactionClient.ts is the SqlClient handed to the engine only: withTransaction opens the SQLite transaction, then the Postgres transaction inside it, so Postgres commits first; a SQLite failure after that leaves the screen store behind, and the projection pipeline catches up from projection_state by cursor. runtimeLayer.ts provides both to the engine in place of OrchestrationEventStoreLive and the receipt repository. OutboxDispatcher.ts spawns throughline.request for pending outbox rows; the reactor claims the provider-turn effect through RecordPort.beginEffect before sendTurn (one mount line at the sendTurn call), so the live path and the workflow's ensure-started never both start a turn. Before the server first boots on the record, scripts/throughline/backfill-record.ts copies every existing orchestration_events row and command receipt from a VACUUM INTO snapshot of state.sqlite into the record with the same event ids, stream versions and order, and verifies per-stream counts and hashes; if verification fails the mount is not switched and the server keeps SQLite (no history loss). scripts/throughline/check-record-coverage.ts proves every projected message has its event and every finished turn its effect outcome. Absurd down: a new turn is refused with turn rail not ready: queue-reachability, drafts stay unsubmitted, history reads from the screen store marked stale (K05). The slice closes with one release whose installed bundle carries the admission marker (S3-C11).",
    files: [
      {
        path: "apps/server/src/throughline/record/RecordBackedEventStore.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "apps/server/src/throughline/record/RecordFirstTransactionClient.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "apps/server/src/throughline/record/OutboxDispatcher.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "scripts/throughline/backfill-record.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "scripts/throughline/check-record-coverage.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "apps/server/src/orchestration/runtimeLayer.ts",
        side: "upstream-edit",
        action: "edit",
        note: "the same file T3.01 mounts in; replaces the placeholder 'apps/server/src/ (event store)'",
      },
      {
        path: "apps/server/src/orchestration/Layers/ProviderCommandReactor.ts",
        side: "upstream-edit",
        action: "edit",
        note: "the same file T3.01 edits; one line claims the effect before sendTurn",
      },
      {
        path: "apps/server/src/orchestration/Layers/OrchestrationEngine.ts",
        side: "upstream-edit",
        action: "read",
        note: "lines 84-90 and 268-300; not edited",
      },
    ],
    signatures: [
      "export const RecordBackedEventStoreLive: Layer.Layer<OrchestrationEventStore | OrchestrationCommandReceiptRepository, never, RecordPortService>",
      "export const RecordFirstTransactionClientLive: Layer.Layer<SqlClient.SqlClient, never, SqliteClient | PgClient>   // provided to OrchestrationEngineLive only",
      "export const OutboxDispatcherLive: Layer.Layer<never, never, RecordPortService | AbsurdRuntime>",
      "node scripts/throughline/backfill-record.ts --repo <abs> --sqlite-snapshot <abs> [--verify-only]   exit 0 only when every stream's count and hash match",
      "node scripts/throughline/check-record-coverage.ts --repo <abs> [--since <sequence>]   exit 1 names each message without an event and each finished turn without an outcome",
      "test apps/server/src/throughline/record/crash-boundaries.test.ts › K01 verbatim: 'kill the process at every boundary (before admission, after admission before enqueue, after enqueue before effect, after effect before outcome, after outcome before notification): duplicate submission yields exactly one admitted command and no repeated non-idempotent effect' (specified, not yet implemented)",
      "test … › 'delete the screen store and rebuild the same ordered history from the record' and › 'restore from a snapshot plus the event log and compare projections' (specified, not yet implemented)",
      "test … › 'with the record unreachable a new turn is refused, the draft stays unsubmitted and history reads as stale' (specified, not yet implemented)",
    ],
    failing_checks: ["S3-C10", "S3-C11"],
    done_when: {
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline && cd /Users/Admin/throughline/apps/server && pnpm exec vp test run src/throughline/record/crash-boundaries.test.ts && node /Users/Admin/throughline/scripts/throughline/check-record-coverage.ts --repo /Users/Admin/throughline",
      expect:
        "exit 0: every slice-3 check green including the guards and the installed-bundle marker; crash tests green on a disposable database; coverage reports zero gaps on the installed Mac record after the slice release",
    },
    depends_on: ["T3.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [
      "data loss if the backfill is skipped; the switch is gated on backfill verification and the SQLite snapshot stays as rollback",
      "two-database ordering: Postgres commits before SQLite; the opposite order would let the screen show events the record lacks",
    ],
    rollback:
      "provide OrchestrationEventStoreLive and the SQLite receipt repository again in runtimeLayer.ts (path-limited revert) and restart; SQLite still holds every event up to the switch, and events written after it are exported from the record with the backfill script's reverse mode before reverting",
    annotations: {
      evidence: ["E18", "E19"],
      discriminating_failure:
        "a kill after the Postgres commit and before the SQLite commit leaves the screen behind and the cursor catch-up restores it without a duplicate event",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T4.01",
    enforcement_evidence: [
      {
        id: "B07",
        score: 8,
        finding:
          "twr-owned 0664 unit contains DB env assignment; same twr owns server/DB. 0600 state under same uid does not isolate twr agents. Mac dev env mode 0644. App-only keychain identity/ACL not established.",
        correction:
          "Keep K05 sole-not-isolated until T6.02/K04 reach test. Name owning app/keychain identity and use installed boolean ACL diagnostic plus non-secret canary; remove harness env inheritance. Retire readable dev source only in guarded cutover, not in this read-only task.",
        status: "folded in 0.4.0",
        source: "G6-Enforcement.json section B",
        superseded_by:
          "R2 three-state interval for current ownership/custody claims; the original finding and correction remain history",
      },
    ],
    slice: "slice-4",
    title:
      "The existing tower Postgres bound to the tailnet interface with TLS and one role per host",
    serves: ["NG-016", "NG-066"],
    detail_state: "detailed",
    what: "The existing user-owned cluster (absurd-pg.service under twr, binaries and data at /home/twr/absurd-pg) stays in place and is rebound: listen_addresses adds the tailnet address 100.96.34.116 beside loopback; ssl=on with a server certificate and key under /home/twr/absurd-pg/tls (mode 0600, owner twr) in state shared-account; T4.06 relocates both to /etc/throughline/record-tls/ (root:throughline-record 0750; certificate 0644; key 0640 root-owned with group read) and rewrites the two ssl_*_file lines in the same batch; pg_hba.conf admits only hostssl rows: one role per connecting host (the tower server role over loopback, the Mac app role from the Mac's tailnet address) with scram-sha-256; no trust rows, no 0.0.0.0. Role credentials: the tower server role's credential lives in the ThroughLine server unit's private state (readable by the server account only); the Mac app role's credential lives in the app-only keychain entry (D04) proven by the K05 read-refusal test; the Raspberry Pi observer of T4.03 uses no role (credential-free liveness probe). AbsurdRuntimeInProcess.ts takes host identity from the record, not from environment variables. T4.01 rebinds the cluster in place under its current owner twr (state shared-account); T4.06, batched with T6.01 in the Phase 4 sudo act, moves the same binaries and data to the throughline-record account as the system unit throughline-record.service (state record-isolated-seats-shared), and the postgresql.conf and pg_hba.conf edited here travel with the data directory unchanged; seat isolation (state authority-isolated) is delivered by T6.02, where the K04 reach test runs. Measured Oct 9, 2026, structure only (G6 B07): the twr-owned unit file is mode 0664 and carries the database environment assignment; the same twr account owns the server and the database, so 0600 state under that account does not isolate twr agents; the Mac development environment source is mode 0644; the app-only keychain identity and its access list are not yet established. This measured intake is shared-account; record isolation and tower credential custody become claimable only from T4.06, and agent binding and seat isolation only from T6.02 and its K04 reach test. This task names the owning app and keychain identity, proves the access list with the installed boolean diagnostic plus a non-secret canary, removes credential inheritance from the harness environment, and retires the readable development source only in the guarded cutover.",
    files: [
      {
        path: "/home/twr/absurd-pg/data/postgresql.conf",
        side: "host-filesystem",
        host: "twr",
        owner: "twr",
        action: "edit",
        note: "listen_addresses, ssl, ssl_cert_file, ssl_key_file; backup copy beside it before edit; the two configuration files are edited at /home/twr/absurd-pg/data/ before T4.06 and live at /srv/agents-runtime-state/absurd-pg/data/ after it; the done_when reads whichever path the current state names; ssl_cert_file and ssl_key_file are the two configuration lines that do not travel unchanged: T4.06 rewrites them to /etc/throughline/record-tls/",
      },
      {
        path: "/home/twr/absurd-pg/data/pg_hba.conf",
        side: "host-filesystem",
        host: "twr",
        owner: "twr",
        action: "edit",
        note: "hostssl rows only; backup copy beside it; the two configuration files are edited at /home/twr/absurd-pg/data/ before T4.06 and live at /srv/agents-runtime-state/absurd-pg/data/ after it; the done_when reads whichever path the current state names",
      },
      {
        path: "/home/twr/.config/systemd/user/absurd-pg.service",
        side: "host-filesystem",
        host: "twr",
        owner: "twr",
        action: "read",
        note: "unchanged; Restart=always retained",
      },
      {
        path: "apps/server/src/orchestration/AbsurdRuntimeInProcess.ts",
        side: "fork-namespace",
        action: "edit",
        note: "host identity from the record, not environment variables (already listed in spec 0.3.0)",
      },
      {
        path: "/usr/bin/openssl (Mac)",
        side: "host-filesystem",
        action: "run",
        note: "credential-free TLS handshake probe with -starttls postgres; prints certificate metadata only, no role, no password",
        surface: "verification",
      },
      {
        path: "/usr/bin/openssl (rpi)",
        side: "host-filesystem",
        action: "run",
        note: "credential-free TLS handshake probe with -starttls postgres; prints certificate metadata only, no role, no password",
        surface: "verification",
      },
      {
        path: "/home/twr/absurd-pg/bin/psql",
        side: "host-filesystem",
        host: "twr",
        owner: "twr",
        action: "run",
        note: "the cluster's own client, run only as the cluster owner over the local socket for the connection-table read and for the deliberate non-TLS refusal; no password on any command line",
      },
      {
        path: "/Users/Admin/core-root/src/tools/absurd-sandbox/dist/habitat-up.mjs",
        side: "outside-tool",
        action: "read",
        note: "the declared Tier 2 payload of absurd-sandbox (runtime-targets.json); its `check` subcommand becomes the Mac-side credential-free rail probe once T4.02 ships the remote-target configuration; it is not used by T4.01 and pg-reachable.ts is never imported as proof",
        surface: "verification",
      },
    ],
    signatures: [
      "two receipts in execution/phase-04/: the Raspberry Pi reachability line and the Mac role-plus-keychain lines, each with the non-builder's session id",
    ],
    planned_checks: [
      {
        id: "T4.01-ia07-canary",
        kind: "contract-test",
        command:
          "place a fixed non-secret canary value in the same custody as the Mac app role credential; launch a seat through the real launcher and call the app's protected API paths from it",
        expect:
          "the canary is absent from the child environment and from any export; the seat cannot get an acceptance or a record write accepted through the app or server as a proxy; only booleans and refusal codes are reported, never a credential",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    done_when: {
      host: "rpi and the Mac for credential-free transport; twr (as the cluster owner over the local socket) for authenticated consumption observed from the server side; fired by a non-builder; no role or credential is handed to any test process",
      command:
        "State scope: the twr-owner psql probes below run only before T4.06, in shared-account; after T4.06 consume the server diagnostics and installed-message proof specified by T4.06, never obtain the role credential or run authenticated psql as twr. Configuration reads follow the state-named path. (a) transport and TLS, credential-free, from rpi and from the Mac: timeout 4 bash -c '</dev/tcp/100.96.34.116/5432' && echo OPEN; openssl s_client -starttls postgres -connect 100.96.34.116:5432 -servername twr </dev/null 2>/dev/null | grep -E '^(Protocol|Verify return code|subject=|issuer=)' ; (b) non-TLS refusal, as twr on the tower using the cluster's own client with no password: /home/twr/absurd-pg/bin/psql 'host=100.96.34.116 port=5432 dbname=absurd user=<mac role> sslmode=disable' -c 'select 1' ; (c) authenticated app consumption observed from the server side, as twr over the local socket (peer authentication, no password on the command line) while the installed /Applications/ThroughLine.app is running and shows its record connected: /home/twr/absurd-pg/bin/psql -h /tmp -d absurd -At -c \"select a.usename, a.client_addr, s.ssl, s.version from pg_stat_activity a join pg_stat_ssl s using (pid) where a.usename in ('<mac role>')\"",
      expect:
        "(a) OPEN on both hosts; the handshake reports a TLS 1.2-or-newer protocol and the certificate subject and issuer the T4.01 receipt pinned (self-signed is allowed in this task and its fingerprint is recorded; the verify return code is recorded as observed, not asserted zero); (b) the server refuses before authentication with the pg_hba message naming SSL off, no password prompt, no credential sent; (c) exactly one row per connected host: the Mac role from the Mac's tailnet address with ssl=t, and no row for any unlisted host; keychain boundary: recorded as PENDING-T6.03 in this receipt, proven by T6.03's access check, never by reading the item here",
    },
    depends_on: ["T3.03"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [],
    rollback:
      "restore postgresql.conf and pg_hba.conf from the beside-file backups; `systemctl --user restart absurd-pg.service` as twr; drop the new roles; the cluster and data are untouched throughout",
    failing_check_first:
      "measured before the work: from the Raspberry Pi, port 5432 on 100.96.34.116 is CLOSED (2026-10-09); the same probe is the first green",
    retained_protection:
      "absurd-pg.service Restart=always, RestartSec=3, NRestarts=0 is kept exactly; the done_when re-reads those fields and fails if any changed",
    failure_test:
      "Fail if: any pg_hba row is not hostssl; the non-TLS attempt in (b) reaches authentication or prompts for a password; the connection table in (c) shows a listed role from an unlisted address, or ssl=f for any listed role; the probe from an unlisted tailnet host succeeds; the unit's Restart policy changed; any test command in this task carries a password, imports Tier 1 source as proof, or passes -w to the keychain tool",
    ryan_act:
      "none expected. If a tower firewall blocks 5432 on the tailnet interface after the rebind (probe still CLOSED with the server listening on 100.96.34.116 per `ss -ltn`), the worker prepares the literal nft or ufw command plus its rollback and hands it as a sudo act under SHAPE-2026-10-04; that is the only privileged step and it is conditional",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    interfaces_required: [
      "T3.03 supplies the admission port. Before T4.06, state shared-account, the existing twr private environment file is not credential isolation. T4.06 owns the root-held credential loaded only into throughline-server; its zero-output diagnostics/canary and installed consumption establish custody, not T6.01's seat StateDirectory.",
      "the Mac keychain boundary for the Mac app role (K05's read-refusal test) is proven by T6.03's keychain access check, which owns the adapter and the item; T4.01's receipt records keychain=PENDING-T6.03 and no depends_on edge is added, so the graph is unchanged",
    ],
    proof_limits: [
      "the connection-table read proves the installed app consumed the role over TLS from the Mac's address; it does not prove which process on the Mac holds the credential, which is T6.03's access check",
      "TLS proves transport privacy, not that the certificate is pinned by every client; pinning is named for slice 12",
      "the twr-side psql commands run as the cluster owner in the declared state shared-account before T4.06; they are read-only queries and send no credential, but they are not evidence of seat isolation",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        what: "The existing user-owned cluster (absurd-pg.service under twr, binaries and data at /home/twr/absurd-pg) stays in place and is rebound: listen_addresses adds the tailnet address 100.96.34.116 beside loopback; ssl=on with a server certificate under /home/twr/absurd-pg/tls (mode 0600, owner twr); pg_hba.conf admits only hostssl rows: one role per connecting host (the tower server role over loopback, the Mac app role from the Mac's tailnet address, the Raspberry Pi server role from the Raspberry Pi's tailnet address) with scram-sha-256; no trust rows, no 0.0.0.0. Role credentials: the tower server role's credential lives in the ThroughLine server unit's private state (readable by the server account only); the Mac app role's credential lives in the app-only keychain entry (D04) proven by the K05 read-refusal test; the Raspberry Pi observer of T4.03 uses no role (credential-free liveness probe). AbsurdRuntimeInProcess.ts takes host identity from the record, not from environment variables. The cluster owner stays twr (existing eligible owner); seat isolation from the record is delivered by T6.01/T6.02, which is where the K04 reach test runs. Measured Oct 9, 2026, structure only (G6 B07): the twr-owned unit file is mode 0664 and carries the database environment assignment; the same twr account owns the server and the database, so 0600 state under that account does not isolate twr agents; the Mac development environment source is mode 0644; the app-only keychain identity and its access list are not yet established. So K05 stays sole holder, not isolated, until T6.02 and the K04 reach test pass. This task names the owning app and keychain identity, proves the access list with the installed boolean diagnostic plus a non-secret canary, removes credential inheritance from the harness environment, and retires the readable development source only in the guarded cutover.",
        done_when: {
          host: "rpi and the Mac for credential-free transport; twr (as the cluster owner over the local socket) for authenticated consumption observed from the server side; fired by a non-builder; no role or credential is handed to any test process",
          command:
            "(a) transport and TLS, credential-free, from rpi and from the Mac: timeout 4 bash -c '</dev/tcp/100.96.34.116/5432' && echo OPEN; openssl s_client -starttls postgres -connect 100.96.34.116:5432 -servername twr </dev/null 2>/dev/null | grep -E '^(Protocol|Verify return code|subject=|issuer=)' ; (b) non-TLS refusal, as twr on the tower using the cluster's own client with no password: /home/twr/absurd-pg/bin/psql 'host=100.96.34.116 port=5432 dbname=absurd user=<mac role> sslmode=disable' -c 'select 1' ; (c) authenticated app consumption observed from the server side, as twr over the local socket (peer authentication, no password on the command line) while the installed /Applications/ThroughLine.app is running and shows its record connected: /home/twr/absurd-pg/bin/psql -h /tmp -d absurd -At -c \"select a.usename, a.client_addr, s.ssl, s.version from pg_stat_activity a join pg_stat_ssl s using (pid) where a.usename in ('<mac role>','<rpi role>')\"",
          expect:
            "(a) OPEN on both hosts; the handshake reports a TLS 1.2-or-newer protocol and the certificate subject and issuer the T4.01 receipt pinned (self-signed is allowed in this task and its fingerprint is recorded; the verify return code is recorded as observed, not asserted zero); (b) the server refuses before authentication with the pg_hba message naming SSL off, no password prompt, no credential sent; (c) exactly one row per connected host: the Mac role from the Mac's tailnet address with ssl=t, and no row for any unlisted host; keychain boundary: recorded as PENDING-T6.03 in this receipt, proven by T6.03's access check, never by reading the item here",
        },
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T4.02",
    later_named_task: {
      text: "T4.04 (new, slice 4, after Phase 6 acceptance): drop staging databases, remove the Mac Postgres data directory, archive dump files; owner the same seat; no cutover logic",
      numbering:
        "Fable named it T4.04; that id is the existing Raspberry Pi notify.push task, so the cleanup task takes the next free slice-4 number when it is created after Phase 6 acceptance",
      source: "Fable-Delta-Hosts.json item 1",
      deferred_rpi:
        "General Raspberry Pi data cleanup remains paused; no recovery-island data is deleted or merged.",
    },
    slice: "slice-4",
    title: "The Mac record is cut over into the one tower record; the Mac keeps none",
    serves: ["NG-016", "NG-008", "NG-131"],
    detail_state: "detailed",
    what: "The Mac source record (Homebrew Postgres) is cut over into the tower cluster's authoritative database by the cutover tool (packages/throughline-record-cutover): fence the source admission with a visible refusal and drain in-flight effects to terminal or unknown; snapshot with pg_dump and a recorded digest; restore into a worker-less staging database on the tower cluster; verify counts, event ordering, blob digests and pending tasks, steps and waits; merge under existing identities with ON CONFLICT DO NOTHING asserting zero conflicts and recording every inserted key in throughline_import_ledger; switch the source server's connection to the tower record through its own host role; the fence stays on the source forever. Rollback inside the window deletes exactly the ledgered rows and repoints the source; before the switch the source is untouched. The absurd-habitat launchd job stops keeping a Mac Postgres alive and stays as a second, report-only observer of the tower record (T4.03 supplies the probe target); it is repurposed, not retired, and it is a transition mechanism only: its Health Hub row is never acceptance evidence for this task or any other (common_definitions.final_visibility), and once T12.04's ThroughLine durability view has proven itself on a real loss the Mac job becomes one watched service among the rest. The Homebrew postgresql@16 service is stopped and disabled only after both T4.03 receipts exist; its data directory is preserved on disk until the Phase-6 acceptance, never deleted by this task. When the tailnet or the tower record is unreachable a new Mac turn is refused with the existing visible error (the turn rail's queue-reachability refusal), the draft stays unsubmitted and cached history is shown as stale (K05). Keep Mac rollback data until authority-isolated and Phase-6 acceptance; tower credential custody and record isolation are claimable from T4.06; agent binding and seat isolation still wait for T6.02. The Raspberry Pi general-record cutover is deferred under IC-008; the T12.08 recovery-island record is never merged into the tower.",
    files: [
      {
        path: "packages/throughline-record-cutover/",
        side: "fork-namespace",
        action: "add",
        note: "TypeScript; subcommands fence, drain, snapshot, transfer, verify, merge, switch, unfence, rollback <batch>; K12 operation id, attempt and receipts; import ledger table migration",
      },
      {
        path: "packages/absurd-runtime/migrations/<next>_throughline_import_ledger.sql",
        side: "fork-namespace",
        action: "add",
      },
      {
        path: "/home/twr/absurd-pg-cutover/<batch>/",
        side: "host-filesystem",
        host: "twr",
        owner: "twr",
        action: "add",
        note: "dump files and receipts per batch",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/src/habitat-up.ts",
        side: "outside-tool",
        action: "edit",
        note: "Tier 1 owner. supervise mode reads its probe target from a config file; when the target is remote the recovery ladder is disabled and the mode is report-only; shipped through Ship Warden as a version bump of absurd-sandbox (0.2.0 → next)",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/com.ryan.absurd-habitat.plist",
        side: "outside-tool",
        action: "edit",
        note: "arguments name the remote target config; RunAtLoad and KeepAlive unchanged",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/runtime-targets.json",
        side: "outside-tool",
        action: "edit",
        note: "declares the shipped payloads; Ship Warden is the lane",
      },
      {
        path: "/Users/Admin/core-root/src/tools/absurd-sandbox/dist/habitat-up.mjs",
        side: "outside-tool",
        action: "read",
        note: "never edited; proves the ship landed",
        surface: "verification",
      },
      {
        path: "apps/server/src/orchestration/AbsurdRuntimeInProcess.ts",
        side: "fork-namespace",
        action: "edit",
        note: "connection target from the record configuration, no localhost default",
      },
    ],
    signatures: [
      "one receipt in execution/phase-04/ with the three command outputs and the non-builder's session id, dated after both T4.03 receipts; the receipt's first line is the literal state name record-isolated-seats-shared",
    ],
    failing_checks: ["PH2-C01"],
    done_when: {
      host: "the tower as twr for the cutover tool, the Mac for the switch; a non-builder fires the verify, the switch probe and the rollback rehearsal",
      command:
        "rehearsal first on a copy: run the full tool against a copy of the Mac dump restored to a disposable source cluster, through merge and switch into the tower rehearsal cluster, then `rollback <batch>`; then the real Mac batch; after each real switch: send one message in a migrated conversation from the source device and curl the tower snapshot for that conversation; then read throughline_import_ledger counts per table",
      expect:
        "rehearsal: zero conflicts, verify counts equal, rollback leaves the tower rehearsal database row-for-row identical to before the merge (compared by table digests); real batches: the migrated conversation accepts the new message on the tower with its full prior history in order, rewind to its first turn works on the tower (K06), the ledger count equals the staging count, the source record is fenced and refuses a direct write with the visible refusal",
    },
    depends_on: ["T4.01", "T4.03", "T3.03", "T4.06"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [],
    rollback:
      "`brew services start postgresql@16`; revert the shipped absurd-sandbox version through Ship Warden to 0.2.0; the Mac server's record target reverts to loopback; both T4.03 receipts make this rollback unnecessary in the normal path but it stays executable until Phase-6 acceptance",
    completion_condition:
      "state record-isolated-seats-shared: the tower record is the sole record under the throughline-record account, the Mac keeps none, twr seats cannot stop the record or read its credential; seats still share the twr account, so binding and seat isolation are not claimable until T6.02",
    failing_check_first:
      "before the work, `brew services list` shows postgresql@16 started and the habitat job's arguments name the loopback target (measured in the Tier 1 plist text); that is the real red",
    retained_protection:
      "the existing queue-reachability refusal on the turn rail is kept as the visible failure; this task adds no new error path, it proves the existing one fires with the tower as the only record",
    failure_test:
      "Fail if: any Mac process starts a local Postgres after the cutover; a send with the tower unreachable is accepted or silently queued on the Mac; the draft is lost; the habitat job restarts a Mac Postgres; the data directory was deleted",
    ryan_act: "none",
    not_guaranteed_in_this_state:
      "tower seats (account twr) still share one account with each other and the human account, have no execution generation and can read one another's files; no claim of enforced agent binding or seat isolation may appear in this task's receipt, in CURRENT.json, or in any health row until T6.02's receipt names state authority-isolated; credential custody and record isolation are claimable from T4.06's receipt",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    interfaces_required: [
      "slice 10 thread UI owns the stale marker and draft retention rendering; this task supplies the refusal event, slice 10 renders it (named requirement, not an edit here)",
    ],
    proof_limits: [
      "the Tailscale-off rehearsal proves the no-tailnet case on the Mac, not a tower-down case with the tailnet up; that case is T4.03's rehearsal-cluster probe",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        title:
          "The Mac and Raspberry Pi records are cut over into the one tower record; the Mac and Raspberry Pi keep none",
        what: "The Mac source record (Homebrew Postgres) is cut over into the tower cluster's authoritative database by the cutover tool (packages/throughline-record-cutover): fence the source admission with a visible refusal and drain in-flight effects to terminal or unknown; snapshot with pg_dump and a recorded digest; restore into a worker-less staging database on the tower cluster; verify counts, event ordering, blob digests and pending tasks, steps and waits; merge under existing identities with ON CONFLICT DO NOTHING asserting zero conflicts and recording every inserted key in throughline_import_ledger; switch the source server's connection to the tower record through its own host role; the fence stays on the source forever. Rollback inside the window deletes exactly the ledgered rows and repoints the source; before the switch the source is untouched. The absurd-habitat launchd job stops keeping a Mac Postgres alive and stays as a second, report-only observer of the tower record (T4.03 supplies the probe target); it is repurposed, not retired, and it is a transition mechanism only: its Health Hub row is never acceptance evidence for this task or any other (common_definitions.final_visibility), and once T12.04's ThroughLine durability view has proven itself on a real loss the Mac job becomes one watched service among the rest. The Homebrew postgresql@16 service is stopped and disabled only after both T4.03 receipts exist; its data directory is preserved on disk until the Phase-6 acceptance, never deleted by this task. When the tailnet or the tower record is unreachable a new Mac turn is refused with the existing visible error (the turn rail's queue-reachability refusal), the draft stays unsubmitted and cached history is shown as stale (K05). Keep Mac rollback data until authority-isolated and Phase-6 acceptance; no shared twr credential-custody claim before the launcher receipt. The Raspberry Pi's own record is cut over in its own batch and its absurd-pg.service is stopped and disabled only after its receipt and rollback window; its data is kept until Phase 6 acceptance.",
        done_when: {
          host: "the tower as twr for the cutover tool, the Mac and the Raspberry Pi for the switch; a non-builder fires the verify, the switch probe and the rollback rehearsal",
          command:
            "rehearsal first on a copy: run the full tool against a copy of the Mac dump restored to a disposable source cluster, through merge and switch into the tower rehearsal cluster, then `rollback <batch>`; then the real Mac batch, then the real Raspberry Pi batch; after each real switch: send one message in a migrated conversation from the source device and curl the tower snapshot for that conversation; then read throughline_import_ledger counts per table",
          expect:
            "rehearsal: zero conflicts, verify counts equal, rollback leaves the tower rehearsal database row-for-row identical to before the merge (compared by table digests); real batches: the migrated conversation accepts the new message on the tower with its full prior history in order, rewind to its first turn works on the tower (K06), the ledger count equals the staging count, the source record is fenced and refuses a direct write with the visible refusal",
        },
        files: [
          {
            path: "packages/throughline-record-cutover/",
            side: "fork-namespace",
            action: "add",
            note: "TypeScript; subcommands fence, drain, snapshot, transfer, verify, merge, switch, unfence, rollback <batch>; K12 operation id, attempt and receipts; import ledger table migration",
          },
          {
            path: "packages/absurd-runtime/migrations/<next>_throughline_import_ledger.sql",
            side: "fork-namespace",
            action: "add",
          },
          {
            path: "/home/twr/absurd-pg-cutover/<batch>/",
            side: "host-filesystem",
            host: "twr",
            owner: "twr",
            action: "add",
            note: "dump files and receipts per batch",
          },
          {
            path: "/home/rpi/.config/systemd/user/absurd-pg.service",
            side: "host-filesystem",
            host: "rpi",
            owner: "rpi",
            action: "edit",
            note: "disabled after the Raspberry Pi batch receipt; data kept",
          },
          {
            path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/src/habitat-up.ts",
            side: "outside-tool",
            action: "edit",
            note: "Tier 1 owner. supervise mode reads its probe target from a config file; when the target is remote the recovery ladder is disabled and the mode is report-only; shipped through Ship Warden as a version bump of absurd-sandbox (0.2.0 → next)",
          },
          {
            path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/com.ryan.absurd-habitat.plist",
            side: "outside-tool",
            action: "edit",
            note: "arguments name the remote target config; RunAtLoad and KeepAlive unchanged",
          },
          {
            path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/runtime-targets.json",
            side: "outside-tool",
            action: "edit",
            note: "declares the shipped payloads; Ship Warden is the lane",
          },
          {
            path: "/Users/Admin/core-root/src/tools/absurd-sandbox/dist/habitat-up.mjs",
            side: "outside-tool",
            action: "read",
            note: "never edited; proves the ship landed",
            surface: "verification",
          },
          {
            path: "apps/server/src/orchestration/AbsurdRuntimeInProcess.ts",
            side: "fork-namespace",
            action: "edit",
            note: "connection target from the record configuration, no localhost default",
          },
        ],
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T4.03",
    slice: "slice-4",
    title:
      "The tower record is kept alive and watched from the always-on Raspberry Pi before the Mac path retires",
    serves: ["NG-016", "NG-008", "NG-128", "NG-131"],
    detail_state: "detailed",
    what: "Keep-alive: the record at 100.96.34.116:5432, probed by address; the unit that owns that port is state-dependent: absurd-pg.service (twr user unit) in state shared-account, throughline-record.service (system unit, account throughline-record) from state record-isolated-seats-shared onward; the keep-alive proof runs on the rehearsal cluster in whichever state is current and asserts Restart=always on the unit that owns the port at check time. Off-host detection: a user unit and 60-second timer under the rpi account on the Raspberry Pi (Linger=yes, always on, independent of the Mac and of the tower) runs a credential-free liveness probe against 100.96.34.116:5432 (TCP connect plus Postgres startup handshake with TLS, the pg_isready shape; no role, no password) and writes a durable status row to /home/rpi/.local/state/absurd-record-watch/status.json plus an append-only loss log. Operator notification: when a loss persists for two consecutive cycles outside a declared maintenance window, the observer asks the Raspberry Pi's own admin-capability-broker (broker-capability.service, account broker-service, a system unit on the Raspberry Pi that holds credentials under root-owned custody and serves typed capabilities over a Unix socket to the rpi group) to push one line to the existing ntfy.sh phone topic Ryan already receives alerts on; recovery pushes one line. That route depends on nothing on the tower and nothing on the Mac: measured 2026-10-09 from the rpi account, ntfy.sh resolves to a public address and is reached through the LAN default gateway 192.168.0.1 on eth0 with no Tailscale exit node, not through the tailnet. A forwarder to the tower broker (broker-tower-tunnel.service) is explicitly not the route, because it dies with the tower. The push capability does not exist in the broker's registry yet; it is a required prerequisite with a named owner and first action (open_dependencies below), so until it is installed the notification cell reads DEPENDENCY-OPEN and is never reported as accepted. The Mac habitat supervisor is a second observer kept only as a transition mechanism; the Health Hub adapter it reports to is retired by SHAPE-2026-09-03 line 28 and counts for nothing in acceptance; it is not the laptop-closed witness. Final visibility is the ThroughLine durability view that T12.01 builds (which shows the Raspberry Pi observer's heartbeat row and its age) plus the Raspberry Pi notification path when the tower or its record is down. Independence from the admission path: the observer writes its loss row to the Raspberry Pi's own disk, calls the Raspberry Pi broker over a local Unix socket, and the broker publishes to ntfy.sh over the LAN; no ThroughLine turn, Absurd task, event or admitted command is involved anywhere in that chain, so the report reaches Ryan while the tower record is the thing that is down. No seat reports the tower record healthy from the tower's own say-so: a health claim cites the Raspberry Pi status row or the durability view's rendering of it. Restart/timer values are read from effective installed configuration; a fast restart alone does not promise a sampled loss. T4.04 and T4.05 receipts are required before cutover; notification is never conditional PASS. Runtime loss testing uses a sustained controlled rehearsal fault through the real consumer, not a shared live-database kill. On a confirmed loss the watcher opens an incident file in /home/rpi/.local/state/absurd-record-watch/incidents/<id>.json with responder=not-installed and sends one informational line through notify.push reading 'no responder installed yet; no action needed unless paged'; T12.08 later consumes the same incident file and owns tier 0, tier 1, their ordering before further lines, and the page.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/src/habitat-up.ts",
        side: "outside-tool",
        action: "edit",
        surface: "authoring",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/src/record-watch.ts",
        side: "outside-tool",
        action: "add",
        surface: "authoring",
        note: "bounded observer inside existing owning component; reuses pg-reachable.ts, not a new monitoring platform",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/linux/absurd-record-watch.service",
        side: "outside-tool",
        action: "add",
        surface: "authoring",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/linux/absurd-record-watch.timer",
        side: "outside-tool",
        action: "add",
        surface: "authoring",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/runtime-targets.json",
        side: "config",
        action: "edit",
        surface: "authoring",
        note: "declare Raspberry Pi delivery through the existing component’s governed lane",
      },
      {
        path: "/Users/Admin/core-root/src/tools/absurd-sandbox/dist/habitat-up.mjs",
        side: "outside-tool",
        action: "read",
        surface: "verification",
      },
      {
        path: "/home/rpi/.config/systemd/user/absurd-record-watch.timer",
        side: "host-filesystem",
        action: "read",
        surface: "verification",
        note: "installed by the component-owned user-unit delivery lane",
      },
      {
        path: "/home/twr/.config/systemd/user/absurd-pg.service",
        side: "host-filesystem",
        action: "read",
        surface: "verification",
        note: "Policy read in shared-account before T4.06; kept disabled as rollback afterward, never probed.",
      },
      {
        path: "/etc/systemd/system/throughline-record.service",
        side: "host-filesystem",
        action: "read",
        surface: "verification",
        host: "twr",
        owner: "root",
        owning_source: "packages/throughline-launcher/systemd/throughline-record.service",
        note: "Policy read only after T4.06; never a fault-probe target.",
      },
    ],
    signatures: [
      "three receipts in execution/phase-04/ (keep-alive, lid-closed loss, intentional stop), each with the non-builder's session id and the raw command output; the lid-closed receipt states the notification cell as PASS or DEPENDENCY-OPEN",
      "the T4.03 receipt names the state it was taken in and the unit it probed; a receipt taken before T4.06 is not re-taken after it unless the Restart policy read on throughline-record.service differs from the one proven on the rehearsal unit",
    ],
    failing_checks: ["S4-C01"],
    depends_on: ["T4.01", "T4.04", "T4.05"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    service_binding: {
      host: "twr",
      owner: "state-dependent",
      scope: "state-dependent",
      unit: "state-dependent",
      fragment: "state-dependent",
      readback_source:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/host-spec-preparation/Host-Identity-Readback.md",
      configuration_at_intake:
        "systemctl --user show absurd-pg.service -p FragmentPath -p Restart -p RestartUSec -p NRestarts -p ActiveState; loginctl show-user twr -p Linger; read-only as twr, no credential output",
      address: "100.96.34.116:5432",
      intake_binding: {
        host: "twr",
        owner: "twr",
        scope: "user",
        unit: "absurd-pg.service",
        fragment: "/home/twr/.config/systemd/user/absurd-pg.service",
        readback_source:
          "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/host-spec-preparation/Host-Identity-Readback.md",
        configuration_at_intake:
          "systemctl --user show absurd-pg.service -p FragmentPath -p Restart -p RestartUSec -p NRestarts -p ActiveState; loginctl show-user twr -p Linger; read-only as twr, no credential output",
      },
      state_rule:
        "the record at 100.96.34.116:5432, probed by address; the unit that owns that port is state-dependent: absurd-pg.service (twr user unit) in state shared-account, throughline-record.service (system unit, account throughline-record) from state record-isolated-seats-shared onward; the keep-alive proof runs on the rehearsal cluster in whichever state is current and asserts Restart=always on the unit that owns the port at check time",
      check_adaptation:
        "the check reads the unit owning port 5432 at check time (ss -ltnp as a privileged read is not available to twr after T4.06; use systemctl show on the state-named unit) and asserts its Restart= is always; it no longer pins the unit name absurd-pg.service; expected_today stays as measured until T4.06 lands",
      state_bindings: [
        {
          state: "shared-account",
          owner: "twr",
          scope: "user",
          unit: "absurd-pg.service",
          fragment: "/home/twr/.config/systemd/user/absurd-pg.service",
          readback:
            "systemctl --user show absurd-pg.service -p FragmentPath -p Restart -p RestartUSec -p ActiveState",
        },
        {
          state: "record-isolated-seats-shared",
          owner: "throughline-record",
          scope: "system",
          unit: "throughline-record.service",
          fragment: "/etc/systemd/system/throughline-record.service",
          readback:
            "systemctl show throughline-record.service -p FragmentPath -p User -p Restart -p RestartUSec -p ActiveState",
        },
        {
          state: "authority-isolated",
          owner: "throughline-record",
          scope: "system",
          unit: "throughline-record.service",
          fragment: "/etc/systemd/system/throughline-record.service",
          readback:
            "systemctl show throughline-record.service -p FragmentPath -p User -p Restart -p RestartUSec -p ActiveState",
        },
      ],
      proof_scope:
        "Read the T4.06/T6.02 receipts and current state-named unit; assert Restart=always. Fault probes target only the state-named throwaway rehearsal unit; no live record or server is stopped or killed. After T4.06 the root-installed rehearsal system unit has the explicitly scoped twr kill/stop/start grant and no production unit grant.",
      probe_path_by_state: {
        "before_T4.06_shared_account":
          "T4.03 tests the twr user unit: the rehearsal cluster absurd-pg-rehearsal.service (twr user unit, identical unit shape) takes the SIGKILL and intentional-stop probes as twr with no grant; the live absurd-pg.service user unit's policy is read with systemctl --user show and never probed",
        "after_T4.06_record_isolated_seats_shared":
          "T4.03 tests the system unit: the Phase 4 sudo batch also installs throughline-record-rehearsal.service, a root-owned system unit with the identical shape (Restart=always, RestartSec=3) running a throwaway cluster under the throughline-record account on a non-5432 port with no real data, plus one polkit rule granting twr kill, stop and start on exactly that rehearsal unit and nothing else; the non-builder as twr runs systemctl kill -s SIGKILL throughline-record-rehearsal.service and systemctl stop throughline-record-rehearsal.service for the two probes and reads the live throughline-record.service policy with systemctl show -p Restart -p RestartUSec -p NRestarts, never probing it; the rehearsal grant is on a unit holding no record and does not weaken the three-state sentence",
        receipt_rule:
          "the T4.03 receipt names the state it was taken in and the unit it probed; a receipt taken before T4.06 is not re-taken after it unless the Restart policy read on throughline-record.service differs from the one proven on the rehearsal unit",
        X19: "pins no unit name; asserts that the unit owning port 5432 at check time is the state-named unit and that its Restart= is always",
      },
      rehearsal_grant: {
        principal: "twr",
        unit: "throughline-record-rehearsal.service",
        verbs: ["kill", "stop", "start"],
        production_unit_grants: [],
        scope:
          "throwaway rehearsal unit only; no real data; no grant on throughline-record.service or throughline-server.service",
      },
    },
    observer: {
      host: "rpi",
      owner: "rpi",
      owning_component: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox",
      availability:
        "existing always-on rpi user manager with Linger=yes, resident message-optimizer-watchdog.service and broker-capability.service; non-builder reads loginctl show-user rpi -p Linger, systemctl --user list-timers absurd-record-watch.timer, heartbeat timestamp/age and effective interval",
      status_path: "/home/rpi/.local/state/absurd-record-watch/status.json",
      notification_owner:
        "admin-capability-broker on the Raspberry Pi, broker-capability.service owned by broker-service; missing notify.push adapter/grant remains a required prerequisite",
      independent_delivery:
        "local Unix socket to Raspberry Pi broker, its own receipt ledger and ntfy.sh over LAN; never broker-tower-tunnel.service, the Mac, tower admission or the failed tower record",
      acceptance:
        "laptop closed AND tower server/record unavailable: fresh Raspberry Pi loss row and actual phone push; neither grant service nor notification requires a ThroughLine turn or tower record; Health Hub/x-registry cannot count",
    },
    acceptance_prerequisites: [
      {
        id: "rpi-user-unit-delivery",
        owner: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox",
        first_action:
          "bounded workhorse reads the existing message-optimizer user-unit install contract, adds observer target/templates in absurd-sandbox Tier 1 and proves the component-owned nonprivileged delivery lane; no hand-copy across the source/runtime seam",
        test: "non-builder as rpi reads installed payload hashes, effective service/timer configuration and linger, then consumes the real observer path cold",
        status: "required",
        task: "T4.05",
        execution_owner: "implementer / live Codex workhorse",
      },
      {
        id: "rpi-independent-notification",
        owner: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/admin-capability-broker",
        first_action:
          "bounded workhorse inspects only the Raspberry Pi broker’s current capability registry, floor metadata and typed grant contract; add/ship notify.push through its owning lane if absent, without reading any topic/token value. Derive any reserved install/custody act from the current admitted broker policy and cited Ryan words, never infer an operator duty from the host proposal",
        test: "Mac closed and tower/record unavailable: a local rpi consumer obtains a Raspberry Pi broker-local receipt and one phone push; no tower admission, event, task, proxy or credential in observer",
        status: "required",
        task: "T4.04",
        execution_owner: "implementer / live Codex workhorse",
      },
    ],
    done_when: {
      command:
        "T4.03 tests the twr user unit: the rehearsal cluster absurd-pg-rehearsal.service (twr user unit, identical unit shape) takes the SIGKILL and intentional-stop probes as twr with no grant; the live absurd-pg.service user unit's policy is read with systemctl --user show and never probed T4.03 tests the system unit: the Phase 4 sudo batch also installs throughline-record-rehearsal.service, a root-owned system unit with the identical shape (Restart=always, RestartSec=3) running a throwaway cluster under the throughline-record account on a non-5432 port with no real data, plus one polkit rule granting twr kill, stop and start on exactly that rehearsal unit and nothing else; the non-builder as twr runs systemctl kill -s SIGKILL throughline-record-rehearsal.service and systemctl stop throughline-record-rehearsal.service for the two probes and reads the live throughline-record.service policy with systemctl show -p Restart -p RestartUSec -p NRestarts, never probing it; the rehearsal grant is on a unit holding no record and does not weaken the three-state sentence (2) Through the shipped observer’s real probe consumer, inject a controlled connection-refused/TLS-handshake failure against the disposable rehearsal endpoint for longer than two installed timer cycles, with laptop closed and tower server/record unavailable in a safe rehearsal window; read the Raspberry Pi status/log and local broker receipt, and witness the phone push. Clear the injected fault and witness reachable plus recovery push. For intentional maintenance, use the owning module maintenance window, stop only the selected rehearsal unit, read Result/NRestarts and the stopped-intentionally row, then explicitly start that same rehearsal unit for cleanup. the T4.03 receipt names the state it was taken in and the unit it probed; a receipt taken before T4.06 is not re-taken after it unless the Restart policy read on throughline-record.service differs from the one proven on the rehearsal unit",
      expect:
        "Three non-builder receipts: injected crash returns automatically with NRestarts increased and signal/restart journal evidence; sustained controlled loss is durably visible off-host and actually delivered to the phone while Mac and tower are unavailable; maintenance stop stays down, is reported as intentional with Result=success/NRestarts unchanged, and is restored explicitly. A fast restart alone does not promise a sampled loss row. Any missing observer delivery/notify.push grant receipt leaves cutover unaccepted, never a conditional PASS. the loss in step (2) creates an incident file with responder=not-installed and sends exactly one informational line; no page is sent and nothing attempts a repair the T4.03 receipt names the state it was taken in and the unit it probed; a receipt taken before T4.06 is not re-taken after it unless the Restart policy read on throughline-record.service differs from the one proven on the rehearsal unit",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-reject-uncited-operator-assignments-on-sight-authority-laundering.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-03-ryan-durability-is-a-running-watched-layer-not-answers-in-a-readme.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-10-04-ryan-performs-tower-sudo-installs-for-now.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    risk: [
      "observer and notification receipts are required before any cutover; no new monitoring platform",
      "faults only on a disposable rehearsal or explicitly stated safe window; no shared live database fault probes",
      "no credential output; no operator assignment without cited source; no authority-isolation claim before T6.02",
    ],
    rollback:
      "disable and remove the two Raspberry Pi user units; remove the rehearsal cluster with the same teardown shape the lab cluster uses; the live record is untouched throughout",
    ryan_act: "none",
    proof_limits: [
      "This is a specified contract, not executed host proof; the route/grant and user-unit delivery prerequisites remain required",
      "The host proposal’s kill-and-sample test was corrected: a three-second restart can be missed by a longer observer cycle, so loss visibility uses a sustained controlled fault through the actual consumer",
      "No installation, new capability, host change or live data change is performed by P2-01",
    ],
    failing_check_first:
      "before the observer exists, step (2) produces no status row at all on the Raspberry Pi (the file does not exist, measured absent 2026-10-09); that is the real red, not a manufactured one",
    retained_protection:
      "Restart=always on the live absurd-pg.service is retained unchanged; the rehearsal cluster carries the identical unit shape so step (1) proves the policy the live unit already has",
    failure_test:
      "Fail if: the rehearsal unit does not return on its own; no Raspberry Pi row appears within one cycle while the lid is closed; a seat reports the record healthy while the row says lost; the intentional stop is pushed as a failure; the live absurd-pg.service was killed or stopped by any probe; the Mac Postgres was removed before both receipts existed; the loss row, the push, or the broker's push capability requires any ThroughLine turn, task, event or admitted command on the tower record to deliver the outage report; a receipt cites a Health Hub row or the x-registry as evidence of liveness or loss",
    open_dependencies: [
      {
        id: "rpi-broker-notify-push",
        what: "a notify.push capability (ntfy.sh publish) served by the admin-capability-broker on the Raspberry Pi, with the topic held under broker-service custody as a root-owned file, the same custody shape the broker already uses for the Jev key and the Cloudflare token; the observer calls the broker's Unix socket and never holds the topic",
        owning_module:
          "/Users/Admin/core-root/vault/01_Projects/workbench/infra/admin-capability-broker/ (Tier 1); its Linux lane dist/linearCapabilityInstall.js and the root-installable Raspberry Pi templates under linux/",
        why_this_owner:
          "its README states the rule 'only installed named adapters execute, registration never pretends an external integration is live' and that the Raspberry Pi floor is root-owned and default-closed; the ntfy topic is credential-shaped, so it belongs under that custody, not in /home/rpi and not in the observer",
        independence_test_executed_2026_10_09:
          "from the rpi account: `ip route get <ntfy.sh address>` printed 'via 192.168.0.1 dev eth0', `ip route show default` printed the LAN gateway, tailscale exit-node status was empty, and a HEAD request to https://ntfy.sh/ answered 200 via a public address; the route uses neither the tailnet nor the tower",
        first_action:
          "a bounded workhorse task on the admin-capability-broker module: add the notify.push adapter and registry row (Tier 1, with the broker's existing preflight rows), ship through the broker's Linux lane to the Raspberry Pi; then one operator act on the Raspberry Pi: the floor row for notify.push and the topic file drop, prepared by the broker installer with literal commands and rollback (the Raspberry Pi has no agent sudo; the Oct 4 tower shape is the pattern, applied to the Raspberry Pi by the same operator)",
        first_action_owner:
          "lead-ngdeliv-6fd18e63 routes it; executor is the live workhorse role; acceptance by a non-builder calling the socket from rpi and receiving one push on the phone",
        cold_test:
          "with the Mac lid closed and the tower's rehearsal cluster SIGKILLed, the observer's call to the broker socket returns a receipt id and one push lands on the phone within two cycles; a second test with the tower's Tailscale interface administratively down for the probe window (operator act on the tower, or the rehearsal cluster's port blocked) shows the push still lands",
        admission_independence: {
          rule: "the notify.push capability and the broker-service that serves it must not consult, write to, or wait on the tower record's admission path; the broker's own receipt ledger on the Raspberry Pi is its only durable record of the push (the broker README's existing design: a broker-local append-only ledger, root-owned state directory)",
          test: "with the tower's rehearsal cluster SIGKILLed and the tower's ThroughLine server stopped by its owner in the same rehearsal window (systemctl --user stop throughline-server.service as twr, an intentional stop recorded by Result=success), the observer's call to the Raspberry Pi broker socket returns a receipt id and the push lands on the phone; the receipt shows the broker ledger row on the Raspberry Pi and no row anywhere on the tower",
        },
        no_token_fetched: true,
        status:
          "REQUIRED prerequisite; the notification cell stays DEPENDENCY-OPEN until its receipt exists",
      },
      {
        id: "rpi-user-unit-delivery-lane",
        what: "absurd-sandbox runtime-targets.json has no Raspberry Pi target; the observer's two user units need a delivery lane that runs as rpi with no sudo",
        existing_pattern:
          "/Users/Admin/core-root/vault/01_Projects/workbench/tools/message-optimizer/adapters/mobile/install-rpi-systemd.sh: runs as rpi, writes ~/.config/systemd/user/, `systemctl --user daemon-reload` and `enable --now`, relies on linger (read 2026-10-09; no sudo in the script)",
        first_action:
          "a bounded workhorse task on the absurd-sandbox module: add linux/install-rpi-user-units.sh modeled on that script, add a Raspberry Pi target to runtime-targets.json, and record the ship path (Ship Warden if it carries Linux user-unit targets, otherwise the same agent-run install the message optimizer uses, named in the receipt)",
        first_action_owner:
          "lead-ngdeliv-6fd18e63 routes it; executor the live workhorse role; acceptance by a non-builder reading `systemctl --user list-timers` as rpi",
        status: "REQUIRED",
      },
    ],
    contract_clause_correction_for_the_lead: {
      contract: "K05",
      field: "statement",
      "replace_in_IA-06_append":
        "the Mac's existing supervisor retargeted at the tower address, reporting loss to the Health Hub within one supervision cycle",
      with: "an always-on off-host observer on the Raspberry Pi (a user unit under the rpi account) recording loss within one 60-second cycle and, once its push grant is bound, notifying the operator through the existing phone route; the Mac supervisor is a second observer only",
    },
    interfaces_required: [
      "T12.04's ThroughLine durability view is the final visibility surface for this task: it lists absurd-record-watch.timer and renders the Raspberry Pi observer's heartbeat row and its age, red past three cycles (one-sentence append the delta already names, now with the surface named); until that view exists, the receipts for this task cite the Raspberry Pi status row directly, never a Health Hub row",
      "slice 12 pairing-row owner: the Raspberry Pi's own absurd-pg.service and ThroughLine server (port 13774) are not touched by this task; whether the Raspberry Pi server re-points at the tower record is a device-matrix decision for the rpi role, named here as an integration dependency on NG-016's owner, never absorbed or dropped",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    phase_scoped_acceptance: {
      "phase_4_acceptance_T4.03":
        "T4.03 is accepted in Phase 4 when, on a confirmed rehearsal loss with the Mac lid closed, the watcher creates the incident file with responder=not-installed, sends exactly one informational line reading 'no responder installed yet; no action needed unless paged', attempts no repair and sends no page; the keep-alive proof and the maintenance-window proof pass as written. Phase 4 acceptance makes no claim about tier 0, tier 1 or ordering.",
      "phase_12_acceptance_T12.08":
        "T12.08 is accepted in Phase 12 when the same incident mechanism, on a rehearsal loss, records tier 0 attempted before the informational open line is sent, moves the incident's responder field from not-installed through tier-0 and tier-1 to closed, and the page half passes; the ordering 'tier 0 before notify' is a Phase 12 claim only and appears in no Phase 4 receipt.",
      "T4.03_done_when_expect_final_text":
        "the loss in step (2) creates an incident file with responder=not-installed and sends exactly one informational line; no page is sent and nothing attempts a repair",
      "T4.03_what_final_append":
        "On a confirmed loss the watcher opens an incident file in /home/rpi/.local/state/absurd-record-watch/incidents/<id>.json with responder=not-installed and sends one informational line through notify.push reading 'no responder installed yet; no action needed unless paged'; T12.08 later consumes the same incident file and owns tier 0, tier 1, their ordering before further lines, and the page.",
    },
  },
  {
    id: "T5.01",
    fork_state: [
      {
        ref: "06d31c5452",
        disposition: "rework",
        reason:
          "Move SQLite identity_alias migration/binding into the authoritative Postgres record transaction with admitted commands, preserve existing rows in backfill/dual-write and retire the native-lineage resolver only after compatibility proof.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "1f49185a68",
        disposition: "rework",
        reason:
          "Keep conflict/unknown handling, but replace the Agent Instruments JSONL lineage reader with launcher-written record columns and admitted-event ancestry; do not promote JSONL to the new authority.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "c195963030",
        disposition: "rework",
        reason:
          "Keep captured requested-model comparison, but remove provider-local optional-SqlClient alias writes after updateResumeCursor and bind aliases in the same authoritative transaction as command admission.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/ident-20261009",
        disposition: "rework",
        reason:
          "Keep exact identity/model/security tests, but this branch combines SQLite aliases, projection stamping, engine settings receipts and JSONL lineage; replace those owners with the designed record/admission/launcher joins.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-5",
    title:
      "One public identity with every other id riding under it; native ids as aliases; the resolver retires",
    serves: ["NG-055", "NG-056", "NG-057", "NG-058", "NG-059"],
    detail_state: "detailed",
    what: "An identity_alias table (public_agent_id, native_kind in {claude, codex, pi, throughline-thread, app-session}, native_id, bound_generation nullable, created_at, unique on native_kind+native_id) replaces the fork-ancestry resolver. ThroughLine already assigns each native message id deterministically before submission; this task stores that assignment as an alias row in the same transaction as the admitted command (K01 outbox). Lookups are by native id to public id only; the resolver module is deleted and its two callers rewritten. Migration is expand-then-contract (K09): the table and columns are added, dual-written for one release, the resolver removed in the next.",
    files: [
      {
        path: "apps/server/src/throughline/identity/native-lineage.ts",
        side: "fork-namespace",
        action: "edit",
      },
      {
        path: "apps/server/src/throughline/rewind/claudeTranscriptParent.ts",
        side: "fork-namespace",
        action: "edit",
      },
      {
        path: "apps/server/src/throughline/identity/identity-alias.ts",
        side: "fork-namespace",
        action: "add",
      },
      {
        path: "packages/absurd-runtime/migrations/<next>_identity_alias.sql",
        side: "fork-namespace",
        action: "add",
        note: "expand step only in this task",
      },
    ],
    signatures: ["one receipt: test output plus the snapshot excerpt, non-builder session id"],
    failing_checks: ["PH2-C01"],
    done_when: {
      host: "twr, on the installed release, fired by a non-builder through the server's own API (no database credential)",
      command:
        "pnpm -C <fork> test --filter identity-alias (the new test inserts one message per native kind and resolves each to one public id, and asserts the old resolver export no longer exists); then on the tower: curl -s http://100.96.34.116:3773/api/orchestration/snapshot | jq '.threads[0].messages[0] | {public_agent_id, native_id}'",
      expect:
        "the test passes with one public id per fixture and fails to import the old resolver; the snapshot shows a public_agent_id beside each native_id on a real thread created after the release",
    },
    depends_on: ["T3.03"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [],
    rollback:
      "expand-only migration leaves the old columns intact; revert the two edited files; the alias table stays empty and unused",
    failing_check_first:
      "the new identity-alias test fails before the table and module exist (import error, then zero rows): a genuine red",
    retained_protection:
      "existing rewind tests that read claudeTranscriptParent.ts keep passing; the task adds no exception to them",
    failure_test:
      "Fail if: two native ids resolve to different public ids for the same agent; a native id resolves to two public ids; a message written through any door lacks an alias row; the resolver still has a caller",
    ryan_act: "none",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    interfaces_required: [
      "T3.03 migration lane for the SQL file",
      "slice 10 thread families read public ids; they consume, they do not define",
    ],
    proof_limits: [
      "the snapshot check proves presence of the public id, not uniqueness across the whole history; uniqueness is the test's claim",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T5.02",
    fork_state: [
      {
        ref: "30f8e3e388",
        disposition: "rework",
        reason:
          "Reuse authenticated-claim/refusal tests and sender payloads, but move engine/projection SQLite stamping into record-owned identity joins and admission; authenticate every ingress and retain MCP only until the CLI replacement is proven.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "ebedf4722d",
        disposition: "rework",
        reason:
          "This merge carries useful sender/model/recovery code but includes the SQLite/engine sender implementation; preserve ancestry, rework the sender portion at record/admission and keep model/install protections.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "a63c8239e5",
        disposition: "rework",
        reason:
          "Keep typed trusted-sender serialization, but replace long-lived t3.thread-run/random command creation with request/generation workflows, deterministic task-step IDs and admission-owned durable context.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/hello-20261009",
        disposition: "rework",
        reason:
          "Keep optional-hello compatibility and trusted-sender transport; add record cursor/dedup and admitted identity context, replacing JSONL ancestry and the old long-lived rail.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/hello-typecheck-059-20261009",
        disposition: "rework",
        reason:
          "Preserve this composite repair tip and its typed fixtures/unknown-field decoder; extract old-engine settings/sender logic into record/admission modules and omit inherited interim version stamps.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/ident-20261009",
        disposition: "rework",
        reason:
          "Keep exact identity/model/security tests, but this branch combines SQLite aliases, projection stamping, engine settings receipts and JSONL lineage; replace those owners with the designed record/admission/launcher joins.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/ident-senderlayer-059-20261009",
        disposition: "rework",
        reason:
          "Preserve composite sender/type/fixture repairs, including the ProjectionPipeline sender fixture fix at the tip; apply them to the new record tests, not an engine-owned SQLite authority.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-5",
    title: "Every message records who actually sent it; the identity join",
    serves: ["NG-060", "NG-061"],
    detail_state: "detailed",
    what: "Every message row carries sender_public_id and sender_generation stamped by the server from the authenticated channel, never from the payload: on the tower from the kernel peer credentials of the socket (T7.02 supplies uid and pid; this task maps them through the identity join), on the Mac from the app session, from the CLI from its authenticated session. A payload that names a different sender is refused with a recorded admission failure. The identity join table (public_agent_id, execution_generation {uid, invocation_id, cgroup, process_start}, work_item, purpose, runner) is defined here with its write API; its rows are written by the launcher in T6.02. Origin (NG-060): each message row also carries the authenticated login, device and account, whether the text was dictated or optimized, and whether it was relayed or authored by the operator; a relayed user-role turn is never recorded as Ryan's. the sender stamp reads the generation from the supervisor registry entry resolved in T7.02, never from the payload and never from a cgroup pathname parsed as an id.",
    files: [
      {
        path: "apps/server/src/throughline/identity/identity-join.ts",
        side: "fork-namespace",
        action: "add",
      },
      {
        path: "apps/server/src/throughline/identity/sender-stamp.ts",
        side: "fork-namespace",
        action: "add",
      },
      {
        path: "packages/absurd-runtime/migrations/<next>_identity_join.sql",
        side: "fork-namespace",
        action: "add",
      },
    ],
    signatures: ["one receipt with the six attempts and the snapshot excerpt"],
    planned_checks: [
      {
        id: "T5.02-origin",
        kind: "contract-test",
        command:
          "record an honest typed message, a dictated and optimized message, and a relayed user-role turn; then forge a sender field from a seat",
        expect:
          "each row carries login, device, account, dictated/optimized and relayed/operator flags; the forged field is refused or overwritten by the server",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    done_when: {
      host: "twr for the socket and CLI doors, the Mac for the app door; non-builder",
      command:
        "send one message through each door with an honest payload and one with a forged sender field; then curl -s http://100.96.34.116:3773/api/orchestration/snapshot | jq '[.threads[].messages[] | {sender_public_id, sender_generation}]'",
      expect:
        "three honest messages carry the sender that matches the authenticated channel; the three forged ones are refused and an admission-failure event names the mismatch; no message row has an empty sender",
    },
    depends_on: ["T5.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [],
    rollback: "expand-only; revert the two modules; sender columns remain nullable and unused",
    failing_check_first:
      "before the work, the forged-sender message is accepted (the field does not exist); that acceptance is the red",
    retained_protection:
      "K01 admission tests retained; the stamp happens inside the same admitted-command transaction",
    failure_test:
      "Fail if: a forged sender lands; a message without a sender lands; the Mac app's messages stamp a tower identity; a replaced generation's late message stamps the new generation",
    ryan_act: "none",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    interfaces_required: [
      "T7.02 must expose peer uid and pid to the stamp (named requirement on slice 7, inside this group)",
      "T6.02 writes the join rows",
    ],
    proof_limits: [
      "until T6.02 lands, join rows for tower seats are written by a test fixture; the receipt says so",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T6.01",
    slice: "slice-6",
    title: "The root-owned ThroughLine supervisor on the tower, installed once by Ryan",
    serves: ["NG-070", "NG-197", "NG-072"],
    detail_state: "detailed",
    what: "Two root-owned system unit files: the supervisor service (starts and stops agent units on the admission service's instruction) and the agent template unit with DynamicUser=yes, PrivateNetwork=yes, ProtectHome=yes, StateDirectory per instance, and the two sockets (broker, messaging) bind-mounted in; this wires the two lines in systemd-execution.ts (93 and 94) that declare a dynamic Linux user per agent and are unwired today. Agents keep no sudo. T4.06, batched with this task in the same Ryan sudo act, has already moved the ThroughLine server to throughline-server.service, a system unit under the throughline-server account, and the record to throughline-record.service; the twr user units for both are disabled and kept on disk as rollback; this task does not touch either unit, and the supervisor's control socket admits the throughline-server account's uid. Ryan performs the single install act after the nonprivileged preflight passes. Tower installs remain Ryan's sudo act. On the tower the agent prepares the nonprivileged preflight (systemd-analyze verify as the agent account; a user-manager rehearsal of the template without DynamicUser; payload sha256 pinned in the request file) and root runs only the root-owned, hash-checked copy. The tower yields its installed-supervisor receipt; the Raspberry Pi supervisor rollout is retained only as deferred history. The supervisor control socket's peer allowlist is the throughline-server account from T4.06, not twr. The supervisor's polkit grant covers throughline-agent@*.service for start, stop, restart and kill, and additionally throughline-record.service and throughline-server.service for start and restart only; it never covers stop or kill of those two units and no other account holds any grant on them.",
    files: [
      {
        path: "packages/throughline-launcher/hosts/twr.json",
        side: "fork-namespace",
        action: "add",
        note: "per-host configuration: agent account, architecture, broker socket contract path, record role name; no credential",
      },
      {
        path: "packages/task-workspaces/src/systemd-execution.ts",
        side: "fork-namespace",
        action: "edit",
        note: "lines 93 and 94 wired; verify by reading the file at intake, the line numbers are from spec 0.3.0",
      },
      {
        path: "packages/throughline-launcher/systemd/throughline-supervisor.service",
        side: "fork-namespace",
        action: "add",
        note: "unit names follow the Command-Grammar-Standard naming of Linux units; the lead confirms the names before the sudo act",
      },
      {
        path: "packages/throughline-launcher/systemd/throughline-agent@.service",
        side: "fork-namespace",
        action: "add",
        note: "unit names follow the Command-Grammar-Standard naming of Linux units; the lead confirms the names before the sudo act",
      },
      {
        path: "/etc/systemd/system/throughline-supervisor.service",
        side: "host-filesystem",
        host: "twr",
        owner: "root",
        action: "add",
        note: "installed by Ryan's sudo act",
      },
      {
        path: "/etc/systemd/system/throughline-agent@.service",
        side: "host-filesystem",
        host: "twr",
        owner: "root",
        action: "add",
        note: "installed by Ryan's sudo act",
      },
    ],
    signatures: [
      "preflight receipt, Ryan's act as a Linear issue key with the literal commands, and the non-builder receipt",
    ],
    failing_checks: ["PH2-C01"],
    done_when: {
      host: "twr, after Ryan's install, fired by a non-builder as twr (no sudo)",
      command:
        "systemctl show throughline-supervisor.service -p ActiveState -p User -p FragmentPath; systemctl show 'throughline-agent@probe.service' -p DynamicUser -p PrivateNetwork -p ProtectHome -p StateDirectory; then ask the supervisor through the admission service to start one probe agent and inside it run: id -u; ls /home/twr; ls -l $BROKER_SOCKET",
      expect:
        "the supervisor is active, FragmentPath under /etc/systemd/system, root-owned; the template shows DynamicUser=yes, PrivateNetwork=yes, ProtectHome=yes; inside the probe agent id -u is not 1002 (twr) and not 0, ls /home/twr fails, the broker socket exists and is connectable; one tower receipt",
    },
    depends_on: ["T4.01", "T5.02", "T4.06"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [],
    rollback:
      "sudo systemctl disable --now throughline-supervisor.service; remove the two unit files; daemon-reload (literal commands prepared with the install)",
    failing_check_first:
      "before the install, `systemctl show throughline-supervisor.service -p LoadState` returns not-found on the tower (measured 2026-10-09: no such unit); that is the red",
    retained_protection:
      "throughline-server.service and absurd-pg.service user units untouched; the done_when re-reads both as active",
    failure_test:
      "Fail if: the probe agent runs as twr or root; it can list /home/twr; it reaches any TCP broker port; the unit files are writable by twr; the supervisor is a user unit",
    ryan_act: {
      required: true,
      shape: "SHAPE-2026-10-04 tower sudo",
      preflight_without_privilege:
        "systemd-analyze verify on both unit files as twr; a user-manager rehearsal of the template without DynamicUser (ProtectHome and PrivateNetwork hold in --user) proving the launcher's process shape; payload hash pinned in the request file",
      handed_to_ryan_as:
        "one message with the literal install commands, the rollback commands, the payload hash, and the sentence 'what root execution has not proved: DynamicUser allocation and the system-manager socket bind-mounts'",
      after:
        "the non-builder done_when above; command submission or preflight green is not installation",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    interfaces_required: [
      "the admission service (slice 3) issues the start instruction; the launcher (T6.02) is what the template unit executes",
    ],
    proof_limits: [
      "the user-manager rehearsal cannot prove DynamicUser; only the installed system unit can, which is why the non-builder check runs after Ryan's act",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    batched_with: "T4.06 (same Ryan sudo act; scheduling note, not a reverse dependency)",

    command_grammar: "IC-002",

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        title:
          "The root-owned ThroughLine supervisor on each Linux execution host (tower and Raspberry Pi), installed once per host by Ryan",
        what: "Two root-owned system unit files: the supervisor service (starts and stops agent units on the admission service's instruction) and the agent template unit with DynamicUser=yes, PrivateNetwork=yes, ProtectHome=yes, StateDirectory per instance, and the two sockets (broker, messaging) bind-mounted in; this wires the two lines in systemd-execution.ts (93 and 94) that declare a dynamic Linux user per agent and are unwired today. Agents keep no sudo. The existing throughline-server.service user unit under twr keeps running through this task; moving the server itself under the supervisor is a later step with its own receipt, not part of this task. Ryan performs the single install act after the nonprivileged preflight passes. Tower installs remain Ryan's sudo act. On the tower the agent prepares the nonprivileged preflight (systemd-analyze verify as the agent account; a user-manager rehearsal of the template without DynamicUser; payload sha256 pinned in the request file) and root runs only the root-owned, hash-checked copy. Each host yields its own installed-supervisor receipt; neither stands for the other. The supervisor control socket's peer allowlist is the throughline-server account from T4.06, not twr. The supervisor's polkit grant covers throughline-agent@*.service for start, stop, restart and kill, and additionally throughline-record.service and throughline-server.service for start and restart only; it never covers stop or kill of those two units and no other account holds any grant on them.",
        done_when: {
          host: "twr and rpi, each after Ryan's install on that host, fired by a non-builder as the host's agent account (no sudo)",
          command:
            "systemctl show throughline-supervisor.service -p ActiveState -p User -p FragmentPath; systemctl show 'throughline-agent@probe.service' -p DynamicUser -p PrivateNetwork -p ProtectHome -p StateDirectory; then ask the supervisor through the admission service to start one probe agent and inside it run: id -u; ls /home/twr; ls -l $BROKER_SOCKET",
          expect:
            "the supervisor is active, FragmentPath under /etc/systemd/system, root-owned; the template shows DynamicUser=yes, PrivateNetwork=yes, ProtectHome=yes; inside the probe agent id -u is not 1002 (twr) and not 0, ls /home/twr fails, the broker socket exists and is connectable; the same expectations hold on the Raspberry Pi with id -u not 1007 (rpi) and not 0, ls /home/rpi failing inside the probe agent, and the Raspberry Pi broker socket connectable; two receipts, one per host",
        },
        files: [
          {
            path: "/etc/systemd/system/throughline-supervisor.service and throughline-agent@.service",
            side: "host-filesystem",
            host: "rpi",
            owner: "root",
            action: "add",
            note: "installed by Ryan's act through the admin account",
          },
          {
            path: "packages/throughline-launcher/hosts/twr.json and hosts/rpi.json",
            side: "fork-namespace",
            action: "add",
            note: "per-host configuration: agent account, architecture, broker socket contract path, record role name; no credential",
          },
          {
            path: "packages/task-workspaces/src/systemd-execution.ts",
            side: "fork-namespace",
            action: "edit",
            note: "lines 93 and 94 wired; verify by reading the file at intake, the line numbers are from spec 0.3.0",
          },
          {
            path: "packages/throughline-launcher/systemd/throughline-supervisor.service",
            side: "fork-namespace",
            action: "add",
            note: "unit names follow the Command-Grammar-Standard naming of Linux units; the lead confirms the names before the sudo act",
          },
          {
            path: "packages/throughline-launcher/systemd/throughline-agent@.service",
            side: "fork-namespace",
            action: "add",
            note: "unit names follow the Command-Grammar-Standard naming of Linux units; the lead confirms the names before the sudo act",
          },
          {
            path: "/etc/systemd/system/throughline-supervisor.service",
            side: "host-filesystem",
            host: "twr",
            owner: "root",
            action: "add",
            note: "installed by Ryan's sudo act",
          },
          {
            path: "/etc/systemd/system/throughline-agent@.service",
            side: "host-filesystem",
            host: "twr",
            owner: "root",
            action: "add",
            note: "installed by Ryan's sudo act",
          },
        ],
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T6.02",
    required_by_admission_decision: {
      owner:
        "thread a2915a9c-1fa1-41ef-8bc9-2c39902452c9 (slices 4 to 7); dependency named, not decided here",
      requirement:
        "the launcher reads the thread check-first state at launch and sets ReadOnlyPaths on the protected roots when pending; a transition relaunches the seat with a new execution generation; the launcher passes the run id and the admission token beside the broker socket",
      source: "Fable-Delta-Enforcement.json item T3.01+F07",
    },
    slice: "slice-6",
    title:
      "The launcher: binds the identity to the execution generation, starts the harness with its mod or extension, registers the socket endpoint",
    serves: ["NG-062", "NG-067", "NG-068", "NG-197", "NG-050"],
    detail_state: "detailed",
    what: "One program in packages/throughline-launcher executed by the agent template unit: reads its generation (uid from id, $INVOCATION_ID, cgroup from /proc/self/cgroup, process start from /proc/self/stat), writes the identity join row (T5.02 API) binding the public agent id to that generation, creates the agent's messaging socket under the root-owned runtime directory the supervisor passes in, registers the endpoint with the admission service carrying the generation, starts the harness (Claude with the ThroughLine mod, Codex with its approval policy, Pi with the extension) with the mods folder read-only to the agent, passes the broker socket and the broker observer endpoint (IA-05) into the profile, and on exit drains results, closes the endpoint, lets the unit stop, and the dynamic account is removed by systemd; a replayed registration or a late result from a replaced generation is refused by the admission service. Crash resume: a new generation registers fresh; the old generation's unknown effects stay unknown (K01). The launcher is built per architecture (x86_64, arm64) with K12 input digests and reads its host configuration from packages/throughline-launcher/hosts/<host>.json; the active Linux deployment is the tower supervisor; the Raspberry Pi host template is deferred. At every unit start the launcher's supervisor writes the generation registry entry (unit name, invocation id from systemctl show, cgroup path, dynamic uid, unit start time, children_allowed, state=active) under /run/throughline/registry/<unit>.json, root-owned, group-readable by the host's server account; at ExecStopPost it sets state=closed. The host's server forwards the entry to the admission service over its own authenticated record connection; no key is minted. It exposes an optional target-id job input and read-only target-tool binding slot. T9.01 and the provider owners prove target-bound launch/succession later; target-free exploratory launches stay supported and no later-slice edge is added here.",
    files: [
      {
        path: "/run/throughline/registry/",
        side: "host-filesystem",
        host: "twr",
        owner: "root directory, entries root-owned, readable by the server account",
        action: "add",
        note: "created by the supervisor; verification target; Raspberry Pi counterpart deferred under IC-008",
      },
      {
        path: "packages/throughline-launcher/",
        side: "fork-namespace",
        action: "add",
      },
      {
        path: "apps/server/src/orchestration/admission/registration.ts",
        side: "fork-namespace",
        action: "add",
        note: "generation-carrying registration and refusal of replays",
      },
      {
        path: "packages/throughline-launcher/src/target-binding.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
    ],
    signatures: ["one receipt per provider plus the replay receipt"],
    failing_checks: ["PH2-C01"],
    done_when: {
      host: "twr, under the installed supervisor, non-builder",
      command:
        "start one agent of each provider; record each registration; then: kill the Claude agent's unit, restart it, and replay the first registration and a result signed with the first generation; inside the restarted Codex agent run: ls $BROKER_SOCKET $OBSERVER_ENDPOINT; curl -s --unix-socket $OBSERVER_ENDPOINT http://x/headroom | jq .freshness; ls /home/twr; cat /etc/passwd | grep -c throughline; then as twr on the tower: ps -u twr -o pid=,comm= | grep -vE '^ *[0-9]+ (postgres|node|systemd|\\(sd-pam\\))$' ; systemctl --user list-units --type=service --no-legend | grep -ciE 'claude|codex|pi-|harness|seat'",
      expect:
        "three registrations with distinct generations; the replayed registration and the stale result are refused with recorded events; the broker socket and observer endpoint exist and headroom returns a freshness field with no credential in the environment; ls /home/twr fails; the previous dynamic account is gone from the system after its unit stopped; the twr process list shows no harness process and neither the record nor the server (those are owned by throughline-record and throughline-server after T4.06), and twr's user manager runs no seat unit: this is the no-twr-seat probe that reaches state authority-isolated; the per-host provider receipt (the K03 matrix measured on that host) belongs to the provider binding owners T8.01, T11.01 and T11.02 and their device cells, and is not a condition of T6.02",
    },
    depends_on: ["T6.01", "T1.10"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [],
    rollback:
      "remove the launcher package from the template unit's ExecStart (the unit then refuses to start, which is the pre-task state)",
    completion_condition:
      "state authority-isolated (readback_revision.cutover_states.state_2): reached only when the K04 reach test and the no-twr-seat probe both pass in one receipt whose first line is the literal state name; until then T6.02 is not done and no surface may describe tower isolation as enforced",
    failing_check_first:
      "before the launcher exists, the template unit has nothing to execute: the supervisor's start instruction fails with a recorded 'no launcher' event; that is the red",
    retained_protection: "K01 kill-at-every-boundary tests retained",
    failure_test:
      "Fail if: a replayed registration is accepted; a stale result lands; any provider reaches a TCP broker; a seat reads a credential; the mods folder is writable from inside the agent; the dynamic account outlives its unit",
    ryan_act: "none",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    interfaces_required: [
      "T7.02 defines the socket protocol the launcher creates the endpoint for; T11.03 consumes the observer endpoint (IA-05 dependency edit, applied by the lead)",
      "the broker observer endpoint's unix socket path is read from the admin-capability-broker component's contract, not restated here",
    ],
    proof_limits: [
      "headroom field names are the broker component's; this test proves reachability without credential, not the headroom semantics (T11.03 owns those)",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    target_tool_launch: {
      owner: "T9.01",
      source: "packages/throughline-launcher/src/target-binding.ts",
      input_keys: ["target_id"],
      adapter_owners: ["T8.03", "T11.02", "T11.01"],
      tested_after: ["T9.01", "T8.03", "T11.01", "T11.02"],
      no_back_edge:
        "The launcher supplies the optional typed input/module slot; target/provider owners prove its target-bound consumption later, not a slice-6 dependency on slice 9.",
    },

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        done_when: {
          host: "twr, under the installed supervisor, non-builder and rpi under its supervisor after the Raspberry Pi server is installed at the same release through the existing per-slice Raspberry Pi install path (pipeline steps build-rpi, gate-rpi, stage-rpi-headless and install-rpi-headless, which T1.10 already requires)",
          command:
            "start one agent of each provider; record each registration; then: kill the Claude agent's unit, restart it, and replay the first registration and a result signed with the first generation; inside the restarted Codex agent run: ls $BROKER_SOCKET $OBSERVER_ENDPOINT; curl -s --unix-socket $OBSERVER_ENDPOINT http://x/headroom | jq .freshness; ls /home/twr; cat /etc/passwd | grep -c throughline; then as twr on the tower: ps -u twr -o pid=,comm= | grep -vE '^ *[0-9]+ (postgres|node|systemd|\\(sd-pam\\))$' ; systemctl --user list-units --type=service --no-legend | grep -ciE 'claude|codex|pi-|harness|seat'",
          expect:
            "three registrations with distinct generations; the replayed registration and the stale result are refused with recorded events; the broker socket and observer endpoint exist and headroom returns a freshness field with no credential in the environment; ls /home/twr fails; the previous dynamic account is gone from the system after its unit stopped; the twr process list shows only the record, the server and systemd (no harness process), and twr's user manager runs no seat unit: this is the no-twr-seat probe that reaches state authority-isolated; a separate Raspberry Pi receipt with the same five outcomes; the per-host provider receipt (the K03 matrix measured on that host) belongs to the provider binding owners T8.01, T11.01 and T11.02 and their device cells, and is not a condition of T6.02",
        },
        what: "One program in packages/throughline-launcher executed by the agent template unit: reads its generation (uid from id, $INVOCATION_ID, cgroup from /proc/self/cgroup, process start from /proc/self/stat), writes the identity join row (T5.02 API) binding the public agent id to that generation, creates the agent's messaging socket under the root-owned runtime directory the supervisor passes in, registers the endpoint with the admission service carrying the generation, starts the harness (Claude with the ThroughLine mod, Codex with its approval policy, Pi with the extension) with the mods folder read-only to the agent, passes the broker socket and the broker observer endpoint (IA-05) into the profile, and on exit drains results, closes the endpoint, lets the unit stop, and the dynamic account is removed by systemd; a replayed registration or a late result from a replaced generation is refused by the admission service. Crash resume: a new generation registers fresh; the old generation's unknown effects stay unknown (K01). The launcher is built per architecture (x86_64, arm64) with K12 input digests and reads its host configuration from packages/throughline-launcher/hosts/<host>.json; it runs identically under both supervisors. At every unit start the launcher's supervisor writes the generation registry entry (unit name, invocation id from systemctl show, cgroup path, dynamic uid, unit start time, children_allowed, state=active) under /run/throughline/registry/<unit>.json, root-owned, group-readable by the host's server account; at ExecStopPost it sets state=closed. The host's server forwards the entry to the admission service over its own authenticated record connection; no key is minted. It exposes an optional target-id job input and read-only target-tool binding slot. T9.01 and the provider owners prove target-bound launch/succession later; target-free exploratory launches stay supported and no later-slice edge is added here.",
        files: [
          {
            path: "/run/throughline/registry/",
            side: "host-filesystem",
            host: "twr and rpi",
            owner: "root directory, entries root-owned, readable by the server account",
            action: "add",
            note: "created by the supervisor; verification target",
          },
          {
            path: "packages/throughline-launcher/",
            side: "fork-namespace",
            action: "add",
          },
          {
            path: "apps/server/src/orchestration/admission/registration.ts",
            side: "fork-namespace",
            action: "add",
            note: "generation-carrying registration and refusal of replays",
          },
          {
            path: "packages/throughline-launcher/src/target-binding.ts",
            side: "fork-namespace",
            action: "add",
            exists_now: false,
          },
        ],
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T6.03",
    slice: "slice-6",
    title: "The Mac adapter and the Claude Code version pin on both hosts",
    serves: ["NG-069", "NG-054"],
    detail_state: "detailed",
    what: "The Mac joins the record through an adapter in the desktop app that binds the same public agent id to the app's keychain-held identity (weaker by declaration, K04) and registers with the admission service carrying an app-session generation. Claude Code is pinned to one mods-capable version on the Mac and the tower through the existing cc-version-pin lane (the governed ryan door on the Mac, checksum download plus symlink on the tower); the mods folder path is the same on both hosts.",
    files: [
      {
        path: "apps/desktop/src/throughline/adapter.ts",
        side: "fork-namespace",
        action: "add",
      },
      {
        path: "apps/desktop/src/throughline/keychain-access-check.ts",
        side: "fork-namespace",
        action: "add",
        note: "source-owned, non-model access check: one function putAppOnlyItem(service, account, value, trustedApps) writes both the real item and a canary item (service suffix -canary, fixed non-secret value 'throughline-canary-v1') with the identical trusted-application list; the check reports booleans only and never passes -w on the real item",
      },
      {
        path: "~/Library/Application Support/ThroughLine/diagnostics/keychain-check.json",
        side: "outside-tool",
        host: "mac",
        action: "read",
        note: "written by the installed app's own run of the check: {real_item_present, canary_present, acl_lists_equal, canary_app_read, checked_at}; contains no values",
        surface: "verification",
      },
      {
        path: "/Users/Admin/.claude/settings.json",
        side: "outside-tool",
        action: "read",
        note: "CLAUDE_CODE_PLUGIN_DIRS read only",
        surface: "verification",
      },
    ],
    signatures: ["pin receipt from the cc-version-pin lane plus the adapter receipt"],
    failing_checks: ["PH2-C01"],
    done_when: {
      host: "the Mac and twr, non-builder",
      command:
        "Installed app’s own canary access diagnostics reports booleans only: real_item_present, canary_present, acl_lists_equal, canary_app_read and current checked_at. Negative non-app probe uses only the fixed non-secret canary and reports EXIT, distinguishing missing (44), denied (other nonzero) and incorrectly readable (0). Observe real app consumption only from the server-side connection table. Do not dump a real keychain, read real item metadata/value, inspect process arguments or capture then redact. Compare the two governed Claude version-pin receipts without changing lane/context/security settings.",
      expect:
        "identical version strings on both hosts and the version listed as mods-capable in the cc-version-pin receipt; the message's sender_generation is an app-session generation bound to the Mac's public id; (1) keychain-check.json shows real_item_present=true, canary_present=true, acl_lists_equal=true, canary_app_read=true with a checked_at inside the test window; (2) the two items' trusted-application lists are identical and name only the installed app's executable; (3) EXIT is non-zero and not 44 (44 is errSecItemNotFound and means the canary is missing, a different failure); EXIT=0 means the boundary is broken",
    },
    depends_on: ["T6.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [],
    rollback: "cc-version-pin undo with its receipt; remove the adapter registration",
    failing_check_first:
      "before the work, the two hosts' `claude --version` outputs differ or the tower has none under the dynamic user; measured at intake and recorded",
    retained_protection:
      "the real item is never read by any test on either polarity; the existing app-only trusted-application ACL (D04) is retained and proven by equivalence to the canary",
    failure_test:
      "Fail if: versions differ; the adapter stamps a tower generation; the canary is readable by a non-app process (EXIT=0); the canary is absent (EXIT=44) while the real item is present; the two ACL lists differ or either names any executable other than the installed app; keychain-check.json is older than the test window or missing any boolean; any test passes -w on the real item or captures its value; the pin was done by hand instead of through the lane",
    ryan_act:
      "none on the Mac; on the tower the pin is a user-level symlink under the launcher's path, no sudo",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    interfaces_required: [
      "T12.02 pairing depends on this adapter (IA-03 dependency edit, applied by the lead)",
    ],
    proof_limits: [
      "Canary/ACL equivalence is reported by the installed owning app, not a dump of the real keychain. Real-item positive consumption is server-side; no actual credential export proof or process-argument inspection is claimed.",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T7.01",
    slice: "slice-7",
    title: "The ComsNet envelope as the shared provider-binding core",
    serves: ["NG-017", "NG-022", "NG-023"],
    detail_state: "detailed",
    what: "packages/throughline-coms carries the prompt, response and ping envelopes ported from Ryan's coms.ts as plain TypeScript with no Node imports, plus encode and decode with tolerant decoding (K09) and a fixture set; the mod, the server, the Pi extension and the CLI import it.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/pi-harness/pi-vs-claude-code-upstream/extensions/coms.ts",
        side: "outside-tool",
        action: "read",
      },
      {
        path: "packages/throughline-coms/",
        side: "fork-namespace",
        action: "add",
      },
    ],
    signatures: ["one receipt with the build, test and consumer count output"],
    failing_checks: ["PH2-C01"],
    done_when: {
      host: "the fork checkout on the Mac for the build test, twr for the consumer test; non-builder",
      command:
        "pnpm --filter throughline-coms build && pnpm --filter throughline-coms test (the test fails the build if any module imports node:*); grep -rl 'throughline-coms' apps/server packages/throughline-launcher <mod> <pi-extension> <cli> | wc -l",
      expect:
        "build and fixtures pass with zero node imports; at least four consumers import the package; the fixture round-trips byte-identical for all three envelopes",
    },
    depends_on: ["T6.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [],
    rollback: "remove the package; consumers revert to their private copies",
    failing_check_first:
      "the no-node-imports test fails on the first port because coms.ts imports node modules today (read at intake); that is the red",
    retained_protection:
      "existing coms.ts behavior kept by the fixtures captured from it before the port",
    failure_test:
      "Fail if: any node import survives; a consumer keeps a private envelope copy; a fixture changes bytes",
    ryan_act: "none",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    interfaces_required: [
      "slice 8 mod and slice 11 Pi extension import this package; they do not define envelopes",
    ],
    proof_limits: [
      "tolerant decoding is tested against the fixture set, not against a future release's envelope",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T7.02",
    later_named_task: {
      text: "T7.06 (new, slice 7): cross-host peer discovery between tower and Raspberry Pi seats over the rail (messages already cross hosts as tasks; direct socket peers are host-local by design); not required for the first install",
      source: "Fable-Delta-Hosts.json item 3",
    },
    slice: "slice-7",
    title:
      "One socket endpoint per agent account; peers found across accounts and authenticated by the kernel",
    serves: ["NG-024", "NG-026", "NG-018"],
    detail_state: "detailed",
    what: "Each agent's endpoint is a unix socket in its own root-owned runtime directory created by the supervisor (never under another account's home); the directory listing the admission service publishes is the discovery, with the generation beside each endpoint. On accept, the server reads SO_PEERCRED (pid, uid), reads /proc/<pid>/cgroup, finds the active supervisor registry entry whose cgroup path equals it (the path is only a lookup key; the invocation id and generation come from the entry the supervisor wrote), requires uid equal to the entry's dynamic uid, requires the connecting process's own start time from /proc/<pid>/stat to be at or after the entry's unit start time, re-reads that start time after the lookup and refuses on any change, and refuses with a recorded reason when no active entry matches (not-supervised), when the entry is closed (generation-replaced), or when the uid differs (uid-mismatch). A process inside the unit's cgroup, including a harness-spawned CLI child, is a member of that generation; its message is stamped with the unit's generation and its own pid and start time are recorded as member identity, never compared to the launcher's start.",
    files: [
      {
        path: "packages/throughline-coms/src/socket/peer-membership.ts",
        side: "fork-namespace",
        action: "add",
        note: "the registry lookup, uid and start-time checks, and the refusal reasons",
      },
      {
        path: "packages/throughline-coms/src/socket/",
        side: "fork-namespace",
        action: "add",
      },
      {
        path: "/run/throughline/<agent>/coms.sock",
        side: "host-filesystem",
        host: "twr",
        owner: "root directory, agent-owned socket",
        action: "add",
        note: "created by the supervisor and launcher; verification target",
      },
    ],
    signatures: ["one receipt with the three outcomes"],
    failing_checks: ["PH2-C01"],
    done_when: {
      host: "twr under the installed supervisor, non-builder",
      command:
        "start agents A and B; from inside A run the CLI child (throughline-coms send --to B) and record the stamp; then stop B's unit and start a new B and replay A's cached endpoint for old B; then as twr run `systemd-run --user --pty -- node <cli> peers` and connect to A's socket; then stage a pid-reuse case: a member process exits immediately after connect and the test harness forks until it obtains the same pid, then attempts to continue the connection",
      expect:
        "the CLI child's message is accepted and stamped with A's unit generation with the child's own pid and start recorded; the replay to old B is refused generation-replaced; the systemd-run process is refused not-supervised; the pid-reuse case is refused on the start-time recheck; every refusal is a recorded event with its reason",
    },
    depends_on: ["T7.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [],
    rollback: "remove the socket module; the launcher creates no endpoint",
    failing_check_first:
      "before the work, any process that can open the socket path is accepted; that acceptance is the red (measured by a connect from a twr shell to a fixture socket)",
    retained_protection: "K04 replay tests from T6.02 retained",
    failure_test:
      "Fail if: a connection without a matching join tuple is accepted; discovery requires reading another account's home; a recycled uid connects",
    ryan_act: "none",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    interfaces_required: ["T5.02 sender stamp reads the same peer tuple"],
    proof_limits: [
      "SO_PEERCRED proves the connecting process's uid and pid at accept time; the start-time read closes the pid-reuse window but a process replaced between accept and read is a theoretical gap, recorded as such",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        done_when: {
          host: "twr under the installed supervisor (and rpi after its receipt), non-builder",
          command:
            "start agents A and B; from inside A run the CLI child (throughline-coms send --to B) and record the stamp; then stop B's unit and start a new B and replay A's cached endpoint for old B; then as twr run `systemd-run --user --pty -- node <cli> peers` and connect to A's socket; then stage a pid-reuse case: a member process exits immediately after connect and the test harness forks until it obtains the same pid, then attempts to continue the connection",
          expect:
            "the CLI child's message is accepted and stamped with A's unit generation with the child's own pid and start recorded; the replay to old B is refused generation-replaced; the systemd-run process is refused not-supervised; the pid-reuse case is refused on the start-time recheck; every refusal is a recorded event with its reason",
        },
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T7.03",
    slice: "slice-7",
    title:
      "One rail: the message is a task for the recipient, the reply its result, the sender a wait row",
    serves: ["NG-019", "NG-020", "NG-021", "NG-088", "NG-013"],
    detail_state: "detailed",
    what: "A message received on the socket is admitted as a command and enqueued as an Absurd task addressed to the recipient's public id in the same transaction (K01 outbox); the recipient's reply is the task's result; the sender holds a durable event wait keyed by request id and generation (K02, Absurd 0.5.0 durable event waits, whose migration is slice 3's named task). No watcher process and no poll loop exist; delivery is the recipient's worker picking up its task. JEV rides this rail (NG-088): each admitted send and each reply passes through the K07 condition port as a recorded step on the recipient task's workflow, carrying source ids, question version, model and confidence; the answer annotates the message and never blocks or releases delivery. Waiting ends the turn (D25): the sender's durable event wait is the seat's suspension, never a poll inside the model's turn; the coms wait tool returns to the provider adapter a suspend outcome that ends the model step, and the reply arrives as a new admitted command through the route slot (T3.08), which wakes the seat once with a digest when more than one task is pending. A broadcast is one admitted command with many recipients, classified once; each recipient's task carries the same route decision and JEV step id. An admitted send to a sleeping recipient whose route is no_model records the annotation and starts no task for that recipient.",
    files: [
      {
        path: "packages/absurd-runtime/src/",
        side: "fork-namespace",
        action: "edit",
      },
      {
        path: "packages/throughline-coms/src/rail/",
        side: "fork-namespace",
        action: "add",
      },
    ],
    signatures: ["one receipt per boundary run plus the three reply cases"],
    planned_checks: [
      {
        id: "T7.03-jev",
        kind: "contract-test",
        command:
          "send one message and one reply on the socket; read the recipient workflow's steps; retry the send with the same request id",
        expect:
          "one JEV step per send and per reply with source ids, question version, model and confidence; the retry reuses the recorded step and makes no second JEV call; delivery is unchanged by the answer",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    done_when: {
      host: "twr, non-builder",
      command:
        "A sends to B; kill the server process at each K01 boundary in turn (five runs); then send a duplicate reply, a late reply after the wait closed, and reply-before-wait; then: read only registered service/cgroup identities and process comm names, never argv or environment; record zero watcher/poller units",
      expect:
        "each run yields exactly one admitted command and one delivered reply or one recorded unknown, never two deliveries; the duplicate and late replies are recorded and ignored; reply-before-wait resumes exactly once; the process count for any watcher or poller is 0; a notice sent to five idle recipients records one route decision, one JEV step when the port is bound, and zero provider turns; a seat that calls wait ends its model step and resumes exactly once when the reply and two queued notices are pending, with the notices in the digest",
    },
    depends_on: ["T7.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [],
    rollback:
      "the rail module is removed; the socket carries nothing; the MCP path (still present until T7.04) remains the transport",
    failing_check_first:
      "before the work, the kill-after-enqueue run delivers the message twice or loses it (the existing MCP path has no outbox); recorded at intake as the red",
    retained_protection: "K01 and K02 tests retained verbatim",
    failure_test:
      "Fail if: a message is delivered twice; a late reply resumes a closed generation; a poller exists; a reply completes a target (K02 forbids)",
    ryan_act: "none",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    interfaces_required: [
      "slice 3 owns the Absurd 0.4.0 to 0.5.0 migration task; T7.03 depends on it being landed, named as a requirement, not absorbed",
    ],
    proof_limits: [
      "five boundary kills prove the named boundaries; a kill inside Postgres itself is slice 4's rehearsal-cluster probe, not this task",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T7.04",
    fork_state: [
      {
        ref: "30f8e3e388",
        disposition: "rework",
        reason:
          "Reuse authenticated-claim/refusal tests and sender payloads, but move engine/projection SQLite stamping into record-owned identity joins and admission; authenticate every ingress and retain MCP only until the CLI replacement is proven.",
        source: "G5-Fork-State.json A.main_commits",
      },
    ],
    slice: "slice-7",
    title:
      "The CLI (Codex's only door) and the Pi extension; the MCP comsnet retires after the replacement passes",
    serves: ["NG-028", "NG-027", "NG-043"],
    detail_state: "detailed",
    what: "packages/throughline-coms-cli is a first-class CLI with the four tools (peers, send, subscribe, result) for all three harnesses and Codex's only door (Ryan, Sep 10, 2026); the Pi extension Ryan owns calls the same core. The MCP comsnet transport, correlation and toolkit retire only after the CLI passes the same four-tool test on all three harnesses on the tower; a seat invoking the retired MCP tool gets a clear refusal naming the CLI. The MCP JSON store is preserved read-only until Phase-6 acceptance, not deleted by this task. Retiring the MCP comsnet also deletes the frozen @ryan/agent-mcp-relay relay tarball apps/server/vendor/agent-mcp-relay-0.3.0.tgz, its apps/server/vendor/README.md, and the @ryan/agent-mcp-relay dependency line in apps/server/package.json with its pnpm-lock.yaml importer entry (decision D3, ruled by the lead orchestrator: vendored as a tarball, not as a fork package).",
    files: [
      {
        path: "apps/server/vendor/agent-mcp-relay-0.3.0.tgz",
        side: "fork-namespace",
        action: "remove",
        exists_now: true,
        note: "the frozen 0.3.0 legacy MCP relay tarball (not ComsNet)",
      },
      {
        path: "apps/server/vendor/README.md",
        side: "fork-namespace",
        action: "remove",
        exists_now: true,
      },
      {
        path: "apps/server/package.json",
        side: "upstream-edit",
        action: "edit",
        exists_now: true,
        note: "removes the fork-added @ryan/agent-mcp-relay dependency line, returning this stock file toward its upstream content",
      },
      {
        path: "pnpm-lock.yaml",
        side: "upstream-edit",
        action: "edit",
        exists_now: true,
        note: "drops the @ryan/agent-mcp-relay importer entry; regenerated by pnpm install",
      },
      {
        path: "packages/throughline-coms-cli/",
        side: "fork-namespace",
        action: "add",
      },
      {
        path: "apps/server/src/mcp/ComsNetTransport.ts",
        side: "fork-namespace",
        action: "remove",
      },
      {
        path: "apps/server/src/mcp/ComsNetCorrelation.ts",
        side: "fork-namespace",
        action: "remove",
      },
      {
        path: "apps/server/src/mcp/toolkits/comsnet/handlers.ts",
        side: "fork-namespace",
        action: "remove",
      },
    ],
    signatures: ["three seat receipts plus the retirement receipt"],
    failing_checks: ["PH2-C01"],
    done_when: {
      host: "twr, one seat per harness, non-builder",
      command:
        "in each of a Claude, a Codex and a Pi seat: throughline-coms peers; throughline-coms send --to <peer> --text ping; throughline-coms subscribe --timeout 30; throughline-coms result <id>; then in the Codex seat call the old MCP comsnet tool; then in the release worktree: test ! -e apps/server/vendor/agent-mcp-relay-0.3.0.tgz && test ! -e apps/server/vendor/README.md && ! grep -q '@ryan/agent-mcp-relay' apps/server/package.json pnpm-lock.yaml && pnpm install --frozen-lockfile",
      expect:
        "all four commands succeed in all three seats with generations recorded; the MCP call is refused with a message naming the CLI; the three removed files are absent from the installed server and the owning seam manifest records proven fork-owned retirements; Seam-Baseline.json remains byte-unchanged in this integration; the relay tarball and apps/server/vendor/README.md are absent, neither apps/server/package.json nor pnpm-lock.yaml names @ryan/agent-mcp-relay, and the frozen install succeeds without it",
    },
    depends_on: ["T7.03"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [],
    rollback:
      "restore the three MCP files from the seam baseline commit; the CLI stays installed but unused",
    failing_check_first:
      "before the work, `throughline-coms` is not on any seat's path (command not found): the red",
    retained_protection:
      "the MCP path keeps working until the CLI receipt exists (replacement before retirement, Phase-4 exit)",
    failure_test:
      "Fail if: any harness lacks one of the four tools; the MCP tool still works after retirement; the JSON store was deleted; Codex has a second door",
    ryan_act: "none",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    interfaces_required: [
      "T2.01 owns seam accounting against pinned identities; no baseline lowering or mutation by this task.",
    ],
    proof_limits: [
      "the Pi extension is Ryan-owned source; this task proves it calls the shared core, not that every Pi feature is unchanged",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T7.05",
    slice: "slice-7",
    title: "Cross-device messaging on every device role, required; the transport chosen under K05",
    serves: ["NG-025", "NG-195", "NG-018"],
    detail_state: "detailed",
    what: "A message sent from any device role (Mac app, iPhone, Android, tower seat) lands as a request on the rail and its reply returns to the sender's device. Transport: the existing pairing transport is the adapter to the admission service on the tower; the HTTP-and-SSE hub from the same upstream repository is adopted only if a measured gap in pairing is recorded with its test; the Cloudflare tunnel to the tower service is preserved for the no-Tailscale case and reaches the same admission service, never a fallback authority (K05). The device matrix messaging row's cold test is this task's done_when.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/coms-net/specs/coms-net-v1.md",
        side: "outside-tool",
        action: "read",
      },
      {
        path: "apps/mobile/src/connection/",
        side: "fork-namespace",
        action: "edit",
        note: "pairing transport carries the envelope",
      },
    ],
    signatures: [
      "one receipt per device role plus the no-Tailscale receipt, each with the non-builder id and the device",
    ],
    failing_checks: ["PH2-C01"],
    done_when: {
      host: "each device role, cold, by a non-builder on the real device; the no-Tailscale case with Tailscale off on the phone",
      command:
        "from each device: send one message to a tower seat and wait for its reply; on the phone with Tailscale off: repeat through the Cloudflare route; then curl the snapshot for the five request ids",
      expect:
        "five replies returned to their sending devices; five request rows with distinct device generations; the no-Tailscale send reaches the same admission service (same record row shape, no second queue); if the SSE hub was adopted, the receipt carries the measured pairing gap",
    },
    depends_on: ["T7.04", "T12.07"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [],
    rollback:
      "the mobile transport change reverts; device messaging falls back to not-available in the matrix, never to a second queue",
    failing_check_first:
      "before the work, the phone send has no rail row (the pairing transport carries no envelope today): the red",
    retained_protection: "existing pairing tests retained; K05 partition tests retained",
    failure_test:
      "Fail if: a device role cannot send or does not receive its reply; the no-Tailscale route creates a second authority; the SSE hub was adopted without a recorded gap",
    ryan_act:
      "No blanket OS-prompt assignment; pairing/permissions are agent work where capabilities allow. Genuinely reserved hardware/privilege acts require current cited authority and an alternative.",
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    interfaces_required: [
      "slice 13 device matrix owner consumes this row; slice 12 pairing owner supplies the paired state (IA-03); neither is edited here",
    ],
    proof_limits: [
      "Android evidence is tracked at K09's six levels; this task's Android cell is proven only at the native-device level with its dated receipt",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        what: "A message sent from any device role (Mac app, iPhone, Android, tower seat, Raspberry Pi seat) lands as a request on the rail and its reply returns to the sender's device. Transport: the existing pairing transport is the adapter to the admission service on the tower; the HTTP-and-SSE hub from the same upstream repository is adopted only if a measured gap in pairing is recorded with its test; the Cloudflare tunnel to the tower service is preserved for the no-Tailscale case and reaches the same admission service, never a fallback authority (K05). The device matrix messaging row's cold test is this task's done_when.",
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T8.01",
    enforcement_evidence: [
      {
        id: "B03",
        score: 8,
        finding:
          "Mod throw/budget overrun/invalid return defaults to skip-to-core. A deny after await next is too late.",
        correction:
          "Require mod load witness; obtain validated decision before next; return valid refusal on error and install refusing .catch for tool.call and turn.step. Test missing module, throw, timeout, malformed response and late-next; failed gate never qualifies as enforced.",
        status: "folded in 0.4.0",
        source: "G6-Enforcement.json section B",
      },
      {
        id: "B04",
        score: 9,
        finding:
          "Claude turn.step has per-turn-request control but auxiliary plugin calls have separate events; Codex approvals do not gate model requests; Pi before_provider_request transforms and swallows failure.",
        correction:
          "Separate turn admission from per-model-request admission. Bind existing access-broker transport to the SAME I-01 admission service before forwarding Codex/Pi requests, or use a mandatory fail-closed wrapped provider/stream. Claude binds auxiliary model operations too. No second execution authority; until measured, declare these per-model cells unsupported/observe-only.",
        status:
          "open: scored 9; with the Fable design thread 44973766-bbeb-4c80-b506-a4b171273e33, whose decision lands at execution/phase-02/closeout-2026-10-09/Fable-Delta-Enforcement.json and is applied verbatim before 0.4.0 is final",
        source: "G6-Enforcement.json section B",
      },
      {
        id: "B06",
        score: 6,
        finding:
          "Cancellation best effort on all; SubagentStart does not veto spawn. Current Claude/Codex support pre-compact veto; Pi adapter lacks native compaction controls.",
        correction:
          "Veto Agent/spawn_agent/dispatch before spawn and require child binding. Record stop-requested until settlement and preserve unknown effects; never count post-tool/interrupt as prevented. Measure current compaction controls rather than inheriting old limits.",
        status: "folded in 0.4.0",
        source: "G6-Enforcement.json section B",
      },
      {
        id: "B08",
        score: 4,
        finding:
          "This read-only task establishes source/tooling capability and custody metadata, not live disconnected-record/refused-operation trials.",
        correction:
          "Fold as design evidence, not K03 acceptance. Keep counts null and A05 evidence-needed until pinned provider/host/profile trials cover failures, bypasses, child binding and actual side-effect witnesses.",
        status: "folded in 0.4.0",
        source: "G6-Enforcement.json section B",
      },
    ],
    slice: "slice-8",
    action: "amend",
    title:
      "The Claude binding: every model request and tool call of a Claude seat goes to the admission point, with the four coms tools",
    serves: [
      "NG-044",
      "NG-045",
      "NG-046",
      "NG-047",
      "NG-048",
      "NG-049",
      "NG-053",
      "NG-030",
      "NG-035",
      "NG-036",
    ],
    what: "One ThroughLine Claude mod in the fork namespace, loaded in every Claude session the launcher starts. Its hooks turn each model request and tool call into an I-01 admission request over the server's local socket and act on the decision: pre-tool refused means the tool does not run; unreachable admission means refuse (fail-closed). A mod handler that throws, overruns its budget or returns an invalid value falls through to the core by default, and a deny after await next is too late (G6 B03), so the mod obtains a validated decision before it calls next, returns a valid refusal on any error, installs a refusing catch on tool.call and turn.step, and writes a load witness so a missing mod is never counted as enforced. Agent spawn is vetoed before the spawn (SubagentStart only observes) and a cancellation is recorded as stop-requested until it settles; a post-tool event or an interrupt is never counted as prevented (G6 B06). Classes the hooks cannot veto are declared observe-only in the K03 row, never claimed. The mod never classifies an effect and never signs provenance. It carries the four coms tools over I-05. Target tools move to T8.03. No journal: every row goes through the server door, never to Postgres. Levels 6 and 7 of JEV (NG-087, NG-089): the mod passes each intercepted tool input, tool result and outgoing model request, and each turn end, to the K07 port; each answer is a recorded step with source ids, question version, model and confidence, and annotates without admitting or refusing. The mod's turn.step remains a pre-model check for the turn's own requests (supported, counted) and fails closed per B03; auxiliary and plugin-originated model calls are observed by the mod and enforced only by the broker token; the launcher-passed admission token is attached to every outbound model request. The mod attaches the step id to each tool.call and model request it observes; an action with no step id is refused by the mod (B03 fail-closed) and, independently, at the broker. Evidence instead of raw output (D25, level 6): before a tool result enters the model's context the mod's tool.result hook sends the full result to the record (blob when over the step payload limit, T3.02) and asks the admission service for evidence: code facts (exit code, byte and line counts, changed paths, diff stats, the first and last lines) and, when the K07 port is bound, the passages JEV selects against the tool call's stated purpose and the bounded questions the call carried; the model receives the evidence with the blob id and recovers any original passage through readBlob. Whether the Claude mod can replace a tool result before the model sees it is measured in the K03 row, never assumed; where it cannot, the row says observe-only and the raw result enters context.",
    files: [
      {
        path: "packages/throughline-claude-mod/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
        assumption: "A03",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/hooks/claude-mods/ask-jev/.claude/types/claude-code.d.ts",
        side: "outside-tool",
        action: "read",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: ["I-01", "I-04", "I-05"],
      provides: ["Claude row of the K03 matrix"],
    },
    signatures: [
      "onPreToolUse(event) -> admission request (I-01) -> allow | deny with reason",
      "onModelRequest(event) -> admission request with operation_class pre-model",
      "coms tools: send, reply, wait, list (names fixed by T7.04's CLI contract)",
      "failClosed(handler) -> a valid refusal on a missing module, a throw, a timeout, a malformed response or a late next; five fixtures, one per case, and a failed gate is never reported as enforced",
    ],
    done_when: {
      command:
        "node /Users/Admin/throughline/packages/throughline-claude-mod/scripts/k03-matrix.mts --provider claude --host <mac|twr> --out <evidence>/k03-claude-<host>.json",
      expect:
        "exit 0 on all three hosts; refused pre-tool calls did not execute; fail-closed case refused; a Claude plugin-originated model call without a valid token is refused at the broker and recorded; the mod's turn.step refusal of a turn request is counted",
      judge: "a visible ThroughLine seat that did not build T8.01, medium effort or lower",
    },
    depends_on: ["T3.01", "T6.02", "T7.04", "T3.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback:
      "Install the previous release through the pipeline; the mod is versioned inside the release, so the previous release has no mod and no admission rows.",
    risk: [
      "Claude hook coverage of model requests may be observe-only; K03 records that instead of inventing parity.",
    ],
    window_estimate: "one window: one new package, about 6 files, one host-run script",
    device_cells: ["exec-claude@mac", "exec-claude@twr"],
    proof_limits: [
      "Proves the binding only on the hosts measured and the Claude Code version pinned at measurement; re-measured at every provider pin (K03).",
    ],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-01", "I-04", "I-05"],
        provides: ["Claude row of the K03 matrix"],
      },
      window_estimate: "one window: one new package, about 6 files, one host-run script",
      proof_limits:
        "Proves the binding only on the hosts measured and the Claude Code version pinned at measurement; re-measured at every provider pin (K03).",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T8.01-jev",
        kind: "contract-test",
        command: "one Claude turn with one tool call; read the turn's workflow steps",
        expect:
          "JEV steps for the intercepted tool input, its result and the turn end, each with source ids, question version, model and confidence; the admission decision is the same with JEV disabled",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T8.01-red",
        kind: "first-act-red",
        where: "installed ThroughLine on the Mac",
        command:
          "node /Users/Admin/throughline/packages/throughline-claude-mod/scripts/k03-matrix.mts --provider claude --host mac --out <evidence>/k03-claude-mac.json",
        expected_today:
          "fails: the script and mod do not exist yet; after the script exists and before the mod installs, a Claude tool call produces zero admission rows",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T8.01-k03",
        kind: "contract-test",
        command:
          "the same script on mac, twr and rpi under the real launch policy, dropping the record connection before each call",
        expect:
          "every K03 cell for Claude is a measured count of requested, admitted, executed and recorded actions by stable id",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        done_when: {
          command:
            "node /Users/Admin/throughline/packages/throughline-claude-mod/scripts/k03-matrix.mts --provider claude --host <mac|twr|rpi> --out <evidence>/k03-claude-<host>.json",
          expect:
            "exit 0 on all three hosts; refused pre-tool calls did not execute; fail-closed case refused; a Claude plugin-originated model call without a valid token is refused at the broker and recorded; the mod's turn.step refusal of a turn request is counted",
          judge: "a visible ThroughLine seat that did not build T8.01, medium effort or lower",
        },
        device_cells: ["exec-claude@mac", "exec-claude@twr", "exec-claude@rpi"],
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T8.02",
    slice: "slice-8",
    action: "amend",
    title:
      "Re-entry from the record when compaction happens; whether compaction may happen stays each seat's launch setting",
    serves: ["NG-196", "NG-098"],
    what: "When a Claude seat's compaction runs, the mod's compaction hook replaces the model-written summary with a re-entry packet built from the record: opening turns with engine handles, the kickoff compiled by the session-handoff compiler and gated by handoff-check, recent turns, and the act-matched shape statements resolved by code from the intent index with supersession applied, full text and ids (delta IA-02). The packet names the committed sequence cut, target revision, execution generation, native-session handle and unresolved-effect set; release is an atomic compare-and-release against the current cut, so a stale packet never releases (K06). Precompute before the ceiling. The mod never turns automatic compaction on or off. Auto-compaction is off for every Claude, Codex and Pi seat on every host as the product default (Ryan, Oct 9, 2026: \"I don't want any agent—Claude, Codex, nobody—to AutoCompact\"); T10.10 owns those settings, and the packet serves a compaction that Ryan or a seat starts by hand. There is one Codex provider and no separate worker lane. NG-196's \"on again after the install\" is superseded for the default by that Oct 9 ruling; turning auto-compaction back on would be a later Ryan decision applied through T10.10, never by this mod. The installed PreCompact hook changes in the same release. JEV bounces move to T8.04.",
    delta_carried: ["IA-02 append on T8.02"],
    files: [
      {
        path: "packages/throughline-claude-mod/src/compaction.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/hooks/claude-mods/_meta/lite-lifecycle-design-2026-10-06/Request-To-Fable-Design-Input-2026-10-07.md",
        side: "outside-tool",
        action: "read",
        exists_now: true,
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/hooks/claude-mods/_meta/lite-lifecycle-design-2026-10-06/Replay-Results-2026-10-07.html",
        side: "outside-tool",
        action: "read",
        exists_now: true,
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/_meta/next-gen-ledger-2026-10-05/Fable-Refresh-2026-10-07/Decision-Lite-Lifecycle-Mod-FOLD-2026-10-07.md",
        side: "outside-tool",
        action: "read",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: ["I-01", "I-02", "I-03"],
      provides: ["re-entry packet with shape ids"],
    },
    signatures: [
      "buildReentryPacket(conversation_id, cut) -> Packet",
      "compareAndRelease(packet) -> released | stale",
    ],
    done_when: {
      command:
        "the K06 stale-packet script (target change, tool completion, missing blob, cancelled execution injected between precompute and cut) plus the IA-02 packet test plus the three-provider auto-compaction read (T8.02-protect) before and after the mod installs",
      expect:
        "no stale packet releases; the shape is carried; on mac and twr, before and after: Claude autoCompactEnabled false, Codex model_auto_compact_token_limit 100000000, Pi compaction.enabled false",
      judge: "non-builder seat, medium or lower",
    },
    depends_on: ["T8.01", "T3.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-10-ryan-the-system-delivers-the-shape-at-the-moment-not-the-agent-remembering.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    rollback:
      "Previous release restores the previous PreCompact hook; the protection check proves no compaction setting moved.",
    risk: [
      "Reading the re-entry packet as permission to compact: the packet never turns compaction on; the three-provider protection read is the guard.",
    ],
    window_estimate: "one window if the existing session-handoff compiler is reused",
    device_cells: ["re-entry@mac", "re-entry@twr"],
    proof_limits: ["The intent-index recall rate is not promised (delta IA-02 remaining proof)."],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-01", "I-02", "I-03"],
        provides: ["re-entry packet with shape ids"],
      },
      delta_carried: ["IA-02 append on T8.02"],
      window_estimate: "one window if the existing session-handoff compiler is reused",
      proof_limits: "The intent-index recall rate is not promised (delta IA-02 remaining proof).",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T8.02-protect",
        kind: "retained-protection",
        where: "the Claude, Codex and Pi settings on the Mac, tower and Raspberry Pi",
        command:
          "on each of mac, twr and rpi, before and after the mod installs, read only these keys: autoCompactEnabled in ~/.claude/settings.json and ~/.claude.json; model_auto_compact_token_limit and model_auto_compact_token_limit_scope in ~/.codex/config.toml; compaction.enabled in ~/.pi/agent/settings.json (absent means the Pi harness default, true)",
        expected_today:
          "measured Oct 9, 2026: Mac Claude false in both files (A32); Mac and tower Codex 100000000 with scope total; Mac Pi has no compaction key, so Pi seats auto-compact today until T10.10 sets it; Raspberry Pi not yet read",
        measured: true,
        spec_projection: {
          kind: "real-disk",
          expected_today: "measured, see expected_today",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T8.02-red",
        kind: "first-act-red",
        command:
          "node /Users/Admin/throughline/packages/throughline-claude-mod/scripts/k06-stale-packet.mts --host twr --out <evidence>",
        expected_today:
          "fails: no packet builder exists; the installed PreCompact hook writes a model summary",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T8.02-ia02",
        kind: "contract-test",
        command: "build a packet for a successor whose next act is 'declare a slice finished'",
        expect:
          "carries SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self full text, no superseded shape, ids recorded",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        done_when: {
          command:
            "the K06 stale-packet script (target change, tool completion, missing blob, cancelled execution injected between precompute and cut) plus the IA-02 packet test plus the three-provider auto-compaction read (T8.02-protect) before and after the mod installs",
          expect:
            "no stale packet releases; the shape is carried; on mac, twr and rpi, before and after: Claude autoCompactEnabled false, Codex model_auto_compact_token_limit 100000000, Pi compaction.enabled false",
          judge: "non-builder seat, medium or lower",
        },
        device_cells: ["re-entry@mac", "re-entry@twr", "re-entry@rpi"],
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T9.01",
    slice: "slice-9",
    action: "amend",
    title:
      "The target record: a thread's work record exists from its first message in the state exploring; targets have their own ids and revisions",
    serves: ["NG-073", "NG-074", "NG-075", "NG-081"],
    what: "The lab's target task (steps, waits, events per target) reshaped for ThroughLine under K02 and K08: a target keeps its own id and revisions, distinct from the conversation and from each request; the thread's work record exists from the first message with state exploring and is durable before any target. A target waits on durable events and holds no worker slot while idle. An agent starts from nothing but a target id. Provides the target API and the add, fix and retract tools (consumed by T8.03 and the CLI). The common typed target tool interface serves Claude, Codex and Pi through the one owner; every launcher/provider consumes it. The installed target-ID-only succession test is owned by downstream T11.05; it is not a prerequisite of these APIs or their adapters. The existing exploratory-work test remains mandatory here.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/_meta/tower-pi-absurd-lab-2026-10-02/lab/src/targets.ts",
        side: "outside-tool",
        action: "read",
        exists_now: true,
      },
      {
        path: "packages/throughline-target/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
        assumption: "A03",
      },
      {
        path: "packages/throughline-target/src/provider-tools.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
    ],
    interfaces: {
      consumes: ["I-02", "I-03"],
      provides: [
        "target API",
        "deliverable_scope field on each target revision (used by D-CAP-01)",
      ],
    },
    signatures: [
      "openWorkRecord(conversation_id) -> state exploring",
      "admitTarget(conversation_id, candidate, answer) -> target_id, revision",
      "getTarget(target_id) -> revisions, deliverable_scope, checks",
      "requestTarget(operation, payload, authenticatedPeer) -> target snapshot | admitted target-change event | typed refusal",
    ],
    done_when: {
      command:
        "K08 test 1 on installed tower: a thread with no admitted target runs three turns, writes a file and dispatches a seat; then the central target API contract test for read/add/fix/retract, before provider wrappers consume it.",
      expect:
        "Exploratory work is recorded without an admitted target. Central API preserves exact words and revisions and refuses stale/unauthorized changes. Full provider startup and partial-work succession is accepted by T11.05 after the adapters, never claimed by this task.",
      judge: "non-builder seat",
    },
    depends_on: ["T5.02", "T7.03", "T3.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback:
      "Previous release; the work-record rows are additive and ignored by the previous build.",
    risk: [
      "Whether an idle Absurd 0.5.0 target holds no worker slot is asserted by K02 for conversations and must be measured for targets.",
    ],
    window_estimate: "one window",
    device_cells: [],
    proof_limits: ["none beyond the hosts measured"],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-02", "I-03"],
        provides: [
          "target API",
          "deliverable_scope field on each target revision (used by D-CAP-01)",
        ],
      },
      window_estimate: "one window",
      proof_limits: "none beyond the hosts measured",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T9.01-red",
        kind: "first-act-red",
        command:
          "node /Users/Admin/throughline/packages/throughline-target/scripts/k08-no-target.mts --host twr --out <evidence>",
        expected_today: "fails: after a first message there is no work record with state exploring",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    target_only_start: {
      owner: "T11.05",
      implementation_file: "packages/throughline-target/src/target-only-start.test.ts",
      hosts: ["mac", "twr"],
      providers: ["claude", "codex", "pi"],
      input_keys: ["target_id"],
      non_builder_required: true,
      steps: [
        "Launch a real installed ThroughLine worker for each supported provider with job input containing only target_id; no prompt transcript, copied target text or hand-authored handoff.",
        "Read Ryan exact_words, current revision and checks through the central authority; compare bytes with the authoritative source and record the provider/session/generation.",
        "Record the failing check, save partial work plus a durable step/wait, then replace the worker.",
        "Launch the replacement with only the same target_id; it reads the authority and recorded partial work, continues without redoing the committed effect and without a hand-written handoff.",
        "Advance the target revision; a completion for the old revision refuses.",
        "Builder self-acceptance and acceptance by an unauthorized third seat refuse; the dispatcher-named non-builder can accept the current revision.",
        "Direct agent writes to target records refuse; add/fix/retract only through the common interface with recorded admission and revision events.",
      ],
      refusals: [
        "stale-revision-completion",
        "builder-self-acceptance",
        "unauthorized-check-acceptance",
        "direct-target-record-write",
        "stale-generation-tool-call",
      ],
      receipt: "{evidence}/target-only-start/<host>-<provider>.json",
      final_acceptance:
        "ACCEPT-ALL requires every supported provider on each active execution host; a missing cell is not a pass; unsupported/observe-only behavior cannot be advertised as bound",
      central_owner: "T9.01",
    },

    target_interface: {
      owner: "T9.01",
      module: "packages/throughline-target/src/provider-tools.ts",
      transport:
        "One common typed target tool interface on the existing authenticated ThroughLine server tool surface; Claude mod, Codex launch tool registration and Pi extension are thin adapters. This is not a ComsNet transport and does not restore its retired MCP tools.",
      operations: ["read", "add", "fix", "retract"],
      signature:
        "requestTarget(operation, payload, authenticatedPeer) -> target snapshot | admitted target-change event | typed refusal",
      payload:
        "read(target_id); add(conversation_id, candidate_text, source_message_id); fix(target_id, expected_revision, candidate_text, reason, source_message_id); retract(target_id, expected_revision, reason)",
      read_result: [
        "target_id",
        "exact_words",
        "revision",
        "checks",
        "shape_ids",
        "deliverable_scope",
        "work_steps",
        "pending_waits",
      ],
      authority:
        "Identity and execution generation come from the authenticated launch/session, never caller labels; central target owner applies K08 and I-01, calls JEV, admits by code and records each accepted change as one event. No direct record writes, per-provider target store or credential is given to a seat.",
      launch_binding:
        "T6.02 passes only the target id as the job input and binds the read-only target-tool module plus the authenticated session/generation. Initial and resumed launches fetch the current revision from the one authority; input cannot supply cached words, check acceptance or authority.",
      runtime_state: "proposed-not-implemented",
    },
  },
  {
    id: "T9.02",
    slice: "slice-9",
    action: "amend",
    title:
      "The one JEV condition port; JEV answers before a target is saved and checks every later message; code admits",
    serves: [
      "NG-076",
      "NG-077",
      "NG-078",
      "NG-079",
      "NG-080",
      "NG-085",
      "NG-086",
      "NG-087",
      "NG-093",
      "NG-090",
    ],
    what: "JEV through the one condition port of K07 (typed answers, question and state-builder versions, cache by input hash and generation, batching, distinct no-answer, timeout and refusal outcomes, request and attempt identity), served through the access broker, every answer a step. The promotion parameter starts at 0.80 and is marked unevaluated until T9.04 records the chosen value. A declined candidate leaves the thread exploring; JEV re-asks only when the thread's own text changes. Code admits; JEV never does. An admitted target carries the shape ids its first acts match; the add, fix and retract tools record shape changes as events (delta IA-02). The port lives in its own package (D-CAP-09). NG-090: the port keeps a registry of its consumers so each new JEV use is visible and kept once a consumer uses its answer; the daily cadence is an operating practice after install, not an install gate. Placement accepted by the integration decision: packages/throughline-conditions is a code package only. No new daemon, queue, policy store or credential client; it reuses the existing broker capability and its owning client contract, and targets, re-entry and delivery consume the port without importing one another. After a target is admitted (NG-078), every later message is evaluated automatically with a typed outcome, unchanged, replaces the target, constrains it, or a separate task, and each change is a revision event that keeps the old words and the reason. The route slot (T3.08) is a registered consumer of the port (NG-090) through T9.06; its conditions are batched in one call per admitted message and cached by content hash plus recipient generation, so a broadcast is one call.",
    delta_carried: ["IA-02 append on T9.02"],
    files: [
      {
        path: "packages/throughline-conditions/src/port.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
      {
        path: "packages/throughline-target/src/jev-gate.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
    ],
    interfaces: {
      consumes: ["I-02", "access broker JEV route (existing)"],
      provides: ["condition port used by T8.04, T9.03, T9.05"],
    },
    signatures: [
      "ask(question_version, state, policy) -> Answer | NoAnswer | Timeout | Refusal",
      "gate(candidate) -> admitted(target_id) | declined",
    ],
    done_when: {
      command:
        "K07 test 2 (malformed answers, outage, duplicates, cache invalidation after a rewind) on the installed tower, then one thread whose first message becomes a target",
      expect:
        "K07 named outcomes pass; an unevaluated policy keeps live candidate admission exploratory. Test-only calibrated policy fixtures may exercise admission; production promotion governs only after T9.04’s calibration receipt.",
      judge: "non-builder seat",
    },
    depends_on: ["T9.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-10-ryan-the-system-delivers-the-shape-at-the-moment-not-the-agent-remembering.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    rollback: "Previous release; with no port, threads stay exploring, which K08 allows.",
    risk: [],
    window_estimate: "one window",
    device_cells: ["targets@mac", "targets@twr"],
    proof_limits: ["The 0.80 value has no evaluated error rate until T9.04."],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-02", "access broker JEV route (existing)"],
        provides: ["condition port used by T8.04, T9.03, T9.05"],
      },
      delta_carried: ["IA-02 append on T9.02"],
      window_estimate: "one window",
      proof_limits: "The 0.80 value has no evaluated error rate until T9.04.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T9.02-later-correction",
        kind: "contract-test",
        command:
          "admit a target; send a later message that corrects it, with no manual fixTarget call",
        expect:
          "one revision event typed replaces or constrains, carrying the old words and the reason",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T9.02-protect",
        kind: "retained-protection",
        command: "one native JEV call through the broker returning typed answers",
        expected_today:
          "passed once (receipts/Orchestrator-Jev-Recheck-2026-10-08.json); not a reliability claim",
        measured: true,
        spec_projection: {
          kind: "real-disk",
          expected_today: "measured, see expected_today",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T9.02-red",
        kind: "first-act-red",
        command:
          "node /Users/Admin/throughline/packages/throughline-conditions/scripts/k07-outcomes.mts --out <evidence>",
        expected_today:
          "fails: no port; malformed, outage, duplicate and post-rewind cache cases have no named outcome",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        device_cells: ["targets@mac", "targets@twr", "targets@rpi"],
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T9.03",
    slice: "slice-9",
    action: "amend",
    title:
      "Finished is computed and check-first is enforced: T9.03 supplies the target-policy input to the one admission point",
    serves: ["NG-138", "NG-139", "NG-083", "NG-089"],
    what: "A target's first act is a failing check on the installed thing. T9.03 implements the target_policy input slot of I-01: for each effect the admission point is deciding, it returns whether the effect is building or marking done under K08 and whether a failing-check event exists on the current target revision. The admission point (T3.01) makes the decision and refuses that effect, never the turn. K08's scope is kept whole: building and marking done wait for the failing check; launching seats, writing designs, dispatching and exploration do not. Settled by the integration decision. The building obligation is K08's verbatim: building and marking done wait for the failing check; launching seats, writing designs, dispatching and exploration do not. Classification uses engine-typed facts only (effect kind set by the server-side adapter, engine-resolved paths and cwd, step id, record state); a caller field such as exploration, mode or skip_gate is ignored and recorded. The deliverable scope is the admitted target revision's declared scope, plus the registered product roots (the fork repository, install roots and release steps) so that the absence of a target never grants unverified product mutation; design and plan areas outside those roots are never building. Post-tool observation is never counted as prevention. When an opaque command, such as a shell command whose writes cannot be resolved before it runs, could touch that scope, it runs only through an enforced read-only or test execution path, or that one effect is refused with a usable safe alternative named in the refusal; the turn stays available. Where K03 measures pre-tool veto as unsupported for a provider launch, that launch is refused for gated building explicitly and is never advertised as enforced. A thread closes only when structured records meet the done criterion and a named non-builder accepted. The delivery seam moves to T9.05.",
    files: [
      {
        path: "packages/throughline-target/src/completion.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
      {
        path: "packages/throughline-target/src/target-policy.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
    ],
    interfaces: {
      consumes: ["I-01 (as a policy-input supplier)", "T9.02 port"],
      provides: ["target_policy slot"],
    },
    signatures: [
      "targetPolicy(conversation_id, effect: {effect_kind, resolved_paths, cwd_resolved, step_id}) -> {gate: none | requires-failing-check, target_revision, check_recorded}",
      "isFinished(target_id) -> computed from structured records",
    ],
    done_when: {
      command:
        "On the installed tower build with a target whose scope is apps/web/**: (a) write plans/x.html -> admitted; (b) write apps/web/src/x.ts before any failing check -> that effect refused with a safe alternative, the next tool call runs; (c) the same write with exploration=true in the payload -> refused, field ignored and recorded; (d) record the failing check, repeat -> admitted; (e) a no-target thread writes a plan file and dispatches a seat -> admitted, nothing stalls; (f) from cwd /tmp a shell command that would write apps/web/src/y.ts -> runs only in the enforced read-only or test path, or is refused before it runs; (g) a no-target thread edits a file under the fork repository root -> refused per effect with the alternative named; plus K08 test 2 (a builder accepting its own check is refused)",
      expect: "each case as listed; no case passes by post-tool detection",
      judge: "non-builder seat",
    },
    depends_on: ["T9.02", "T3.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback:
      "Previous release; with no target_policy supplied the admission point treats the gate as none, which K08 permits only while no target is admitted, so rollback also reverts target admission (T9.02).",
    risk: [],
    window_estimate: "one window",
    device_cells: [],
    proof_limits: [
      "Before this slot is live, the foundation’s NoTargetRecordPolicyLive still refuses unverified product-root mutations and opaque effects without supported enforcement; no target is never blanket permission.",
    ],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-01 (as a policy-input supplier)", "T9.02 port"],
        provides: ["target_policy slot"],
      },
      window_estimate: "one window",
      proof_limits:
        "Before T9.03 is live the foundation's default slot (NoTargetRecordPolicyLive) answers gate none, which is today's behavior and not a new permission; product-root gating starts when this slot replaces it.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T9.03-red",
        kind: "first-act-red",
        command:
          "node /Users/Admin/throughline/packages/throughline-target/scripts/check-first.mts --host twr --out <evidence>",
        expected_today:
          "fails: an edit inside the target's scope is admitted before any failing check",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T10.01",
    fork_state: [
      {
        ref: "7a0a75f18f",
        disposition: "keep",
        reason:
          "Retain conversation-only rewind isolation from checkpoint work and late-completion retention checks; conversation rewind must not restore external files.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "47bb9b57f2",
        disposition: "keep",
        reason:
          "Retain same-session native Pi navigation with summarize:false and session/branch verification; expose it through the new admission/record mount without replacing external state.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "673f1f467c",
        disposition: "keep",
        reason:
          "Retain fork-namespace inspector-free rewind/source-population protections; extend capability pins for the new record path rather than discard existing native-provider safeguards.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/compiled-rewind-protection-20261009",
        disposition: "keep",
        reason:
          "Keep native navigation and compiled-consumer regression protections; main contains the composed 47bb/673f versions, so avoid importing older whole-file states.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/inspector-free-rewind-20261009",
        disposition: "keep",
        reason:
          "Keep isolated artifact/proof-population safeguards; main has the composed 673f version, so compare missing test deltas before any selective reuse.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/packaged-rewind-acceptance-20261009",
        disposition: "keep",
        reason:
          "Keep artifact-only packaged rewind and exact caller/source-population protections; no install/build is needed to preserve these tests.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/release-compatible-inspector-20261009",
        disposition: "keep",
        reason:
          "Keep release-custody-compatible rewind inspector declarations; main already contains the composed 673f/d966 successors.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/rewind-20261009",
        disposition: "keep",
        reason:
          "Native same-session Pi rewind patch is already equivalent on main (47bb9b57f2); preserve it, do not duplicate it.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-10",
    action: "amend",
    title:
      "Same-session rewind for Codex and Pi threads on every host, with Claude's rewind kept green",
    serves: ["NG-094", "NG-095", "NG-096", "NG-097"],
    what: "Rewind changes the active conversation branch only; external effects and audit history are untouched; a rewind accepted while the provider is in error shows pending, never lost (K06). Claude rewind already exists as a protected capability and stays green. The phone picker moves to T10.05.",
    files: [
      {
        path: "apps/server/src/provider/Layers/CodexAdapter.ts",
        side: "upstream-edit",
        action: "edit",
        exists_now: true,
      },
      {
        path: "apps/server/src/provider/Layers/PiProvider.ts",
        side: "fork-namespace",
        action: "edit",
        exists_now: true,
      },
      {
        path: "apps/server/src/provider/Layers/PiSessionRuntime.ts",
        side: "upstream-edit",
        action: "edit",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: ["I-02", "I-03"],
    },
    signatures: [
      "Declared cold acceptance interface: K06 test 2 on every provider: rewind to the first turn twice on Mac and tower homed threads, from the Mac app => files unchanged; same session; Claude protection still green",
    ],
    done_when: {
      command:
        "K06 test 2 on every provider: rewind to the first turn twice on Mac and tower homed threads, from the Mac app",
      expect: "files unchanged; same session; Claude protection still green",
      judge: "non-builder seat",
    },
    depends_on: ["T5.01", "T3.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    rollback:
      "Previous release; protected rewind manifest refuses a release that loses Claude rewind.",
    risk: [
      "Codex or Pi may lack a native same-session rewind; K03 then records it unsupported rather than faking it.",
    ],
    window_estimate: "one window",
    device_cells: ["rewind@mac", "rewind@twr"],
    proof_limits: ["Per provider version measured."],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-02", "I-03"],
      },
      window_estimate: "one window",
      proof_limits: "Per provider version measured.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T10.01-protect",
        kind: "retained-protection",
        command:
          "Ship-Pipeline steps rewind-regression and rewind-live-proof against /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/capabilities/rewind/Capability.json",
        expected_today: "exists (A22); last result not read",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T10.01-red",
        kind: "first-act-red",
        command:
          "the rewind-live-proof harness pointed at a Codex thread and a Pi thread on the installed tower",
        expected_today: "fails or is unsupported for Codex and Pi threads",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        signatures: [
          "Declared cold acceptance interface: K06 test 2 on every provider: rewind to the first turn twice on Mac, tower and Raspberry Pi homed threads, from the Mac app => files unchanged; same session; Claude protection still green",
        ],
        done_when: {
          command:
            "K06 test 2 on every provider: rewind to the first turn twice on Mac, tower and Raspberry Pi homed threads, from the Mac app",
          expect: "files unchanged; same session; Claude protection still green",
          judge: "non-builder seat",
        },
        device_cells: ["rewind@mac", "rewind@twr", "rewind@rpi"],
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T10.02",
    fork_state: [
      {
        ref: "1f49185a68",
        disposition: "rework",
        reason:
          "Keep conflict/unknown handling, but replace the Agent Instruments JSONL lineage reader with launcher-written record columns and admitted-event ancestry; do not promote JSONL to the new authority.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "952a996dba",
        disposition: "rework",
        reason:
          "Keep factual family/unknown UI, but change its source from agent-instruments.thread-lineage.v1 to launcher-written record ancestry and admitted waiting-state projections.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "1d4be1927a",
        disposition: "rework",
        reason:
          "Keep owning-environment query/mismatch checks; bind the query/result contract to the new record-backed family API, not the current launcher JSONL source.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "0016ddec02",
        disposition: "rework",
        reason:
          "Keep voice raw/undo, Android transcription and composer controls, but repair its family-query mount against a real record-backed RPC: main calls getLauncherThreadFamily without the branch-only server/contract declaration.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/copy-20261009",
        disposition: "rework",
        reason:
          "Keep copy/picker logic and branch-only owning-query tests at 65c74e, but rebind family authority to launcher record columns; much client code is already composed into main.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/hello-20261009",
        disposition: "rework",
        reason:
          "Keep optional-hello compatibility and trusted-sender transport; add record cursor/dedup and admitted identity context, replacing JSONL ancestry and the old long-lived rail.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/ident-20261009",
        disposition: "rework",
        reason:
          "Keep exact identity/model/security tests, but this branch combines SQLite aliases, projection stamping, engine settings receipts and JSONL lineage; replace those owners with the designed record/admission/launcher joins.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/settings-host-20261009",
        disposition: "rework",
        reason:
          "This broad composite carries useful client/voice/hello code but still records a fixed boolean through old engine activity receipts and JSONL lineage; migrate those owners to record/admission and keep already-folded client protections.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-10",
    action: "amend",
    title:
      "Ryan's threads apart from agent threads: families, lineage columns, visible handles, one view of what waits on Ryan",
    serves: ["NG-101", "NG-103", "NG-113", "NG-180", "NG-192"],
    what: "Two lineage columns on the thread row written by the launcher (I-04); a view of everything waiting on Ryan derived from admitted events (K14); fact-based visibility of stopped and silent threads. Also owns the phone cells for sending into a thread and for fixing a target from the phone. It also keeps the existing terminal security control after the terminal-drawer tool's withdrawal: every existing terminal action (open, write, resize) reaching the server is classified as a terminal-io effect through the admission module T3.01 already mounts in ws.ts, with the terminal's owning identity in the scope slot, so another account's terminal id is refused (K14 test 1). No upstream file is added: the classification lives in the fork namespace. Every thread, Ryan-created or agent-created, shows its handle and its finish line or target, and keeps its model, effort, window, thread and session identities visible (NG-113). The needs-you view records filed, alerted, rechecked and resolved events for each operator-act request, and closes an obsolete or agent-owned request with its installed-state evidence and reason (NG-192).",
    files: [
      {
        path: "apps/web/src/throughline/",
        side: "fork-namespace",
        action: "add",
        exists_now: true,
        assumption: "A04",
      },
      {
        path: "apps/server/src/throughline/terminal-scope/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
      {
        path: "apps/server/src/terminal/Manager.ts",
        side: "upstream-edit",
        action: "read",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: ["I-03", "I-04", "I-01"],
    },
    signatures: [
      "Declared cold acceptance interface: row tests CT for messaging and targets phone cells plus the needs-you script on the installed Mac app; K14 test 1's terminal case: a write to another account's terminal id is refused => lineage columns filled by the launcher; needs-you lists exactly the admitted waiting events",
    ],
    done_when: {
      command:
        "row tests CT for messaging and targets phone cells plus the needs-you script on the installed Mac app; K14 test 1's terminal case: a write to another account's terminal id is refused",
      expect:
        "lineage columns filled by the launcher; needs-you lists exactly the admitted waiting events",
      judge: "non-builder seat",
    },
    depends_on: ["T5.02", "T6.02", "T3.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous release; added columns are ignored by it.",
    risk: [],
    window_estimate: "one window",
    device_cells: ["targets@ios", "targets@android"],
    proof_limits: ["Android physical cells wait on D-CAP-05."],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-03", "I-04", "I-01"],
      },
      window_estimate: "one window",
      proof_limits: "Android physical cells wait on D-CAP-05.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T10.02-handles-and-asks",
        kind: "contract-test",
        command:
          "cold, on the installed app: open one Ryan-created and one agent-created thread; file an operator-act request, then make it obsolete",
        expect:
          "both threads show handle, finish line or target, and model/effort/window/thread/session identities; the request shows filed and alerted, then resolved with its evidence and reason",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T10.02-protect",
        kind: "retained-protection",
        command:
          "phone send-and-reply on the current release (pipeline capture-phone and gate-phone)",
        expected_today: "simulator gate passed with four screens unproven on device (A12)",
        measured: true,
        spec_projection: {
          kind: "real-disk",
          expected_today: "measured, see expected_today",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T10.02-red",
        kind: "first-act-red",
        command:
          "node /Users/Admin/throughline/apps/web/src/throughline/scripts/needs-you.mts --host mac --out <evidence>",
        expected_today: "fails: no needs-you view or lineage columns",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T10.02-terminal",
        kind: "first-act-red",
        command:
          "on the installed Mac app, send a terminal write naming another account's terminal id",
        expected_today: "not measured; the first act records whether the current build refuses it",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T10.03",
    slice: "slice-10",
    action: "amend",
    title: "Waits and thread watching move into the record and the app",
    serves: ["NG-111", "NG-115"],
    what: "A wake becomes a durable event wait on the request's own workflow keyed by request id and generation (K02); watching a thread becomes a subscription in the app; needs-you and lineage derive from admitted events (K14). Builds the replacement only; retiring the Agent Instruments driver moves to T10.06 so nothing is removed before its replacement is proven.",
    files: [
      {
        path: "apps/server/src/throughline/waits/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
    ],
    interfaces: {
      consumes: ["I-02", "I-03", "I-05"],
    },
    signatures: [
      "waitFor(request_id, generation) -> durable wait",
      "subscribe(thread_id, cursor) -> event stream",
    ],
    done_when: {
      command:
        "a waiting seat survives a server restart and wakes on the reply; a late reply to a closed generation is recorded and ignored",
      expect: "both observed on the installed tower",
      judge: "non-builder seat",
    },
    depends_on: ["T7.03", "T3.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous release; Agent Instruments remains in place until T10.06.",
    risk: [],
    window_estimate: "one window",
    device_cells: [],
    proof_limits: ["none"],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-02", "I-03", "I-05"],
      },
      window_estimate: "one window",
      proof_limits: "none",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T10.03-red",
        kind: "first-act-red",
        command:
          "node /Users/Admin/throughline/apps/server/src/throughline/waits/scripts/wait-survives-restart.mts --host twr --out <evidence>",
        expected_today: "fails: no durable wait exists in the app",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T10.04",
    fork_state: [
      {
        ref: "7f48b45618",
        disposition: "keep",
        reason:
          "Retain owning-environment identity copy and readable repeated-rewind choices; record mobile fork-added paths for incremental relocation, not a whole-branch rewrite.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "2ca67b35db",
        disposition: "keep",
        reason:
          "Retain owning-route copy mounting, raw newline/attached command behavior and observed-model controls; these are client protections, not record or admission ownership.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/compose-20261009",
        disposition: "rework",
        reason:
          "Retain client behavior already folded into 2ca6/7f48/0016; its settings intent is still a single boolean on the old store and needs the record-owned contract.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/copy-20261009",
        disposition: "rework",
        reason:
          "Keep copy/picker logic and branch-only owning-query tests at 65c74e, but rebind family authority to launcher record columns; much client code is already composed into main.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-10",
    action: "amend",
    title: "Copy thread id, session id and transcript path from the desktop and the phones",
    serves: ["NG-105"],
    what: "A copy menu on desktop and phone copies the ThroughLine thread id, the provider's session id and the exact transcript path, for Claude and Codex; the phone asks the thread's owning host. Split out of the former T10.04 bundle; the other parts are T10.07-T10.10, and the terminal-drawer tool from that bundle is withdrawn as a Ryan exploration.",
    files: [
      {
        path: "apps/web/src/throughline/thread-copy/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
      {
        path: "apps/mobile/src/",
        side: "upstream-edit",
        action: "edit",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: ["I-03", "T5.01 identity resolver"],
    },
    signatures: [
      "Declared cold acceptance interface: row tests for copy-ids on mac, ios and android => each copied value resolves to the real thread, session and transcript",
    ],
    done_when: {
      command: "row tests for copy-ids on mac, ios and android",
      expect: "each copied value resolves to the real thread, session and transcript",
      judge: "non-builder seat",
    },
    depends_on: ["T10.02", "T5.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous release.",
    risk: [],
    window_estimate: "small",
    device_cells: ["copy-ids@mac", "copy-ids@ios", "copy-ids@android"],
    proof_limits: ["Android physical cell waits on D-CAP-05."],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-03", "T5.01 identity resolver"],
      },
      window_estimate: "small",
      proof_limits: "Android physical cell waits on D-CAP-05.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T10.04-red",
        kind: "first-act-red",
        command: "row test CT copy-ids on the installed Mac app",
        expected_today:
          "not measured; the first act records whether the current build already has the menu",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T11.01",
    enforcement_evidence: [
      {
        id: "B04",
        score: 9,
        finding:
          "Claude turn.step has per-turn-request control but auxiliary plugin calls have separate events; Codex approvals do not gate model requests; Pi before_provider_request transforms and swallows failure.",
        correction:
          "Separate turn admission from per-model-request admission. Bind existing access-broker transport to the SAME I-01 admission service before forwarding Codex/Pi requests, or use a mandatory fail-closed wrapped provider/stream. Claude binds auxiliary model operations too. No second execution authority; until measured, declare these per-model cells unsupported/observe-only.",
        status:
          "open: scored 9; with the Fable design thread 44973766-bbeb-4c80-b506-a4b171273e33, whose decision lands at execution/phase-02/closeout-2026-10-09/Fable-Delta-Enforcement.json and is applied verbatim before 0.4.0 is final",
        source: "G6-Enforcement.json section B",
      },
      {
        id: "B05",
        score: 8,
        finding:
          "Heartbeat/workflow step/resume do not veto a tool. Pi RPC is full-access only with no approval API; native tool_call block exists but admission extension is not wired.",
        correction:
          "Explicitly install admission extension in every Pi AgentSession loop; cover registered custom/MCP/dispatch tools and classify extension-owned process/file paths separately. Wire required compaction control; preserve native file/id on retry. No advertised read-only Pi mode without measured external sandbox.",
        status: "folded in 0.4.0",
        source: "G6-Enforcement.json section B",
      },
      {
        id: "B06",
        score: 6,
        finding:
          "Cancellation best effort on all; SubagentStart does not veto spawn. Current Claude/Codex support pre-compact veto; Pi adapter lacks native compaction controls.",
        correction:
          "Veto Agent/spawn_agent/dispatch before spawn and require child binding. Record stop-requested until settlement and preserve unknown effects; never count post-tool/interrupt as prevented. Measure current compaction controls rather than inheriting old limits.",
        status: "folded in 0.4.0",
        source: "G6-Enforcement.json section B",
      },
      {
        id: "B08",
        score: 4,
        finding:
          "This read-only task establishes source/tooling capability and custody metadata, not live disconnected-record/refused-operation trials.",
        correction:
          "Fold as design evidence, not K03 acceptance. Keep counts null and A05 evidence-needed until pinned provider/host/profile trials cover failures, bypasses, child binding and actual side-effect witnesses.",
        status: "folded in 0.4.0",
        source: "G6-Enforcement.json section B",
      },
    ],
    slice: "slice-11",
    action: "amend",
    title:
      "Pi bound to the record: one short request workflow per turn under the conversation identity, one step per finished turn, and a stable per-conversation cache key",
    serves: ["NG-032", "NG-037", "NG-132", "NG-133", "NG-033", "NG-035", "NG-036"],
    what: "Kept from the lab (A18): the Pi loop runs inside the Absurd worker with a lease heartbeat; each finished turn is one step; a retry rebuilds Pi from recorded turns. Changed by K02: there is no long-lived task per conversation; each request is its own short workflow under the conversation identity, and replay reads the conversation's recorded turns plus the request's own steps. ThroughLine keeps spawning Pi in RPC mode through the governed ryan-pi door (A16). Pi already forwards its own session id on every model call of a session (A54); ThroughLine cannot choose that id, so the stable cache key is the Pi session id bound one-to-one to the conversation, recorded as a native alias under the conversation identity (T5.01), and every request workflow resumes that same Pi session (switch_session or the recorded session file) instead of opening a new one. Never a request id, a workflow id or a generation. NG-033: Claude reaching Pi through the Meridian route to the Agent SDK stays, checked as a retained protection. Binding (G6 B05): Pi in RPC mode has full tool access and no approval API, and heartbeats, workflow steps and resume do not veto a tool, so ThroughLine installs its admission extension in every Pi AgentSession loop on the native tool_call block, covering registered custom, MCP and dispatch tools, and classifies extension-owned process and file paths separately; no read-only Pi mode is advertised without a measured external sandbox; a retry keeps the native session file and id. The Pi adapter has no native compaction control today; Pi compaction stays off through pi.compaction.enabled = false, owned by T10.10. Levels 6 and 7 of JEV (NG-087, NG-089) for Pi run on the inputs and results the admission extension intercepts and on each finished turn, through the same K07 port, as recorded steps. Pi's before_provider_request is observe-and-annotate; the durable Pi loop attaches the admission token to every provider request; a swallowed extension failure changes nothing, because the broker refuses an untokened request. The durable Pi loop checkpoints per managed action (a step per model request and per tool start), not per finished turn. Non-builder, installed Mac and tower: from a real pi seat add a candidate using source-bound Ryan words, read its exact words/revision/checks, fix it against the expected revision, read the new revision, retract it with reason and read the retraction event. Verify one admitted change/event per operation and the authenticated caller/generation. A stale revision or direct record write refuses. Calls delegate to the common target interface; no provider owns target state. The launcher binds this adapter on every initial and replacement launch.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/_meta/tower-pi-absurd-lab-2026-10-02/lab/src/durable-pi.ts",
        side: "outside-tool",
        action: "read",
        exists_now: true,
      },
      {
        path: "apps/server/src/provider/Layers/PiProvider.ts",
        side: "fork-namespace",
        action: "edit",
        exists_now: true,
      },
      {
        path: "apps/server/src/provider/Layers/PiSessionRuntime.ts",
        side: "upstream-edit",
        action: "edit",
        exists_now: true,
      },
      {
        path: "packages/throughline-target/src/pi-tools.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
        note: "thin provider adapter; central target owner retains all policy and storage",
      },
    ],
    interfaces: {
      consumes: ["I-01", "I-02"],
      provides: ["Pi row of the K03 matrix"],
    },
    signatures: [
      "runPiTurn(conversation_id, request_id, generation) -> step per finished turn",
      "piSessionOptions(conversation_id) -> recorded native Pi session alias/session file, resumed across request workflows; never invent a native id or use request/generation as cache key",
      "piAdmissionExtension(session) -> blocks the native tool_call when I-01 refuses, for built-in, custom, MCP and dispatch tools; loaded in every AgentSession loop the adapter starts",
    ],
    done_when: {
      command:
        "D-CAP-02 test and the Pi K03 script on Mac and tower; Non-builder, installed Mac and tower: from a real pi seat add a candidate using source-bound Ryan words, read its exact words/revision/checks, fix it against the expected revision, read the new revision, retract it with reason and read the retraction event. Verify one admitted change/event per operation and the authenticated caller/generation. A stale revision or direct record write refuses.",
      expect:
        "stable key on every call including after a worker kill; no workflow outlives its request; K03 cells measured; a Pi request with a stale generation token is refused at the broker and the seat's wait row resumes on the refusal event; a Pi tool start and a Pi model request each carry a step id minted before execution Add/read/fix/retract consumption passes through the central owner; no direct target writes or per-provider store; no fixture-only provider claim.",
      judge: "non-builder seat",
    },
    depends_on: ["T3.02", "T8.01", "T3.01", "T9.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous release.",
    risk: [
      "If RPC mode cannot carry a caller-chosen sessionId, the key comes from a per-conversation --session-dir and resumed session file; record which.",
    ],
    window_estimate: "one window",
    device_cells: ["exec-pi@mac", "exec-pi@twr"],
    proof_limits: [
      "The Mac sandbox's 73 and 93 percent cached shares (A15) are evidence of the mechanism, not of ThroughLine.",
    ],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-01", "I-02"],
        provides: ["Pi row of the K03 matrix"],
      },
      window_estimate: "one window",
      proof_limits:
        "The Mac sandbox's 73 and 93 percent cached shares (A15) are evidence of the mechanism, not of ThroughLine.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T11.01-discover",
        kind: "first-act-red",
        command:
          "On each host: read the Pi version the governed ryan-pi door runs; then on the installed tower, one Pi thread, two requests and one worker kill; read each provider request's prompt_cache_key and cached input tokens from the broker's request record",
        expected_today:
          "Pass when both requests and the resumed attempt carry one key and the second reports cached input above zero. Fail when the key changes per request (ThroughLine opens a new Pi session per request: fix by binding the session to the conversation) or is absent on the wire (that Pi version's provider adapter does not map it: pin a version that does through ryan pi, NG-133).",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T11.01-k03",
        kind: "contract-test",
        command:
          "node /Users/Admin/throughline/apps/server/scripts/k03-matrix.mts --provider pi --host <mac|twr|rpi> --out <evidence>",
        expect: "measured counts for every Pi cell",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    target_tools: {
      provider: "pi",
      owner: "T11.01",
      file: "packages/throughline-target/src/pi-tools.ts",
      interface_owner: "T9.01",
      interface_module: "packages/throughline-target/src/provider-tools.ts",
      launch_owner: "T6.02",
      launch_file: "packages/throughline-launcher/src/target-binding.ts",
      operations: ["read", "add", "fix", "retract"],
      cold_test:
        "Non-builder, installed Mac and tower: from a real pi seat add a candidate using source-bound Ryan words, read its exact words/revision/checks, fix it against the expected revision, read the new revision, retract it with reason and read the retraction event. Verify one admitted change/event per operation and the authenticated caller/generation. A stale revision or direct record write refuses.",
      no_provider_store: true,
    },

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        done_when: {
          command:
            "D-CAP-02 test and the Pi K03 script on Mac, tower and Raspberry Pi; Non-builder, installed Mac and tower: from a real pi seat add a candidate using source-bound Ryan words, read its exact words/revision/checks, fix it against the expected revision, read the new revision, retract it with reason and read the retraction event. Verify one admitted change/event per operation and the authenticated caller/generation. A stale revision or direct record write refuses.",
          expect:
            "stable key on every call including after a worker kill; no workflow outlives its request; K03 cells measured; a Pi request with a stale generation token is refused at the broker and the seat's wait row resumes on the refusal event; a Pi tool start and a Pi model request each carry a step id minted before execution Add/read/fix/retract consumption passes through the central owner; no direct target writes or per-provider store; no fixture-only provider claim.",
          judge: "non-builder seat",
        },
        device_cells: ["exec-pi@mac", "exec-pi@twr", "exec-pi@rpi"],
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T11.02",
    enforcement_evidence: [
      {
        id: "B01",
        score: 8,
        finding:
          "True of approvals, incomplete for installed native hooks. Hooks stable/enabled on Mac 0.161.0 and tower 0.159.3 support scoped local-tool veto even under never.",
        correction:
          "Keep escalation approvals; add distinct native PreToolUse binding, mandatory loading/trust and a scoped coverage matrix. Do not change delivery-worker policy just to create approvals.",
        status: "folded in 0.4.0",
        source: "G6-Enforcement.json section B",
      },
      {
        id: "B02",
        score: 9,
        finding:
          "write_stdin sends fresh input without another PreToolUse. Hosted/specialized paths can opt out. A full-access persistent shell cannot be called universally gated by a tool hook.",
        correction:
          "Give terminal-input/write_stdin and hosted/specialized calls separate unsupported pre-veto cells. Refuse protected-building effects while check-first is pending unless a proven OS read-only/design-test-writable mode contains them, or route through the same admission service with a typed controlled executor. Never infer safety from cwd or original approval.",
        status:
          "open: scored 9; with the Fable design thread 44973766-bbeb-4c80-b506-a4b171273e33, whose decision lands at execution/phase-02/closeout-2026-10-09/Fable-Delta-Enforcement.json and is applied verbatim before 0.4.0 is final",
        source: "G6-Enforcement.json section B",
      },
      {
        id: "B04",
        score: 9,
        finding:
          "Claude turn.step has per-turn-request control but auxiliary plugin calls have separate events; Codex approvals do not gate model requests; Pi before_provider_request transforms and swallows failure.",
        correction:
          "Separate turn admission from per-model-request admission. Bind existing access-broker transport to the SAME I-01 admission service before forwarding Codex/Pi requests, or use a mandatory fail-closed wrapped provider/stream. Claude binds auxiliary model operations too. No second execution authority; until measured, declare these per-model cells unsupported/observe-only.",
        status:
          "open: scored 9; with the Fable design thread 44973766-bbeb-4c80-b506-a4b171273e33, whose decision lands at execution/phase-02/closeout-2026-10-09/Fable-Delta-Enforcement.json and is applied verbatim before 0.4.0 is final",
        source: "G6-Enforcement.json section B",
      },
      {
        id: "B06",
        score: 6,
        finding:
          "Cancellation best effort on all; SubagentStart does not veto spawn. Current Claude/Codex support pre-compact veto; Pi adapter lacks native compaction controls.",
        correction:
          "Veto Agent/spawn_agent/dispatch before spawn and require child binding. Record stop-requested until settlement and preserve unknown effects; never count post-tool/interrupt as prevented. Measure current compaction controls rather than inheriting old limits.",
        status: "folded in 0.4.0",
        source: "G6-Enforcement.json section B",
      },
      {
        id: "B08",
        score: 4,
        finding:
          "This read-only task establishes source/tooling capability and custody metadata, not live disconnected-record/refused-operation trials.",
        correction:
          "Fold as design evidence, not K03 acceptance. Keep counts null and A05 evidence-needed until pinned provider/host/profile trials cover failures, bypasses, child binding and actual side-effect witnesses.",
        status: "folded in 0.4.0",
        source: "G6-Enforcement.json section B",
      },
    ],
    slice: "slice-11",
    action: "amend",
    title:
      "Codex binds through its approval requests; the cost of one round trip per tool call is measured",
    serves: ["NG-031", "NG-038", "NG-035", "NG-036"],
    what: "The adapter already maps each approval request to a typed kind (A19). Each becomes an I-01 admission request whose effect_kind comes from that typed kind; a refused decision declines the approval; an unreachable admission point declines (fail-closed). Under a launch policy that never asks for approval, approvals give no pre-tool veto (A20), but Codex native hooks do: hooks are stable and enabled on the Mac (Codex 0.161.0) and the tower (0.159.3) and support a scoped local-tool PreToolUse veto even under never (G6 B01). The binding therefore has two parts: approval requests for escalations, and a native PreToolUse hook bound to the same I-01 admission point, with mandatory loading and trust and a scoped coverage matrix in the K03 row. The Codex launch policy is not changed just to create approvals. The round-trip cost is measured, not assumed. There is one Codex provider; this task changes no seat's launch policy, and T10.10 removes the duplicate Codex provider entry (ryan-codex-worker) from ThroughLine's settings. Levels 6 and 7 of JEV (NG-087, NG-089) for Codex run on the inputs and results the native hooks and approval requests intercept and on each turn end, through the same K07 port, as recorded steps. Codex binds shell start through its native PreToolUse hook under the never approval policy (B01), counted; write_stdin and hosted or specialized tool paths are the live-input cell, observe-only, with their effects recorded from the host's changed-path record; the capability matrix row for Codex names both cells with their measured counts. Codex approvals never gate model requests; the Codex route carries the admission token the launcher passed, and the broker is the per-model gate. The Codex native PreToolUse hook attaches the step id to each tool start; a start with no step id is denied by the hook. Non-builder, installed Mac and tower: from a real codex seat add a candidate using source-bound Ryan words, read its exact words/revision/checks, fix it against the expected revision, read the new revision, retract it with reason and read the retraction event. Verify one admitted change/event per operation and the authenticated caller/generation. A stale revision or direct record write refuses. Calls delegate to the common target interface; no provider owns target state. The launcher binds this adapter on every initial and replacement launch. Evidence instead of raw output (D25, level 6) for Codex: the native hook that observes a tool result sends it to the record and requests evidence as T8.01 does; whether a Codex native hook can replace the result before the model reads it is measured in the K03 row (the Oct 10 audit shows Codex seats re-reading 40,000-character truncated results on every later step); where it cannot, the row says observe-only and the adapter's only lever is the route slot and wake coalescing.",
    files: [
      {
        path: "apps/server/src/provider/Layers/CodexAdapter.ts",
        side: "upstream-edit",
        action: "edit",
        exists_now: true,
      },
      {
        path: "packages/throughline-target/src/codex-tools.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
        note: "thin provider adapter; central target owner retains all policy and storage",
      },
    ],
    interfaces: {
      consumes: ["I-01", "I-02"],
      provides: ["Codex row of the K03 matrix"],
    },
    signatures: [
      "onApprovalRequest(kind, payload) -> admission request -> accept | decline",
      "onCodexPreToolUse(event) -> admission request (I-01) -> allow | block; hook loaded and trusted on every host; coverage recorded per tool class in the K03 row",
    ],
    done_when: {
      command:
        "the Codex K03 script on Mac and tower with the round-trip cost recorded; Non-builder, installed Mac and tower: from a real codex seat add a candidate using source-bound Ryan words, read its exact words/revision/checks, fix it against the expected revision, read the new revision, retract it with reason and read the retraction event. Verify one admitted change/event per operation and the authenticated caller/generation. A stale revision or direct record write refuses.",
      expect:
        "measured counts; refused approvals did not execute; measured counts for Codex: shell-start vetoes fire before execution under never; a write_stdin protected-path edit is recorded as an observed effect and refuses the thread's done computation; a Codex model request without a token is refused at the broker, counted Add/read/fix/retract consumption passes through the central owner; no direct target writes or per-provider store; no fixture-only provider claim.",
      judge: "non-builder seat",
    },
    depends_on: ["T3.01", "T3.02", "T9.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous release.",
    risk: [],
    window_estimate: "one window",
    device_cells: ["exec-codex@mac", "exec-codex@twr"],
    proof_limits: ["Per Codex version pinned."],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-01", "I-02"],
        provides: ["Codex row of the K03 matrix"],
      },
      window_estimate: "one window",
      proof_limits: "Per Codex version pinned.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T11.02-red",
        kind: "first-act-red",
        command:
          "node /Users/Admin/throughline/apps/server/scripts/k03-matrix.mts --provider codex --host twr --out <evidence>",
        expected_today: "fails: approvals are not routed to admission",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    target_tools: {
      provider: "codex",
      owner: "T11.02",
      file: "packages/throughline-target/src/codex-tools.ts",
      interface_owner: "T9.01",
      interface_module: "packages/throughline-target/src/provider-tools.ts",
      launch_owner: "T6.02",
      launch_file: "packages/throughline-launcher/src/target-binding.ts",
      operations: ["read", "add", "fix", "retract"],
      cold_test:
        "Non-builder, installed Mac and tower: from a real codex seat add a candidate using source-bound Ryan words, read its exact words/revision/checks, fix it against the expected revision, read the new revision, retract it with reason and read the retraction event. Verify one admitted change/event per operation and the authenticated caller/generation. A stale revision or direct record write refuses.",
      no_provider_store: true,
    },

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        done_when: {
          command:
            "the Codex K03 script on Mac, tower and Raspberry Pi with the round-trip cost recorded; Non-builder, installed Mac and tower: from a real codex seat add a candidate using source-bound Ryan words, read its exact words/revision/checks, fix it against the expected revision, read the new revision, retract it with reason and read the retraction event. Verify one admitted change/event per operation and the authenticated caller/generation. A stale revision or direct record write refuses.",
          expect:
            "measured counts; refused approvals did not execute; measured counts for Codex: shell-start vetoes fire before execution under never; a write_stdin protected-path edit is recorded as an observed effect and refuses the thread's done computation; a Codex model request without a token is refused at the broker, counted Add/read/fix/retract consumption passes through the central owner; no direct target writes or per-provider store; no fixture-only provider claim.",
          judge: "non-builder seat",
        },
        device_cells: ["exec-codex@mac", "exec-codex@twr", "exec-codex@rpi"],
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T11.03",
    fork_state: [
      {
        ref: "1af05fd66e",
        disposition: "keep",
        reason:
          "Retain curated model/default and exact answering-model comparisons; the namespace admission must record these existing contract edits rather than recreate them.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "674f5baf97",
        disposition: "keep",
        reason:
          "Retain attributable main-turn observation schema/activity mapping and honest unknowns for unsupported providers; existing event vocabulary can be carried by RecordBackedEventStore.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "2ca67b35db",
        disposition: "keep",
        reason:
          "Retain owning-route copy mounting, raw newline/attached command behavior and observed-model controls; these are client protections, not record or admission ownership.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "c195963030",
        disposition: "rework",
        reason:
          "Keep captured requested-model comparison, but remove provider-local optional-SqlClient alias writes after updateResumeCursor and bind aliases in the same authoritative transaction as command admission.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "b5bd5ca044",
        disposition: "keep",
        reason:
          "Retain Claude main-response model observations tied to the captured turn request, without certifying requested models as answers.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "31f3337485",
        disposition: "keep",
        reason:
          "Retain current-policy/retired-wire-id regression fixtures; these are compatibility tests, not another Codex provider implementation.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "ebedf4722d",
        disposition: "rework",
        reason:
          "This merge carries useful sender/model/recovery code but includes the SQLite/engine sender implementation; preserve ancestry, rework the sender portion at record/admission and keep model/install protections.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/build-identity-20261009",
        disposition: "keep",
        reason:
          "Retain model observation and release-identity helpers already composed into main; archive the old branch after preservation, do not merge it over the newer main source.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/build-identity-exports-20261009",
        disposition: "keep",
        reason:
          "Retain package exports and identity/model helpers already represented by main 7453/643e/674f; no separate implementation should be reapplied.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/compose-20261009",
        disposition: "rework",
        reason:
          "Retain client behavior already folded into 2ca6/7f48/0016; its settings intent is still a single boolean on the old store and needs the record-owned contract.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/ident-20261009",
        disposition: "rework",
        reason:
          "Keep exact identity/model/security tests, but this branch combines SQLite aliases, projection stamping, engine settings receipts and JSONL lineage; replace those owners with the designed record/admission/launcher joins.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/model-20261009",
        disposition: "keep",
        reason:
          "Keep exact curated offering and attributable observation work already composed into main; no new provider driver is introduced by this branch.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/model-consumer-repair-20261009",
        disposition: "keep",
        reason:
          "Patch-equivalent to main 31f3337485: preserve retired wire-id/default tests without reapplying stale source.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-11",
    action: "amend",
    title:
      "The model picker shows the model that answers; every model call through the access broker; Pi's list is the union of the curated lists",
    serves: ["NG-039", "NG-040", "NG-041", "NG-034", "NG-029"],
    what: "Model names move only through ryan model roll; the compiled defaults match ryan model list at every release; the recorded model on each turn equals the picker's selection or the picker shows the substitution. Every model call goes through the access broker. The Pi provider's offering is computed at runtime from the union of the curated Claude and Codex lists (delta IA-04). Headroom and the Limits panel move to T11.04. Image generation (NG-190) is exposed, not only routed: the implementer reads the actual flags and doors of the governed Codex launcher and the broker, enables the image tool in both, and a ThroughLine-launched seat generates and edits one image through the broker with no key in the seat. The access broker's providers unit verifies the admission token against I-01 before forwarding any model request and records refusals by request id; this is an amendment to the broker component (external capability) consumed here, and its consumption test is the per-model counterexample in K03.",
    delta_carried: ["IA-04 append on T11.03"],
    files: [
      {
        path: "packages/contracts/src/modelOffering.ts",
        side: "fork-namespace",
        action: "edit",
        exists_now: true,
      },
      {
        path: "packages/contracts/src/model.ts",
        side: "upstream-edit",
        action: "edit",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: ["I-01", "I-04"],
    },
    signatures: [
      "Declared cold acceptance interface: the comparison plus one turn per provider whose recorded model matches the picker => no mismatch; Pi list equals the union",
    ],
    done_when: {
      command: "the comparison plus one turn per provider whose recorded model matches the picker",
      expect:
        "no mismatch; Pi list equals the union; the per-model counterexample and the route-exclusivity test in K03 pass on the tower and on the Mac, fired by a seat that did not build the route",
      judge: "non-builder seat",
    },
    depends_on: ["T6.02", "T3.01"],
    depends_on_note: "Replaces T4.01 per D-CAP-06.",
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous release.",
    risk: [],
    window_estimate: "small",
    device_cells: [],
    proof_limits: ["none"],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-01", "I-04"],
      },
      delta_carried: ["IA-04 append on T11.03"],
      window_estimate: "small",
      proof_limits: "none",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T11.03-image-exposure",
        kind: "contract-test",
        command:
          "from a seat launched by ThroughLine through the governed Codex launcher, generate one image and edit it",
        expect:
          "both succeed through the broker; the seat holds no key; the tool is listed in the seat's launch configuration",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T11.03-red",
        kind: "first-act-red",
        command:
          "compare the compiled defaults with ryan model list --json and one recorded turn's model with the picker",
        expected_today: "not measured",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T12.01",
    fork_state: [
      {
        ref: "87b09c712f",
        disposition: "keep",
        reason:
          "Retain non-writing installer preflight and deferred directory creation; repository-relative installer behavior survives the move.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "0aa89dc714",
        disposition: "keep",
        reason:
          "Retain headless-server recovery during desktop handover and existing user-unit semantics; preserve the installer while new-host proof is pending.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "ebedf4722d",
        disposition: "rework",
        reason:
          "This merge carries useful sender/model/recovery code but includes the SQLite/engine sender implementation; preserve ancestry, rework the sender portion at record/admission and keep model/install protections.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/installer-integration-review-20261009",
        disposition: "keep",
        reason:
          "Patch-equivalent to main's non-writing installer preflight; keep the main version and preserve this review branch only as evidence/history.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/recover-20261009",
        disposition: "keep",
        reason:
          "Keep installer/headless handover and issued-lifetime renewal protections; main has composed successors, so retain the useful delta without replacing newer owner-safe renewal.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/renew-idle-20261009",
        disposition: "keep",
        reason:
          "Keep owner-safe bounded idle renewal and installer handover; main 2114/87b0/0aa8 is the composed source, not a reason to remerge the older branch wholesale.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-12",
    action: "amend",
    title: "Every ThroughLine service comes back after a reboot on every host",
    serves: ["NG-128", "NG-072", "NG-142"],
    what: "Units with run-at-load and keep-alive on the Mac and the tower; on the Raspberry Pi only the watcher/responder and its explicitly scoped broker/recovery-island units, proven by a bootout-and-bootstrap receipt per unit, fired by a seat that did not configure the unit. The watcher layer moves to T12.04 and the recovery route to T12.05. Under S6 each unit also has a Tier 1 home, ships through Ship Warden or an equivalent lane, and is git-backed. On the tower, the reboot-survival proof for every unit is bootout-and-bootstrap only; a real reboot is never a test step. The tower boots to an encrypted-disk password prompt that only Ryan at the KVM can answer, so any planned reboot waits for Ryan's explicit yes in the current conversation, is announced to the Raspberry Pi watcher as a reboot marker before it starts, and a tower that does not return is reported as waiting for Ryan's unlock, never as broken.",
    files: [
      {
        path: "apps/desktop/linux/install-linux.sh",
        side: "fork-namespace",
        action: "edit",
        exists_now: true,
      },
      {
        path: "apps/desktop/mac/install-mac.sh",
        side: "fork-namespace",
        action: "edit",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: ["T6.01 supervisor"],
    },
    signatures: [
      "Declared cold acceptance interface: one unit bootout-and-bootstrap receipt per unit per host, in a safe window, never a casual kill of a shared database => every unit back without a human",
    ],
    done_when: {
      command:
        "one unit bootout-and-bootstrap receipt per unit per host, in a safe window, never a casual kill of a shared database",
      expect:
        "every unit back without a human the tower receipts show bootout-and-bootstrap commands only; no receipt shows a reboot command on the tower",
      judge: "non-builder seat",
    },
    depends_on: ["T6.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-03-ryan-durability-is-a-running-watched-layer-not-answers-in-a-readme.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous unit files restored by the previous release's installer.",
    risk: [
      "Tower sudo installs are Ryan's act for now (SHAPE-2026-10-04-ryan-performs-tower-sudo-installs-for-now); prepare and test everything without privilege first.",
    ],
    window_estimate: "one window",
    device_cells: [],
    proof_limits: ["none"],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["T6.01 supervisor"],
      },
      window_estimate: "one window",
      proof_limits: "none",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T12.01-red",
        kind: "first-act-red",
        command:
          "list each ThroughLine unit per host with its run-at-load and keep-alive settings, read from the installed units",
        expected_today: "not measured",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        what: "Units with run-at-load and keep-alive on the Mac, the tower and the headless Raspberry Pi server, proven by a bootout-and-bootstrap or a real reboot receipt per unit, fired by a seat that did not configure the unit. The watcher layer moves to T12.04 and the recovery route to T12.05. Under S6 each unit also has a Tier 1 home, ships through Ship Warden or an equivalent lane, and is git-backed. On the tower, the reboot-survival proof for every unit is bootout-and-bootstrap only; a real reboot is never a test step. The tower boots to an encrypted-disk password prompt that only Ryan at the KVM can answer, so any planned reboot waits for Ryan's explicit yes in the current conversation, is announced to the Raspberry Pi watcher as a reboot marker before it starts, and a tower that does not return is reported as waiting for Ryan's unlock, never as broken.",
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },

    unit_proof_rule: {
      operator_words:
        "Any proof that something survives a reboot uses a launchd or systemd unit bootout-and-bootstrap, never a machine reboot.",
      source:
        "User instruction in this writer thread beginning Hard rule from Ryan, for every Phase 3 seat, effective now",
      runtime_action_by_writer: false,
    },
  },
  {
    id: "T12.02",
    fork_state: [
      {
        ref: "2114b0f4f1",
        disposition: "keep",
        reason:
          "Retain per-session issued-lifetime renewal, bounded retries and owner-safe idle recovery; first pairing and broker-custody/device proof are not established by these source changes.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/recover-20261009",
        disposition: "keep",
        reason:
          "Keep installer/headless handover and issued-lifetime renewal protections; main has composed successors, so retain the useful delta without replacing newer owner-safe renewal.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/renew-idle-20261009",
        disposition: "keep",
        reason:
          "Keep owner-safe bounded idle renewal and installer handover; main 2114/87b0/0aa8 is the composed source, not a reason to remerge the older branch wholesale.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-12",
    action: "amend",
    title: "Logins renew before they expire, and agents pair and re-pair every device",
    serves: ["NG-129"],
    what: "The login each Linux server gives the Mac app renews before the expiresAt recorded on the issued session (read each admitted grant/session’s current expiry contract; never a frozen lifetime). Delta IA-03 with the review's corrections: per device, the access broker holds the pairing credential (I-06); the adapter (Mac) or launcher (tower) performs first pairing, renewal and permission recovery after an app replacement; the pairing link form is used, never a code handed to Ryan. Phones are paired by an agent: the iPhone through iPhone Mirroring (A13), using current capabilities and reserving a physical act only with cited governing authority and its alternative; Android once an agent route to the phone exists (D-CAP-05). A denied OS permission is reported as denied. The no-Tailscale route moves to T12.06.",
    delta_carried: ["IA-03 append on T12.02"],
    files: [
      {
        path: "apps/server/src/auth/",
        side: "upstream-edit",
        action: "edit",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: ["I-06", "I-04"],
    },
    signatures: [
      "renewBefore(session.expiresAt)",
      "pairDevice(device) -> pairing link from broker custody",
    ],
    done_when: {
      command:
        "the delta IA-03 failure test with the review's corrections, and row tests pairing on mac, ios, android",
      expect:
        "no token typed by Ryan; phone loads its threads and completes one exchange; denied permission shown as denied; disallowed scope refused",
      judge: "non-builder seat",
    },
    depends_on: ["T12.01", "T6.03"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-06-ryan-agents-handle-throughline-pairing-and-permissions-themselves.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous release; an existing paired session keeps working until its expiresAt.",
    risk: [],
    window_estimate: "one window",
    device_cells: ["pairing@mac", "pairing@ios", "pairing@android"],
    proof_limits: ["Android physical cell waits on D-CAP-05."],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-06", "I-04"],
      },
      delta_carried: ["IA-03 append on T12.02"],
      window_estimate: "one window",
      proof_limits: "Android physical cell waits on D-CAP-05.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T12.02-red",
        kind: "first-act-red",
        command:
          "force-expire the Mac app's tower login on a test session and observe whether it re-pairs",
        expected_today: "fails: no renewal (the Sep 28, 2026 expiry recorded in the pairing rule)",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        what: "The login each Linux server gives the Mac app renews before the expiresAt recorded on the issued session (read each admitted grant/session’s current expiry contract; never a frozen lifetime). Delta IA-03 with the review's corrections: per device, the access broker holds the pairing credential (I-06); the adapter (Mac) or launcher (tower, Raspberry Pi) performs first pairing, renewal and permission recovery after an app replacement; the pairing link form is used, never a code handed to Ryan. Phones are paired by an agent: the iPhone through iPhone Mirroring (A13), using current capabilities and reserving a physical act only with cited governing authority and its alternative; Android once an agent route to the phone exists (D-CAP-05). A denied OS permission is reported as denied. The no-Tailscale route moves to T12.06.",
        done_when: {
          command:
            "the delta IA-03 failure test with the review's corrections, and row tests pairing on mac, rpi, ios, android",
          expect:
            "no token typed by Ryan; phone loads its threads and completes one exchange; denied permission shown as denied; disallowed scope refused",
          judge: "non-builder seat",
        },
        device_cells: ["pairing@mac", "pairing@rpi", "pairing@ios", "pairing@android"],
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T12.03",
    slice: "slice-12",
    action: "amend",
    title:
      "Every outside tool folded in, kept outside with a reason, or retired, and a check that reads the table",
    serves: ["NG-131"],
    what: "Session import, the ship tool, the upstream counter, the habitat job, the operator stylesheet and themes, the Stop hooks: one table with the disposition and reason for each, plus a pipeline preflight check that reads it and refuses a release when a retired tool's job or hook is still installed or a folded tool's capability is missing. A table nothing reads is not a deliverable.",
    files: [
      {
        path: "docs/throughline/next-gen-spec/Outside-Tools.json",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Pipeline.json",
        side: "config",
        action: "edit",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: ["I-07"],
    },
    signatures: [
      "Declared cold acceptance interface: the preflight check on a release candidate => passes only when every listed tool's real state matches its disposition",
    ],
    done_when: {
      command: "the preflight check on a release candidate",
      expect: "passes only when every listed tool's real state matches its disposition",
      judge: "non-builder seat",
    },
    depends_on: ["T8.02", "T10.03", "T10.06"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    rollback: "Remove the preflight step.",
    risk: [],
    window_estimate: "small",
    device_cells: [],
    proof_limits: ["none"],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-07"],
      },
      window_estimate: "small",
      proof_limits: "none",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T12.03-red",
        kind: "first-act-red",
        command: "the new preflight check against the current hosts",
        expected_today: "fails: no table",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T13.01",
    slice: "slice-13",
    action: "amend",
    title: "The Android release step with its six evidence levels",
    serves: ["NG-119", "NG-118"],
    what: "Android joins the pipeline through the route Ryan set on Oct 3, 2026 (A53): the tower builds a release AAB, the tower Access-Broker signs it and uploads it to the Westcoast Certified Play Console internal-testing track, and no agent reads either key. The existing broker-publish and tower-build work items TQ-654/TQ-655 are external prerequisites whose current owning-provider state and accepted receiver are read at intake; no old uncited operator hold is adopted. T13.01 consumes their actual receipts and adds the six evidence levels as dated receipts in the existing step contract (I-07): setup, authentication, build, signing, publishing, native-device; an authentication receipt never stands for the platform (K09). Mac and iOS still build only on the Mac (NG-118). Installing on Ryan's phone is agent work through Play (internal-testing opt-in and install through his signed-in browser), not an operator act. The native-device level is witnessed first by the installed app's own hello from the physical phone (T3.05); cells that need an agent to drive the phone's screen need the phone holder's one-time debugging authorization (A47), presented once with its working path when the first such cell is ready, and read 'not proven on device' until then.",
    delta_carried: ["IA-03 append on T13.01"],
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Pipeline.json",
        side: "config",
        action: "edit",
        exists_now: true,
      },
      {
        path: "apps/mobile/android/",
        side: "upstream-edit",
        action: "read",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: ["I-07"],
    },
    signatures: [
      "Declared cold acceptance interface: six dated receipts in the release schema; native-device receipt from the physical phone => each level has its own receipt; emulator receipts labelled emulator",
    ],
    done_when: {
      command:
        "six dated receipts in the release schema; native-device receipt from the physical phone",
      expect: "each level has its own receipt; emulator receipts labelled emulator",
      judge: "non-builder seat",
    },
    depends_on: ["T2.03", "T12.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Remove the Android steps; other targets unaffected.",
    risk: [
      "External broker/build receipts must be real, not a queue label or presumed installed version; any tower sudo act follows the cited Oct-4 source after nonprivileged preflight.",
    ],
    window_estimate: "one window",
    device_cells: [],
    proof_limits: [
      "Native-device proof of screen-driven cells waits for the debugging authorization; app-reported cells do not.",
    ],
    external_prerequisites: [
      {
        queue_id: "TQ-654",
        what: "broker publish route for Play internal testing",
        state: "queued; built version held for Ryan's tower install",
        child: "TQ-679 (rename re-target, blocks parent)",
      },
      {
        queue_id: "TQ-655",
        what: "tower Android build lane",
        state: "queued",
      },
    ],
    detail_state: "detailed",
    annotations: {
      proposal_action: "amend",
      interfaces: {
        consumes: ["I-07"],
      },
      delta_carried: ["IA-03 append on T13.01"],
      window_estimate: "one window",
      proof_limits:
        "Native-device proof of screen-driven cells waits for the debugging authorization; app-reported cells do not.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T13.01-red",
        kind: "first-act-red",
        command: "grep -c android Ship-Pipeline.json",
        expected_today: "0 (A11)",
        measured: true,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T3.04",
    fork_state: [
      {
        ref: "upgrade/hello-absurd-types-059-20261009",
        disposition: "rework",
        reason:
          "Retain typed Effect/platform fixes and the rpc.test.ts unknown-field decode correction, but port to absurd-sdk exactly 0.5.0 and request workflows; do not import inherited 0.0.57/0.0.58 stamps.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/hello-typecheck-059-20261009",
        disposition: "rework",
        reason:
          "Preserve this composite repair tip and its typed fixtures/unknown-field decoder; extract old-engine settings/sender logic into record/admission modules and omit inherited interim version stamps.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-3",
    detail_state: "detailed",
    title: "Absurd 0.4.0 to 0.5.0: the pin, the database migration and its own test",
    serves: ["NG-006"],
    what: "D17 and K02 require this as a named task with its own test, never implied. Pin absurd-sdk to exactly 0.5.0 in every package that names it (today packages/absurd-runtime ^0.4.0) with the lockfile resolving only 0.5.0, matching the tower lab. Migrate the Absurd schema with the migration absurdctl ships for 0.5.0 (the worker reads the 0.5.0 release notes and pins the exact command in the test). absurd-upgrade.test.ts runs against a disposable database it creates and drops on the Mac's Homebrew Postgres: install the 0.4.0 schema, leave a task with one committed step and one in-flight step, migrate, resume on 0.5.0, and assert the committed step replays without re-executing, the in-flight step runs once, and awaitEvent resolves for an event emitted before the wait. The live absurd database migrates in a pipeline step absurd-schema-upgrade placed before install-mac: pg_dump to the release's backup root first, migrate, read the schema version back; the dump is the rollback. The live queue is never killed or depleted as a probe (alignment review, actual-service-and-safe-probes).",
    files: [
      {
        path: "packages/absurd-runtime/package.json",
        side: "fork-namespace",
        action: "edit",
        note: "exists; absurd-sdk ^0.4.0 today (E17)",
      },
      {
        path: "pnpm-lock.yaml",
        side: "upstream-edit",
        action: "edit",
        note: "regenerated by pnpm install so it resolves 0.5.0 only; already fork-edited",
      },
      {
        path: "packages/absurd-runtime/src/absurd-upgrade.test.ts",
        side: "fork-namespace",
        action: "add",
        note: "to create",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Pipeline.json",
        side: "config",
        action: "edit",
        note: "absurd-schema-upgrade step before install-mac",
      },
    ],
    signatures: [
      'packages/absurd-runtime/package.json: "absurd-sdk": "0.5.0"',
      'Ship-Pipeline.json step { "id": "absurd-schema-upgrade", "kind": "rehearsal" } before install-mac: pg_dump to /Users/Admin/throughline-worktrees/_versions/<release>/absurd-before-0.5.0.dump, migrate, read back the schema version',
      "test packages/absurd-runtime/src/absurd-upgrade.test.ts › 'a task suspended on 0.4.0 resumes on 0.5.0 without re-running its committed step' and › 'awaitEvent resolves for an event emitted before the wait' (specified, not yet implemented)",
    ],
    failing_checks: ["S3-C07"],
    done_when: {
      command:
        "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C07 && cd /Users/Admin/throughline/packages/absurd-runtime && pnpm exec vp test run src/absurd-upgrade.test.ts",
      expect: "exit 0; the upgrade test creates, migrates and drops its own database",
    },
    depends_on: ["T2.01", "T3.07"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    risk: [
      "a migration that alters queue tables while the installed app's worker holds leases; the pipeline step runs with the Mac server quit, the same window install-mac already uses",
    ],
    rollback:
      "restore the pre-migration dump with pg_restore into the absurd database, revert the package.json pin and lockfile (path-limited), re-install the previous release",
    annotations: {
      source_authority: ["D17", "K02"],
      parallel: "runs beside T3.01; T3.02 needs it for durable event waits",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T8.03",
    slice: "slice-8",
    action: "split-child",
    parent: "T8.01",
    title: "Target tools in the Claude mod: add, fix and retract a target, each an event",
    serves: ["NG-081", "NG-082"],
    what: "The mod registers the K08 target tools that T9.01 provides; every call is an admission request of effect_kind target-change and an event on the record. Split from T8.01 because the tools need the target package, which T8.01 does not. Non-builder, installed Mac and tower: from a real claude seat add a candidate using source-bound Ryan words, read its exact words/revision/checks, fix it against the expected revision, read the new revision, retract it with reason and read the retraction event. Verify one admitted change/event per operation and the authenticated caller/generation. A stale revision or direct record write refuses. Calls delegate to the common target interface; no provider owns target state. The launcher binds this adapter on every initial and replacement launch.",
    files: [
      {
        path: "packages/throughline-claude-mod/src/target-tools.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
    ],
    interfaces: {
      consumes: ["I-01", "T9.01 target API"],
    },
    signatures: [
      "addTarget(text) | fixTarget(target_id, revision, text) | retractTarget(target_id, reason) -> event id",
    ],
    done_when: {
      command:
        "the same script on the installed Mac and tower; Non-builder, installed Mac and tower: from a real claude seat add a candidate using source-bound Ryan words, read its exact words/revision/checks, fix it against the expected revision, read the new revision, retract it with reason and read the retraction event. Verify one admitted change/event per operation and the authenticated caller/generation. A stale revision or direct record write refuses.",
      expect:
        "each tool call produces one admitted command and one target event with the caller's identity Add/read/fix/retract consumption passes through the central owner; no direct target writes or per-provider store; no fixture-only provider claim.",
      judge: "non-builder seat",
    },
    depends_on: ["T8.01", "T9.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    rollback: "Previous release; target events already written stay as history.",
    risk: [],
    window_estimate: "small, under one window",
    device_cells: [],
    proof_limits: ["none beyond the hosts measured"],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T8.01",
      interfaces: {
        consumes: ["I-01", "T9.01 target API"],
      },
      window_estimate: "small, under one window",
      proof_limits: "none beyond the hosts measured",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T8.03-red",
        kind: "first-act-red",
        command:
          "node /Users/Admin/throughline/packages/throughline-claude-mod/scripts/target-tools.mts --host mac --out <evidence>",
        expected_today: "fails: no target tools exist",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    target_tools: {
      provider: "claude",
      owner: "T8.03",
      file: "packages/throughline-claude-mod/src/target-tools.ts",
      interface_owner: "T9.01",
      interface_module: "packages/throughline-target/src/provider-tools.ts",
      launch_owner: "T6.02",
      launch_file: "packages/throughline-launcher/src/target-binding.ts",
      operations: ["read", "add", "fix", "retract"],
      cold_test:
        "Non-builder, installed Mac and tower: from a real claude seat add a candidate using source-bound Ryan words, read its exact words/revision/checks, fix it against the expected revision, read the new revision, retract it with reason and read the retraction event. Verify one admitted change/event per operation and the authenticated caller/generation. A stale revision or direct record write refuses.",
      no_provider_store: true,
    },
  },
  {
    id: "T8.04",
    slice: "slice-8",
    action: "split-child",
    parent: "T8.02",
    title: "JEV conditions bounce a re-entry packet and never release it",
    serves: ["NG-196"],
    what: "Through the one K07 condition port, JEV may bounce a packet with a typed reason; code alone releases. A JEV timeout, refusal or no-answer never releases and never blocks a code release that passed (K06: the absence of an objection is never a release predicate).",
    files: [
      {
        path: "packages/throughline-claude-mod/src/reentry-conditions.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
    ],
    interfaces: {
      consumes: ["T9.02 condition port"],
    },
    signatures: ["bounce(packet) -> bounced(reason) | no-objection"],
    done_when: {
      command: "the bounce script with a malformed answer, an outage and a bounce",
      expect:
        "bounce holds the packet; outage and malformed answer leave the code decision unchanged",
      judge: "non-builder seat",
    },
    depends_on: ["T8.02", "T9.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    rollback: "Previous release; T8.02's code release keeps working without bounces.",
    risk: [],
    window_estimate: "small",
    device_cells: [],
    proof_limits: ["none"],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T8.02",
      interfaces: {
        consumes: ["T9.02 condition port"],
      },
      window_estimate: "small",
      proof_limits: "none",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T8.04-red",
        kind: "first-act-red",
        command:
          "node /Users/Admin/throughline/packages/throughline-claude-mod/scripts/k06-jev-bounce.mts --out <evidence>",
        expected_today: "fails: no condition port",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T9.04",
    slice: "slice-9",
    action: "split-child",
    parent: "T9.02",
    title:
      "Calibrate the target-promotion parameter on real first messages, and publish the label glossary JEV questions use",
    serves: ["NG-077", "NG-078", "NG-092"],
    what: "K07 test 1: a labelled corpus of real first messages, quotes, questions, retractions and agent-to-agent asks; measure false promotion, false omission, abstentions, p95 latency and cost at 0.80 and two neighbours; record the chosen value with its error costs. Labels by a seat that did not build the gate. Split from T9.02 because labelling and measuring is its own window. Also NG-092: every Absurd table, column, state value and option, and every Pi role, event and field, listed under one address scheme generated from the installed schemas, so JEV questions name them exactly. The corpus adds the wake messages of the Oct 10, 2026 usage audit (the two RESUME LEAD MESSAGES notices, the lead ruling, Ryan's liveness question, and the other first messages of the seven cold wakes), labelled no_model, light, standard or lead_only by a non-builder with the reason; the route conditions are calibrated on this corpus at 0.80 and two neighbours alongside the target-promotion parameter, and the false-no_model rate is reported separately because its cost is a silenced seat.",
    files: [
      {
        path: "packages/throughline-conditions/calibration/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
    ],
    interfaces: {
      consumes: ["T9.02 port"],
    },
    signatures: [
      "Declared cold acceptance interface: the calibration script => one recorded value with its measured error costs; the parameter flips from unevaluated to governing",
    ],
    done_when: {
      command: "the calibration script",
      expect:
        "one recorded value with its measured error costs; the parameter flips from unevaluated to governing",
      judge: "non-builder seat that also did not label",
    },
    depends_on: ["T9.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Restore the 0.80 unevaluated parameter.",
    risk: [],
    window_estimate: "one window",
    device_cells: [],
    proof_limits: [
      "The corpus size is whatever real messages exist; no target accuracy is promised.",
    ],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T9.02",
      interfaces: {
        consumes: ["T9.02 port"],
      },
      window_estimate: "one window",
      proof_limits:
        "The corpus size is whatever real messages exist; no target accuracy is promised.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T9.04-red",
        kind: "first-act-red",
        command:
          "node /Users/Admin/throughline/packages/throughline-conditions/scripts/calibrate.mts --corpus <labels> --out <evidence>",
        expected_today: "fails: no corpus, no recorded value",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T9.05",
    slice: "slice-9",
    action: "split-child",
    parent: "T9.03",
    title:
      "The delivery seam: formatted delivery is a projection; missing details and governing shapes are appended, never rewritten",
    serves: ["NG-084", "NG-091"],
    what: "Every report is checked against the target before Ryan sees it. Raw authored content is immutable; the formatted view is a projection; missing-detail requests and the shape statements governing an act Ryan is asked to take are appended (K14, delta IA-02). Builds on the existing renderer seam at apps/web/src/operatorDeliveryLinks.ts (A05), moved into the fork namespace by one mount line.",
    delta_carried: ["IA-02 append on T9.03"],
    files: [
      {
        path: "apps/web/src/operatorDeliveryLinks.ts",
        side: "upstream-edit",
        action: "read",
        exists_now: true,
        assumption: "A05",
      },
      {
        path: "apps/web/src/throughline/delivery/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
        assumption: "A03",
      },
    ],
    interfaces: {
      consumes: ["T9.02 port", "intent index (gate-and-rewind script, outside tool)"],
    },
    signatures: ["project(rawMessage, target) -> {view, appended[]}"],
    done_when: {
      command: "K14 test 1 on the installed Mac app: a formatter timeout and a stale mobile action",
      expect:
        "raw bytes unchanged; append present when the act matches a shape; formatter timeout shows the raw text",
      judge: "non-builder seat",
    },
    depends_on: ["T9.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-10-ryan-the-system-delivers-the-shape-at-the-moment-not-the-agent-remembering.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous release; the projection is display-only.",
    risk: [],
    window_estimate: "one window",
    device_cells: [],
    proof_limits: ["none"],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T9.03",
      interfaces: {
        consumes: ["T9.02 port", "intent index (gate-and-rewind script, outside tool)"],
      },
      delta_carried: ["IA-02 append on T9.03"],
      window_estimate: "one window",
      proof_limits: "none",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T9.05-protect",
        kind: "retained-protection",
        command:
          "the existing path-link insertion in the installed Mac app leaves stored message bytes untouched",
        expected_today: "described as working by the document-rendering rule; not re-measured here",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T9.05-red",
        kind: "first-act-red",
        command:
          "node /Users/Admin/throughline/apps/web/src/throughline/delivery/scripts/delivery-seam.mts --out <evidence>",
        expected_today: "fails: no shape or missing-detail append exists",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T10.05",
    fork_state: [
      {
        ref: "7f48b45618",
        disposition: "keep",
        reason:
          "Retain owning-environment identity copy and readable repeated-rewind choices; record mobile fork-added paths for incremental relocation, not a whole-branch rewrite.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/copy-20261009",
        disposition: "rework",
        reason:
          "Keep copy/picker logic and branch-only owning-query tests at 65c74e, but rebind family authority to launcher record columns; much client code is already composed into main.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-10",
    action: "split-child",
    parent: "T10.01",
    title: "The phones: the readable rewind picker and the desktop color scheme",
    serves: ["NG-100", "NG-104", "NG-106", "NG-107"],
    what: "The iPhone and Android picker uses the theme's own colors and rewinds to the first turn repeatedly; the phones carry the desktop color scheme and layout control (NG-107) through the fork-owned front end (NG-106). The first act measures the installed phone build to separate what already passes from the gap.",
    files: [
      {
        path: "apps/mobile/src/",
        side: "upstream-edit",
        action: "edit",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: ["T10.01 rewind", "slice-2 seam rule for front-end ownership (K11)"],
    },
    signatures: [
      "Declared cold acceptance interface: rewind and phone-theme row tests on ios and android => picker readable in the theme colors; two rewinds to the first turn; scheme matches the desktop",
    ],
    done_when: {
      command: "rewind and phone-theme row tests on ios and android",
      expect:
        "picker readable in the theme colors; two rewinds to the first turn; scheme matches the desktop",
      judge: "non-builder seat",
    },
    depends_on: ["T10.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous TestFlight build is retained by the pipeline (A12).",
    risk: [
      "Full layout control on iOS may exceed one window; if the first act shows that, split again before building.",
    ],
    window_estimate: "one window, conditional on the first act",
    device_cells: ["rewind@ios", "rewind@android", "phone-theme@ios", "phone-theme@android"],
    proof_limits: ["Android physical cells wait on D-CAP-05."],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T10.01",
      interfaces: {
        consumes: ["T10.01 rewind", "slice-2 seam rule for front-end ownership (K11)"],
      },
      window_estimate: "one window, conditional on the first act",
      proof_limits: "Android physical cells wait on D-CAP-05.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T10.05-red",
        kind: "first-act-red",
        command:
          "row tests CT rewind@ios and phone-theme@ios on the physical iPhone through iPhone Mirroring",
        expected_today: "not measured",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T10.06",
    slice: "slice-10",
    action: "split-child",
    parent: "T10.03",
    title:
      "Retire the Agent Instruments driver, watch verbs and HTTP sends after the replacement is proven",
    serves: ["NG-013", "NG-014"],
    what: "Only after T10.03's durable waits and app subscriptions pass and the messaging cells pass: retire the driver daemon, the watch verbs and the HTTP send path in the Tier 1 source and deliver the removal through its owning ship lane. Edit lists never point at the deployed copy (A33). Every seat's return route, including the orchestrator's, moves to the ComsNet CLI before the old send is removed.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/agent-instruments/",
        side: "outside-tool",
        action: "edit",
        exists_now: true,
        assumption: "A33",
      },
    ],
    interfaces: {
      consumes: ["I-05"],
    },
    signatures: [
      "Declared cold acceptance interface: after the ship lane installs the removal: one seat replies to the orchestrator through the CLI and the reply appears in the orchestrator thread's own record => reply visible in the receiver's record; no driver process on any host",
    ],
    done_when: {
      command:
        "after the ship lane installs the removal: one seat replies to the orchestrator through the CLI and the reply appears in the orchestrator thread's own record",
      expect: "reply visible in the receiver's record; no driver process on any host",
      judge: "non-builder seat",
    },
    depends_on: ["T10.03", "T7.04"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-03-ryan-durability-is-a-running-watched-layer-not-answers-in-a-readme.yaml",
    ],
    rollback: "Reinstall the previous Agent Instruments version through its ship lane.",
    risk: ["Removing the send path before every seat migrates strands return routes."],
    window_estimate: "small",
    device_cells: [],
    proof_limits: ["none"],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T10.03",
      interfaces: {
        consumes: ["I-05"],
      },
      window_estimate: "small",
      proof_limits: "none",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T10.06-protect",
        kind: "retained-protection",
        command:
          "every return route in the project's current-state file and active work orders is a ComsNet CLI call before removal",
        expected_today:
          "fails today: the orchestrator's return route is agent-instruments send (A33)",
        measured: true,
        spec_projection: {
          kind: "real-disk",
          expected_today: "measured, see expected_today",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T10.07",
    fork_state: [
      {
        ref: "fcb5e39703",
        disposition: "keep",
        reason:
          "Retain draft ownership, generation/selection checks, original preservation and guarded undo in the existing fork namespace; native dictation and installed central-log proof remain separate.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "0016ddec02",
        disposition: "rework",
        reason:
          "Keep voice raw/undo, Android transcription and composer controls, but repair its family-query mount against a real record-backed RPC: main calls getLauncherThreadFamily without the branch-only server/contract declaration.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/settings-host-20261009",
        disposition: "rework",
        reason:
          "This broad composite carries useful client/voice/hello code but still records a fixed boolean through old engine activity receipts and JSONL lineage; migrate those owners to record/admission and keep already-folded client protections.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/voice-20261009",
        disposition: "keep",
        reason:
          "Keep raw transcript/guarded undo, tower optimizer ports and optional Android transcription; most source is composed into 0016/fcb5, so preserve only missing deltas and existing iOS protections.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-10",
    action: "split-child",
    parent: "T10.04",
    title:
      "Voice and optimize on the desktop: the composer action on Mac and the Linux desktop app, Super Whisper on the Mac, the full optimizer on the tower",
    serves: ["NG-108", "NG-071"],
    what: "The composer has an optimize action that rewrites a selection or the whole draft, keeps the original, offers undo, preserves the raw transcript and shows the optimization status; Super Whisper dictation on the Mac goes through the tower's Message Optimizer; the tower runs the full original process with one central log and the model-or-Off preference (K14). The Linux desktop part follows D-CAP-04. Linux is required, not a decision: spec decision D16 says 'In the desktop app on Mac and Linux and on the phone', resting on NG-108's Oct 7, 2026 user message 'I've expressed I want that in the desktop app here and on Linux too' (A49). The Mac part absorbs the existing queue item for the desktop composer voice button (TQ-652, queued, codex lane); the lead links or closes it into this task. First act on the tower: inside the desktop session that runs the app, list capture devices the app can open. Pass: dictation proven there. Fail because no microphone is physically attached: the optimize action is still proven and the dictation half is reported not proven on that host, named with its working path (a USB microphone on the tower, or the Linux desktop app on a Linux machine that has one); it is never dropped.",
    files: [
      {
        path: "apps/web/src/throughline/composer-optimize/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
      {
        path: "apps/desktop/src/throughline/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
        assumption: "A03",
      },
    ],
    interfaces: {
      consumes: ["Message Optimizer tower route (A35)"],
    },
    signatures: ["optimize(text, scope: selection | draft) -> {optimized, original, status}"],
    done_when: {
      command: "row tests voice@mac, voice@twr and voice-linux-desktop@twr (per D-CAP-04)",
      expect: "dictate or type, optimize, undo; raw text kept; one central log row per request",
      judge: "non-builder seat",
    },
    depends_on: [],
    depends_on_note:
      "No in-graph prerequisite: voice consumes no record or identity contract. The slice-10 precondition still applies at slice level.",
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous release.",
    risk: [],
    window_estimate: "one window",
    device_cells: ["voice@mac", "voice@twr", "voice-linux-desktop@twr"],
    proof_limits: [
      "The tower has one capture device node, but account twr cannot enumerate sound cards and whether a microphone is attached is unknown (A50).",
    ],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T10.04",
      interfaces: {
        consumes: ["Message Optimizer tower route (A35)"],
      },
      window_estimate: "one window",
      proof_limits:
        "The tower has one capture device node, but account twr cannot enumerate sound cards and whether a microphone is attached is unknown (A50).",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T10.07-red",
        kind: "first-act-red",
        command:
          "row test CT voice@mac on the installed Mac app, then read the central log row on the tower",
        expected_today: "Ryan, Oct 4, 2026: 'currently live in iOS, desktop not yet'",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T10.08",
    fork_state: [
      {
        ref: "93f0b46569",
        disposition: "keep",
        reason:
          "Retain mobile optimization status, fallback reasons and raw-draft behavior; these UI protections do not depend on the authoritative record layout.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "7bac3fc7a3",
        disposition: "keep",
        reason:
          "Retain the pinned Expo speech dependency and lock entries needed by Android dictation; native plugin configuration still needs the branch-only permission entry and device proof.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "0016ddec02",
        disposition: "rework",
        reason:
          "Keep voice raw/undo, Android transcription and composer controls, but repair its family-query mount against a real record-backed RPC: main calls getLauncherThreadFamily without the branch-only server/contract declaration.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/release-20261009",
        disposition: "keep",
        reason:
          "Keep the missing Expo speech native-permission plugin at c5712ecdd4; most dependency/identity work is already folded into main, so reuse only missing deltas and test the chosen Android speech service.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/settings-host-20261009",
        disposition: "rework",
        reason:
          "This broad composite carries useful client/voice/hello code but still records a fixed boolean through old engine activity receipts and JSONL lineage; migrate those owners to record/admission and keep already-folded client protections.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/voice-20261009",
        disposition: "keep",
        reason:
          "Keep raw transcript/guarded undo, tower optimizer ports and optional Android transcription; most source is composed into 0016/fcb5, so preserve only missing deltas and existing iOS protections.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-10",
    action: "split-child",
    parent: "T10.04",
    title: "Voice and optimize on the phones: keep iOS working, bring Android to parity",
    serves: ["NG-108", "NG-104"],
    what: "iOS voice through Message Optimizer is live (Ryan, Oct 4, 2026) and is kept as a protection; Android gains the same dictate, optimize and undo with the raw transcript kept. Super Whisper does not exist on Android (Ryan, quoted in NG-104).",
    files: [
      {
        path: "apps/mobile/src/",
        side: "upstream-edit",
        action: "edit",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: ["T10.07 optimize contract"],
    },
    signatures: [
      "Declared cold acceptance interface: row tests voice@ios and voice@android => dictate, optimize, undo on both phones",
    ],
    done_when: {
      command: "row tests voice@ios and voice@android",
      expect: "dictate, optimize, undo on both phones",
      judge: "non-builder seat",
    },
    depends_on: ["T10.07"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous phone builds retained.",
    risk: [],
    window_estimate: "one window",
    device_cells: ["voice@ios", "voice@android"],
    proof_limits: ["Android physical cell waits on D-CAP-05."],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T10.04",
      interfaces: {
        consumes: ["T10.07 optimize contract"],
      },
      window_estimate: "one window",
      proof_limits: "Android physical cell waits on D-CAP-05.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T10.08-protect",
        kind: "retained-protection",
        command: "row test CT voice@ios on the physical iPhone through iPhone Mirroring",
        expected_today: "live per Ryan Oct 4, 2026; not re-measured",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T10.08-red",
        kind: "first-act-red",
        command: "row test CT voice@android on the emulator as pre-proof",
        expected_today: "not measured",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T10.09",
    fork_state: [
      {
        ref: "2ca67b35db",
        disposition: "keep",
        reason:
          "Retain owning-route copy mounting, raw newline/attached command behavior and observed-model controls; these are client protections, not record or admission ownership.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "0016ddec02",
        disposition: "rework",
        reason:
          "Keep voice raw/undo, Android transcription and composer controls, but repair its family-query mount against a real record-backed RPC: main calls getLauncherThreadFamily without the branch-only server/contract declaration.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/compose-20261009",
        disposition: "rework",
        reason:
          "Retain client behavior already folded into 2ca6/7f48/0016; its settings intent is still a single boolean on the old store and needs the record-owned contract.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/voice-20261009",
        disposition: "keep",
        reason:
          "Keep raw transcript/guarded undo, tower optimizer ports and optional Android transcription; most source is composed into 0016/fcb5, so preserve only missing deltas and existing iOS protections.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-10",
    action: "split-child",
    parent: "T10.04",
    title: "The carried composer and app features, in the ledger's words",
    serves: ["NG-109", "NG-110", "NG-187"],
    what: "On iPhone, Return inserts a newline and only the send arrow sends; attachment limits are the app's own setting; a new thread starts machine-first with a sensible folder per device; Command+Shift+V pastes inline on the Mac; side chat attaches to any thread; vault links in chat open the link-router page; the turn-budget refusal is removed from the running apps (CP-01, D-CAP-07). Several were reported landed on Oct 5, 2026; the first act measures each on the installed builds, keeps what passes as a protection and builds only the gaps. Also the vault viewer's copy button (NG-187): a durable, easy-to-tap button in the shared template that serves vault files over Ryan's mobile Tailscale links, copying the page's whole contents; the first act locates that template's Tier 1 source.",
    files: [
      {
        path: "apps/web/src/throughline/composer/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
      {
        path: "apps/mobile/src/",
        side: "upstream-edit",
        action: "edit",
        exists_now: true,
      },
    ],
    interfaces: {},
    signatures: [
      "Declared cold acceptance interface: row tests composer-carried on mac, ios and android => every listed behavior observed on the installed build",
    ],
    done_when: {
      command: "row tests composer-carried on mac, ios and android",
      expect: "every listed behavior observed on the installed build",
      judge: "non-builder seat",
    },
    depends_on: [],
    depends_on_note: "No in-graph prerequisite; independent UI work.",
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous release.",
    risk: [],
    window_estimate: "one window, mostly protections",
    device_cells: ["composer-carried@mac", "composer-carried@ios", "composer-carried@android"],
    proof_limits: ["Android physical cell waits on D-CAP-05."],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T10.04",
      interfaces: {},
      window_estimate: "one window, mostly protections",
      proof_limits: "Android physical cell waits on D-CAP-05.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T10.09-measure",
        kind: "retained-protection",
        command:
          "one check per feature on the installed Mac app and the physical iPhone; each recorded as pass (protection) or gap",
        expected_today:
          "agent report of Oct 5, 2026 says the iPhone Return behavior and attachment limits landed; not re-measured",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T10.10",
    fork_state: [
      {
        ref: "cf26b80931",
        disposition: "rework",
        reason:
          "Reuse field-limited rollback/readback logic, but widen its single boolean/three-host allowlist from the versioned intent contract and admit/record settings changes through RecordPort instead of an unrecorded multi-host act.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "b210fb27b3",
        disposition: "rework",
        reason:
          "Keep authenticated host-map/readback checks, but replace ExistingRecordContext.owner=OrchestrationEngine and the fixed three-role boolean ports with the versioned eligible-host contract and record-owned settings admission.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "f03e6ad350",
        disposition: "rework",
        reason:
          "Extract the large makeExistingSettingsConsumer adapter from OrchestrationEngine into the fork namespace and persist settings commands/events through RecordPort; retain exact receipt/environment comparison tests.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/compose-20261009",
        disposition: "rework",
        reason:
          "Retain client behavior already folded into 2ca6/7f48/0016; its settings intent is still a single boolean on the old store and needs the record-owned contract.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/hello-continuation-20261009",
        disposition: "rework",
        reason:
          "Reuse authenticated boolean-only RPC guards, but direct serverSettings.updateSettings is not record admission or cross-host intent propagation; move behavior into the namespace with a minimal ws mount.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/hello-typecheck-059-20261009",
        disposition: "rework",
        reason:
          "Preserve this composite repair tip and its typed fixtures/unknown-field decoder; extract old-engine settings/sender logic into record/admission modules and omit inherited interim version stamps.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/ident-20261009",
        disposition: "rework",
        reason:
          "Keep exact identity/model/security tests, but this branch combines SQLite aliases, projection stamping, engine settings receipts and JSONL lineage; replace those owners with the designed record/admission/launcher joins.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/ident-senderlayer-059-20261009",
        disposition: "rework",
        reason:
          "Preserve composite sender/type/fixture repairs, including the ProjectionPipeline sender fixture fix at the tip; apply them to the new record tests, not an engine-owned SQLite authority.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/ident-typecheck-059-20261009",
        disposition: "rework",
        reason:
          "Retain typed authorization/evidence encoding fixes, but the corrected makeExistingSettingsConsumer remains in OrchestrationEngine and must be extracted/rebound to RecordPort.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/settings-host-20261009",
        disposition: "rework",
        reason:
          "This broad composite carries useful client/voice/hello code but still records a fixed boolean through old engine activity receipts and JSONL lineage; migrate those owners to record/admission and keep already-folded client protections.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/settings-typecheck-059-20261009",
        disposition: "rework",
        reason:
          "Keep strict boolean/readback/excess-property fixture corrections, but port the old-engine context/three-host contracts to the versioned eligible-host record design; exclude inherited interim stamps.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-10",
    action: "split-child",
    parent: "T10.04",
    title: "Settings carry Ryan's intent to every eligible host",
    serves: ["NG-114"],
    what: "Delta IA-04 as written: the application-intent source (contracts/Protected-Settings.json widened to the curated set, versioned) and one adapter per host; a setting changed on any host lands on every eligible host in the same act through the record; effective state is read back and drift is reported with a rollback; privileges, credential access and intentional device differences are excluded; each entry names its eligible hosts. The phones' app-owned settings survive every upgrade. Two of Ryan's Oct 9, 2026 rulings land here as product defaults on mac and twr. First, no agent auto-compacts (\"I don't want any agent—Claude, Codex, nobody—to AutoCompact\"): the curated set carries one auto-compaction entry per provider, Claude, Codex and Pi, and the adapters write and read back each one. Second, there is one Codex provider (\"this additional Codex lane, needs to not be in future versions\"): the settings migration removes the duplicate Codex provider instance that lives today in ThroughLine's own settings file as providerInstances.codexWorker, displayed as ryan-codex-worker with its own Codex home at /Users/Admin/.local/state/codex-worker-lane/home; the registry-keyed refusal hook built for that lane is retired through its own component. Self-driving (NG-115) is an application-intent setting that is off on a fresh install and on every upgrade that has no recorded Ryan request; it turns on only through an explicit enable event that carries his words, and the running state shown matches the effective state.",
    delta_carried: ["IA-04 replace on T10.04"],
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/contracts/Protected-Settings.json",
        side: "config",
        action: "edit",
        exists_now: true,
        assumption: "A21",
      },
      {
        path: "apps/server/src/throughline/settings-intent/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
        note: "Also holds migrateProviderInstances, run at server start on every host against that host's ThroughLine settings.json (Mac: /Users/Admin/.t3/userdata/settings.json; tower: /srv/agents-runtime-state/throughline/userdata/settings.json; Raspberry Pi settings path is deferred, not an execution target).",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/protected-settings/check-protected-settings.ts",
        side: "outside-tool",
        action: "read",
        exists_now: true,
        note: "The existing checker behind pipeline steps protected-settings and protected-settings-live; it reads the three auto-compaction entries from Protected-Settings.json, so no second checker is written.",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/hooks/pre-compaction-proximity-gate/src/codex/worker-no-compact.ts",
        side: "outside-tool",
        action: "remove",
        exists_now: true,
        note: "The registry-keyed Codex worker refusal (component pre-compaction-proximity-gate 0.2.2; registry /Users/Admin/.local/state/codex-worker-lane/no-compact/). Removed with a version bump of that component and shipped through Ship Warden, which also drops its Codex hook registration. The Claude reminder entry of the same component is unchanged. /Users/Admin/.local/state/codex-worker-lane/ is archived, not deleted.",
      },
    ],
    interfaces: {
      consumes: ["I-03"],
    },
    signatures: [
      "applyIntent(setting, value) -> event; adapters read back effective state per host",
      'Auto-compaction entries in Protected-Settings.json, eligible hosts mac, twr: claude.autoCompactEnabled = false in ~/.claude/settings.json and ~/.claude.json; codex.model_auto_compact_token_limit = 100000000 with model_auto_compact_token_limit_scope = "total" in ~/.codex/config.toml; pi.compaction.enabled = false in ~/.pi/agent/settings.json (the Pi harness reads compaction?.enabled ?? true in @earendil-works/pi-coding-agent dist/core/settings-manager.js, so an absent key means on).',
      "migrateProviderInstances(settings) -> {settings, receipt}: leaves exactly one provider instance per driver among claudeAgent, codex and pi; removes providerInstances.codexWorker; threads bound to codexWorker are rebound to codex and listed in the receipt; idempotent, so a second run changes nothing.",
    ],
    done_when: {
      command:
        "the delta IA-04 failure test on installed hosts, with the propagation interval measured",
      expect:
        "same effective value on every eligible host; one event; no privilege setting moved; no release needed; on mac and twr exactly one codex provider instance and auto-compaction off for Claude, Codex and Pi, read back by the existing protected-settings checker",
      judge: "non-builder seat",
    },
    depends_on: ["T3.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Each change carries its prior value; drift report offers the revert.",
    risk: [],
    window_estimate: "one window",
    device_cells: ["settings@mac", "settings@twr", "settings@ios", "settings@android"],
    proof_limits: ["Android physical cell waits on D-CAP-05."],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T10.04",
      interfaces: {
        consumes: ["I-03"],
      },
      delta_carried: ["IA-04 replace on T10.04"],
      window_estimate: "one window",
      proof_limits: "Android physical cell waits on D-CAP-05.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T10.10-self-driving-default",
        kind: "contract-test",
        command:
          "fresh install on a test host; read the self-driving setting; then record an explicit enable with Ryan's words",
        expect:
          "off after install; on only after the enable event; the displayed running state equals the effective state",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T10.10-protect",
        kind: "retained-protection",
        command:
          "Ship-Pipeline steps protected-settings and protected-settings-live with the existing checker",
        expected_today: "exists (A21)",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T10.10-red",
        kind: "first-act-red",
        command:
          "change the continue-threads-after-restart setting on the Mac; read the tower and Raspberry Pi effective values after one interval",
        expected_today: "fails: no propagation",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T10.10-one-codex-red",
        kind: "first-act-red",
        command:
          "count providerInstances entries whose driver is codex in /Users/Admin/.t3/userdata/settings.json (read only the driver and displayName fields)",
        expected_today:
          "fails: two (codex as ryan-codex and codexWorker as ryan-codex-worker), measured Oct 9, 2026",
        measured: true,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T10.10-pi-compaction-red",
        kind: "first-act-red",
        command: "read compaction.enabled in /Users/Admin/.pi/agent/settings.json",
        expected_today:
          "fails: the key is absent, so the Pi harness default (on) applies, measured Oct 9, 2026",
        measured: true,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        what: "Delta IA-04 as written: the application-intent source (contracts/Protected-Settings.json widened to the curated set, versioned) and one adapter per host; a setting changed on any host lands on every eligible host in the same act through the record; effective state is read back and drift is reported with a rollback; privileges, credential access and intentional device differences are excluded; each entry names its eligible hosts. The phones' app-owned settings survive every upgrade. Two of Ryan's Oct 9, 2026 rulings land here as product defaults on mac, twr and rpi. First, no agent auto-compacts (\"I don't want any agent—Claude, Codex, nobody—to AutoCompact\"): the curated set carries one auto-compaction entry per provider, Claude, Codex and Pi, and the adapters write and read back each one. Second, there is one Codex provider (\"this additional Codex lane, needs to not be in future versions\"): the settings migration removes the duplicate Codex provider instance that lives today in ThroughLine's own settings file as providerInstances.codexWorker, displayed as ryan-codex-worker with its own Codex home at /Users/Admin/.local/state/codex-worker-lane/home; the registry-keyed refusal hook built for that lane is retired through its own component. Self-driving (NG-115) is an application-intent setting that is off on a fresh install and on every upgrade that has no recorded Ryan request; it turns on only through an explicit enable event that carries his words, and the running state shown matches the effective state.",
        signatures: [
          "applyIntent(setting, value) -> event; adapters read back effective state per host",
          'Auto-compaction entries in Protected-Settings.json, eligible hosts mac, twr, rpi: claude.autoCompactEnabled = false in ~/.claude/settings.json and ~/.claude.json; codex.model_auto_compact_token_limit = 100000000 with model_auto_compact_token_limit_scope = "total" in ~/.codex/config.toml; pi.compaction.enabled = false in ~/.pi/agent/settings.json (the Pi harness reads compaction?.enabled ?? true in @earendil-works/pi-coding-agent dist/core/settings-manager.js, so an absent key means on).',
          "migrateProviderInstances(settings) -> {settings, receipt}: leaves exactly one provider instance per driver among claudeAgent, codex and pi; removes providerInstances.codexWorker; threads bound to codexWorker are rebound to codex and listed in the receipt; idempotent, so a second run changes nothing.",
        ],
        done_when: {
          command:
            "the delta IA-04 failure test on installed hosts, with the propagation interval measured",
          expect:
            "same effective value on every eligible host; one event; no privilege setting moved; no release needed; on mac, twr and rpi exactly one codex provider instance and auto-compaction off for Claude, Codex and Pi, read back by the existing protected-settings checker",
          judge: "non-builder seat",
        },
        device_cells: [
          "settings@mac",
          "settings@twr",
          "settings@rpi",
          "settings@ios",
          "settings@android",
        ],
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T11.04",
    fork_state: [
      {
        ref: "8822a86733",
        disposition: "keep",
        reason:
          "Retain pure configured-plus-observed headroom projection and namespace Limits widgets with freshness/unknowns; their data binding and admission are not proven by this commit.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "55ae2ab8b9",
        disposition: "rework",
        reason:
          "Keep the bounded observer cache, but replace ProviderService's in-memory wait/sleep with the I-01 headroom slot and durable request wait rows; resolve the existing broker route per host and join actual configured identities.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/android-preflight-20261009",
        disposition: "rework",
        reason:
          "Despite the name, this tip is the limits/provider-headroom branch, identical to upgrade/limits; preserve helpers already integrated as 8822/55ae, replace its provider-local wait with record admission.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/limits-20261009",
        disposition: "rework",
        reason:
          "Same SHA as android-preflight; keep pure projections but replace old provider-local wait/routing with the I-01 headroom slot and durable waits, without creating another meter.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/limits-cache-20261009",
        disposition: "rework",
        reason:
          "Keep bounded transport/cache and fresh/unknown projection, already composed into 55ae; replace ephemeral ProviderService waits and host-assumed observer input.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/observer-http-20261009",
        disposition: "rework",
        reason:
          "Keep observer cache guards, but move waiting to record admission and port the mixed packaging/throughline-ship-source RPi unit checks to the owning ship-tool source/new release contract instead of AF60/0.0.57 constants.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-11",
    action: "split-child",
    parent: "T11.03",
    title: "Headroom from the broker's observer feeds the admission point and the Limits panel",
    serves: ["NG-039", "NG-141"],
    what: "Delta IA-05 with the review's corrections: the model route reads the broker observer's headroom with its freshness and supplies it to the headroom slot of I-01 before each model-backed turn; unknown or stale never blocks; a known-empty account is not routed to until the observer reports its reset; a turn that cannot be served waits as a wait row. The Limits panel shows every account the observer reports, with freshness and unknown states; nothing counts or caps calls. The number of accounts is read at runtime (A30). Tests use controlled observer responses through the real consumer path; no real subscription is spent down. Under S5 it reads the broker's existing observer surface and adds no ThroughLine-only meter, endpoint or tool unless the observer lacks a field, which is then added to the observer itself. Preserve every currently configured broker identity, including unloaded/unknown accounts, by joining current configured-identity status with the observer. Loaded/available/configured are distinct; no fixed account count. Reset re-check (D25): when the observer reports an account's reset, the model route does not resume the seats that limit stopped on their queued messages as they stand; it asks the route slot (T3.08) to re-evaluate each queued message against current state and wakes each seat at most once with the digest of what survives; a wake whose digest is empty is recorded and not started.",
    delta_carried: ["IA-05 append on T11.03"],
    files: [
      {
        path: "apps/server/src/throughline/headroom/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
      {
        path: "apps/web/src/throughline/limits/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
    ],
    interfaces: {
      consumes: ["I-01", "I-06"],
      provides: ["headroom slot"],
    },
    signatures: ["headroom() -> per account {state, reset_at, observed_at}"],
    done_when: {
      command: "the delta IA-05 failure test with controlled responses",
      expect:
        "empty account skipped until reset; stale reading admits; panel shows every reported account with freshness Every currently configured identity remains visible, including unloaded/unknown; no subscription depletion.",
      judge: "non-builder seat",
    },
    depends_on: ["T11.03", "T3.01", "T6.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-16-ryan-brokered-resources-carry-one-visible-headroom-ledger-not-ad-hoc-tools.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback:
      "Previous release; with no headroom input the admission point admits and the provider result decides.",
    risk: [],
    window_estimate: "one window",
    device_cells: ["limits@mac", "limits@twr"],
    proof_limits: [
      "Controlled exhausted/reset responses through the real consumer; no deliberately depleted subscription.",
    ],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T11.03",
      interfaces: {
        consumes: ["I-01", "I-06"],
        provides: ["headroom slot"],
      },
      delta_carried: ["IA-05 append on T11.03"],
      window_estimate: "one window",
      proof_limits:
        "One real exhausted-pool recovery on the tower is still owed (delta IA-05 remaining proof).",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T11.04-red",
        kind: "first-act-red",
        command:
          "a controlled observer response marking one account empty, sent through the installed tower's consumer path",
        expected_today: "fails: dispatch has no headroom input",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        device_cells: ["limits@mac", "limits@twr", "limits@rpi"],
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T12.04",
    slice: "slice-12",
    action: "split-child",
    parent: "T12.01",
    title:
      "Every service is watched by something that is itself watched, including from another device",
    serves: ["NG-128"],
    what: "The accepted surfaces are the ThroughLine durability view in the app and an independent off-host notification path for record or host loss (the retired Health Hub adapter and x-registry never count, S6). The view shows every ThroughLine service's alive state from its watcher. The off-host path consumes the host proposal's T4.03 Raspberry Pi observer: with the laptop closed and the tower or its record unavailable, the Raspberry Pi still detects the loss and notifies, and neither the notification nor its grant service needs the failed tower record to admit the outage report. Something on the tower watches the Mac's keep-alive layer and the Mac watches the tower. Existing Mac supervision may keep running as a transition mechanism until this view proves itself on a real loss, then it is one watched service among the rest, never a witness. The broker observer's freshness is one watched signal, never a gate (delta IA-05 on T12.01). The delta's IA-05 and IA-06 text naming the Health Hub is superseded by S6 (A57). The off-host path is not only detection and notification: it launches the responder of T12.08 first, and Ryan is paged only by T12.08's tier-2 rule; the durability view shows open incidents and the responder thread. The durability view shows the two unreachable states (planned, waiting for unlock; unplanned) distinctly from a record loss and from a service loss, with the reboot marker's time when present.",
    delta_carried: ["IA-05 append on T12.01"],
    files: [
      {
        path: "apps/server/src/throughline/watch/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
    ],
    interfaces: {
      consumes: ["T4.03 Raspberry Pi observer and its notification path (host proposal)"],
      provides: ["the ThroughLine durability view the host proposal names as final visibility"],
    },
    signatures: [
      "Declared cold acceptance interface: the integration decision's cross-device test: laptop closed, tower record unavailable; then Mac unit bootout-and-bootstrap watched from the tower => the Raspberry Pi detects and notifies without the tower record; the durability view shows the loss and the return; the Mac's keep-alive layer is seen coming back",
    ],
    done_when: {
      command:
        "the integration decision's cross-device test: laptop closed, tower record unavailable; then Mac unit bootout-and-bootstrap watched from the tower",
      expect:
        "the Raspberry Pi detects and notifies without the tower record; the durability view shows the loss and the return; the Mac's keep-alive layer is seen coming back",
      judge: "a visible ThroughLine seat that did not build T12.04, medium effort or lower",
    },
    depends_on: ["T12.01", "T4.03", "T12.08"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-03-ryan-durability-is-a-running-watched-layer-not-answers-in-a-readme.yaml",
    ],
    rollback: "Disable the new watcher units.",
    risk: [],
    window_estimate: "one window",
    device_cells: [],
    proof_limits: ["none"],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T12.01",
      interfaces: {
        consumes: ["T4.03 Raspberry Pi observer and its notification path (host proposal)"],
        provides: ["the ThroughLine durability view the host proposal names as final visibility"],
      },
      delta_carried: ["IA-05 append on T12.01"],
      window_estimate: "one window",
      proof_limits: "none",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T12.04-red",
        kind: "first-act-red",
        command:
          "in a rehearsal window with the laptop lid closed, stop the tower's record service on the rehearsal cluster and watch for the Raspberry Pi's notification and the durability view's state",
        expected_today: "fails: no durability view exists",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    unit_proof_rule: {
      operator_words:
        "Any proof that something survives a reboot uses a launchd or systemd unit bootout-and-bootstrap, never a machine reboot.",
      source:
        "User instruction in this writer thread beginning Hard rule from Ryan, for every Phase 3 seat, effective now",
      runtime_action_by_writer: false,
    },
  },
  {
    id: "T12.05",
    slice: "slice-12",
    action: "split-child",
    parent: "T12.01",
    title:
      "The health-recovery route restarts a stalled service without waiting on operator presence",
    serves: ["NG-128"],
    what: "Delta IA-09 as written: one ship-tool internal step, recover-service, taking host and unit, restarts a stalled service without the presence step, preserves drafts, writes a recovery receipt and reuses the restart-courtesy step; the routine install route keeps its presence step; neither route has a skip flag. No public command is added. recover-service is also the tier-0 ladder the Raspberry Pi watcher and the responder call over the rpi-to-tower ssh identity as twr; for the system units it does not call systemctl and holds no polkit grant: it sends heal <unit> to the supervisor's control socket, and the supervisor, under its own scoped grant (start and restart only for throughline-record.service and throughline-server.service), acts only if its own credential-free probe shows that unit down or unresponsive at that moment and otherwise answers already-healthy; no public command and no new flag; its recovery receipt is copied into the incident ledger.",
    delta_carried: ["IA-09 append on T12.01"],
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/",
        side: "outside-tool",
        action: "edit",
        exists_now: true,
      },
    ],
    interfaces: {},
    signatures: ["recover-service(host, unit) -> recovery receipt"],
    done_when: {
      command: "delta IA-09 failure test, both routes",
      expect: "recovery does not wait; install quit does wait; draft kept; receipt written",
      judge: "non-builder seat",
    },
    depends_on: ["T12.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-05-ryan-never-prioritize-the-operator-at-the-keyboard-over-unsticking-the-system.yaml",
    ],
    rollback: "Remove the internal step.",
    risk: [],
    window_estimate: "small",
    device_cells: [],
    proof_limits: ["none"],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T12.01",
      interfaces: {},
      delta_carried: ["IA-09 append on T12.01"],
      window_estimate: "small",
      proof_limits: "none",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T12.05-red",
        kind: "first-act-red",
        command:
          "delta IA-09 failure test with synthetic continuous input on a disposable rehearsal unit",
        expected_today: "fails: no recover-service step",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T12.06",
    slice: "slice-12",
    action: "split-child",
    parent: "T12.02",
    title: "The no-Tailscale route and the three connection states shown separately",
    serves: ["NG-129", "NG-143"],
    what: "Without Tailscale the preserved route is the Cloudflare tunnel to the tower service (or the replacement Ryan authorizes), reaching the same admission service; connectivity, authentication and permission to execute are three states shown separately; with no tower record there is no new durable execution, cached history is shown stale and drafts stay unsubmitted; no Mac scheduler and no Mac database (K05, D22). The route itself is built by T12.07; this task builds the three-state display and the client behavior over it.",
    files: [
      {
        path: "apps/web/src/throughline/connection-state/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
    ],
    interfaces: {
      consumes: ["I-06"],
    },
    signatures: [
      "Declared cold acceptance interface: row tests notailscale on mac, ios, android => the app reaches the tower with Tailscale off; drafts held when the record is unreachable",
    ],
    done_when: {
      command: "row tests notailscale on mac, ios, android",
      expect:
        "the app reaches the tower with Tailscale off; drafts held when the record is unreachable",
      judge: "non-builder seat",
    },
    depends_on: ["T12.02", "T12.07"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous release; the tunnel unit can be stopped without touching Tailscale.",
    risk: ["Tunnel credential custody (D-CAP-08)."],
    window_estimate: "one window",
    device_cells: ["notailscale@mac", "notailscale@ios", "notailscale@android"],
    proof_limits: ["Android physical cell waits on D-CAP-05."],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T12.02",
      interfaces: {
        consumes: ["I-06"],
      },
      window_estimate: "one window",
      proof_limits: "Android physical cell waits on D-CAP-05.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T12.06-red",
        kind: "first-act-red",
        command:
          "with T12.07's route in place, turn Tailscale off on the Mac and send into a tower thread",
        expected_today: "fails until T12.07 lands (no tower route, A55, A56)",
        measured: true,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T13.02",
    slice: "slice-13",
    action: "split-child",
    parent: "T13.01",
    title: "Every active-target pipeline step resumes from its own effect state",
    serves: ["NG-120", "NG-121"],
    what: "The new Android and five-target install steps carry the K12 fields of the existing step contract (I-07); interrupt each before and after its side effect and before its receipt; resume without a duplicate upload or install. Simulator and device resources are namespaced per run. Does not re-implement the slice-1 contract.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Pipeline.json",
        side: "config",
        action: "edit",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: ["I-07"],
    },
    signatures: [
      "Declared cold acceptance interface: K12 tests 1 and 2 => no duplicate upload or install; compatibility and data-loss implications reported",
    ],
    done_when: {
      command: "K12 tests 1 and 2",
      expect: "no duplicate upload or install; compatibility and data-loss implications reported",
      judge: "non-builder seat",
    },
    depends_on: ["T13.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Previous step definitions.",
    risk: [],
    window_estimate: "one window",
    device_cells: [],
    proof_limits: ["none"],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T13.01",
      interfaces: {
        consumes: ["I-07"],
      },
      window_estimate: "one window",
      proof_limits: "none",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T13.02-red",
        kind: "first-act-red",
        command: "K12 test 1 on the Android and install steps",
        expected_today: "not measured",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T13.03",
    fork_state: [
      {
        ref: "673f1f467c",
        disposition: "keep",
        reason:
          "Retain fork-namespace inspector-free rewind/source-population protections; extend capability pins for the new record path rather than discard existing native-provider safeguards.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "d96649b868",
        disposition: "keep",
        reason:
          "Retain release-custody-compatible artifact declarations and refusal tests; these do not authorize an interim release install.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/packaged-rewind-acceptance-20261009",
        disposition: "keep",
        reason:
          "Keep artifact-only packaged rewind and exact caller/source-population protections; no install/build is needed to preserve these tests.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/release-compatible-inspector-20261009",
        disposition: "keep",
        reason:
          "Keep release-custody-compatible rewind inspector declarations; main already contains the composed 673f/d966 successors.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-13",
    action: "split-child",
    parent: "T13.01",
    title: "A client a release ahead or behind its server still works",
    serves: ["NG-119"],
    what: "K09 test 1: old client against new server and new client against old server: send, reconnect with a stale cursor, repeat rewind, receive a late reply, preserve settings and voice text. Consumes the negotiation interface I-08, owned by the proposed slice-3 task T3.05.",
    files: [
      {
        path: "apps/server/src/throughline/compat-tests/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
    ],
    interfaces: {
      consumes: ["I-08"],
    },
    signatures: [
      "Declared cold acceptance interface: row tests updates on all five devices => every case in K09 test 1 passes both directions",
    ],
    done_when: {
      command: "row tests updates on all five devices",
      expect: "every case in K09 test 1 passes both directions",
      judge: "non-builder seat",
    },
    depends_on: ["T13.01", "T3.05"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback: "Not a code change on its own; refuse the release on failure.",
    risk: [],
    window_estimate: "one window",
    device_cells: ["updates@mac", "updates@twr", "updates@ios", "updates@android"],
    proof_limits: ["Android physical cell waits on D-CAP-05."],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T13.01",
      interfaces: {
        consumes: ["I-08"],
      },
      window_estimate: "one window",
      proof_limits: "Android physical cell waits on D-CAP-05.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T13.03-red",
        kind: "first-act-red",
        command: "the current TestFlight build (one release behind) against the candidate server",
        expected_today: "not measured",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        device_cells: [
          "updates@mac",
          "updates@twr",
          "updates@rpi",
          "updates@ios",
          "updates@android",
        ],
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T13.04",
    fork_state: [
      {
        ref: "643ebb3bfe",
        disposition: "keep",
        reason:
          "Retain explicit embedded release/commit decoding and truthful nulls; reusable client witnesses do not infer checkout identity.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "7453a8305b",
        disposition: "keep",
        reason:
          "Retain public exports for compiled release identity; no repository-home or authoritative-store dependency.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "47065c2a65",
        disposition: "keep",
        reason:
          "Retain full source-commit injection into Expo/web config; a built/installed bundle must still read back the same pin rather than treating config source as installed proof.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/model-types-059-20261009",
        disposition: "revert",
        reason:
          "No model type repair exists on this branch: its only non-main commits are 0.0.57 and 0.0.58 version stamps; exclude them from the active next release and retain them only in the archive.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/observer-http-20261009",
        disposition: "rework",
        reason:
          "Keep observer cache guards, but move waiting to record admission and port the mixed packaging/throughline-ship-source RPi unit checks to the owning ship-tool source/new release contract instead of AF60/0.0.57 constants.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/release-20261009",
        disposition: "keep",
        reason:
          "Keep the missing Expo speech native-permission plugin at c5712ecdd4; most dependency/identity work is already folded into main, so reuse only missing deltas and test the chosen Android speech service.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/ship-fallback-057-af60",
        disposition: "revert",
        reason:
          "This is the 0.0.57 stamp-only fallback branch; remove it from future pipeline carry_branches and preserve it as an abandoned candidate, never merge that version into 0.0.60.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-13",
    action: "split-child",
    parent: "T13.01",
    title:
      "One version from one commit installed on the four active targets; Raspberry Pi deferred",
    serves: ["NG-119", "NG-120", "NG-121", "NG-142"],
    what: "Install the release on the Mac, tower, iPhone and Android phone from one commit; each target reads back the release and commit; one screenshot per upgrade; the cycle cheap enough for agents to iterate. This is one slice release; whole-design acceptance remains ACCEPT-ALL (K10, D21). Concretely: one new pipeline step, five-device-acceptance, in the existing release tool and its existing step contract (I-07, K12), appended after rewind-live-proof as the new final step and run by the close job that outlives the Mac app restart. It reads the expected candidate identity from the run's own {evidence}/source-commit.json (fields release and commit, the 40-character frozen source commit) and refuses before probing if run-binding.json names a different release. Each target then reports its own release and commit through one named readback (acceptance_interface.per_target_readback): the Mac and tower servers answer a new fork-namespace loopback route /.well-known/throughline/release from the build identity file the version-stamp step writes; the iPhone and Android apps report through the hello they send at connect (T3.05), recorded on the tower. Each target leaves one readback receipt and one screenshot; the step compares release and full commit per target, requires the active retained protection steps passed in the same run, and refuses with a named code on any mismatch, missing readback, missing or stale screenshot, or excluded verifier (acceptance_interface.refusals). Final architecture install also consumes T3.07: refuse unless the pinned upstream head is an ancestor of the installed source or every deliberate non-inclusion is source-backed and recorded. A preserve-base foundation release does not satisfy this gate. The existing five-device-acceptance identifier remains a compatibility name, not a five-device obligation: its required target set is the preserved admission snapshot amended only by IC-008. Raspberry Pi rows and rpi-cold-turn remain deferred, never passed.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Pipeline.json",
        side: "config",
        action: "edit",
        exists_now: true,
        note: "Adds step five-device-acceptance {action: five-device-acceptance, platform: all, kind: parity-proof, privilege: none, command: [node, {tool}, five-device-acceptance], requires: [rewind-live-proof, the Android native-device step T13.01 adds], retry_class: idempotent}; appends it to required_steps and sets final_step to it.",
      },
      {
        path: "apps/server/src/throughline/release/http.ts",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
        note: "Route layer for GET /.well-known/throughline/release, built on the existing operatorProfile route pattern in apps/server/src/throughline/operatorProfile/http.ts; answers 503 RELEASE_IDENTITY_UNSTAMPED when the identity file still holds the placeholder.",
      },
      {
        path: "apps/server/src/throughline/release/release-identity.generated.json",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
        note: "Committed placeholder {release: '0.0.0-unstamped', commit: null}; the version-stamp step overwrites it in the release checkout from {evidence}/source-commit.json before build-mac and build-tower; build-rpi remains deferred, so the bundler inlines one identity into every server build.",
      },
      {
        path: "apps/server/src/server.ts",
        side: "upstream-edit",
        action: "edit",
        exists_now: true,
        note: "One added layer entry beside operatorProfileRouteLayer (line 611 at fork commit 47065c2a65); no other change.",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/five-device-acceptance.ts",
        side: "outside-tool",
        action: "add",
        exists_now: false,
        note: "Future owning component implementation/version/payload/test obligation only; not released by this proposal.",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/five-device-acceptance.test.ts",
        side: "outside-tool",
        action: "add",
        exists_now: false,
        note: "Future owning component implementation/version/payload/test obligation only; not released by this proposal.",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/core.ts",
        side: "outside-tool",
        action: "edit",
        exists_now: true,
        note: "Future owning component implementation/version/payload/test obligation only; not released by this proposal.",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/cli.ts",
        side: "outside-tool",
        action: "edit",
        exists_now: true,
        note: "Future owning component implementation/version/payload/test obligation only; not released by this proposal.",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/core.test.ts",
        side: "outside-tool",
        action: "edit",
        exists_now: true,
        note: "Future owning component implementation/version/payload/test obligation only; not released by this proposal.",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/cli-run.test.ts",
        side: "outside-tool",
        action: "edit",
        exists_now: true,
        note: "Future owning component implementation/version/payload/test obligation only; not released by this proposal.",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/runner.test.ts",
        side: "outside-tool",
        action: "edit",
        exists_now: true,
        note: "Future owning component implementation/version/payload/test obligation only; not released by this proposal.",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/runtime-targets.json",
        side: "outside-tool",
        action: "edit",
        exists_now: true,
        note: "Future owning component implementation/version/payload/test obligation only; not released by this proposal.",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/TOOL.md",
        side: "outside-tool",
        action: "edit",
        exists_now: true,
        note: "Future owning component implementation/version/payload/test obligation only; not released by this proposal.",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/package.json",
        side: "outside-tool",
        action: "edit",
        exists_now: true,
        note: "Future owning component implementation/version/payload/test obligation only; not released by this proposal.",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/CHANGELOG.md",
        side: "outside-tool",
        action: "edit",
        exists_now: true,
        note: "Future owning component implementation/version/payload/test obligation only; not released by this proposal.",
      },
    ],
    interfaces: {
      consumes: ["I-07"],
    },
    signatures: [
      "acceptAll(evidence_root) -> ACCEPT-ALL verdict over every done receipt, slice state, ledger acceptance proof and device-cell receipt; a separate entrypoint from five-device-acceptance, run only by a non-builder; a slice release never calls it.",
      "FiveDeviceReleaseAcceptance owned by I-07/K12 through throughline-ship native step five-device-acceptance: exact FiveDeviceAcceptanceInput + owned run/source/attempt/lease context => FiveDeviceAcceptanceResult at {evidence}/T13.04/five-device-acceptance.attempt-{attempt}.json.",
      "export async function fiveDeviceAcceptance(context: OwnedAcceptanceContext, input: FiveDeviceAcceptanceInput, probes: FiveDeviceAcceptanceProbes): Promise<FiveDeviceAcceptanceResult> — context = {run_id, evidence, attempt, lease_path}; input = {candidate: {release, commit} from {evidence}/source-commit.json, install_finished_at per target from that target's install receipt, protected_receipts}; probes = {readback(target) -> {release, commit, captured_at, raw_sha256}, screenshot(target) -> {path, sha256, captured_at, shows} | waiting(reason)}, injectable so the negative fixtures run with no device.",
      "GET /.well-known/throughline/release (fork-namespace route apps/server/src/throughline/release/http.ts, unauthenticated, loopback) -> {schema: 'throughline.release-identity.v1', release, commit} read from release-identity.generated.json, written by the version-stamp step from {evidence}/source-commit.json before any build; the T3.05 hello's server_release and server_commit read the same file.",
      "Installed readbacks and fresh source-bound, independently viewed screenshots for every identity in the immutable admitted version contract after the source-bound IC-008 pause projection must report one effective release and full commit. Verification actors exclude actual build/install/proof-author actors and the verified current build/ship caller resolved by I-07 identity ownership; invocation alone is not classification or exemption.",
      "Per target: readback.release === candidate.release and readback.commit === candidate.commit (40 lowercase hex, whole string), readback and screenshot captured after that target's install receipt finished; otherwise one refusal code from acceptance_interface.refusals per target, all collected, outcome failed (or waiting for the Android screen proof only).",
      "Android app-reported hello proves installed identity only; missing physical screen proof stays not-proven/waiting, never silently passes full active-target release.",
      "Retain testflight-readback and tower-cold-turn as distinct required protections; retain rpi-cold-turn deferred, never passed; a slice release never grants ACCEPT-ALL.",
      "Retained helper receipts bind effective run/source/install effects; version/build-only helper metadata is not same-commit installed proof. passed/waiting/failed map to existing runner outcomes, with waiting/failed non-pass; no new runner state.",
    ],
    done_when: {
      command: "ryan throughline ship <release> --retry-step five-device-acceptance --json",
      expect:
        "owning step outcome passed and hash-bound active-target result receipt; all installed release+commit/readback/screenshot/non-builder/protection comparisons pass; no whole-design acceptance. The receipt lists, for each of mac, twr, ios and android, the readback method, the reported release and commit, the screenshot path and sha256, and outcome passed; refusals is empty; accept_all_granted is false. The four negative fixtures in planned_checks refuse with their named codes. The same-candidate upstream reconciliation gate passes; missing, stale or incomplete proof refuses. Browser-preview cold-capture acceptance from T3.07 must pass for this exact built/installed candidate, with a non-builder failed-before/passing-after screenshot pair; otherwise refuse final install and reopen the same diagnosis.",
      judge: "non-builder seat",
    },
    depends_on: ["T13.01", "T13.02", "T13.03", "T12.01", "T12.04", "T3.05", "T3.07"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback:
      "Rollback snapshot step (Mac app, prior IPA, prior AppImage) already in the pipeline.",
    risk: [],
    window_estimate: "one window",
    device_cells: ["version@mac", "version@twr", "version@ios", "version@android"],
    proof_limits: ["Android physical cell waits on D-CAP-05."],
    detail_state: "detailed",
    annotations: {
      proposal_action: "split-child",
      parent: "T13.01",
      interfaces: {
        consumes: ["I-07"],
      },
      window_estimate: "one window",
      proof_limits: "Android physical cell waits on D-CAP-05.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T13.04-protect",
        kind: "retained-protection",
        command:
          "pipeline steps testflight-readback and tower-cold-turn required; rpi-cold-turn retained as deferred and never counted passed",
        expected_today: "exist (A12)",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T13.04-red",
        kind: "first-act-red",
        command:
          "curl --fail --silent --max-time 10 http://127.0.0.1:3773/.well-known/throughline/release on the Mac",
        expected_today:
          "fails: the route does not exist; every install step today compares only serverVersion from /.well-known/t3/environment and no step reads a commit (throughline-ship src/rpi.ts and src/tower-headless.ts)",
        measured: true,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T13.04-neg-commit",
        kind: "contract-test",
        command:
          "five-device-acceptance.test.ts: probes return the candidate release on all four active targets and a different 40-hex commit on twr",
        expect:
          "outcome failed; refusals contains TARGET_COMMIT_MISMATCH:twr; the other three active targets still recorded",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T13.04-neg-missing",
        kind: "contract-test",
        command:
          "five-device-acceptance.test.ts: the twr readback probe throws (unreachable) and the ios hello query returns no row newer than install-phone",
        expect:
          "outcome failed; refusals contains TARGET_READBACK_MISSING:twr and TARGET_READBACK_MISSING:ios",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T13.04-neg-android-screen",
        kind: "contract-test",
        command:
          "five-device-acceptance.test.ts: android hello matches the candidate; the android screenshot probe returns waiting (no debugging authorization)",
        expect:
          "outcome waiting (non-pass, existing runner state); refusals contains ANDROID_SCREEN_PROOF_WAITING; never passed",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
      {
        id: "T13.04-neg-stale",
        kind: "contract-test",
        command:
          "five-device-acceptance.test.ts: the mac screenshot captured_at is earlier than the install-mac receipt finished_at",
        expect: "outcome failed; refusals contains STALE_PROOF:mac",
        spec_projection: {
          kind: "real-disk",
          expected_today: "measure on first run",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    acceptance_interface: {
      id: "I-07/FiveDeviceReleaseAcceptance",
      owner: "throughline-ship",
      adapter: "five-device-acceptance",
      input_schema: "throughline.five-device-acceptance-input.v1",
      result_schema: "throughline.five-device-release-acceptance.v1",
      receipt: "{evidence}/T13.04/five-device-acceptance.attempt-{attempt}.json",
      runtime_state: "proposed-not-implemented",
      required_targets: ["mac", "twr", "ios", "android"],
      required_targets_source:
        "immutable preserved pre-correction source snapshot and stable version-row digest",
      source_module:
        "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/five-device-acceptance.ts",
      compiled_module:
        "/Users/Admin/core-root/src/tools/throughline-ship/dist/five-device-acceptance.js",
      function_signature:
        "export async function fiveDeviceAcceptance(context: OwnedAcceptanceContext, input: FiveDeviceAcceptanceInput, probes: FiveDeviceAcceptanceProbes): Promise<FiveDeviceAcceptanceResult>",
      invocation_argv: [
        "ryan",
        "throughline",
        "ship",
        "<release>",
        "--retry-step",
        "five-device-acceptance",
        "--json",
      ],
      android_proof_modes: {
        app_reported: "authenticated installed physical-phone hello can prove version/commit only",
        screen_driven:
          "physical screenshot/control proof remains not-proven under current D-CAP-05 limit until actual authorized route",
        full_release:
          "requires both obligations; no Android omission or trace-as-screen substitution",
      },
      required_targets_binding: {
        source_snapshot: {
          path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/packets/Acceptance-Correction-Before-spec.json",
          sha256: "8d67f3b15bf3bf9a4675d65b68ccde9ae6136f0d2c344d265f1807641a7d7b32",
        },
        version_row: {
          key: "version",
          sha256: "42199fd2dbdd80c8803340a84d0308d777b28d282a621a1a60ad46dc984c7909",
          target_ids: ["mac", "twr", "rpi", "ios", "android"],
        },
        rule: "The original snapshot and version-row digest stay byte-preserved; active targets are its required identities minus only the IC-008 removed_targets. Deferred rows stay visible and cannot satisfy acceptance.",
        scope_amendment: {
          instruction: "IC-008",
          source:
            "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/lead-transfer/Ryan-Instruction-Coverage.json",
          source_message_id: "5a024d4c-6a95-4d33-a6b6-77124d0a2471",
          removed_targets: ["rpi"],
          reason:
            "Ryan paused general Raspberry Pi install/execution; archive and watcher/responder exceptions do not require a general release cell.",
          counts_as_passed: false,
        },
      },
      actor_binding: {
        authority: "I-07 and identity ownership, not caller labels",
        excluded_actual_actor_classes: [
          "build",
          "install",
          "proof-author",
          "verified-current-build-ship-caller",
        ],
        exclude_invocation_alone: false,
        read_only_verifier_allowed_only_if_not_excluded: true,
        proof_author_scope:
          "authors of submitted install/readback/capture proofs, not mere author of an independent verification result",
      },
      protected_readbacks: {
        step_ids: ["testflight-readback", "tower-cold-turn"],
        binding_authority: "I-07 effective run/source/install effects",
        require_run_source_install_effects: true,
        helper_metadata_alone_proves_installed_commit: false,
      },
      outcome_mapping: {
        passed: "passed",
        waiting: "waiting",
        failed: "failed",
        non_pass_behavior: "existing runner/PIPELINE_STEP_NOT_PASSED",
        adds_runner_state: false,
      },
      target_bindings: [
        {
          target: "mac",
          readback_target: "mac",
          screenshot_target: "mac",
          role: "both",
        },
        {
          target: "twr",
          readback_target: "twr",
          screenshot_target: "twr",
          role: "execution-host",
        },
        {
          target: "ios",
          readback_target: "ios",
          screenshot_target: "ios",
          role: "control-client",
        },
        {
          target: "android",
          readback_target: "android",
          screenshot_target: "android",
          role: "control-client",
        },
      ],
      pipeline_step: {
        file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Pipeline.json",
        id: "five-device-acceptance",
        placement:
          "after rewind-live-proof; becomes final_step; run by the existing close job after the Mac app restart",
        requires: ["rewind-live-proof", "the Android native-device step that T13.01 adds"],
        k12_fields: {
          operation_id: "five-device-acceptance",
          attempt: "runner attempt number",
          lease: "{evidence}/five-device-acceptance.lease.json (existing runner lease)",
          retry_class:
            "idempotent: every probe is a read; screenshots are recaptured on each attempt",
          input_digests: [
            "sha256 of {evidence}/source-commit.json",
            "sha256 of each protected step receipt",
          ],
        },
        second_pipeline: false,
      },
      candidate_identity: {
        source: "{evidence}/source-commit.json",
        fields: {
          release: "x.y.z, must equal {evidence}/run-binding.json release",
          commit: "40 lowercase hex, the frozen source commit the run built from",
        },
        stamped_into_builds_by:
          "the existing version-stamp step writes apps/server/src/throughline/release/release-identity.generated.json in the release checkout; APP_COMMIT for the web and Expo builds comes from the same field (fork commit 47065c2a65 already carries APP_COMMIT in apps/web/vite.config.ts and apps/mobile/app.config.ts)",
        refuse_before_probing: "CANDIDATE_IDENTITY_INCONSISTENT",
      },
      per_target_readback: [
        {
          target: "mac",
          method: "loopback-route",
          run_on: "Mac",
          command:
            "curl --fail --silent --max-time 10 http://127.0.0.1:3773/.well-known/throughline/release",
          also: "/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/ThroughLine.app/Contents/Info.plist equals release",
          fields: ["release", "commit"],
          readback_receipt: "{evidence}/T13.04/readback-mac.attempt-{attempt}.json",
          screenshot: {
            path: "{evidence}/T13.04/version-mac.png",
            how: "bring ThroughLine forward through System Events only, open Settings, screencapture -x",
            shows: "the installed release on the Settings screen",
          },
        },
        {
          target: "twr",
          method: "loopback-route",
          run_on: "tower, over ssh -o BatchMode=yes twr",
          command:
            "curl --fail --silent --max-time 10 http://127.0.0.1:3773/.well-known/throughline/release",
          fields: ["release", "commit"],
          readback_receipt: "{evidence}/T13.04/readback-twr.attempt-{attempt}.json",
          screenshot: {
            path: "{evidence}/T13.04/version-twr.png",
            how: "Mac ThroughLine Settings, Connections, the twr environment entry, screencapture -x",
            shows: "the tower environment connected after the install",
          },
        },
        {
          target: "ios",
          method: "client-hello-record",
          run_on: "tower, read-only",
          command:
            "read the newest row for platform ios in the hello table T3.05 writes to the tower's state database (opened read-only), received_at after the install-phone receipt finished",
          fields: ["release", "commit", "platform", "received_at"],
          also: "testflight-readback passed in this run for the same marketing version",
          readback_receipt: "{evidence}/T13.04/readback-ios.attempt-{attempt}.json",
          screenshot: {
            path: "{evidence}/T13.04/version-ios.png",
            how: "iPhone Mirroring window on the Mac, the app's Settings screen, screencapture -x",
            shows: "the installed release on the iPhone Settings screen",
          },
        },
        {
          target: "android",
          method: "client-hello-record",
          run_on: "tower, read-only",
          command:
            "read the newest row for platform android in the same hello table, received_at after the Android native-device receipt finished",
          fields: ["release", "commit", "platform", "received_at"],
          readback_receipt: "{evidence}/T13.04/readback-android.attempt-{attempt}.json",
          screenshot: {
            path: "{evidence}/T13.04/version-android.png",
            how: "adb -s <physical serial> exec-out screencap -p of the app's Settings screen",
            shows: "the installed release on the physical Android phone",
            prerequisite:
              "USB or wireless debugging authorized on the physical phone (D-CAP-05); until then this probe returns waiting",
          },
        },
      ],
      comparison: {
        release: "readback.release === candidate.release",
        commit: "readback.commit === candidate.commit, whole 40-character string, no prefix match",
        freshness:
          "readback.captured_at and screenshot.captured_at are later than that target's install receipt finished_at",
        screenshot:
          "file exists, is a PNG, sha256 recorded, viewed by the verifier named in the result",
        protected:
          "testflight-readback and tower-cold-turn each have a passed receipt in this run, bound by receipt path and sha256; rpi-cold-turn remains deferred, not passed",
        all_collected:
          "every target is probed and every refusal recorded; the step never stops at the first refusal",
      },
      refusals: [
        {
          code: "CANDIDATE_IDENTITY_INCONSISTENT",
          when: "source-commit.json is missing, its commit is not 40 lowercase hex, or its release differs from run-binding.json",
          outcome: "failed",
        },
        {
          code: "TARGET_RELEASE_MISMATCH:<target>",
          when: "the target reports a different release",
          outcome: "failed",
        },
        {
          code: "TARGET_COMMIT_MISMATCH:<target>",
          when: "the target reports a different commit, or a null commit",
          outcome: "failed",
        },
        {
          code: "TARGET_READBACK_MISSING:<target>",
          when: "the host is unreachable, the route is absent or answers RELEASE_IDENTITY_UNSTAMPED, a field is missing, or no hello row is newer than the install",
          outcome: "failed",
        },
        {
          code: "TARGET_SCREENSHOT_MISSING:<target>",
          when: "no screenshot file for mac, twr or ios",
          outcome: "failed",
        },
        {
          code: "ANDROID_SCREEN_PROOF_WAITING",
          when: "the Android hello matches but the physical screenshot cannot be taken because debugging is not authorized",
          outcome: "waiting",
        },
        {
          code: "STALE_PROOF:<target>",
          when: "a readback or screenshot was captured before that target's install finished",
          outcome: "failed",
        },
        {
          code: "PROTECTED_READBACK_NOT_PASSED:<step>",
          when: "testflight-readback or tower-cold-turn has no passed receipt in this run",
          outcome: "failed",
        },
        {
          code: "VERIFIER_EXCLUDED",
          when: "the verifying actor is in actor_binding.excluded_actual_actor_classes",
          outcome: "failed",
        },
      ],
      result_fields: [
        "schema",
        "run_id",
        "release",
        "commit",
        "attempt",
        "outcome",
        "targets[{target, method, readback{release, commit, captured_at, raw_sha256, receipt_path}, screenshot{path, sha256, captured_at, shows}, outcome, refusals[]}]",
        "protected_readbacks[{step_id, receipt_path, receipt_sha256, outcome}]",
        "verifier{actor, class}",
        "refusals[]",
        "accept_all_granted: false",
      ],
      deferred_targets: {
        rpi: {
          state: "deferred",
          instruction: "IC-008",
          target_bindings: [
            {
              target: "rpi",
              readback_target: "rpi",
              screenshot_target: "rpi",
              role: "execution-host",
            },
          ],
          per_target_readback: [
            {
              target: "rpi",
              method: "loopback-route",
              run_on: "Raspberry Pi, over ssh -o BatchMode=yes rpi",
              command:
                "curl --fail --silent --max-time 10 http://127.0.0.1:13774/.well-known/throughline/release",
              fields: ["release", "commit"],
              readback_receipt: "{evidence}/T13.04/readback-rpi.attempt-{attempt}.json",
              screenshot: {
                path: "{evidence}/T13.04/version-rpi.png",
                how: "Mac ThroughLine Settings, Connections, the rpi environment entry, screencapture -x",
                shows: "the Raspberry Pi environment connected after the install",
              },
            },
          ],
          protected_steps: ["rpi-cold-turn"],
          counts_as_passed: false,
        },
      },
    },

    command_grammar: "IC-002",

    upstream_reconciliation: {
      owner: "T13.04",
      receipt: "{evidence}/upstream-reconciliation.json",
      same_candidate_required: true,
      gate: "pinned upstream head is an ancestor of the effective installed source OR every non-included incoming change has a deliberate source-backed disposition; no missing rows, unclaimed conflicts or stale candidate receipt",
      seam_ceilings: "unchanged; counts may only fall",
      capability_tests: "all pinned fork capability regressions; all must execute and pass",
      not_all_updates_when_exceptions: true,
      browser_preview: {
        owner: "T3.07",
        required: true,
        receipt: "{evidence}/T3.07/browser-preview-cold-capture.json",
        same_candidate_required: true,
        non_builder_required: true,
        failed_before_and_passing_after_required: true,
        all_source_tests_required: true,
        on_failure: {
          owner: "worker-shotdiag-db00e8d1",
          action:
            "Reopen the same screenshot diagnosis with the same diagnostic seat if upstream does not close any cold test or the required failed-before/passing-after evidence remains missing.",
          before_final_install: true,
          may_accept_failed_test: false,
        },
      },
    },

    deferred_rpi: {
      state: "deferred",
      instruction: "IC-008",
      counts_as_passed: false,
      former_fields: {
        device_cells: [
          "version@mac",
          "version@twr",
          "version@rpi",
          "version@ios",
          "version@android",
        ],
        title:
          "One version from one commit installed on five targets, with a screenshot per host; a slice release, not whole-design acceptance",
        what: "Install the release on the Mac, tower, iPhone and Android phone from one commit; each target reads back the release and commit; one screenshot per upgrade; the cycle cheap enough for agents to iterate. This is one slice release; whole-design acceptance remains ACCEPT-ALL (K10, D21). Concretely: one new pipeline step, five-device-acceptance, in the existing release tool and its existing step contract (I-07, K12), appended after rewind-live-proof as the new final step and run by the close job that outlives the Mac app restart. It reads the expected candidate identity from the run's own {evidence}/source-commit.json (fields release and commit, the 40-character frozen source commit) and refuses before probing if run-binding.json names a different release. Each target then reports its own release and commit through one named readback (acceptance_interface.per_target_readback): the Mac and tower servers answer a new fork-namespace loopback route /.well-known/throughline/release from the build identity file the version-stamp step writes; the iPhone and Android apps report through the hello they send at connect (T3.05), recorded on the tower. Each target leaves one readback receipt and one screenshot; the step compares release and full commit per target, requires the active retained protection steps passed in the same run, and refuses with a named code on any mismatch, missing readback, missing or stale screenshot, or excluded verifier (acceptance_interface.refusals). Final architecture install also consumes T3.07: refuse unless the pinned upstream head is an ancestor of the installed source or every deliberate non-inclusion is source-backed and recorded. A preserve-base foundation release does not satisfy this gate.",
        done_when: {
          command: "ryan throughline ship <release> --retry-step five-device-acceptance --json",
          expect:
            "owning step outcome passed and hash-bound five-target result receipt; all installed release+commit/readback/screenshot/non-builder/protection comparisons pass; no whole-design acceptance. The receipt lists, for each of mac, twr, rpi, ios and android, the readback method, the reported release and commit, the screenshot path and sha256, and outcome passed; refusals is empty; accept_all_granted is false. The four negative fixtures in planned_checks refuse with their named codes. The same-candidate upstream reconciliation gate passes; missing, stale or incomplete proof refuses.",
          judge: "non-builder seat",
        },
        signatures: [
          "acceptAll(evidence_root) -> ACCEPT-ALL verdict over every done receipt, slice state, ledger acceptance proof and device-cell receipt; a separate entrypoint from five-device-acceptance, run only by a non-builder; a slice release never calls it.",
          "FiveDeviceReleaseAcceptance owned by I-07/K12 through throughline-ship native step five-device-acceptance: exact FiveDeviceAcceptanceInput + owned run/source/attempt/lease context => FiveDeviceAcceptanceResult at {evidence}/T13.04/five-device-acceptance.attempt-{attempt}.json.",
          "export async function fiveDeviceAcceptance(context: OwnedAcceptanceContext, input: FiveDeviceAcceptanceInput, probes: FiveDeviceAcceptanceProbes): Promise<FiveDeviceAcceptanceResult> — context = {run_id, evidence, attempt, lease_path}; input = {candidate: {release, commit} from {evidence}/source-commit.json, install_finished_at per target from that target's install receipt, protected_receipts}; probes = {readback(target) -> {release, commit, captured_at, raw_sha256}, screenshot(target) -> {path, sha256, captured_at, shows} | waiting(reason)}, injectable so the negative fixtures run with no device.",
          "GET /.well-known/throughline/release (fork-namespace route apps/server/src/throughline/release/http.ts, unauthenticated, loopback) -> {schema: 'throughline.release-identity.v1', release, commit} read from release-identity.generated.json, written by the version-stamp step from {evidence}/source-commit.json before any build; the T3.05 hello's server_release and server_commit read the same file.",
          "Installed readbacks and fresh source-bound, independently viewed screenshots for every identity in the immutable admitted version contract must report one effective release and full commit. Verification actors exclude actual build/install/proof-author actors and the verified current build/ship caller resolved by I-07 identity ownership; invocation alone is not classification or exemption.",
          "Per target: readback.release === candidate.release and readback.commit === candidate.commit (40 lowercase hex, whole string), readback and screenshot captured after that target's install receipt finished; otherwise one refusal code from acceptance_interface.refusals per target, all collected, outcome failed (or waiting for the Android screen proof only).",
          "Android app-reported hello proves installed identity only; missing physical screen proof stays not-proven/waiting, never silently passes full five-target release.",
          "Retain testflight-readback, tower-cold-turn and rpi-cold-turn as distinct required protections; a slice release never grants ACCEPT-ALL.",
          "Retained helper receipts bind effective run/source/install effects; version/build-only helper metadata is not same-commit installed proof. passed/waiting/failed map to existing runner outcomes, with waiting/failed non-pass; no new runner state.",
        ],
        acceptance_interface: {
          id: "I-07/FiveDeviceReleaseAcceptance",
          owner: "throughline-ship",
          adapter: "five-device-acceptance",
          input_schema: "throughline.five-device-acceptance-input.v1",
          result_schema: "throughline.five-device-release-acceptance.v1",
          receipt: "{evidence}/T13.04/five-device-acceptance.attempt-{attempt}.json",
          runtime_state: "proposed-not-implemented",
          required_targets: ["mac", "twr", "rpi", "ios", "android"],
          required_targets_source:
            "immutable preserved pre-correction source snapshot and stable version-row digest",
          source_module:
            "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/five-device-acceptance.ts",
          compiled_module:
            "/Users/Admin/core-root/src/tools/throughline-ship/dist/five-device-acceptance.js",
          function_signature:
            "export async function fiveDeviceAcceptance(context: OwnedAcceptanceContext, input: FiveDeviceAcceptanceInput, probes: FiveDeviceAcceptanceProbes): Promise<FiveDeviceAcceptanceResult>",
          invocation_argv: [
            "ryan",
            "throughline",
            "ship",
            "<release>",
            "--retry-step",
            "five-device-acceptance",
            "--json",
          ],
          android_proof_modes: {
            app_reported:
              "authenticated installed physical-phone hello can prove version/commit only",
            screen_driven:
              "physical screenshot/control proof remains not-proven under current D-CAP-05 limit until actual authorized route",
            full_release:
              "requires both obligations; no Android omission or trace-as-screen substitution",
          },
          required_targets_binding: {
            source_snapshot: {
              path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/packets/Acceptance-Correction-Before-spec.json",
              sha256: "8d67f3b15bf3bf9a4675d65b68ccde9ae6136f0d2c344d265f1807641a7d7b32",
            },
            version_row: {
              key: "version",
              sha256: "42199fd2dbdd80c8803340a84d0308d777b28d282a621a1a60ad46dc984c7909",
              target_ids: ["mac", "twr", "rpi", "ios", "android"],
            },
            rule: "Snapshot is preserved bytes, never regenerated; stable row digest and identity set remain valid while corrected spec changes.",
          },
          actor_binding: {
            authority: "I-07 and identity ownership, not caller labels",
            excluded_actual_actor_classes: [
              "build",
              "install",
              "proof-author",
              "verified-current-build-ship-caller",
            ],
            exclude_invocation_alone: false,
            read_only_verifier_allowed_only_if_not_excluded: true,
            proof_author_scope:
              "authors of submitted install/readback/capture proofs, not mere author of an independent verification result",
          },
          protected_readbacks: {
            step_ids: ["testflight-readback", "tower-cold-turn", "rpi-cold-turn"],
            binding_authority: "I-07 effective run/source/install effects",
            require_run_source_install_effects: true,
            helper_metadata_alone_proves_installed_commit: false,
          },
          outcome_mapping: {
            passed: "passed",
            waiting: "waiting",
            failed: "failed",
            non_pass_behavior: "existing runner/PIPELINE_STEP_NOT_PASSED",
            adds_runner_state: false,
          },
          target_bindings: [
            {
              target: "mac",
              readback_target: "mac",
              screenshot_target: "mac",
              role: "both",
            },
            {
              target: "twr",
              readback_target: "twr",
              screenshot_target: "twr",
              role: "execution-host",
            },
            {
              target: "rpi",
              readback_target: "rpi",
              screenshot_target: "rpi",
              role: "execution-host",
            },
            {
              target: "ios",
              readback_target: "ios",
              screenshot_target: "ios",
              role: "control-client",
            },
            {
              target: "android",
              readback_target: "android",
              screenshot_target: "android",
              role: "control-client",
            },
          ],
          pipeline_step: {
            file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Pipeline.json",
            id: "five-device-acceptance",
            placement:
              "after rewind-live-proof; becomes final_step; run by the existing close job after the Mac app restart",
            requires: ["rewind-live-proof", "the Android native-device step that T13.01 adds"],
            k12_fields: {
              operation_id: "five-device-acceptance",
              attempt: "runner attempt number",
              lease: "{evidence}/five-device-acceptance.lease.json (existing runner lease)",
              retry_class:
                "idempotent: every probe is a read; screenshots are recaptured on each attempt",
              input_digests: [
                "sha256 of {evidence}/source-commit.json",
                "sha256 of each protected step receipt",
              ],
            },
            second_pipeline: false,
          },
          candidate_identity: {
            source: "{evidence}/source-commit.json",
            fields: {
              release: "x.y.z, must equal {evidence}/run-binding.json release",
              commit: "40 lowercase hex, the frozen source commit the run built from",
            },
            stamped_into_builds_by:
              "the existing version-stamp step writes apps/server/src/throughline/release/release-identity.generated.json in the release checkout; APP_COMMIT for the web and Expo builds comes from the same field (fork commit 47065c2a65 already carries APP_COMMIT in apps/web/vite.config.ts and apps/mobile/app.config.ts)",
            refuse_before_probing: "CANDIDATE_IDENTITY_INCONSISTENT",
          },
          per_target_readback: [
            {
              target: "mac",
              method: "loopback-route",
              run_on: "Mac",
              command:
                "curl --fail --silent --max-time 10 http://127.0.0.1:3773/.well-known/throughline/release",
              also: "/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/ThroughLine.app/Contents/Info.plist equals release",
              fields: ["release", "commit"],
              readback_receipt: "{evidence}/T13.04/readback-mac.attempt-{attempt}.json",
              screenshot: {
                path: "{evidence}/T13.04/version-mac.png",
                how: "bring ThroughLine forward through System Events only, open Settings, screencapture -x",
                shows: "the installed release on the Settings screen",
              },
            },
            {
              target: "twr",
              method: "loopback-route",
              run_on: "tower, over ssh -o BatchMode=yes twr",
              command:
                "curl --fail --silent --max-time 10 http://127.0.0.1:3773/.well-known/throughline/release",
              fields: ["release", "commit"],
              readback_receipt: "{evidence}/T13.04/readback-twr.attempt-{attempt}.json",
              screenshot: {
                path: "{evidence}/T13.04/version-twr.png",
                how: "Mac ThroughLine Settings, Connections, the twr environment entry, screencapture -x",
                shows: "the tower environment connected after the install",
              },
            },
            {
              target: "rpi",
              method: "loopback-route",
              run_on: "Raspberry Pi, over ssh -o BatchMode=yes rpi",
              command:
                "curl --fail --silent --max-time 10 http://127.0.0.1:13774/.well-known/throughline/release",
              fields: ["release", "commit"],
              readback_receipt: "{evidence}/T13.04/readback-rpi.attempt-{attempt}.json",
              screenshot: {
                path: "{evidence}/T13.04/version-rpi.png",
                how: "Mac ThroughLine Settings, Connections, the rpi environment entry, screencapture -x",
                shows: "the Raspberry Pi environment connected after the install",
              },
            },
            {
              target: "ios",
              method: "client-hello-record",
              run_on: "tower, read-only",
              command:
                "read the newest row for platform ios in the hello table T3.05 writes to the tower's state database (opened read-only), received_at after the install-phone receipt finished",
              fields: ["release", "commit", "platform", "received_at"],
              also: "testflight-readback passed in this run for the same marketing version",
              readback_receipt: "{evidence}/T13.04/readback-ios.attempt-{attempt}.json",
              screenshot: {
                path: "{evidence}/T13.04/version-ios.png",
                how: "iPhone Mirroring window on the Mac, the app's Settings screen, screencapture -x",
                shows: "the installed release on the iPhone Settings screen",
              },
            },
            {
              target: "android",
              method: "client-hello-record",
              run_on: "tower, read-only",
              command:
                "read the newest row for platform android in the same hello table, received_at after the Android native-device receipt finished",
              fields: ["release", "commit", "platform", "received_at"],
              readback_receipt: "{evidence}/T13.04/readback-android.attempt-{attempt}.json",
              screenshot: {
                path: "{evidence}/T13.04/version-android.png",
                how: "adb -s <physical serial> exec-out screencap -p of the app's Settings screen",
                shows: "the installed release on the physical Android phone",
                prerequisite:
                  "USB or wireless debugging authorized on the physical phone (D-CAP-05); until then this probe returns waiting",
              },
            },
          ],
          comparison: {
            release: "readback.release === candidate.release",
            commit:
              "readback.commit === candidate.commit, whole 40-character string, no prefix match",
            freshness:
              "readback.captured_at and screenshot.captured_at are later than that target's install receipt finished_at",
            screenshot:
              "file exists, is a PNG, sha256 recorded, viewed by the verifier named in the result",
            protected:
              "testflight-readback, tower-cold-turn and rpi-cold-turn each have a passed receipt in this run, bound by receipt path and sha256",
            all_collected:
              "every target is probed and every refusal recorded; the step never stops at the first refusal",
          },
          refusals: [
            {
              code: "CANDIDATE_IDENTITY_INCONSISTENT",
              when: "source-commit.json is missing, its commit is not 40 lowercase hex, or its release differs from run-binding.json",
              outcome: "failed",
            },
            {
              code: "TARGET_RELEASE_MISMATCH:<target>",
              when: "the target reports a different release",
              outcome: "failed",
            },
            {
              code: "TARGET_COMMIT_MISMATCH:<target>",
              when: "the target reports a different commit, or a null commit",
              outcome: "failed",
            },
            {
              code: "TARGET_READBACK_MISSING:<target>",
              when: "the host is unreachable, the route is absent or answers RELEASE_IDENTITY_UNSTAMPED, a field is missing, or no hello row is newer than the install",
              outcome: "failed",
            },
            {
              code: "TARGET_SCREENSHOT_MISSING:<target>",
              when: "no screenshot file for mac, twr, rpi or ios",
              outcome: "failed",
            },
            {
              code: "ANDROID_SCREEN_PROOF_WAITING",
              when: "the Android hello matches but the physical screenshot cannot be taken because debugging is not authorized",
              outcome: "waiting",
            },
            {
              code: "STALE_PROOF:<target>",
              when: "a readback or screenshot was captured before that target's install finished",
              outcome: "failed",
            },
            {
              code: "PROTECTED_READBACK_NOT_PASSED:<step>",
              when: "testflight-readback, tower-cold-turn or rpi-cold-turn has no passed receipt in this run",
              outcome: "failed",
            },
            {
              code: "VERIFIER_EXCLUDED",
              when: "the verifying actor is in actor_binding.excluded_actual_actor_classes",
              outcome: "failed",
            },
          ],
          result_fields: [
            "schema",
            "run_id",
            "release",
            "commit",
            "attempt",
            "outcome",
            "targets[{target, method, readback{release, commit, captured_at, raw_sha256, receipt_path}, screenshot{path, sha256, captured_at, shows}, outcome, refusals[]}]",
            "protected_readbacks[{step_id, receipt_path, receipt_sha256, outcome}]",
            "verifier{actor, class}",
            "refusals[]",
            "accept_all_granted: false",
          ],
        },
        planned_checks: [
          {
            id: "T13.04-protect",
            kind: "retained-protection",
            command: "pipeline steps testflight-readback, tower-cold-turn and rpi-cold-turn",
            expected_today: "exist (A12)",
            measured: false,
            spec_projection: {
              kind: "real-disk",
              expected_today: "measure on first run",
              file_ready: false,
              note: "add to spec.checks only when the check file exists on disk (spec check X05)",
            },
          },
          {
            id: "T13.04-red",
            kind: "first-act-red",
            command:
              "curl --fail --silent --max-time 10 http://127.0.0.1:3773/.well-known/throughline/release on the Mac",
            expected_today:
              "fails: the route does not exist; every install step today compares only serverVersion from /.well-known/t3/environment and no step reads a commit (throughline-ship src/rpi.ts and src/tower-headless.ts)",
            measured: true,
            spec_projection: {
              kind: "real-disk",
              expected_today: "FAIL",
              file_ready: false,
              note: "add to spec.checks only when the check file exists on disk (spec check X05)",
            },
          },
          {
            id: "T13.04-neg-commit",
            kind: "contract-test",
            command:
              "five-device-acceptance.test.ts: probes return the candidate release on all five targets and a different 40-hex commit on rpi",
            expect:
              "outcome failed; refusals contains TARGET_COMMIT_MISMATCH:rpi; the other four targets still recorded",
            spec_projection: {
              kind: "real-disk",
              expected_today: "measure on first run",
              file_ready: false,
              note: "add to spec.checks only when the check file exists on disk (spec check X05)",
            },
          },
          {
            id: "T13.04-neg-missing",
            kind: "contract-test",
            command:
              "five-device-acceptance.test.ts: the twr readback probe throws (unreachable) and the ios hello query returns no row newer than install-phone",
            expect:
              "outcome failed; refusals contains TARGET_READBACK_MISSING:twr and TARGET_READBACK_MISSING:ios",
            spec_projection: {
              kind: "real-disk",
              expected_today: "measure on first run",
              file_ready: false,
              note: "add to spec.checks only when the check file exists on disk (spec check X05)",
            },
          },
          {
            id: "T13.04-neg-android-screen",
            kind: "contract-test",
            command:
              "five-device-acceptance.test.ts: android hello matches the candidate; the android screenshot probe returns waiting (no debugging authorization)",
            expect:
              "outcome waiting (non-pass, existing runner state); refusals contains ANDROID_SCREEN_PROOF_WAITING; never passed",
            spec_projection: {
              kind: "real-disk",
              expected_today: "measure on first run",
              file_ready: false,
              note: "add to spec.checks only when the check file exists on disk (spec check X05)",
            },
          },
          {
            id: "T13.04-neg-stale",
            kind: "contract-test",
            command:
              "five-device-acceptance.test.ts: the mac screenshot captured_at is earlier than the install-mac receipt finished_at",
            expect: "outcome failed; refusals contains STALE_PROOF:mac",
            spec_projection: {
              kind: "real-disk",
              expected_today: "measure on first run",
              file_ready: false,
              note: "add to spec.checks only when the check file exists on disk (spec check X05)",
            },
          },
        ],
      },
      note: "Historical clauses only; not active commands, tests or execution authority. Current active fields above govern.",
    },
  },
  {
    id: "T12.07",
    slice: "slice-12",
    action: "split-child",
    parent: "T12.02",
    detail_state: "detailed",
    title: "A Cloudflare route to the tower's ThroughLine service, behind Cloudflare Access",
    serves: ["NG-129"],
    what: "Measured Oct 9, 2026 (A55, A56): the only Cloudflare tunnel is the Mac's mbp21-backup (tl-mac and ssh-mac), whose DNS routes were deliberately not created because no Cloudflare Access gate exists, so nothing is reachable; the tower has no cloudflared and no unit. K05 requires the no-Tailscale route to reach the tower's admission service, so the Mac tunnel cannot serve it. In the network-manager component that owns the tunnel record: create a tower tunnel and connector as a twr user unit with run-at-load and restart; create the Cloudflare Access application first and the DNS route second, the order the tunnel record sets; keep every tunnel credential in broker custody, never read by an agent; account and dashboard steps run through Ryan's signed-in browser as agent work.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/network-manager/_meta/cloudflare-backup-tunnel-2026-09-25/Backup-Tunnel-Notes.md",
        side: "outside-tool",
        action: "read",
        exists_now: true,
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/network-manager/",
        side: "outside-tool",
        action: "edit",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: ["I-06"],
    },
    signatures: [
      "Declared cold acceptance interface: unauthenticated request to the tower hostname; then an authenticated client with Tailscale off; then a connector restart in a rehearsal window => unauthenticated request redirected to Access; authenticated client reaches the tower admission service; connector returns by itself",
    ],
    done_when: {
      command:
        "unauthenticated request to the tower hostname; then an authenticated client with Tailscale off; then a connector restart in a rehearsal window",
      expect:
        "unauthenticated request redirected to Access; authenticated client reaches the tower admission service; connector returns by itself",
      judge: "a visible ThroughLine seat that did not build T12.07, medium effort or lower",
    },
    depends_on: ["T12.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-06-ryan-agents-handle-throughline-pairing-and-permissions-themselves.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-03-ryan-durability-is-a-running-watched-layer-not-answers-in-a-readme.yaml",
    ],
    rollback:
      "Stop and remove the tower connector unit, delete the tower tunnel and its DNS route; the Mac tunnel record is untouched.",
    risk: [
      "If Cloudflare Access needs a paid plan for this use, that is a money decision for Ryan, presented with the working alternative: Tailscale stays the only route and the no-Tailscale cells stay unproven.",
      "If installing cloudflared on the tower needs sudo, that is Ryan's tower act under SHAPE-2026-10-04; a binary in twr's own space avoids it.",
    ],
    window_estimate: "one window",
    device_cells: [],
    proof_limits: ["Proves the route only from the clients tested."],
    split_note:
      "carved from the no-Tailscale route originally inside T12.02, the same parent as T12.06",
    annotations: {
      proposal_action: "split-child",
      parent: "T12.02",
      interfaces: {
        consumes: ["I-06"],
      },
      window_estimate: "one window",
      proof_limits: "Proves the route only from the clients tested.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T12.07-red",
        kind: "first-act-red",
        command: "from a client with Tailscale off, request the tower route's hostname",
        expected_today: "fails: no tower tunnel and no DNS route (A55, A56)",
        measured: true,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T3.05",
    fork_state: [
      {
        ref: "c6682e32f6",
        disposition: "rework",
        reason:
          "Keep hello negotiation/tolerant event helpers, but replace the 0.0.0 floor/null server commit policy, consume the record replay cursor, deduplicate client_command_id at admission and add the contracting-migration refusal.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "643ebb3bfe",
        disposition: "keep",
        reason:
          "Retain explicit embedded release/commit decoding and truthful nulls; reusable client witnesses do not infer checkout identity.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "7453a8305b",
        disposition: "keep",
        reason:
          "Retain public exports for compiled release identity; no repository-home or authoritative-store dependency.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "47065c2a65",
        disposition: "keep",
        reason:
          "Retain full source-commit injection into Expo/web config; a built/installed bundle must still read back the same pin rather than treating config source as installed proof.",
        source: "G5-Fork-State.json A.main_commits",
      },
      {
        ref: "upgrade/build-identity-20261009",
        disposition: "keep",
        reason:
          "Retain model observation and release-identity helpers already composed into main; archive the old branch after preservation, do not merge it over the newer main source.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/build-identity-exports-20261009",
        disposition: "keep",
        reason:
          "Retain package exports and identity/model helpers already represented by main 7453/643e/674f; no separate implementation should be reapplied.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/hello-20261009",
        disposition: "rework",
        reason:
          "Keep optional-hello compatibility and trusted-sender transport; add record cursor/dedup and admitted identity context, replacing JSONL ancestry and the old long-lived rail.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/hello-absurd-types-059-20261009",
        disposition: "rework",
        reason:
          "Retain typed Effect/platform fixes and the rpc.test.ts unknown-field decode correction, but port to absurd-sdk exactly 0.5.0 and request workflows; do not import inherited 0.0.57/0.0.58 stamps.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/hello-typecheck-059-20261009",
        disposition: "rework",
        reason:
          "Preserve this composite repair tip and its typed fixtures/unknown-field decoder; extract old-engine settings/sender logic into record/admission modules and omit inherited interim version stamps.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/ident-senderlayer-059-20261009",
        disposition: "rework",
        reason:
          "Preserve composite sender/type/fixture repairs, including the ProjectionPipeline sender fixture fix at the tip; apply them to the new record tests, not an engine-owned SQLite authority.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/recover-typecheck-059-20261009",
        disposition: "keep",
        reason:
          "Keep the faithful git/websocket fixture type repairs at 2cd49588; inherited release stamps are archive-only and must not be copied into the next release.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/release-20261009",
        disposition: "keep",
        reason:
          "Keep the missing Expo speech native-permission plugin at c5712ecdd4; most dependency/identity work is already folded into main, so reuse only missing deltas and test the chosen Android speech service.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
      {
        ref: "upgrade/settings-host-20261009",
        disposition: "rework",
        reason:
          "This broad composite carries useful client/voice/hello code but still records a fixed boolean through old engine activity receipts and JSONL lineage; migrate those owners to record/admission and keep already-folded client protections.",
        source: "G5-Fork-State.json A.unmerged_upgrade_branches",
      },
    ],
    slice: "slice-3",
    action: "foundation-proposal",
    detail_state: "detailed",
    proposed_to:
      "the slices 2-3 preparer and the delivery lead; it sits beside T3.01 and T3.02 and is not a second admission service",
    title:
      "Client and server agree on protocol version and capabilities at connect; an old client degrades or is told to update",
    serves: ["NG-119"],
    what: "At the existing connection handshake (the same apps/server/src/ws.ts that T3.01 already edits, so the count of edited upstream files does not rise), client and server exchange a hello: protocol_version, release, commit, platform, capabilities and last_cursor. The server answers compatible, degraded (a named capability subset) or update-required against min_supported_client. Decoders in a fork-namespace package keep unknown events and fields and ignore them instead of failing. Duplicate client commands are deduplicated by passing client_command_id to the admission point (T3.01), which returns the existing command id. Replay after reconnect uses the K01 projection cursor (T3.02, T3.03). A migration check refuses a contracting database migration while the previous release or the minimum supported client still reads the column (expand-then-contract). The hello is also how an installed phone app witnesses its own release on the physical device (CP-09).",
    files: [
      {
        path: "packages/throughline-protocol/",
        side: "fork-namespace",
        action: "add",
        exists_now: false,
      },
      {
        path: "apps/server/src/ws.ts",
        side: "upstream-edit",
        action: "edit",
        exists_now: true,
      },
    ],
    interfaces: {
      consumes: [
        "I-01 (adds request field client_command_id; a duplicate returns the existing command_id)",
        "I-02",
        "I-03 (projection cursor)",
      ],
      provides: ["I-08"],
    },
    signatures: [
      "hello(client: {protocol_version, release, commit, platform, capabilities[], last_cursor}) -> {outcome: compatible | degraded | update-required, server_release, server_commit, min_supported_client, capabilities[]}",
      "server_release and server_commit are read from apps/server/src/throughline/release/release-identity.generated.json, the same build identity the T13.04 loopback route serves; there is one identity source per build.",
      "recordHello(hello, received_at) appends one row {platform, release, commit, protocol_version, client_label, received_at} to a fork-namespace table in the server's state database; T13.04 reads the newest ios and android rows read-only as the phones' installed-identity readback.",
      "decodeEvent(raw) -> known event | preserved-unknown",
      "checkMigration(migration, readers[]) -> allowed | refused(reason)",
    ],
    done_when: {
      command:
        "K09 test 1 at protocol level: recorded old and new client fixtures against the installed tower server, a duplicate client_command_id, a stale cursor and a contracting migration",
      expect:
        "compatible, degraded and update-required as specified; the duplicate returns the same command id; replay from the cursor; unknown events preserved; the contracting migration refused",
      judge: "a visible ThroughLine seat that did not build T3.05, medium effort or lower",
    },
    depends_on: ["T3.01", "T3.02"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
    ],
    rollback:
      "Previous release; a server without the hello treats every client as compatible, which is today's behavior.",
    risk: [
      "Store review delays keep old phone builds alive for days; min_supported_client is set from the builds actually on the TestFlight and Play tracks.",
    ],
    window_estimate: "one window",
    device_cells: [],
    proof_limits: ["Protocol-level fixtures only; per-device proof is T13.03."],
    annotations: {
      proposal_action: "foundation-proposal",
      interfaces: {
        consumes: [
          "I-01 (adds request field client_command_id; a duplicate returns the existing command_id)",
          "I-02",
          "I-03 (projection cursor)",
        ],
        provides: ["I-08"],
      },
      window_estimate: "one window",
      proof_limits: "Protocol-level fixtures only; per-device proof is T13.03.",
      source_proposal:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-02/capability-spec-preparation/Capability-Task-Amendments.json",
    },
    planned_checks: [
      {
        id: "T3.05-red",
        kind: "first-act-red",
        command:
          "node /Users/Admin/throughline/packages/throughline-protocol/scripts/k09-handshake.mts --host twr --out <evidence>",
        expected_today:
          "fails: no hello exists; an older client receiving a new event type has no defined behavior",
        measured: false,
        spec_projection: {
          kind: "real-disk",
          expected_today: "FAIL",
          file_ready: false,
          note: "add to spec.checks only when the check file exists on disk (spec check X05)",
        },
      },
    ],
    failing_checks: ["PH2-C01"],
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },

    command_grammar: "IC-002",
  },
  {
    id: "T4.04",
    slice: "slice-4",
    title: "Deliver independent notify.push in the existing Raspberry Pi broker",
    serves: ["NG-128", "NG-131"],
    detail_state: "detailed",
    what: "Add the notify.push named adapter/registry entry and broker-held grant through the existing admin-capability-broker lane. The topic/value stays in broker custody; observer receives only a typed receipt. Read current floor/grant/install metadata, never values, and derive any reserved act from current cited authority rather than the old uncited Raspberry Pi operator assignment. Local broker receipt and LAN delivery must require neither the Mac, tower proxy nor tower admission. Until the non-builder phone delivery receipt exists this prerequisite is unaccepted. notify.push carries a priority field (informational or page) and a fixed template per tier; informational lines never contain an act for Ryan; a page contains exactly one act.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/admin-capability-broker/",
        side: "outside-tool",
        action: "edit",
        surface: "authoring",
      },
    ],
    signatures: [
      "Owning component delivery contract; nonprivileged preflight, pinned payload and explicit receipt limits",
      "Non-builder cold consumer receipt with exact host, unit/socket/payload hashes and caller identity",
    ],
    failing_checks: ["PH2-C01"],
    depends_on: ["T4.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    risk: [
      "No credential values or process arguments inspected; no assumed operator assignment; reserve an act only from current cited authority",
    ],
    rollback:
      "Use the owning component’s recorded reversal; restore prior payload/configuration without touching live record data",
    done_when: {
      command:
        "Read the current /Users/Admin/core-root/vault/01_Projects/workbench/infra/admin-capability-broker delivery contract, run every nonprivileged preflight, deliver through its owning lane, then a non-builder executes the real consumer path on the Raspberry Pi with laptop closed and tower/record unavailable",
      expect:
        "A local rpi consumer obtains a broker-local receipt and a real phone push within two measured observer cycles while laptop closed and tower/record unavailable; no credential in observer and no tower transaction.",
      judge: "Named non-builder reviewer at the live deep-audit policy; never the implementer",
    },
    owning_component:
      "/Users/Admin/core-root/vault/01_Projects/workbench/infra/admin-capability-broker",

    command_grammar: "IC-002",
  },
  {
    id: "T4.05",
    slice: "slice-4",
    title: "Deliver the observer user units through absurd-sandbox’s Raspberry Pi lane",
    serves: ["NG-128", "NG-131"],
    detail_state: "detailed",
    what: "Extend the existing absurd-sandbox delivery contract with the Raspberry Pi payload/user-unit target and source-owned installer/templates; reuse the current message-optimizer user-unit pattern. First action reads those owning contracts and declares the lane, then nonprivileged rehearsal as rpi proves hashes, unit ownership, linger and effective timer. No hand-copy across the source/runtime seam, no sudo assumption and no new monitoring platform.",
    files: [
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/runtime-targets.json",
        side: "config",
        action: "edit",
        surface: "authoring",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/linux/",
        side: "outside-tool",
        action: "add",
        surface: "authoring",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/src/env-names.ts",
        side: "outside-tool",
        action: "add",
        surface: "authoring",
        exists_now: false,
        note: "names-only environment helper per the F1 contract, shipped in the same payload as record-watch",
      },
    ],
    signatures: [
      "Owning component delivery contract; nonprivileged preflight, pinned payload and explicit receipt limits",
      "Non-builder cold consumer receipt with exact host, unit/socket/payload hashes and caller identity",
    ],
    failing_checks: ["PH2-C01"],
    depends_on: ["T4.01"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    reviewer: {
      role: "reviewer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    risk: [
      "No credential values or process arguments inspected; no assumed operator assignment; reserve an act only from current cited authority",
    ],
    rollback:
      "Use the owning component’s recorded reversal; restore prior payload/configuration without touching live record data",
    done_when: {
      command:
        "Read the current /Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox delivery contract, run every nonprivileged preflight, deliver through its owning lane, then a non-builder executes the real consumer path on the Raspberry Pi with laptop closed and tower/record unavailable",
      expect:
        "Non-builder as rpi verifies installed payload/unit hashes, effective timer and linger, then a fresh status/heartbeat row through the real observer; missing proof prevents T4.03/T4.02 cutover.",
      judge: "Named non-builder reviewer at the live deep-audit policy; never the implementer",
    },
    owning_component: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox",

    command_grammar: "IC-002",
  },
];

// S4-C01 is a source-contract check, not host acceptance; T4.03's non-builder rehearsal remains mandatory.
CHECKS.push({
  id: "S4-C01",
  slice: "slice-4",
  title: "T4.03 binds actual owners, independent watch prerequisites and safe non-builder probes",
  kind: "structural",
  file: new URL("./check-spec.mts", import.meta.url).pathname,
  expected_today: "PASS",
  command: "node check-spec.mts",
});
CHECKS.push({
  id: "S2-C01",
  kind: "real-disk",
  expected_today: "FAIL",
  title:
    "the seam manifest throughline-seam.json sits at the repository root with schema throughline.seam-manifest.v1, its upstream, fork and merge-base SHAs are real commits, the merge base is the true merge base of the two, and the fork SHA is HEAD or an ancestor of it",
  slice: "slice-2",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts --repo /Users/Admin/throughline --only S2-C01",
});
CHECKS.push({
  id: "S2-C02",
  kind: "real-disk",
  expected_today: "FAIL",
  title:
    "the manifest entries equal the real diff between the merge base and the fork SHA, each with the right class (upstream-edit, upstream-removed, fork-added, fork-namespace), and every upstream edit or removal carries a reason with its source and its imported-private-symbol and schema-assumption lists",
  slice: "slice-2",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts --repo /Users/Admin/throughline --only S2-C02",
});
CHECKS.push({
  id: "S2-C03",
  kind: "real-disk",
  expected_today: "FAIL",
  title:
    "the counts only fall: the manifest counts equal the computed classes, neither the upstream-edit count nor the fork-added-outside-namespace count exceeds its admitted value, and no admitted value rose since the previous committed manifest",
  slice: "slice-2",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts --repo /Users/Admin/throughline --only S2-C03",
});
CHECKS.push({
  id: "S2-C04",
  kind: "real-disk",
  expected_today: "FAIL",
  title:
    "every path changed both upstream and in the fork has one adopt, retain, replace or defer row with a reason, and no conflict rule takes upstream for a path listed in a capability manifest",
  slice: "slice-2",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts --repo /Users/Admin/throughline --only S2-C04",
});
CHECKS.push({
  id: "S2-C05",
  kind: "real-disk",
  expected_today: "FAIL",
  title:
    "the fork namespace is classified and the mount rule is recorded: namespace paths are fork-namespace, every fork-added entry carries planned or kept relocation, every upstream edit carries its mount line count, and the mount-line checker exists",
  slice: "slice-2",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts --repo /Users/Admin/throughline --only S2-C05",
});
CHECKS.push({
  id: "S2-C06",
  kind: "real-disk",
  expected_today: "FAIL",
  title:
    "capability manifests live in the repository under docs/throughline/capabilities, each valid, every listed path present, every pinned case present verbatim in its test file, and a manifest touching apps/mobile pins at least one apps/mobile case",
  slice: "slice-2",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts --repo /Users/Admin/throughline --only S2-C06",
});
CHECKS.push({
  id: "S2-C07",
  kind: "real-disk",
  expected_today: "FAIL",
  title:
    "the ship lane enforces the seam: the pipeline seam file is the checkout's throughline-seam.json, a seam-check step runs check-seam.ts with --repo after upstream-sync and before the first signed build, and every repository capability has a regression step before the first signed build",
  slice: "slice-2",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts --repo /Users/Admin/throughline --only S2-C07",
});
CHECKS.push({
  id: "S2-C08",
  kind: "real-disk",
  expected_today: "FAIL",
  title:
    "the seam decision tree and view exist: seam-side.ts and seam-view.ts are present and docs/throughline/seam-view.html carries the sha256 of the current manifest",
  slice: "slice-2",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts --repo /Users/Admin/throughline --only S2-C08",
});
CHECKS.push({
  id: "S2-C09",
  kind: "real-disk",
  expected_today: "FAIL",
  title:
    "the installed release carries the seam: the vault copy of the installed release names a commit whose tree holds throughline-seam.json and the rewind capability manifest",
  slice: "slice-2",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts --repo /Users/Admin/throughline --only S2-C09",
});
CHECKS.push({
  id: "S2-G01",
  kind: "guard",
  expected_today: "PASS",
  title:
    "guard: every pinned rewind regression case still appears verbatim in its test file, read from the repository copy of the manifest when it exists and from the vault copy otherwise",
  slice: "slice-2",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-2-seam.mts --repo /Users/Admin/throughline --only S2-G01",
});
CHECKS.push({
  id: "S3-C01",
  kind: "structural",
  expected_today: "FAIL",
  title:
    "the turn-admission module exists in the fork namespace: CommandAdmission.ts names exactly thread.turn.start and thread.user-input.respond as turn-effect commands, the six admission routes, and the admission marker",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C01",
});
CHECKS.push({
  id: "S3-C02",
  kind: "structural",
  expected_today: "FAIL",
  title:
    "no server source outside the decider, the admission module and tests builds a turn-effect command literal, a thread.turn.start sent through the unchanged HTTP handler is refused by the mounted admission guard (behavioral test), and the in-process transport builds none",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C02",
});
CHECKS.push({
  id: "S3-C03",
  kind: "structural",
  expected_today: "FAIL",
  title:
    "the engine admission guard is mounted in the orchestration layer composition, so an unadmitted turn-effect command is refused at the engine",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C03",
});
CHECKS.push({
  id: "S3-C04",
  kind: "structural",
  expected_today: "FAIL",
  title:
    "the durable turn rail lives in the admission module with its readiness gate, and the WebSocket server no longer defines its own copy",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C04",
});
CHECKS.push({
  id: "S3-C05",
  kind: "structural",
  expected_today: "FAIL",
  title:
    "comsnet turns go through admission with a stable message id, and a redrive sweep exists for a request marked delivered whose turn was never admitted",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C05",
});
CHECKS.push({
  id: "S3-C06",
  kind: "real-disk",
  expected_today: "FAIL",
  title:
    "history import never manufactures a turn: the session importer writes thread.history.import, not thread.turn.start, and probes the configured server port; the outside resume tool writes no orchestration_events rows directly",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C06",
});
CHECKS.push({
  id: "S3-C07",
  kind: "real-disk",
  expected_today: "FAIL",
  title:
    "Absurd is pinned exactly to 0.5.0 in every package that names it and the lockfile resolves only 0.5.0",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C07",
});
CHECKS.push({
  id: "S3-C08",
  kind: "structural",
  expected_today: "FAIL",
  title:
    "Absurd step bodies derive command and thread ids from the task id and step name; the in-process transport generates none at random",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C08",
});
CHECKS.push({
  id: "S3-C09",
  kind: "structural",
  expected_today: "FAIL",
  title:
    "the record package @throughline/record exists and its migration creates the throughline_record schema with admitted commands, events, effect attempts with an unknown outcome, the outbox, projection cursors, admission decisions and blobs",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C09",
});
CHECKS.push({
  id: "S3-C10",
  kind: "structural",
  expected_today: "FAIL",
  title:
    "the record is mounted as the engine's event store with the record-first transaction client, and the per-message coverage script exists",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C10",
});
CHECKS.push({
  id: "S3-C11",
  kind: "real-disk",
  expected_today: "FAIL",
  title:
    "the installed Mac app carries turn admission: the bundle under /Applications/ThroughLine.app contains the admission marker throughline.admission.v1",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C11",
});
CHECKS.push({
  id: "S3-C12",
  kind: "structural",
  expected_today: "FAIL",
  title:
    "the check-first seam is in place without deciding policy: EffectAdmission.ts exports classifyEffect, admitEffect, TargetPolicySlot, ProtectedScopeSlot, EnforcementMatrix and NoTargetRecordPolicyLive, every decision carries prevented, preventable, violation, enforcement and safeAlternative, a post-tool path records observed-after-execution, and nothing in the admission module reads exploration, mode, skip_gate or a file name to classify an effect",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C12",
});
CHECKS.push({
  id: "S3-G01",
  kind: "guard",
  expected_today: "PASS",
  title:
    "guard: the direct-dispatch arm still excludes thread.turn.start by type, in the WebSocket server or in the admission module after the move",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-G01",
});
CHECKS.push({
  id: "S3-G02",
  kind: "guard",
  expected_today: "PASS",
  title:
    "guard: the comsnet turn keeps its stable command id comsnet:<requestId>, so a retried send dedupes on the command receipt",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-G02",
});
CHECKS.push({
  id: "S3-G03",
  kind: "guard",
  expected_today: "PASS",
  title:
    "guard: the decider still refuses a thread.turn.start whose message id is in the imported-session namespace",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-G03",
});
CHECKS.push({
  id: "S3-G04",
  kind: "guard",
  expected_today: "PASS",
  title: "guard: the engine still deduplicates commands by their command receipt",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-G04",
});
CHECKS.push({
  id: "S3-G05",
  kind: "guard",
  expected_today: "PASS",
  title:
    "guard: the decider emits thread.turn-start-requested only from the thread.turn.start case and nests a turn start only under thread.user-input.respond, so the admission table is complete",
  slice: "slice-3",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts",
  command:
    "node /Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-G05",
});
CHECKS.push({
  id: "PH2-C01",
  slice: "slice-13",
  title:
    "Current combined task contracts, shapes, planned red checks and required device owners are complete; no installed behavior is certified",
  kind: "structural",
  file: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/checks/phase2-contracts.mts",
  expected_today: "PASS",
  command: "node checks/phase2-contracts.mts",
});
export const TASKS: Task[] = [
  ...T1.map((t) => ({
    ...t,
    executor: SOL,
    reviewer: {
      role: "reviewer" as const,
      model_preference: SOL.model_preference,
      effort: "high" as const,
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
  })),
  ...OUTLINE,
];

export const WATCHER_SERVER_REBOOT_DELTA = {
  source_documents: [
    {
      path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-04/Fable-Delta-Watcher-Server-Reboot.json",
      sha256: "a9221f23945007ed9b9f3b64e3a78703d179306de80b03cf4fcd0e9a20d7f785",
    },
    {
      path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-04/Fable-Delta-Watcher-Server-Reboot-R2.json",
      sha256: "c1ea9783ab443e773c4983356344143aac0b8ad1b93bfa377201801026ebe187",
    },
    {
      path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-04/Fable-Delta-Watcher-Server-Reboot-R3.json",
      sha256: "c768daefb1c7312472b6a7a8554e0f348d177eb5ce4d46bd6e95829f10958e6d",
    },
  ],
  source_precedence:
    "R2 overrides R1 only for its named corrections; R1 remaining decisions and evidence clauses stay bound. R3 is identical in content to R2 key r2_amendment_2026_10_10_review_F1_F2_F3 and amends only F1, F2 and F3 of Review-Spec-0.4.20-8c4bf0d8fd; every other R2 clause stands.",
  new_task_ids: ["T4.06", "T4.07", "T12.08", "T12.09"],
  operator_rulings_verbatim: {
    time: "Oct 10, 2026, about 4:00 AM PDT",
    watcher_and_responder:
      "Yes, I want the server to have its own locked account. Yes, I want Raspberry Pi as the watcher but I do not wanna be the responsible party for acting on the notification. I don't want the whole system waiting on me to notice that Raspberry Pi sent me a message or notification and do something about it. I just wanna be a spectator, in the loop, but that's it. Sure, whatever the first option is of launching an agent to fix it, I can be, I guess, option two if the agent can't be reached. I want a first class solution, so I think fable should be tasked with designing for this.",
    reboot:
      "tower currently has a password protected, encrypted hard drive. We have a KVM switch connected to it, but when it reboots, it first requires a password. Right now, I have to type it in manually ... Don't do a reboot, do not reboot tower unless you've gotten hold of me and I've responded and said yes, I'm available, you can do the reboot now. Otherwise it's gonna reboot And be stuck needing a password. If agents don't know this and don't see it coming back online, they'll think something's wrong.",
  },
  scope_note:
    "The Raspberry Pi stays paused for execution and device acceptance (Oct 9 ruling); Ryan's Oct 10 words put exactly two things on it: the watcher (T4.03, T4.04, T4.05 as already in 0.4.16) and the responder this delta adds. Nothing else on the Raspberry Pi is in scope.",
  proof_limits: [
    "the rpi-to-tower ssh identity as twr is inferred from broker-tower-tunnel's description; the T12.08 receipt confirms it by running one read-only command through it",
    "the Raspberry Pi ThroughLine server's wake route is the broker's throughline-wake capability, live-proven earlier for the tower; its Raspberry Pi instance is confirmed in the T12.08 receipt",
    "whether the tower has a TPM is unmeasured; U1's feasibility is conditional",
    "after T4.06 the server and record run under system units, so the T12.05 recover-service ladder must act on system units through a path the responder is allowed (the supervisor account or a polkit grant scoped to those two units for the responder's ssh identity); the writer carries that as T12.05's amendment, and until it lands the responder's tier-0 reach is the user units only",
    "the canary credential proves the LoadCredential path and root-only openability, not the real credential's correctness; correctness is proven by the Mac message completing",
    "the recovery island's non-merge rule is a design statement; its enforcement is the island admitting only the responder thread kind, tested in T12.08's expect",
  ],
  projection_notes: [
    "Host add/edit intents are retained in intended_install_action; action read denotes their explicit verification-only surface.",
    "The R2 single three-state interval replaces the original interval; the obsolete retained-twr-unit sentence is removed per R2 k05_interval_settled.also_delete.",
    "The source author confirmed the verification action projection and single K05 interval; the later R2 amendment withdraws twr polkit and binds conditional supervisor heal.",
  ],
};

TASKS.push(
  ...([
    {
      id: "T4.06",
      slice: "slice-4",
      title:
        "The server and the record move to their own locked service accounts in Phase 4's single sudo batch",
      serves: ["NG-016", "NG-070", "NG-072"],
      detail_state: "detailed",
      what: "as item 2 of the superseded file: two sysusers.d accounts (throughline-server, throughline-record), two system units, re-owned state and data in place, the record credential as a root-owned file loaded by systemd into the server unit's credentials directory beside a fixed-value canary credential, the supervisor control-socket allowlist updated to the server account, the twr user units disabled and kept on disk as rollback; one rehearsal on a copy; one Ryan sudo act shared with T6.01 (batched_with T6.01, a scheduling note, not an edge) T4.03 tests the system unit: the Phase 4 sudo batch also installs throughline-record-rehearsal.service, a root-owned system unit with the identical shape (Restart=always, RestartSec=3) running a throwaway cluster under the throughline-record account on a non-5432 port with no real data, plus one polkit rule granting twr kill, stop and start on exactly that rehearsal unit and nothing else; the non-builder as twr runs systemctl kill -s SIGKILL throughline-record-rehearsal.service and systemctl stop throughline-record-rehearsal.service for the two probes and reads the live throughline-record.service policy with systemctl show -p Restart -p RestartUSec -p NRestarts, never probing it; the rehearsal grant is on a unit holding no record and does not weaken the three-state sentence The batch relocates the TLS certificate and key to /etc/throughline/record-tls/ with root:throughline-record ownership (certificate 0644, key 0640), rewrites ssl_cert_file and ssl_key_file in the relocated postgresql.conf, generates a separate rehearsal key and certificate for throughline-record-rehearsal.service, proves startup and TLS on the rehearsal unit and the rejection of an old-home key path under ProtectHome=yes before the real units start, and removes the old /home/twr/absurd-pg/tls only after that proof; the rollback script restores both paths and lines.",
      files: [
        {
          path: "packages/throughline-launcher/systemd/throughline-server.service, throughline-record.service, throughline-server.conf and throughline-record.conf",
          side: "fork-namespace",
          action: "add",
          exists_now: false,
          surface: "authoring",
        },
        {
          path: "/etc/systemd/system/throughline-server.service",
          side: "host-filesystem",
          action: "read",
          note: "tower, root-owned, Ryan's sudo act; owning source: packages/throughline-launcher/systemd/ (fork-namespace), delivered by the Phase 4 sudo batch; read-only non-builder verification; deployment remains the owning install act",
          exists_now: false,
          surface: "verification",
          intended_install_action: "add",
          host: "twr",
          owner: "root",
          owning_source:
            "packages/throughline-launcher/systemd/ (fork-namespace), delivered by the Phase 4 sudo batch",
        },
        {
          path: "/etc/systemd/system/throughline-record.service",
          side: "host-filesystem",
          action: "read",
          note: "tower, root-owned, Ryan's sudo act; owning source: packages/throughline-launcher/systemd/ (fork-namespace), delivered by the Phase 4 sudo batch; read-only non-builder verification; deployment remains the owning install act",
          exists_now: false,
          surface: "verification",
          intended_install_action: "add",
          host: "twr",
          owner: "root",
          owning_source:
            "packages/throughline-launcher/systemd/ (fork-namespace), delivered by the Phase 4 sudo batch",
        },
        {
          path: "/etc/throughline/credentials/record-role and record-role-canary",
          side: "host-filesystem",
          action: "read",
          note: "tower, root:root 0600; loaded by systemd; never read by a test; owning source: created by the batch script in packages/throughline-launcher/install/ (fork-namespace); the real value is placed by the batch from the twr private file, never by an agent test; read-only non-builder verification; deployment remains the owning install act",
          exists_now: false,
          surface: "verification",
          intended_install_action: "add",
          host: "twr",
          owner: "root",
          owning_source:
            "created by the batch script in packages/throughline-launcher/install/ (fork-namespace); the real value is placed by the batch from the twr private file, never by an agent test",
        },
        {
          path: "/opt/absurd-pg/",
          side: "host-filesystem",
          action: "read",
          note: "tower, root-owned copy of the cluster binaries; owning source: copied by the batch script from /home/twr/absurd-pg/bin; owning source is the batch script; read-only non-builder verification; deployment remains the owning install act",
          exists_now: false,
          surface: "verification",
          intended_install_action: "add",
          host: "twr",
          owner: "root",
          owning_source:
            "copied by the batch script from /home/twr/absurd-pg/bin; owning source is the batch script",
        },
        {
          path: "/srv/agents-runtime-state/absurd-pg/data",
          side: "host-filesystem",
          action: "read",
          note: "tower, moved on the same filesystem and re-owned to throughline-record; owning source: moved by the batch script; owning source is the batch script; data owner throughline-record; read-only non-builder verification; deployment remains the owning install act",
          exists_now: false,
          surface: "verification",
          intended_install_action: "edit",
          host: "twr",
          owner: "throughline-record",
          owning_source:
            "moved by the batch script; owning source is the batch script; data owner throughline-record",
        },
        {
          path: "/home/twr/.config/systemd/user/throughline-server.service and absurd-pg.service",
          side: "host-filesystem",
          action: "read",
          note: "tower, disabled by twr before the batch, kept as rollback; owning source: exists_now true; disabled by twr before the batch; owning source none (legacy, kept as rollback); read-only non-builder verification; deployment remains the owning install act",
          exists_now: true,
          surface: "verification",
          intended_install_action: "edit",
          host: "twr",
          owner: "twr",
          owning_source:
            "exists_now true; disabled by twr before the batch; owning source none (legacy, kept as rollback)",
        },
        {
          path: "packages/throughline-launcher/systemd/throughline-record-rehearsal.service",
          side: "fork-namespace",
          action: "add",
          surface: "authoring",
          exists_now: false,
          note: "Latest R2 phase-scoped probe: identical Restart policy, throwaway cluster under throughline-record, non-5432 port, no real data.",
        },
        {
          path: "packages/throughline-launcher/install/",
          side: "fork-namespace",
          action: "edit",
          surface: "authoring",
          note: "Owning Phase 4 batch installs the root-owned rehearsal system unit and exactly one rehearsal-only polkit rule; no production grant to twr.",
        },
        {
          path: "/etc/systemd/system/throughline-record-rehearsal.service",
          side: "host-filesystem",
          action: "read",
          intended_install_action: "add",
          surface: "verification",
          host: "twr",
          owner: "root",
          exists_now: false,
          owning_source:
            "packages/throughline-launcher/systemd/throughline-record-rehearsal.service",
          note: "Non-builder verifies deployment from the owning Phase 4 batch; not an authoring surface.",
        },
        {
          path: "/etc/polkit-1/rules.d/",
          side: "host-filesystem",
          action: "read",
          intended_install_action: "add",
          surface: "verification",
          host: "twr",
          owner: "root",
          owning_source: "packages/throughline-launcher/install/",
          note: "Verify only the owning batch rule: twr kill/stop/start on throughline-record-rehearsal.service and no production unit. Existing unrelated rules unchanged.",
        },
        {
          path: "/etc/throughline/record-tls/server.crt and server.key",
          side: "host-filesystem",
          action: "read",
          note: "tower; root-owned; key 0640 group throughline-record; created by the batch script from the T4.01 files; never read by any test; surface verification; owning source: packages/throughline-launcher/install/ (fork-namespace), the Phase 4 sudo batch script; read-only non-builder verification; deployment remains the owning install act",
          exists_now: false,
          surface: "verification",
          intended_install_action: "add",
          host: "twr",
          owner: "root",
          owning_source:
            "packages/throughline-launcher/install/ (fork-namespace), the Phase 4 sudo batch script",
        },
        {
          path: "/etc/throughline/record-tls-rehearsal/",
          side: "host-filesystem",
          action: "read",
          note: "tower; freshly generated rehearsal material for throughline-record-rehearsal.service; same ownership shape; owning source: packages/throughline-launcher/install/ (fork-namespace), the Phase 4 sudo batch script; read-only non-builder verification; deployment remains the owning install act",
          exists_now: false,
          surface: "verification",
          intended_install_action: "add",
          host: "twr",
          owner: "root",
          owning_source:
            "packages/throughline-launcher/install/ (fork-namespace), the Phase 4 sudo batch script",
        },
      ],
      depends_on: ["T4.01"],
      batched_with: "T6.01 (same Ryan sudo act; T6.01 depends on this task)",
      executor: {
        role: "implementer",
        model_preference: "gpt-6.1-sol",
        effort: "high",
      },
      done_when: {
        host: "twr after the batch; non-builder as twr; zero credential output on every polarity",
        command:
          "systemctl show throughline-server.service throughline-record.service -p ActiveState -p User -p FragmentPath; ps -u twr -o comm= | grep -cE 'postgres|node'; ls -ldn /srv/agents-runtime-state/throughline /srv/agents-runtime-state/absurd-pg/data; sudo -n -l -U throughline-server 2>&1 | tail -1; test -r /etc/throughline/credentials/record-role; echo READABLE_BY_TWR=$?; ls -ln /etc/throughline/credentials/ (names, owner and mode only); then the canary: root's install also loads a second credential record-role-canary whose value is the fixed non-secret string throughline-canary-v1 through the identical LoadCredential= line; inside the server unit (the server's own diagnostics action) compute sha256 of $CREDENTIALS_DIRECTORY/record-role-canary and report equal or not-equal to the known canary hash, and report that $CREDENTIALS_DIRECTORY/record-role exists and is non-empty by size only; then from the Mac app send one message and watch it complete; then as twr: /opt/absurd-pg/bin/psql -h /tmp -d absurd -c 'select 1'; the non-builder proves (a) the rehearsal unit starts and `openssl s_client -starttls postgres -connect 127.0.0.1:<rehearsal port> </dev/null 2>/dev/null | grep -E '^(subject=|issuer=)'` shows the rehearsal certificate subject, and (b) the negative fixture: the batch script's dry-run mode starts the rehearsal unit once with ssl_key_file pointed at a path under /home/twr and the unit must fail to start with the journal showing the file-not-found or permission error under ProtectHome=yes; that failure is the proof that the old-home dependency is rejected; then the real batch runs; from the Mac: openssl s_client -starttls postgres -connect 100.96.34.116:5432 -servername twr </dev/null 2>/dev/null | grep -E '^(subject=|issuer=)' shows the pinned real certificate subject (public material only) and one Mac message completes; systemctl show throughline-record.service -p ActiveState reads active; ls -ln /etc/throughline/record-tls/ shows root:throughline-record 0750, server.crt 0644, server.key 0640 owned by root with group throughline-record; test -r /etc/throughline/record-tls/server.key as twr prints only its exit status, expected 1",
        expect:
          "both units active with their own User and a FragmentPath under /etc/systemd/system; zero postgres or node processes owned by twr; the state tree owned by throughline-server and the data directory by throughline-record; sudo not allowed; READABLE_BY_TWR=1; the credentials directory listing shows two root-owned 0600 files; the server's diagnostics report canary=equal and record-role present with a non-zero size, and prints no value; the Mac message completes (the real credential worked, proven by consumption, not by reading it); the twr psql attempt is refused; the rehearsal unit serves TLS with the rehearsal subject, the old-home-path dry run fails to start with the ProtectHome or file error in its journal, the real unit serves the pinned subject, the key is unreadable by twr by exit status, and no command printed key bytes",
        never:
          "cat, strings, grep or hexdump of any credential file; sha256 of the real credential (a hash of a low-entropy secret is itself exposure); any Environment= line carrying a value",
      },
      failing_check_first:
        "before the batch, `systemctl show throughline-server.service -p LoadState` on the tower returns not-found and `ps -u twr -o comm=` lists postgres and node (measured state 2026-10-09); that is the red",
      rollback:
        "the rehearsed rollback script from item 2 of the superseded file: disable the system units, move the data directory back under /home/twr/absurd-pg/data and chown twr, chown the state tree back to twr, re-enable the twr user units, remove the root credential files",
      signatures: ["one non-builder receipt per polarity, with the rehearsal receipt first"],
      counterexample_must_fail:
        "after the batch a twr process stops the record unit, opens the record role credential file, or opens the server's state.sqlite; or either unit shows User=root or User=twr; or any test prints a credential value or its hash or a process running as twr causes a healthy record unit to stop or restart through any path, including the supervisor's heal verb while the supervisor's own probe reads the unit healthy. or the real record unit starts with a TLS path under /home, or server.key is readable by any account other than root and the throughline-record group, or any receipt contains key bytes",
      failing_checks: ["PH2-C01"],
      governing_shapes: [
        "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-10-04-ryan-performs-tower-sudo-installs-for-now.yaml",
        "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-19-ryan-admin-holds-secrets-and-serves-capabilities-without-agent-credential-access.yaml",
        "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
        "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
      ],
      risk: [
        "No credential values, hashes of real credentials, or process arguments are read by any test; openability and canary checks only",
        "No tower reboot by any agent; bootout-and-bootstrap only",
        "No new public command; recover-service and the broker's existing capabilities are reused",
      ],
      planned_checks: [
        {
          id: "T4.06-red",
          kind: "first-act-red",
          command:
            "before the batch, `systemctl show throughline-server.service -p LoadState` on the tower returns not-found and `ps -u twr -o comm=` lists postgres and node (measured state 2026-10-09); that is the red",
        },
      ],
      proof_limits: [
        "the canary credential proves the LoadCredential path and root-only openability, not the real credential's correctness; correctness is proven by the Mac message completing",
        "the recovery island's non-merge rule is a design statement; its enforcement is the island admitting only the responder thread kind, tested in T12.08's expect",
      ],
      delta_sources: [
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-04/Fable-Delta-Watcher-Server-Reboot.json",
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-04/Fable-Delta-Watcher-Server-Reboot-R2.json",
      ],
      design_details: {
        decision:
          "Two locked service accounts on the tower, both created in Phase 4's single sudo batch: throughline-server runs the ThroughLine server as a system unit, and throughline-record owns and runs the Absurd Postgres cluster as a system unit. Both are nologin, no password, no sudo, in the same family as access-broker and service-broker; root owns the unit files and the application bundle and does nothing at runtime. The twr user units for both are stopped and disabled by twr before the batch and their state is re-owned, not copied, so no data moves between filesystems. This supersedes the 0.4.16 K05 sentence that retains the twr-owned absurd-pg.service user unit, by Ryan's Oct 10 ruling that privileged or authoritative things run out of service accounts; it also ends the record half of the declared state sole-not-isolated earlier than T6.02, because twr seats can no longer stop or edit the record unit or read its credential once the record is a system unit under its own account; the seat half (seats still run as twr until T6.02) stays declared.",
        alternative_rejected:
          "Give the server its own account but leave the record as the twr user unit (the 0.4.16 text). Rejected because the record is the single execution authority and Ryan's ruling places authority outside the agent account; a twr-owned cluster lets any twr seat stop the authority without privilege. The cost of the record account is one sysusers.d line, one chown of a directory tree that stays where it is, and one unit file, all inside the batch that already exists.",
        accounts_and_units: {
          "throughline-server": {
            unit: "/etc/systemd/system/throughline-server.service, User=throughline-server, Group=throughline-server, Restart=on-failure, RestartSec=5, WantedBy=multi-user.target, StateDirectory=throughline-server, ProtectHome=yes, NoNewPrivileges=yes, LoadCredential=record-role:/etc/throughline/credentials/record-role (root-owned 0600, presented inside the unit's credentials directory only)",
            replaces:
              "/home/twr/.config/systemd/user/throughline-server.service (stopped, disabled, left on disk as rollback for the Phase 6 window)",
          },
          "throughline-record": {
            unit: "/etc/systemd/system/throughline-record.service, User=throughline-record, ExecStart=/opt/absurd-pg/bin/postgres -D /srv/agents-runtime-state/absurd-pg/data, Restart=always, RestartSec=3, WantedBy=multi-user.target, ProtectHome=yes, NoNewPrivileges=yes",
            replaces:
              "/home/twr/.config/systemd/user/absurd-pg.service (stopped, disabled, left on disk as rollback); binaries copied from /home/twr/absurd-pg/bin to /opt/absurd-pg (root-owned, read-only) and the data directory moved on the same filesystem (mv, not copy) to /srv/agents-runtime-state/absurd-pg/data and re-owned to throughline-record; listen_addresses and pg_hba from T4.01 unchanged",
          },
        },
        data_folder_ownership: [
          "/srv/throughline/app: root:root, read-only to everyone (the shipped AppImage payload; outside Tier 1)",
          "/srv/agents-runtime-state/throughline/ (userdata/state.sqlite, logs/, attachments/): throughline-server:throughline-server, mode 0750; re-owned in the batch; twr loses read access, which is intended",
          "/srv/agents-runtime-state/absurd-pg/data: throughline-record:throughline-record, mode 0700",
          "/var/lib/throughline-server (StateDirectory): the server's private state including the TLS client CA copy for the record",
          "/run/throughline/admission/: throughline-server 0755 (replaces the twr placeholder of the earlier delta); /run/throughline/supervisor/control.sock peer allowlist becomes the throughline-server uid",
          "/etc/throughline/credentials/record-role: root:root 0600, read only by systemd into the server unit's credentials directory; never readable by twr, by seats or by the server account directly on disk",
        ],
        every_path_the_server_reads: [
          "/srv/throughline/app (code)",
          "/srv/agents-runtime-state/throughline/ (its state and logs)",
          "/var/lib/throughline-server (StateDirectory)",
          "$CREDENTIALS_DIRECTORY/record-role (the record role credential, loaded by systemd)",
          "the record over TLS at 100.96.34.116:5432 as role throughline_tower (T4.01)",
          "the access broker providers unit at 127.0.0.1:19443 (the broker's allowlist admits the throughline-server account; the tunnel and provider logins stay under access-broker)",
          "/run/throughline/supervisor/control.sock (writes start, stop, relaunch; delta-2 item A)",
          "/run/throughline/registry/ (reads generation entries)",
          "the listening socket on the tailnet address port 3773 and the Tailscale Serve hop on 443/8443 handled by tailscaled",
          "nothing under /home",
        ],
        sudo_batch_steps_phase_4: [
          "before the batch, as twr (no sudo): systemctl --user disable --now throughline-server.service absurd-pg.service; record their states; this is the fence for the batch, and the Mac shows twr offline for its duration (an intentional stop under a declared maintenance window so the Raspberry Pi watcher records and does not respond)",
          "sysusers.d: throughline-server and throughline-record (and the supervisor account from delta-2 item A)",
          "install /opt/absurd-pg (copy of the binaries, root-owned) and the three system units plus the supervisor's units, polkit rule and tmpfiles.d from delta-2",
          "mv /home/twr/absurd-pg/data /srv/agents-runtime-state/absurd-pg/data; chown -R throughline-record; chown -R throughline-server /srv/agents-runtime-state/throughline",
          "install /etc/throughline/credentials/record-role (the role credential moved from the twr user unit's private file; root-owned 0600; the twr copy removed)",
          "systemctl daemon-reload; enable --now throughline-record.service; enable --now throughline-server.service; enable --now throughline-supervisor.service",
          "verify: the non-builder done_when below; then twr's user unit files stay on disk disabled as rollback",
        ],
        rollback:
          "disable the three system units; mv the data directory back under /home/twr/absurd-pg/data and chown twr; chown the state tree back to twr; re-enable the two twr user units; the credential returns to the twr private file; all inside one rehearsed script carried with the batch; rehearsed first on the rehearsal cluster and a copy of the state tree",
        counterexample_must_fail:
          "After the batch, a process running as twr stops the record unit, reads the record role credential, or reads the server's state.sqlite; or the server unit shows User=root or User=twr; or the credential appears in the unit's Environment= or in any file readable by the server account outside its credentials directory. Any of these means the design has failed.",
        tls_material_relocation: {
          decision:
            "TLS material has a state-scoped home. Before T4.06 (state shared-account) it lives where T4.01 put it. The T4.06 batch relocates it in the same sudo act: /etc/throughline/record-tls/ owned root:throughline-record mode 0750; server.crt root:root 0644; server.key root:throughline-record 0640 (Postgres accepts a root-owned key with group read, so the record account reads it and no other account can); the batch script rewrites exactly two lines in the relocated data directory's postgresql.conf, ssl_cert_file and ssl_key_file, to the new paths, and removes the old /home/twr/absurd-pg/tls directory only after the rehearsal below passes. No agent reads the key at any point; the batch script's copy is a root file operation inside Ryan's act, not a read into any output.",
          rollback_in_the_same_batch:
            "the rollback script restores the two configuration lines, moves the TLS files back to /home/twr/absurd-pg/tls with chown twr and mode 0600, and re-enables the twr user unit; rehearsed on the rehearsal cluster before the real batch",
          startup_and_tls_rehearsal_no_secret_reads:
            "the Phase 4 batch also installs throughline-record-rehearsal.service (already in this delta) with a freshly generated rehearsal key and certificate (openssl req -x509 -newkey, run by the batch script as root into /etc/throughline/record-tls-rehearsal/ with the identical ownership and modes); the non-builder proves (a) the rehearsal unit starts and `openssl s_client -starttls postgres -connect 127.0.0.1:<rehearsal port> </dev/null 2>/dev/null | grep -E '^(subject=|issuer=)'` shows the rehearsal certificate subject, and (b) the negative fixture: the batch script's dry-run mode starts the rehearsal unit once with ssl_key_file pointed at a path under /home/twr and the unit must fail to start with the journal showing the file-not-found or permission error under ProtectHome=yes; that failure is the proof that the old-home dependency is rejected; then the real batch runs",
          real_unit_proof_after_the_batch:
            "from the Mac: openssl s_client -starttls postgres -connect 100.96.34.116:5432 -servername twr </dev/null 2>/dev/null | grep -E '^(subject=|issuer=)' shows the pinned real certificate subject (public material only) and one Mac message completes; systemctl show throughline-record.service -p ActiveState reads active; ls -ln /etc/throughline/record-tls/ shows root:throughline-record 0750, server.crt 0644, server.key 0640 owned by root with group throughline-record; test -r /etc/throughline/record-tls/server.key as twr prints only its exit status, expected 1",
        },
      },

      command_grammar: "IC-002",

      rehearsal_contract: {
        owner: "T4.06",
        source_clause:
          "T4.03 tests the system unit: the Phase 4 sudo batch also installs throughline-record-rehearsal.service, a root-owned system unit with the identical shape (Restart=always, RestartSec=3) running a throwaway cluster under the throughline-record account on a non-5432 port with no real data, plus one polkit rule granting twr kill, stop and start on exactly that rehearsal unit and nothing else; the non-builder as twr runs systemctl kill -s SIGKILL throughline-record-rehearsal.service and systemctl stop throughline-record-rehearsal.service for the two probes and reads the live throughline-record.service policy with systemctl show -p Restart -p RestartUSec -p NRestarts, never probing it; the rehearsal grant is on a unit holding no record and does not weaken the three-state sentence",
        unit: {
          name: "throughline-record-rehearsal.service",
          owner: "root",
          runs_as: "throughline-record",
          restart: "always",
          restart_sec: 3,
          port: "not 5432",
          real_data: false,
        },
        grant: {
          principal: "twr",
          unit: "throughline-record-rehearsal.service",
          verbs: ["kill", "stop", "start"],
          production_unit_grants: [],
          scope:
            "throwaway rehearsal unit only; no real data; no grant on throughline-record.service or throughline-server.service",
        },
        owning_sources: [
          "packages/throughline-launcher/systemd/throughline-record-rehearsal.service",
          "packages/throughline-launcher/install/",
        ],
        delivery: "Phase 4 sudo batch, nonprivileged checks first; writer executes nothing",
        proof_limits:
          "The narrow grant exists only for the root-installed throwaway rehearsal unit. Earlier no-system-unit-grant prose applies to production; the latest source clause defines this one test-unit exception.",
      },
    },
    {
      id: "T4.07",
      slice: "slice-4",
      title:
        "The Raspberry Pi provider route for the responder: its own provider broker login under broker-service custody",
      serves: ["NG-128", "NG-131"],
      detail_state: "detailed",
      what: "Enable the Raspberry Pi's installed broker-provider.service with its own provider login held by broker-service (the Aug 19 shape: the broker holds the credential, the responder never sees it), admitted for threads on the Raspberry Pi ThroughLine server (the responder of T12.08 once it lands; the route-probe thread of this task's proof before that); the broker's allowlist names the Raspberry Pi server's account, not a thread kind; the tower tunnel is never on the responder's path. Agents prepare the enable and the login entry mode (the broker's existing root-only enter-key mode); Ryan performs the act on the Raspberry Pi (sudo is his there too). Until this lands, T12.08's responder would have no model when the tower is down; T12.08 depends on this task's receipt.",
      files: [
        {
          path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/admin-capability-broker/",
          side: "outside-tool",
          action: "edit",
          note: "enable broker-provider on the Raspberry Pi through its Linux lane; no new adapter",
          exists_now: false,
          surface: "authoring",
        },
        {
          path: "/etc/systemd/system/broker-provider.service",
          side: "host-filesystem",
          action: "read",
          note: "Raspberry Pi, root-owned; enabled by Ryan's act; owning source: exists_now true (installed, inactive); owning source /Users/Admin/core-root/vault/01_Projects/workbench/infra/admin-capability-broker/linux/ through its Linux lane; enabled by Ryan's act; read-only non-builder verification; deployment remains the owning install act",
          exists_now: true,
          surface: "verification",
          intended_install_action: "edit",
          host: "rpi",
          owner: "root",
          owning_source:
            "exists_now true (installed, inactive); owning source /Users/Admin/core-root/vault/01_Projects/workbench/infra/admin-capability-broker/linux/ through its Linux lane; enabled by Ryan's act",
        },
      ],
      depends_on: ["T4.04", "T4.05"],
      executor: {
        role: "implementer",
        model_preference: "gpt-6.1-sol",
        effort: "high",
      },
      done_when: {
        host: "rpi, fired by a non-builder as the rpi account; the tower's rehearsal ThroughLine server is stopped for the whole proof so the Raspberry Pi to tower provider tunnel is dead; the probe is a route-probe thread on the Raspberry Pi ThroughLine server started through the Raspberry Pi broker's throughline-wake capability, not a responder; no role, no credential and no value of any kind is read or printed",
        command:
          "STEP 1 (start): request the route-probe thread through the broker's throughline-wake capability with the fixed order 'count slowly to twenty then reply with the single word pong'; record the thread id. STEP 2 (while the turn runs; poll the thread's turn state every second and act only while it reads running): CG=$(systemctl --user show throughline-server.service -p ControlGroup --value); for i in 1 2 3; do PIDS=$(tr '\\n' '|' < /sys/fs/cgroup${CG}/cgroup.procs | sed 's/|$//'); [ -n \"$PIDS\" ] || { echo NO_PIDS; exit 1; }; ss -tnpH | grep -E \"pid=(${PIDS}),\" | awk '{print $5}'; sleep 1; done | sort -u > /home/rpi/.local/state/absurd-record-watch/t407-destinations.txt; cat /home/rpi/.local/state/absurd-record-watch/t407-destinations.txt; for P in $(ss -tnpH | grep -E \"pid=(${PIDS}),\" | grep '127.0.0.1:19443' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do node /home/rpi/.local/share/absurd-sandbox/dist/env-names.mjs --pid $P; done. STEP 3 (after the turn completes): node /home/rpi/.local/share/absurd-sandbox/dist/env-names.mjs --unit throughline-server.service --user; find /home/rpi -maxdepth 3 \\( -iname '*credential*' -o -iname '*token*' -o -iname '*.key' \\) -newer /home/rpi/.config/systemd/user/throughline-server.service -print; read the Raspberry Pi broker's receipt ledger row count for the proof window through the broker's count endpoint (counts only, never bodies). STEP 4 (last): settle the probe thread and record that it is settled.",
        expect:
          "STEP 1: a thread id is recorded. STEP 2: the destinations file is non-empty, contains 127.0.0.1:19443, and contains no address beginning 100. and no other tailnet or public address; NO_PIDS, an empty destinations file, or no pid holding a connection to 127.0.0.1:19443 during the window is a FAILED check, never a vacuous pass; every env-names --pid run exits 0 with a SUMMARY line showing forbidden=0. STEP 3: the probe turn has completed with the reply pong while the tower was unreachable; env-names --unit exits 0 with forbidden=0; the find prints no file; the broker ledger shows exactly one request row for the window. STEP 4: the thread is settled. The receipt pastes the destinations file, every env-names name list and SUMMARY line, the find output (expected empty), the ledger count and the thread id; nothing else.",
        never:
          "grep -r or any search for credential-shaped values; printing an environment value, a connection string or a broker file; a shell pipeline that filters the Environment line by text (the helper is the only parser); treating an empty socket list as a pass; using a responder order or the incident ledger; reading any file under the broker's state directory",
      },
      failing_check_first:
        "before the work, systemctl show broker-provider.service -p ActiveState on the Raspberry Pi returns inactive (measured 2026-10-09), and a route-probe thread's one turn with the tower rehearsal server stopped fails for lack of a provider route; that is the red (no responder exists in Phase 4)",
      rollback:
        "disable broker-provider.service on the Raspberry Pi; the login stays in broker custody or is removed by the broker's own mode",
      signatures: [
        "one non-builder receipt with the destination-address list and the broker ledger count",
      ],
      failing_checks: ["PH2-C01"],
      governing_shapes: [
        "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-19-ryan-admin-holds-secrets-and-serves-capabilities-without-agent-credential-access.yaml",
        "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
        "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
      ],
      risk: [
        "No credential values, hashes of real credentials, or process arguments are read by any test; openability and canary checks only",
        "No tower reboot by any agent; bootout-and-bootstrap only",
        "No new public command; recover-service and the broker's existing capabilities are reused",
      ],
      planned_checks: [
        {
          id: "T4.07-red",
          kind: "first-act-red",
          command:
            "before the work, systemctl show broker-provider.service -p ActiveState on the Raspberry Pi returns inactive (measured 2026-10-09), and a route-probe thread's one turn with the tower rehearsal server stopped fails for lack of a provider route; that is the red (no responder exists in Phase 4)",
        },
      ],
      proof_limits: [
        "the canary credential proves the LoadCredential path and root-only openability, not the real credential's correctness; correctness is proven by the Mac message completing",
        "the recovery island's non-merge rule is a design statement; its enforcement is the island admitting only the responder thread kind, tested in T12.08's expect",
      ],
      delta_sources: [
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-04/Fable-Delta-Watcher-Server-Reboot.json",
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-04/Fable-Delta-Watcher-Server-Reboot-R2.json",
      ],
      design_details: {
        where_the_responder_runs:
          "On the Raspberry Pi, as a thread on the Raspberry Pi's ThroughLine server, started through the local broker's throughline-wake capability; never on the Mac (lid may be closed) and never as a tower seat (a tower seat needs the record for admission, which is the thing that is down; K05 forbids durable execution without it). Model access on the Raspberry Pi must not go through the tower: the Raspberry Pi's inactive broker-provider.service is enabled with its own provider login under broker-service custody (new task T4.07, a Ryan act on the Raspberry Pi), and the responder's requests use it; the tower tunnel is never on the responder's path. Until T4.07 lands, the responder is launchable but has no model when the tower is down, and the receipt says so.",
        scope_note:
          "The Raspberry Pi stays paused for execution and device acceptance (Oct 9 ruling); Ryan's Oct 10 words put exactly two things on it: the watcher (T4.03, T4.04, T4.05 as already in 0.4.16) and the responder this delta adds. Nothing else on the Raspberry Pi is in scope.",
        env_names_helper: {
          decision:
            "A source-owned, non-model helper replaces the pipeline: the absurd-sandbox record-watch payload gains a subcommand env-names that reads either `systemctl [--user] show -p Environment <unit>` output or /proc/<pid>/environ, parses every assignment, and emits variable names only, one per line, never a value, never a partial value, never the raw line. Exit 0 when no name is forbidden; exit 2 when any name is forbidden, printing the forbidden names only. Nothing else in any task may inspect an environment.",
          helper_contract: {
            owner:
              "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/src/env-names.ts (Tier 1), shipped inside the record-watch payload through the T4.05 lane; plain TypeScript, node 22, no shell",
            inputs: [
              "--unit <name> [--user]: runs systemctl show -p Environment and parses the single Environment= line",
              "--pid <n>: reads /proc/<pid>/environ as NUL-separated assignments (the helper reads bytes to find the first = in each entry and discards everything after it before any output is formed)",
              "--fixture <file>: parses a file in systemctl Environment= format, for tests only",
            ],
            parse_rules: [
              "the line is Environment= followed by assignments separated by unquoted whitespace",
              'an assignment may be wrapped in double quotes or single quotes as a whole ("NAME=value with spaces") or carry backslash-escaped whitespace (NAME=a\\ b); quotes and escapes are honored so a value containing spaces, quotes, equals signs or newline escapes never splits into a false name',
              "a name is the text before the first unescaped = in the assignment and must match [A-Za-z_][A-Za-z0-9_]*; an assignment with no = or an invalid name is reported as MALFORMED_ASSIGNMENT with its position, never its text",
              "values are never buffered into any output structure; the parser drops value bytes as it passes them",
            ],
            forbidden_name_rule:
              "a name is forbidden when its uppercase form contains any of KEY, TOKEN, SECRET, PASSWORD, PASSWD, CREDENTIAL, PRIVATE, or ends in _PW; the list is a constant in the source; X21 binds this list, the parse rules, the output rule, the seven fixtures and the test rule byte-equal to this contract on every spec version; the T4.07 non-builder receipt takes the forbidden list from the shipped constant and must show it equal to the bound list",
            output:
              "names only, one per line, sorted; then a final line SUMMARY names=<n> forbidden=<k> exit=<0|2>; the helper refuses with exit 3 and prints nothing if asked to print values by any flag",
            fixtures_in_tier_1_tests: [
              {
                name: "positive-plain",
                input: "Environment=SAFE_FLAG=1 PATH=/usr/bin SECOND_FLAG=2",
                expect_names: ["PATH", "SAFE_FLAG", "SECOND_FLAG"],
                expect_exit: 0,
              },
              {
                name: "positive-quoted-and-escaped",
                input: "Environment=\"QUOTED=a b = c\" ESC=x\\ y 'SINGLE=p q' PLAIN=z",
                expect_names: ["ESC", "PLAIN", "QUOTED", "SINGLE"],
                expect_exit: 0,
              },
              {
                name: "negative-forbidden-middle",
                input: "Environment=SAFE_FLAG=1 API_TOKEN=abc SECOND_FLAG=2",
                expect_names: ["API_TOKEN", "SAFE_FLAG", "SECOND_FLAG"],
                expect_forbidden: ["API_TOKEN"],
                expect_exit: 2,
              },
              {
                name: "negative-forbidden-quoted",
                input: 'Environment="DB_PASSWORD=has spaces" OK=1',
                expect_forbidden: ["DB_PASSWORD"],
                expect_exit: 2,
              },
              {
                name: "negative-value-looks-like-name",
                input: 'Environment=OK="API_TOKEN=notaname" FINE=1',
                expect_names: ["FINE", "OK"],
                expect_exit: 0,
                note: "a forbidden word inside a value is not a name and must not be reported",
              },
              { name: "empty", input: "Environment=", expect_names: [], expect_exit: 0 },
              {
                name: "value-leak-guard",
                input: "Environment=SECRET_KEY=leakme",
                expect_stdout_must_not_contain: "leakme",
                expect_exit: 2,
              },
            ],
            test_rule:
              "every fixture is a Tier 1 unit test that asserts the exact stdout bytes; the value-leak-guard fixture asserts the value string is absent from stdout and stderr; X21 asserts the contract text only and reads no payload and no environment; the T4.07 non-builder receipt runs the shipped helper against all seven fixtures and pastes the SUMMARY lines",
          },
        },
        provider_route_proof: {
          decision:
            "T4.07 proves the provider route with a route-probe thread, not a responder. The route probe is a plain thread on the Raspberry Pi ThroughLine server, started by the non-builder through the Raspberry Pi broker's existing throughline-wake capability with the fixed order 'reply with the single word pong', carrying no responder order, no recovery authority, no ssh identity and no access to the incident ledger; it exists only for the duration of the proof. T12.08 owns the responder thread and proves, in Phase 12, that the responder uses the same route; T12.08's receipt cites T4.07's receipt as the route proof and adds the responder integration. No bootstrap of the responder happens in Phase 4.",
          recovery_island_note:
            "the island rule (the Raspberry Pi server admits nothing outside an open incident) is T12.08's and takes effect when T12.08 lands; in Phase 4 the Raspberry Pi server is the paused island running as today, and the route probe is the one bounded thread the T4.07 proof starts on it; the T4.07 receipt records the probe thread id and that it was settled at the end of the proof",
          edges: "T4.07 -> T4.04, T4.05; T12.08 -> T4.03, T4.04, T4.05, T12.05; acyclic",
        },
      },

      command_grammar: "IC-002",
    },
    {
      id: "T12.08",
      slice: "slice-12",
      title:
        "The Raspberry Pi first responder: tier-0 ladder, responder thread on the recovery island, incident ledger, tier-2 page",
      serves: ["NG-128", "NG-131"],
      detail_state: "detailed",
      what: "The watcher's loss handler: opens the incident, runs recover-service over the rpi-to-tower ssh identity as twr (tier 0), on failure asks the Raspberry Pi broker's throughline-wake capability to start a responder thread on the Raspberry Pi ThroughLine server bound to the responder order file (tier 1), enforces one incident per target, responder heartbeat and lease, one successor responder, flap reopen, and the tier-2 page with exactly one act; the responder's allowed and forbidden acts are the authority list in this delta; all steps are in the incident ledger and are appended to the record as events after recovery. the responder thread is admitted only on the recovery island defined by the K05 exception this task owns; the handler refuses to start a responder when no incident is open; after recovery it appends the incident's steps to the tower record as events under the responder identity and marks the incident reconciled On host-unreachable the handler skips tier 0 and tier 1, reads the reboot marker, classifies the state, and sends the item-3 page; it never starts a responder for an unreachable host. The responder's model route is the one T4.07 proved with a route-probe thread; T12.08's receipt cites that receipt and adds the responder-thread integration proof; no responder exists before T12.08.",
      files: [
        {
          path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/src/record-watch.ts",
          side: "outside-tool",
          action: "edit",
          note: "incident handling, tier 0, the wake call, reconciliation",
          exists_now: false,
          surface: "authoring",
        },
        {
          path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/linux/responder-order.md",
          side: "outside-tool",
          action: "add",
          note: "the order file the responder thread is bound to",
          exists_now: false,
          surface: "authoring",
        },
        {
          path: "/home/rpi/.local/state/absurd-record-watch/incidents/",
          side: "host-filesystem",
          action: "read",
          note: "Raspberry Pi, rpi-owned; owning source: created by the shipped record-watch payload from /Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/src/record-watch.ts through the T4.05 lane; read-only non-builder verification; deployment remains the owning install act",
          exists_now: false,
          surface: "verification",
          intended_install_action: "add",
          host: "rpi",
          owner: "rpi",
          owning_source:
            "created by the shipped record-watch payload from /Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/src/record-watch.ts through the T4.05 lane",
        },
      ],
      depends_on: ["T4.03", "T4.04", "T4.05", "T12.05"],
      executor: {
        role: "implementer",
        model_preference: "gpt-6.1-sol",
        effort: "high",
      },
      done_when: {
        host: "rpi and the tower rehearsal cluster; Mac lid closed; non-builder",
        command:
          "the cold test in item 1 of the superseded file, both halves, plus: after the repair half, read the tower record for events under the responder identity for the incident id",
        expect:
          "the repair half and the page half as written there; the tower record carries the incident's steps as events with the incident id after recovery; the island admitted no thread while no incident was open (its thread list for the window shows only the responder) in the repair half, the ledger shows the tier-0 heal request and the supervisor's answer; a second test sends heal throughline-record.service while the record is healthy and expects already-healthy with the unit's ActiveEnterTimestamp unchanged the incident file created by T4.03 for the rehearsal loss is the one T12.08 consumes (same id), its responder field moves from not-installed through tier-0 and tier-1 to closed, and the informational open line is sent after tier 0 is recorded as attempted, so the ordering T4.03 could not promise is proven here",
      },
      failing_check_first:
        "before the work, a confirmed loss on the rehearsal cluster produces a notification and nothing else: no incident file exists under incidents/ (directory absent, measured) and no responder; that is the red",
      rollback: "remove the incident handler; the watcher returns to notification-only",
      signatures: ["two non-builder receipts (repair half, page half) and the reconciliation read"],
      failing_checks: ["PH2-C01"],
      governing_shapes: [
        "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-03-ryan-durability-is-a-running-watched-layer-not-answers-in-a-readme.yaml",
        "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
        "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
        "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      ],
      risk: [
        "No credential values, hashes of real credentials, or process arguments are read by any test; openability and canary checks only",
        "No tower reboot by any agent; bootout-and-bootstrap only",
        "No new public command; recover-service and the broker's existing capabilities are reused",
      ],
      planned_checks: [
        {
          id: "T12.08-red",
          kind: "first-act-red",
          command:
            "before the work, a confirmed loss on the rehearsal cluster produces a notification and nothing else: no incident file exists under incidents/ (directory absent, measured) and no responder; that is the red",
        },
      ],
      proof_limits: [
        "the canary credential proves the LoadCredential path and root-only openability, not the real credential's correctness; correctness is proven by the Mac message completing",
        "the recovery island's non-merge rule is a design statement; its enforcement is the island admitting only the responder thread kind, tested in T12.08's expect",
      ],
      delta_sources: [
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-04/Fable-Delta-Watcher-Server-Reboot.json",
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-04/Fable-Delta-Watcher-Server-Reboot-R2.json",
      ],
      design_details: {
        decision:
          "Three tiers, each recorded in one incident ledger on the Raspberry Pi, and Ryan hears about every tier only as information except the last. Tier 0 is deterministic and needs no model: when the T4.03 watcher confirms a loss (two cycles outside a maintenance window) it opens an incident and runs the existing T12.05 recover-service ladder over the rpi-to-tower ssh identity that broker-tower-tunnel already uses (as twr, no sudo): classify reachability, then start or restart the record unit and the server unit, re-probe, and stop at the first success. Tier 1 is the responder agent: if the ladder fails and the tower host is reachable, the watcher asks the Raspberry Pi broker's throughline-wake capability to start a responder thread on the Raspberry Pi's own ThroughLine server (always on, independent of the tower and the Mac, visible in the Mac and iPhone apps as the rpi environment), bound to a responder order file that names the incident, the allowed acts and the forbidden acts; the responder diagnoses over the same ssh identity as twr, repairs within its authority, records every step to the incident ledger, and on success closes the incident. Tier 2 is Ryan, paged only when the responder cannot be launched (the wake is refused, the Raspberry Pi provider route is down, or the responder lease expires twice), when the responder exhausts its authority, or when the tower host is unreachable (item 3 decides the wording); the page states the exact act. Every incident open and close sends Ryan one low-priority informational line through notify.push (T4.04); he acts on nothing unless a tier-2 page names an act.",
        alternative_rejected:
          "Run the responder as a Codex CLI process on the Raspberry Pi directly from the watcher (systemd-run --user), without the Raspberry Pi ThroughLine server. Rejected because it is headless by Ryan's definition: not visible in his apps, not a thread, not rewindable, and the Aug 6 shape rejects headless real work; the CLI run is kept only as the degraded fallback when the Raspberry Pi server itself is down, with its full transcript written to the incident ledger and mirrored into the record on recovery.",
        where_the_responder_runs:
          "On the Raspberry Pi, as a thread on the Raspberry Pi's ThroughLine server, started through the local broker's throughline-wake capability; never on the Mac (lid may be closed) and never as a tower seat (a tower seat needs the record for admission, which is the thing that is down; K05 forbids durable execution without it). Model access on the Raspberry Pi must not go through the tower: the Raspberry Pi's inactive broker-provider.service is enabled with its own provider login under broker-service custody (new task T4.07, a Ryan act on the Raspberry Pi), and the responder's requests use it; the tower tunnel is never on the responder's path. Until T4.07 lands, the responder is launchable but has no model when the tower is down, and the receipt says so.",
        authority: {
          may: [
            "read tower logs and unit states over ssh as twr",
            "start, restart, unmask twr user units named in the allowlist (absurd-pg.service, throughline-server.service, and after T4.06 request the same for the system units through recover-service)",
            "run the T12.05 recover-service step for a named unit",
            "free space under an allowlist of twr-owned temporary paths (cutover dump folders older than the retention, rehearsal clusters, log rotation), never the record data directory",
            "re-run the record probe and the ThroughLine health read",
            "write to the incident ledger and, once the record is back, append the incident's steps to the record as events under a responder identity",
          ],
          may_not: [
            "reboot the tower or any host, ever, without Ryan's yes in the current conversation (item 3)",
            "use sudo, request root, or touch anything root-owned",
            "stop the live record except as the first half of a restart",
            "drop, move, chown or edit the record's data directory, roles or credentials",
            "change any credential, floor row or broker policy",
            "start a second responder or any other seat",
            "declare the tower healthy from its own say-so: closure requires the watcher's own probe to read reachable for two cycles",
          ],
        },
        second_alert_during_an_active_repair:
          "The incident ledger allows one open incident per watched target. A further loss signal while an incident is open is appended as an observation to that incident (count and time) and starts nothing. The responder writes a heartbeat to the ledger at least every 60 s; if the heartbeat stops for 5 minutes the watcher marks the responder lost and may start exactly one successor responder bound to the same incident; a second lost responder escalates to tier 2. A loss within 10 minutes after an incident closes reopens the same incident (flap), with the reopen count in the page if it reaches tier 2. A declared maintenance window suppresses tiers 0 to 2 and records observations only.",
        what_ryan_receives: {
          informational:
            "one line at incident open ('tower record lost 03:12 PDT; tier 0 running; no action needed'), one line at close ('restored 03:13 PDT by recover-service restart of absurd-pg; no action needed'), low priority, never a request",
          page: "only at tier 2, high priority, exactly one act in plain words, e.g. 'Tower record down since 03:12 PDT; the responder could not be launched (Raspberry Pi provider route down). Act: at the Mac, open a ThroughLine thread on twr and send: run recover-service absurd-pg' or the item-3 unlock wording; the page is repeated once after 30 minutes if the incident is still open and then stops",
        },
        cold_test:
          "Non-builder, Mac lid closed, watcher pointed at the tower rehearsal cluster. As twr: systemctl --user mask absurd-pg-rehearsal.service; systemctl --user stop absurd-pg-rehearsal.service (an intentional stop with no maintenance window, so it counts as a loss; masking makes the tier-0 restart fail). Expect within three watcher cycles: an incident opened on the Raspberry Pi ledger; tier 0 recorded as failed with the masked-unit error; a responder thread visible on the Raspberry Pi environment in the iPhone app; the responder's ledger steps showing the diagnosis 'unit masked', the unmask and start as twr; the rehearsal unit active; the incident closed after two reachable cycles; Ryan's phone shows exactly two low-priority lines and no page. Then the page test: as rpi, mask the Raspberry Pi ThroughLine server's user unit so the wake is refused, repeat the loss; expect a tier-2 page within two cycles naming the one act, and no responder. Both receipts carry the non-builder's id.",
        counterexample_must_fail:
          "If the tier-2 page is sent while a responder is launchable, or two responders run for one incident, or the responder reboots the tower, uses sudo, or touches the record data directory, or an incident closes on the responder's own report without the watcher's two reachable cycles, or Ryan receives a message that asks him to act when the responder succeeded, the design has failed.",
        recovery_island: {
          problem:
            "K05 says no new durable execution anywhere when the tower record is unreachable and exactly one record after cutover; the responder thread runs on the Raspberry Pi's ThroughLine server, which admits that thread against the Raspberry Pi's own local record while the tower record is down",
          decision:
            "A named, bounded exception, owned by T12.08, called the recovery island. The Raspberry Pi ThroughLine server and its local record are not an execution authority for ThroughLine work: they admit nothing for the one record, no user thread, target, message or effect on the tower record is admitted or executed there, and the island's record is never merged into the tower record. The island admits exactly one thread kind, the responder thread, exactly while an incident is open on the Raspberry Pi watcher's ledger, with effects limited to the responder's authority list (restart and unmask of named tower units through recover-service, allowlisted temporary-path cleanup, reads, ledger writes), and its every step is appended to the tower record as events under the responder identity when the record returns, so the authoritative history is complete after recovery. Outside an open incident the Raspberry Pi server admits no thread of any kind under this upgrade (its other uses are paused by the Oct 9 ruling). The island is a watcher-side mechanism, like the Raspberry Pi's own status row and loss log, not a second authority.",
          alternative_rejected:
            "Run the responder with no durable admission at all (a CLI process the watcher spawns, no thread, no record anywhere). Rejected because it is headless real work (the Aug 6 shape), invisible to Ryan who asked to be a spectator in the loop, and because a responder with no durable record of its own steps cannot be reconciled into the tower record afterwards.",
          K05_append_sentence:
            "One bounded exception exists and is owned by T12.08: while an incident is open on the Raspberry Pi watcher's ledger, the Raspberry Pi's own ThroughLine server and its local record form the recovery island, which admits exactly one thread kind, the responder, whose effects are limited to the responder authority list and whose every step is appended to the tower record as events when the record returns; the island admits nothing for the one record, is never merged into it, admits nothing outside an open incident, and is not an execution authority for ThroughLine work; a responder step that needs the tower record is recorded unknown and surfaced, never executed on the island.",
        },
        conditional_heal: {
          finding_accepted:
            "T12.05's append granted the rpi-to-tower ssh identity (which lands as twr) a polkit grant to start, stop and restart throughline-record.service and throughline-server.service; that lets any twr seat stop the record, which the three-state sentence forbids in the record-isolated-seats-shared state",
          decision:
            "Withdraw the polkit grant to the ssh identity entirely; twr holds no grant on any system unit. The heal path runs through the supervisor service account, which already holds the scoped polkit grant for agent units: its grant widens by exactly two units and two verbs, start and restart of throughline-record.service and throughline-server.service, never stop or kill. The supervisor exposes one more verb on its control socket, heal <unit>, accepted from any local peer, and it honors heal only when its own credential-free probe shows the unit inactive, failed or unresponsive at that moment; otherwise it answers already-healthy and does nothing. A twr process can therefore cause nothing the unit's own Restart=always policy would not do, cannot stop the record, and cannot restart a healthy record. The tier-0 ladder (recover-service over the ssh identity as twr) calls heal through the control socket instead of systemctl.",
          alternative_rejected:
            "A dedicated recovery account for the ssh identity with its own scoped grant. Rejected because the Raspberry Pi's existing ssh identity lands as twr and a new account is a new trust arrangement; the conditional heal verb gives the same recovery with no new account and no new authority.",
          replacement_text: {
            "T12.05_what_append":
              "recover-service is also the tier-0 ladder the Raspberry Pi watcher and the responder call over the rpi-to-tower ssh identity as twr; for the system units it does not call systemctl and holds no polkit grant: it sends heal <unit> to the supervisor's control socket, and the supervisor, under its own scoped grant (start and restart only for throughline-record.service and throughline-server.service), acts only if its own credential-free probe shows that unit down or unresponsive at that moment and otherwise answers already-healthy; no public command and no new flag; its recovery receipt is copied into the incident ledger.",
            "T6.01_what_append":
              "The supervisor's polkit grant covers throughline-agent@*.service for start, stop, restart and kill, and additionally throughline-record.service and throughline-server.service for start and restart only; it never covers stop or kill of those two units and no other account holds any grant on them.",
            "T4.06_counterexample_append":
              "or a process running as twr causes a healthy record unit to stop or restart through any path, including the supervisor's heal verb while the supervisor's own probe reads the unit healthy.",
            K05_three_state_sentence:
              "unchanged: no twr seat can stop the record in the record-isolated-seats-shared state; heal cannot stop it and cannot restart it while healthy",
            "T12.08_done_when_append":
              "in the repair half, the ledger shows the tier-0 heal request and the supervisor's answer; a second test sends heal throughline-record.service while the record is healthy and expects already-healthy with the unit's ActiveEnterTimestamp unchanged",
          },
        },
      },

      command_grammar: "IC-002",

      phase_scoped_acceptance:
        "T12.08 is accepted in Phase 12 when the same incident mechanism, on a rehearsal loss, records tier 0 attempted before the informational open line is sent, moves the incident's responder field from not-installed through tier-0 and tier-1 to closed, and the page half passes; the ordering 'tier 0 before notify' is a Phase 12 claim only and appears in no Phase 4 receipt.",
    },
    {
      id: "T12.09",
      slice: "slice-12",
      title:
        "The reboot marker, the two unreachable-tower states, and the recorded unlock proposal",
      serves: ["NG-072", "NG-128"],
      detail_state: "detailed",
      what: "the reboot marker file on the Raspberry Pi written by whoever receives Ryan's yes (time, thread, expected return window); the watcher's classification of host-unreachable into the two states; the two page templates; and the scored unlock proposal below stored beside the spec as a design record, not an install item",
      files: [
        {
          path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/src/record-watch.ts",
          side: "outside-tool",
          action: "edit",
          note: "reboot marker read and the two state classifications",
          exists_now: false,
          surface: "authoring",
        },
        {
          path: "/home/rpi/.local/state/absurd-record-watch/reboot-marker.json",
          side: "host-filesystem",
          action: "read",
          note: "Raspberry Pi, rpi-owned; written by the seat that received Ryan's yes; owning source: created by the shipped record-watch payload from /Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/src/record-watch.ts through the T4.05 lane; read-only non-builder verification; deployment remains the owning install act",
          exists_now: false,
          surface: "verification",
          intended_install_action: "add",
          host: "rpi",
          owner: "rpi",
          owning_source:
            "created by the shipped record-watch payload from /Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox/src/record-watch.ts through the T4.05 lane",
        },
        {
          path: "/Users/Admin/throughline/docs/throughline/next-gen-spec/Unlock-Proposal.json",
          side: "fork-namespace",
          action: "add",
          note: "the scored options from the superseded file, a design record, not an install item",
          exists_now: false,
          surface: "authoring",
        },
      ],
      depends_on: ["T12.08", "T12.01"],
      executor: {
        role: "implementer",
        model_preference: "gpt-6.1-sol",
        effort: "medium",
      },
      done_when: {
        host: "rpi and a rehearsal only; non-builder",
        command:
          "write a reboot marker, then point the watcher at an unroutable tailnet address for one cycle window; then remove the marker and repeat",
        expect:
          "first run: state planned-reboot-waiting-for-unlock, no responder, one page with the KVM act naming the marker's time; second run: state unreachable-unplanned, no responder, one page with the check-power-and-KVM act; the durability view (when present) shows the state names",
      },
      failing_check_first:
        "before the work, pointing the watcher at an unroutable address produces a plain loss (and under T12.08 a responder attempt); no state name and no marker read exist; that is the red",
      rollback:
        "remove the marker read and the two states; host-unreachable falls back to the plain loss handling of T12.08; the proposal file is deleted",
      signatures: ["one non-builder receipt covering both runs"],
      failing_checks: ["PH2-C01"],
      governing_shapes: [
        "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-03-ryan-durability-is-a-running-watched-layer-not-answers-in-a-readme.yaml",
        "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-10-04-ryan-performs-tower-sudo-installs-for-now.yaml",
        "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
      ],
      risk: [
        "No credential values, hashes of real credentials, or process arguments are read by any test; openability and canary checks only",
        "No tower reboot by any agent; bootout-and-bootstrap only",
        "No new public command; recover-service and the broker's existing capabilities are reused",
      ],
      planned_checks: [
        {
          id: "T12.09-red",
          kind: "first-act-red",
          command:
            "before the work, pointing the watcher at an unroutable address produces a plain loss (and under T12.08 a responder attempt); no state name and no marker read exist; that is the red",
        },
      ],
      proof_limits: [
        "the canary credential proves the LoadCredential path and root-only openability, not the real credential's correctness; correctness is proven by the Mac message completing",
        "the recovery island's non-merge rule is a design statement; its enforcement is the island admitting only the responder thread kind, tested in T12.08's expect",
      ],
      delta_sources: [
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-04/Fable-Delta-Watcher-Server-Reboot.json",
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-04/Fable-Delta-Watcher-Server-Reboot-R2.json",
      ],
      design_details: {
        decision:
          "No agent reboots the tower. Every reboot-survival proof on the tower is a bootout-and-bootstrap of the unit (systemctl disable then enable, stop then start, for system units; the user-manager equivalent for user units) fired by a non-builder; a real tower reboot is never part of a test and happens only when Ryan has said, in the current conversation, that he is available, and he is the one at the KVM for the disk password. The watcher, the responder and every health surface classify a tower that is unreachable on the tailnet into two states, both of which stop all repair attempts: planned-reboot-waiting-for-unlock when a reboot marker exists (written on the Raspberry Pi by the seat that received Ryan's yes, with the time and the thread), and unreachable-unplanned otherwise. Neither state is 'broken': the record is on an encrypted disk that is intact and waiting. The tier-2 page for the first state reads 'Tower is waiting for the disk password after the planned reboot at <time>; act: at the KVM, type the disk password'; for the second: 'Tower is unreachable since <time>; no reboot was planned; act: check power and the KVM screen; if it shows the disk password prompt, type it; otherwise reply here'. The responder is not launched for either state. When the tower returns, the watcher closes the incident on two reachable cycles and sends the informational close line.",
        alternative_rejected:
          "Have the responder attempt a remote power cycle or wake-on-LAN when the tower is unreachable. Rejected because a power cycle of an encrypted-disk host produces exactly the stuck state Ryan described, and because it is a reboot without his yes.",
        unlock_proposal_not_for_this_install: {
          intent:
            "Ryan said agents handling the disk unlock was always intended; this records the options with scores (1 to 10, higher is better) so a later task can pick one; nothing here ships in this upgrade",
          options: [
            {
              id: "U1",
              name: "TPM-sealed auto-unlock (systemd-cryptenroll with the tower's TPM, bound to boot-measurement registers, optional PIN)",
              feasibility: "8 if the tower has a TPM 2.0 (unmeasured), 0 otherwise",
              security_fit:
                "6: the disk unlocks for anyone who boots the intact machine; a stolen whole tower boots; mitigated by PCR binding and a PIN, but a PIN brings Ryan back",
              custody_fit_with_the_Aug_19_shape: "7: no passphrase is held by any agent or broker",
              effort: "3 (low)",
              when_it_fails:
                "a firmware update changes the measurements and the prompt returns; the watcher's planned-reboot state covers it",
            },
            {
              id: "U2",
              name: "Network-bound unlock (clevis and tang) with the Raspberry Pi as the tang server on the LAN",
              feasibility:
                "8: initramfs networking on the tower, tang under a locked account on the always-on Raspberry Pi",
              security_fit:
                "8: the tower alone cannot unlock; it needs the Raspberry Pi reachable on the LAN, so a stolen tower stays locked; the Raspberry Pi holds a key, not the passphrase",
              custody_fit_with_the_Aug_19_shape:
                "8: the key lives under a locked service account on the admin side, served to the tower as a capability",
              effort: "5",
              when_it_fails:
                "the Raspberry Pi is down at the same time; the prompt returns and the planned-reboot state covers it; keep the passphrase as the manual fallback",
            },
            {
              id: "U3",
              name: "SSH unlock in the initramfs (dropbear) driven by the Raspberry Pi watcher, passphrase served by the Raspberry Pi broker",
              feasibility: "7",
              security_fit:
                "5: the passphrase itself is handled by software on the Raspberry Pi and typed over the LAN",
              custody_fit_with_the_Aug_19_shape:
                "6: broker custody, but the broker then holds the whole-disk secret",
              effort: "6",
              when_it_fails:
                "the initramfs network is up but the Raspberry Pi route is down; manual fallback",
            },
            {
              id: "U4",
              name: "Keep manual unlock (status quo)",
              feasibility: "10",
              security_fit: "9",
              custody_fit_with_the_Aug_19_shape: "10",
              effort: "0",
              when_it_fails:
                "every unplanned reboot waits for Ryan; the planned-reboot state and page make the wait visible, not mysterious",
            },
          ],
          recommendation:
            "U2 first, with U1 as the alternative if the tower has a TPM and Ryan accepts the stolen-machine trade-off; both leave the manual passphrase as fallback; decided by Ryan in a later task, not here",
        },
      },
      counterexample_must_fail:
        "a responder is started for an unreachable host; a page says the tower is broken or down without the state name; any test receipt on the tower contains a reboot command; a planned reboot proceeds without Ryan's yes recorded in the marker",

      command_grammar: "IC-002",
    },
  ] as Task[]),
);

// ---------- cross-cutting decisions (quotes copied byte-true from the ledger by item id) ----------
export const DECISIONS: Decision[] = [
  {
    id: "D01",
    title: "ThroughLine moves out of the vault into its own repository, as the first slice",
    statement: `The repository lives at ${HOME}; release worktrees live in ${WORKTREES}/<version>; build outputs land in each release worktree's ignored release/ folder; the evidence root keeps records only; the vault receives release-bound copies of the declared documents.`,
    serves: ["NG-122"],
    quote_from: "NG-122",
    fable_call: `Home ${HOME}: a folder names the thing (folder grammar rule 2), sits beside the monorepo the way core-root does, and a fresh agent asked where Ryan's ThroughLine repository goes places it there; ${WORKTREES} follows the existing core-root-worktrees precedent (rule 8, existing names first). The GitHub remote stays ryankschmidt/t3code; renaming it is Fable's own proposal (R02), not an act Ryan reserved or ordered.`,
    alternative: `${MONOREPO}/src/throughline (refused: src/ is deploy output and inside the monorepo's git) or a folder under /Users/Admin/dev (refused: no precedent; core-root is not inside a collection).`,
  },
  {
    id: "D02",
    title: "One release pipeline from main; ad hoc installs impossible",
    statement:
      "Every change reaches any host only through the pipeline cut from main; every version surface agrees or the install is refused; nothing stays on a branch.",
    serves: ["NG-120"],
    quote_from: "NG-120",
  },
  {
    id: "D03",
    title: "One version from one commit on the Mac, the tower, the Raspberry Pi, iOS and Android",
    statement:
      "The done state of the whole design, in Ryan's words; Android rides the pipeline from its first release.",
    serves: ["NG-119"],
    quote_from: "NG-119",
  },
  {
    id: "D04",
    title:
      "Every message, turn, thread, reply and tool call lives on the Absurd substrate; one Postgres on the tower over the tailnet is the record",
    statement:
      "Absurd is the record for every thread; the Mac keeps no Postgres; when the tower is unreachable, work waits or fails visibly.",
    serves: ["NG-003", "NG-016"],
    quote_from: "NG-003",
  },
  {
    id: "D05",
    title: "Every door that starts a turn goes through one admission point",
    statement:
      "The refusal lives inside the engine's dispatch; the HTTP door, the comsnet handler and the importer close.",
    serves: ["NG-007", "NG-112"],
    quote_from: "NG-112",
  },
  {
    id: "D06",
    title:
      "One Linux account per agent on the tower, created with it and removed after; one trusted launcher",
    statement:
      "The fork's task-workspaces units with a dynamic Linux user per agent, started by a root-owned supervisor Ryan installs once; agents keep no sudo.",
    serves: ["NG-062", "NG-197", "NG-070"],
    quote_from: "NG-062",
  },
  {
    id: "D07",
    title:
      "ComsNet socket messaging is Ryan's fork of coms.ts; agents reach it by a mod, a CLI and the Pi extension, never an injected MCP toolkit",
    statement:
      "The socket carries the message, Absurd owns its outcome; the HTTP-and-SSE hub is the cross-device candidate to explore.",
    serves: ["NG-017", "NG-028", "NG-195"],
    quote_from: "NG-028",
  },
  {
    id: "D08",
    title:
      "Replies arrive by an Absurd event or a socket push, never by polling; no agent-facing watcher",
    statement:
      "A waiting agent is a wait row the reply's event resumes; Agent Instruments folds as waits, thread columns and app subscriptions.",
    serves: ["NG-013", "NG-111", "NG-014"],
    quote_from: "NG-111",
  },
  {
    id: "D09",
    title: "Compaction comes back on after the install, controlled by a mod",
    statement:
      "The summary may become a re-entry built from the Absurd record; the Opus seat's lite-lifecycle design folds into this task.",
    serves: ["NG-196"],
    quote_from: "NG-196",
  },
  {
    id: "D10",
    title: "Model preferences, never roles hardened into software",
    statement:
      "Opus 5.5 at high or extra high leads; Sol at high and Opus at medium implement; Astra reviews; names move only through ryan model roll.",
    serves: ["NG-041", "NG-034"],
    quote_from: "NG-041",
  },
  {
    id: "D11",
    title:
      "Rewind to the first turn, as many times as Ryan likes, on every device, in the same session",
    statement:
      "Rewind never deletes history; it is conversation-only, Ryan's context tool; the Sep 1 shape statement that said ThroughLine needs no rewind is superseded.",
    serves: ["NG-094", "NG-096", "NG-098"],
    quote_from: "NG-094",
  },
  {
    id: "D12",
    title:
      "The target is the centerpiece; JEV answers before a target is saved; a target's first act is a failing check; finished is computed",
    statement:
      "A thread's work record is durable before any target; the first message is the candidate; JEV classifies; code admits (K08). The promotion threshold starts at 0.80 as an unevaluated parameter and governs only after the calibration test in K07; a JEV answer never admits, closes or releases anything. Acceptance belongs to a named non-builder seat, never Ryan by default (K08).",
    serves: ["NG-073", "NG-077", "NG-138", "NG-139"],
    quote_from: "NG-077",
    fable_call:
      "JEV threshold 0.80 is an initial parameter Fable set, not Ryan, not validated; it is replaced by the value the K07 calibration test records; its rollback is one constant.",
  },
  {
    id: "D13",
    title:
      "The seam: one fork namespace, a committed manifest, an edited-upstream count that only falls, a sync that never overwrites a feature",
    statement:
      "Measured Oct 7, 2026: 243 upstream commits since the Sep 27 merge-base, about 210 fork-edited stock files, no manifest or count check in the repository.",
    serves: ["NG-123", "NG-124", "NG-125"],
    quote_from: "NG-124",
  },
  {
    id: "D14",
    title: "Commands and folders follow the two grammar standards",
    statement:
      "Noun then verb; the act's family owns the item; no dots or dashes in typed words; folders name a thing, lowercase, singular, inside their collection. The installed ryan throughline ship reads ryan ship throughline under the grammar; its rename is Ryan's decision and is carried below, never done first.",
    serves: ["NG-127"],
    quote_from: "NG-127",
  },
  {
    id: "D15",
    title:
      "Phase one builds only the launcher-and-account seam ThroughLine's identity needs on the tower",
    statement: "Moving skills, hooks and files from the Mac to the tower stays outside phase one.",
    serves: ["NG-116", "NG-117"],
    quote_from: "NG-116",
  },
  {
    id: "D16",
    title: "Voice-to-text through Message Optimizer on every device and in the composer",
    statement: "In the desktop app on Mac and Linux and on the phone.",
    serves: ["NG-108"],
    quote_from: "NG-108",
  },
  {
    id: "D17",
    title: "Stock Absurd, pinned, with our runtime package; no fork of Absurd",
    statement:
      "ThroughLine runs absurd-sdk 0.4.0 today; the lab ran Absurd 0.5.0. The design pins 0.5.0 for the substrate slice, because its durable event waits are what K02 relies on; the 0.4.0 to 0.5.0 migration is a named task in slice 3 with its own test, never implied.",
    serves: ["NG-006"],
    fable_call:
      "Fable decided; no Ryan quote exists for this item. Amended Oct 8, 2026 to name the version (K02).",
  },
  {
    id: "D18",
    title: "The server never stages a project's whole tree",
    statement:
      "Commit preparation with no file list reads the working tree and never writes the index; with a file list it stages exactly those paths.",
    serves: ["NG-199"],
    fable_call:
      "Fable decided; the ledger item stands approved-by-silence with no Ryan quote. Basis: the agent measurement of Sep 1, 2026 that the server staged the whole monorepo every few seconds, and the add-all arm at GitVcsDriverCore.ts line 2050 read on Oct 7, 2026. The fork already protects the monorepo by a protected-root guard; the moved repository is not protected, so the arm itself is removed.",
  },
  {
    id: "D19",
    title: "The vault reaches the repository by release-bound copies, not links",
    statement: `Measured Oct 7, 2026 on this Mac: the vault's link router answers 403 for a file reached through a symlink and 200 for a plain vault file, so "link" cannot be a symlink. The publish-docs step copies the declared set with generated frontmatter at every release into ${VAULT_COPY}.`,
    serves: ["NG-122"],
    fable_call:
      'Fable decided from the measurement; Ryan\'s word was "link", his meaning "accessible". The copies land under the component\'s references folder, which the folder grammar reserves for inputs a project reads, so no new kind word is added; the folder\'s README is generated by the step, so it never collides with the copied repository README under tree/.',
    alternative:
      "Teach the link router an allowlist of symlinks (a change to the vlink tool, outside this design) and keep symlinks in the vault, which Obsidian would also index.",
  },
  {
    id: "D20",
    title: "The first slice ends with one release from the new home",
    statement:
      "The repository move is proven by release 0.0.60 through the re-pointed pipeline, installed on every host, with the vault copies bound to its frozen commit and the staging fix measured on the installed server; no slice closes on configuration alone. Later IC-008 limits the active set to Mac, tower, iOS and then Android; Raspberry Pi general rollout is deferred, not passed. Archive and watcher/responder exceptions remain.",
    serves: ["NG-120", "NG-119"],
    quote_from: "NG-120",
  },
  {
    id: "D21",
    title:
      "Whole-design acceptance is a separate node over every required disposition; no numbered task is the done state",
    statement:
      "Each slice ships as its own release through the pipeline. The design is accepted only by the acceptance node ACCEPT-ALL, a conjunction over every detailed task's done check, every slice, every implemented ledger disposition's acceptance and every required device cell's cold test (K10). The checker tests the combined task, slice and precondition graph.",
    serves: ["NG-119", "NG-120", "NG-139"],
    fable_call:
      "Fable's mechanism for Ryan's done state (D03, D20); answers fidelity finding F08 and architecture addendum A15.",
  },
  {
    id: "D22",
    title:
      "Cross-device messaging on every device role is required; only the transport is a choice",
    statement:
      "Ryan's and every agent's messages reach every device role as ComsNet messages on the rail. The pairing transport is the adapter to the one admission service; the HTTP-and-SSE hub is adopted only for a transport function pairing lacks; the Cloudflare tunnel to the tower service is the preserved no-Tailscale route; nothing creates a second execution authority (K05).",
    serves: ["NG-018", "NG-025", "NG-129", "NG-143", "NG-195"],
    quote_from: "NG-018",
  },
  {
    id: "D23",
    title:
      "Durable work before a target, admission by code after JEV, acceptance by a named non-builder",
    statement:
      "A thread's work record exists from its first message in the state exploring; a target is admitted by code after JEV answers; building and marking done wait for the failing check, launching, designing, dispatching and exploring do not; acceptance is a named seat that did not build the work, never Ryan by default (K08).",
    serves: ["NG-074", "NG-076", "NG-081", "NG-082", "NG-138", "NG-139"],
    fable_call:
      "Fable decided the open parts of NG-082 and NG-138 the ledger left open; answers F06 and IA-08.",
  },
  {
    id: "D24",
    title:
      "Provider enforcement is a measured capability matrix; unsupported enforcement is refused or declared observational",
    statement:
      "For each provider and operation class the matrix in K03 states supported, observe-only or unsupported, with the hook or policy that proves it, measured under the real launch policy; binding means bound at those hooks, never recorded after the fact where a hook exists.",
    serves: ["NG-035", "NG-036", "NG-038"],
    quote_from: "NG-035",
  },
  {
    id: "D25",
    title:
      "A turn is routed before any expensive model reads it: code first, JEV for meaning, a policy floor decides; Ryan's words travel whole",
    statement:
      "Every command that could start a provider turn (thread.turn.start, thread.user-input.respond, a comsnet send, an Agent Instruments wake) passes a route slot inside the one admission decision before any provider is called. The slot runs three passes in order. Code: sender class (operator, agent, system notice, instrument), the envelope kind and its structured no-reply flag, exact facts a record answers (thread liveness, counts, ids, generation), duplicate and superseded notices by content hash within the recipient's generation, and hold-flag changes, which are state writes and never turns. JEV, through the K07 port, only for what code cannot read: needs_new_work, notice_only, asks_recorded_fact, asks_judgment, names_deliverable, and the bounded spans of a message. Policy, read from a floor file only Ryan edits: no_model (record and code reply), light (the cheapest curated model at medium effort, a fresh minimal context of the operator's words plus record pointers), standard (the recipient thread's launch model and effort), lead_only (a named lead model, admitted only when the recipient thread's role is lead). The operator's original bytes travel unchanged in the envelope with every routed part; an operator message is never dropped: a no_model route must deliver a reply built from the record or it escalates to light. JEV classifies and annotates; code decides; a JEV no-answer, timeout or refusal falls to the code rules and the standard route and never blocks or approves a turn (K07).",
    serves: ["NG-086", "NG-088", "NG-089", "NG-091"],
    fable_call:
      "The one measured cause of the Oct 10 drain was wakes, not reasoning: six seats re-read 215,000 to 409,000 uncached tokens each to absorb a notice that said no acknowledgment was required, and Ryan's one-line liveness question started a new expensive seat. Reasoning was 2.5 percent of the comparison. A router at the admission point is the only place that sees every turn start on every route (T3.01 names six) before a provider is called; a Stop hook or a mod-side filter sees it after the context is loaded. JEV sits between the operator and the expensive model exactly as Ryan asked, but as a classifier on the admission decision, never as the authority; the floor file is the Ship Warden and broker shape SHAPE-2026-09-16 names.",
    alternative:
      "A JEV filter inside each provider adapter (the Claude mod, the Codex hooks): it runs after the seat is woken and its context loaded, so it saves nothing on the measured cases; and a per-provider filter is three implementations of one policy.",
    post_cutoff_ryan_words: {
      note: "Ryan's Oct 10, 2026 words are after the ledger cutoff. The spec writer records them through the post-cutoff ledger lane (intent/ledger/Post-Cutoff-Delta.json) and binds the quote here; until that item exists, X07 is satisfied by the fable_call above.",
      quote:
        "Assign Fable with solving for this with first classs design perhaps putting Jev inbetween me Astra so that Jev classifies and route away the expensive parts of a prompt that would lead to expensive tools calls",
      when: "Oct 10, 2026, about 12:15 PM PDT, lead thread abf5e046-bb33-4f0e-97bc-d1ccbba31693",
    },
  },
];

export const RYAN_DECISIONS_PENDING: PendingDecision[] = [
  {
    id: "R01",
    what: "Rename the installed command ryan throughline ship to ryan ship throughline: the act's family owns the item under the command grammar (section 4), and the grammar says an installed command is renamed only by Ryan's decision (section 9).",
    brought_as:
      "a filled Command-Proposal.json of kind rename with current callers from ryan audit query and a drain plan",
    default: "rename, keep the old spelling answering for a stated window",
    serves: ["NG-127"],
    blocks: "nothing in slice 1",
    authority: {
      kind: "standard",
      source:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/first-class-command-layer/Command-Grammar-Standard-V1.html",
      quote:
        "Nothing here is renamed by this standard. A rename of an installed command is Ryan's decision (section 10) and moves through its own door upgrade.",
      note: 'the command grammar is an agent-written standard Ryan adopted; its section 10 quotes Ryan, Oct 1, 2026: "Do not add any command, please until you have run them all by me and you have first confirmed them against the original FCCL command layer grammar design."',
    },
  },
  {
    id: "R02",
    what: "Rename the GitHub repository ryankschmidt/t3code to ryankschmidt/throughline so the folder, the remote and the product carry one name (folder grammar rule 6). This is Fable's naming proposal; Ryan's words establish an own repository and say nothing about renaming the GitHub repository.",
    brought_as:
      "one sentence; GitHub redirects the old name; origin URL updates are one git remote set-url",
    default:
      "carried out Oct 9, 2026 under Ryan's order to establish the repository on GitHub: origin is now https://github.com/ryankschmidt/throughline.git; the spec and every check use the new name",
    serves: ["NG-122"],
    blocks: "nothing",
    carried_out: {
      on: "2026-10-09",
      by_order_of: "Ryan: establish the repository on GitHub",
      renamed_from: "https://github.com/ryankschmidt/t3code.git",
      renamed_to: "https://github.com/ryankschmidt/throughline.git",
      receipt:
        "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-03/repo-home-2026-10-09/Repo-Home-Receipt.json",
    },
    authority: {
      kind: "proposal",
      ryan_required: false,
      note: "no Ryan quote reserves or orders this act; it is carried as an unapproved naming proposal and is never Ryan's required work",
    },
  },
  {
    id: "R03",
    what: "Install the root-owned ThroughLine supervisor on the tower with sudo, from the command agents prepare, hash-checked (slice 6).",
    brought_as: "the exact command, hash-checked, when slice 6 is detailed",
    default: "install",
    serves: ["NG-070", "NG-197"],
    blocks: "slice 6 only; nothing in slice 1",
    authority: { kind: "ryan-quote", ledger_item: "NG-070" },
  },
];

export const GOAL = {
  quote:
    "I am serious. I want to land this in 24 hours. I want this done and installed in 24 hours.",
  speaker: "ryan",
  source:
    "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/intent/Operator-Management-Order.txt",
  note: "Current operator destination for the 24-hour ThroughLine upgrade and install; the prior phase-one goal is historical, not current.",
  historical: [
    {
      label: "Historical phase-one goal",
      quote:
        "phase one is bringing ThroughLine back into check, tightening it up, fixing the drift.",
      speaker: "ryan",
      note: "Ryan's goal in his words, as recorded in the re-entry state file of Oct 7, 2026",
    },
  ],
};

// Ryan instruction audit: exact source words, with the owning execution contracts.
export const INSTRUCTION_COVERAGE = {
  source: {
    path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/lead-transfer/Ryan-Instruction-Coverage.json",
    sha256: "ae3a72e26191a029b584b834a0f8643efd8e82df6476d1d0ef1b08b479b8df9e",
  },
  order:
    "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-04/Order-Spec-Writer-Watcher-And-Coverage-2026-10-10.txt",
  rows: [
    {
      id: "IC-049",
      ryan_exact_words:
        "Also, When we install the new version of ThroughLine, I want it to have all of the downloads from upstream. We have not folded in upstreams updates in a while. They've been building up. I don't want to ship ThroughLine with upstream updates not reconciled and included in the install.",
      source: {
        exact_words:
          "Also, When we install the new version of ThroughLine, I want it to have all of the downloads from upstream. We have not folded in upstreams updates in a while. They've been building up. I don't want to ship ThroughLine with upstream updates not reconciled and included in the install.",
        thread_id: "619f77ee-d97f-430f-b917-ef1427b74191",
        message_id: "2a41a9b1-50b3-4d10-aa37-a49685792530",
        time: "2026-10-10T10:48:57.516Z",
        source_file: "/Users/Admin/.t3/userdata/state.sqlite",
        event_sequence: 1034198,
        event_id: "4cd896fd-f7db-4477-8687-4196c3633ca9",
        quote_start_character: 667,
        quote_end_character: 951,
        source_text_sha256: "d49af5756ec9aab545e0878c36745700ec396204c3cc15ac16957d08a3acce58",
      },
    },
    {
      id: "IC-052",
      ryan_exact_words:
        "The end state is every ThroughLine agent starts with nothing but a target ID and works toward your words.",
      source: {
        exact_words:
          "The end state is every ThroughLine agent starts with nothing but a target ID and works toward your words.",
        thread_id: "619f77ee-d97f-430f-b917-ef1427b74191",
        message_id: "17252cb6-f0a0-40ff-bba0-22623b2e50e7",
        time: "2026-10-10T10:49:39.117Z",
        source_file: "/Users/Admin/.t3/userdata/state.sqlite",
        event_sequence: 1034236,
        event_id: "c5c3e49b-911b-4285-807e-db0aa67de8dd",
        quote_start_character: 121,
        quote_end_character: 226,
        source_text_sha256: "7ed9af93a22fe6b99958f2ecc39ccfb9de2169b1b229e4f0c77c05b6ebca1a0f",
      },
    },
    {
      id: "IC-056",
      ryan_exact_words:
        "how do agents and threads bind to them and how do they start with a target and my words to drive to and how can the target chain be changed if it needs to be changed or added later in the session?",
      source: {
        exact_words:
          "how do agents and threads bind to them and how do they start with a target and my words to drive to and how can the target chain be changed if it needs to be changed or added later in the session?",
        thread_id: "619f77ee-d97f-430f-b917-ef1427b74191",
        message_id: "17252cb6-f0a0-40ff-bba0-22623b2e50e7",
        time: "2026-10-10T10:49:39.117Z",
        source_file: "/Users/Admin/.t3/userdata/state.sqlite",
        event_sequence: 1034236,
        event_id: "c5c3e49b-911b-4285-807e-db0aa67de8dd",
        quote_start_character: 1259,
        quote_end_character: 1455,
        source_text_sha256: "7ed9af93a22fe6b99958f2ecc39ccfb9de2169b1b229e4f0c77c05b6ebca1a0f",
      },
    },
    {
      id: "IC-002",
      ryan_exact_words:
        "For example, if your design touches a violating command — now that you know the standards, you can include in your structured deliverable, as part of the execution, for the agent to fix the command and shift it to the correct shape. \n\nAlso, if you are planning to design any new commands, any new families use $ryan-command-layer  and the two grammar standard docs to make their shape and composition intentional and alligned:\n\n`/Users/Admin/core-root/vault/01_Projects/workbench/infra/first-class-command-layer/Command-Grammar-Standard-V1.html` \n\n`/Users/Admin/core-root/vault/01_Projects/workbench/infra/grammar/Folder-Grammar-Standard-V1.html`\n\n``/Users/Admin/core-root/vault/01_Projects/workbench/infra/grammar/Folder-Grammar-Standard-V1-Dependencies.json``",
      source: {
        exact_words:
          "For example, if your design touches a violating command — now that you know the standards, you can include in your structured deliverable, as part of the execution, for the agent to fix the command and shift it to the correct shape. \n\nAlso, if you are planning to design any new commands, any new families use $ryan-command-layer  and the two grammar standard docs to make their shape and composition intentional and alligned:\n\n`/Users/Admin/core-root/vault/01_Projects/workbench/infra/first-class-command-layer/Command-Grammar-Standard-V1.html` \n\n`/Users/Admin/core-root/vault/01_Projects/workbench/infra/grammar/Folder-Grammar-Standard-V1.html`\n\n``/Users/Admin/core-root/vault/01_Projects/workbench/infra/grammar/Folder-Grammar-Standard-V1-Dependencies.json``",
        thread_id: "44973766-bbeb-4c80-b506-a4b171273e33",
        message_id: "a47f865c-a45e-4fd6-a52a-2c81eb12fd2b",
        time: "2026-10-07T21:59:52.792Z",
        source_file: "/Users/Admin/.t3/userdata/state.sqlite",
        event_sequence: 834360,
        event_id: "fb854fbb-6480-48ae-9a51-707a15ae4020",
        quote_start_character: 600,
        quote_end_character: 1361,
        source_text_sha256: "6a550a82631556ff8c5730e7d1cf5d6d5fe6f2b37105fe48d86b5d60998f25e3",
      },
    },
    {
      id: "IC-008",
      ryan_exact_words:
        "Because if that's right, I would prefer we take Raspberry Pi off the list and focus on Mac, tower, and iOS as priority, and when those three are done, then Android, number four. For Raspberry Pi, I think I want to pause",
      source: {
        exact_words:
          "Because if that's right, I would prefer we take Raspberry Pi off the list and focus on Mac, tower, and iOS as priority, and when those three are done, then Android, number four. For Raspberry Pi, I think I want to pause",
        thread_id: "abf5e046-bb33-4f0e-97bc-d1ccbba31693",
        message_id: "5a024d4c-6a95-4d33-a6b6-77124d0a2471",
        time: "2026-10-10T02:46:44.191Z",
        source_file: "/Users/Admin/.t3/userdata/state.sqlite",
        event_sequence: 1008000,
        event_id: "a61422b5-05e1-41ad-8d12-191806f8cf84",
        quote_start_character: 494,
        quote_end_character: 713,
        source_text_sha256: "1faab045dd25c95fc0b35d4edd77b0de49575f9fc74ed5ae4b95808f4abdb7ef",
      },
    },
  ],
  upstream_reconciliation: {
    owner: "T3.07",
    phase: 4,
    first: true,
    foundation: {
      release: "0.0.60",
      mode: "preserve-base",
      not_final_architecture: true,
    },
    pin: {
      fields: ["remote", "ref", "commit", "fetched_at", "previous_merge_base", "candidate_commit"],
      fresh_fetch_required: true,
    },
    dispositions: {
      coverage: "every incoming commit and changed path",
      choices: ["adopt", "retain", "replace", "defer"],
      requires: [
        "source citation",
        "reason",
        "conflict decision",
        "resulting path or deliberate non-inclusion",
      ],
      unclaimed_conflict: "refuse; never blanket take-upstream",
    },
    final_install: {
      owner: "T13.04",
      receipt: "{evidence}/upstream-reconciliation.json",
      same_candidate_required: true,
      gate: "pinned upstream head is an ancestor of the effective installed source OR every non-included incoming change has a deliberate source-backed disposition; no missing rows, unclaimed conflicts or stale candidate receipt",
      seam_ceilings: "unchanged; counts may only fall",
      capability_tests: "all pinned fork capability regressions; all must execute and pass",
      not_all_updates_when_exceptions: true,
    },
  },
  target_interface: {
    owner: "T9.01",
    module: "packages/throughline-target/src/provider-tools.ts",
    transport:
      "One common typed target tool interface on the existing authenticated ThroughLine server tool surface; Claude mod, Codex launch tool registration and Pi extension are thin adapters. This is not a ComsNet transport and does not restore its retired MCP tools.",
    operations: ["read", "add", "fix", "retract"],
    signature:
      "requestTarget(operation, payload, authenticatedPeer) -> target snapshot | admitted target-change event | typed refusal",
    payload:
      "read(target_id); add(conversation_id, candidate_text, source_message_id); fix(target_id, expected_revision, candidate_text, reason, source_message_id); retract(target_id, expected_revision, reason)",
    read_result: [
      "target_id",
      "exact_words",
      "revision",
      "checks",
      "shape_ids",
      "deliverable_scope",
      "work_steps",
      "pending_waits",
    ],
    authority:
      "Identity and execution generation come from the authenticated launch/session, never caller labels; central target owner applies K08 and I-01, calls JEV, admits by code and records each accepted change as one event. No direct record writes, per-provider target store or credential is given to a seat.",
    launch_binding:
      "T6.02 passes only the target id as the job input and binds the read-only target-tool module plus the authenticated session/generation. Initial and resumed launches fetch the current revision from the one authority; input cannot supply cached words, check acceptance or authority.",
    runtime_state: "proposed-not-implemented",
  },
  target_only_start: {
    owner: "T9.01",
    implementation_file: "packages/throughline-target/src/target-only-start.test.ts",
    hosts: ["mac", "twr"],
    providers: ["claude", "codex", "pi"],
    input_keys: ["target_id"],
    non_builder_required: true,
    steps: [
      "Launch a real installed ThroughLine worker for each supported provider with job input containing only target_id; no prompt transcript, copied target text or hand-authored handoff.",
      "Read Ryan exact_words, current revision and checks through the central authority; compare bytes with the authoritative source and record the provider/session/generation.",
      "Record the failing check, save partial work plus a durable step/wait, then replace the worker.",
      "Launch the replacement with only the same target_id; it reads the authority and recorded partial work, continues without redoing the committed effect and without a hand-written handoff.",
      "Advance the target revision; a completion for the old revision refuses.",
      "Builder self-acceptance and acceptance by an unauthorized third seat refuse; the dispatcher-named non-builder can accept the current revision.",
      "Direct agent writes to target records refuse; add/fix/retract only through the common interface with recorded admission and revision events.",
    ],
    refusals: [
      "stale-revision-completion",
      "builder-self-acceptance",
      "unauthorized-check-acceptance",
      "direct-target-record-write",
      "stale-generation-tool-call",
    ],
    receipt: "{evidence}/target-only-start/<host>-<provider>.json",
    final_acceptance:
      "ACCEPT-ALL requires every supported provider on each active execution host; a missing cell is not a pass; unsupported/observe-only behavior cannot be advertised as bound",
  },
  command_grammar: {
    id: "IC-002",
    skill: "/Users/Admin/.codex/skills/ryan-command-layer/SKILL.md",
    sources: [
      "/Users/Admin/core-root/vault/01_Projects/workbench/infra/first-class-command-layer/Command-Grammar-Standard-V1.html",
      "/Users/Admin/core-root/vault/01_Projects/workbench/infra/grammar/Folder-Grammar-Standard-V1.html",
      "/Users/Admin/core-root/vault/01_Projects/workbench/infra/grammar/Folder-Grammar-Standard-V1-Dependencies.json",
    ],
    when: "Every task that adds, changes, names or touches a command, command family, wrapper, installer or caller; applies before command implementation.",
    owner:
      "The task executor through the owning command-layer module; independent reviewer checks the resulting command and current callers.",
    required: [
      "Read the command-layer skill and both grammar standards plus the folder dependency record.",
      "For every touched command, record current grammar compliance; include correction of a touched violation in the same execution task.",
      "Use the owning door upgrade/proposal path; keep old callers answering during the declared compatibility window; enumerate callers from source and runtime audit, migrate them and prove the old route drains before removal.",
      "Read current help and execute the actual resulting door in the environment of record; no guessed spelling or ad-hoc shim.",
      "Public additions/renames follow the standards authority path; this spec pass renames no live command.",
    ],
    receipt: "{evidence}/<task>/command-grammar.json",
    acceptance:
      "non-builder verifies grammar, preserved caller behavior and the measured drain; explicit not-applicable with reason only when the task touches no command",
  },
};
TASKS.splice(
  TASKS.findIndex((t) => t.slice === "slice-3"),
  0,
  {
    id: "T3.07",
    slice: "slice-3",
    title: "First Phase 4 task: reconcile a freshly pinned upstream before new architecture work",
    serves: ["NG-123", "NG-124", "NG-125", "NG-126", "NG-130"],
    detail_state: "detailed",
    what: "0.0.60 is the preserve-base foundation, not the completed architecture. Before any other Phase 4 task, fetch upstream T3 Code, pin its full commit and fetch time, enumerate every incoming commit and changed path from the prior merge base, and record adopt/retain/replace/defer with source-backed conflict decisions. Integrate the selected changes without losing fork capabilities. Every deliberate non-inclusion stays explicit; never describe that result as all updates included. Preserve the seam ceilings and run every pinned capability regression. The final install refuses without the same-candidate reconciliation receipt and ancestry or exhaustive deliberate-non-inclusion proof. Browser-preview screenshots are part of this acceptance: upstream commit ac8e9453ca0948469ccf5651b765086d8d9ecd64 replaces the native capturePage path with Page.captureScreenshot but is not a proven fix. After reconciliation, a non-builder runs every source-listed cold capture test on the built candidate and independently inspects failed-before and passing-after product screenshots. If upstream does not close it, reopen the same diagnosis with worker-shotdiag-db00e8d1 before final install.",
    files: [
      {
        path: "docs/throughline/seam/",
        side: "fork-namespace",
        action: "edit",
        note: "existing seam manifest and pinned capability contracts; no ceiling increase",
      },
      {
        path: "docs/throughline/capabilities/",
        side: "fork-namespace",
        action: "read",
        note: "every retained capability regression",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship/src/source-sync.ts",
        side: "outside-tool",
        action: "edit",
        note: "owning source integration/final install gate, no separate pipeline",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/Ship-Pipeline.json",
        side: "config",
        action: "edit",
        note: "bind reconciliation proof to final architecture release; retain 0.0.60 preserve-base",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/lead-transfer/Preview-Screenshot-Diagnosis.json",
        side: "vault",
        action: "read",
        exists_now: true,
        note: "Exact cold acceptance test list and explicit unproven-fix boundary",
      },
      {
        path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/lead-transfer/Preview-Screenshot-Fixture.html",
        side: "vault",
        action: "read",
        exists_now: true,
        note: "Supplied synthetic loopback fixture, pinned by SHA-256; no historical page content",
      },
    ],
    depends_on: ["T1.10", "T2.04"],
    executor: {
      role: "implementer",
      model_preference: "gpt-6.1-sol",
      effort: "high",
    },
    governing_shapes: [
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-31-ryan-tier-1-only-edit-surface-ship-to-all-runtimes.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-before-saying-you-checked-something-reasoning-is-not-running.yaml",
      "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    ],
    signatures: [
      "UpstreamReconciliationReceipt { upstream_commit, fetched_at, previous_merge_base, candidate_commit, incoming_changes[], dispositions[], conflicts[], seam_results, capability_results, ancestry_result, non_inclusions[] }",
      "refuseUpstreamAcceptance(candidate, receipt): rejects stale candidate, missing disposition, unclaimed conflict, increased seam counts or unexecuted/failing capability tests",
    ],
    failing_checks: ["PH2-C01"],
    planned_checks: [
      {
        id: "T3.07-red",
        command:
          "Before integration, prove the candidate does not contain the freshly fetched upstream head and the reconciliation receipt is absent; preserve that failed gate.",
      },
      {
        id: "T3.07-neg",
        command:
          "Remove one incoming-change disposition, change candidate_commit, drop one capability result and raise a seam count in separate disposable receipts: every mutation must refuse.",
      },
      {
        id: "T3.07-preview-cold",
        command:
          "All source-listed browser-preview cold tests on unchanged source and built candidate; no recording warmup; preserve the failed-before screenshot and passing-after PNG.",
      },
      {
        id: "T3.07-preview-refusal",
        command:
          "Missing failed-before PNG, warm-capture-only proof, a failed cold test or a receipt for another candidate each refuses final install and reopens the same diagnosis.",
      },
    ],
    done_when: {
      command:
        "Non-builder: in the repository run git fetch upstream refs/heads/main, record git rev-parse FETCH_HEAD with the actual fetch time, and verify the integrator pinned that exact cut. Walk the complete incoming-change/disposition table, run git merge-base --is-ancestor <pinned-upstream> <candidate>, run the installed seam self-test and every pinned capability regression. Exercise the final-install gate with the valid receipt and all T3.07-neg mutations; no install is performed by this test. Then, on the built candidate, run each browser_preview_acceptance.tests entry verbatim using its pinned loopback fixture, followed by independent inspection of both actual failed-before and passing-after PNGs.",
      expect:
        "Fresh full upstream SHA and time; exact incoming-change coverage; no unclaimed conflicts; ancestry succeeds or every deliberate non-inclusion has source-backed proof; seam counts do not rise; every capability test executes and passes; all negative receipts refuse. 0.0.60 remains preserve-base. Every cold preview test passes on the built candidate, with source-bound non-builder evidence and the required failed-before/passing-after pair. Any failed test, missing pair or unproven repair reopens the same diagnosis with worker-shotdiag-db00e8d1 and prevents final install.",
    },
    rollback:
      "Keep the pinned source and failed proof history; return to the pre-reconciliation source through the owning integration lane, without overwriting other work.",
    risk: [
      "A fresh fetch can change the reconciliation cut; receipt and installed source must share the exact candidate.",
      "No force reset, lost fork capability or increased seam ceiling.",
    ],
    upstream_reconciliation: {
      owner: "T3.07",
      phase: 4,
      first: true,
      foundation: {
        release: "0.0.60",
        mode: "preserve-base",
        not_final_architecture: true,
      },
      pin: {
        fields: [
          "remote",
          "ref",
          "commit",
          "fetched_at",
          "previous_merge_base",
          "candidate_commit",
        ],
        fresh_fetch_required: true,
      },
      dispositions: {
        coverage: "every incoming commit and changed path",
        choices: ["adopt", "retain", "replace", "defer"],
        requires: [
          "source citation",
          "reason",
          "conflict decision",
          "resulting path or deliberate non-inclusion",
        ],
        unclaimed_conflict: "refuse; never blanket take-upstream",
      },
      final_install: {
        owner: "T13.04",
        receipt: "{evidence}/upstream-reconciliation.json",
        same_candidate_required: true,
        gate: "pinned upstream head is an ancestor of the effective installed source OR every non-included incoming change has a deliberate source-backed disposition; no missing rows, unclaimed conflicts or stale candidate receipt",
        seam_ceilings: "unchanged; counts may only fall",
        capability_tests: "all pinned fork capability regressions; all must execute and pass",
        not_all_updates_when_exceptions: true,
        browser_preview: {
          owner: "T3.07",
          required: true,
          receipt: "{evidence}/T3.07/browser-preview-cold-capture.json",
          same_candidate_required: true,
          non_builder_required: true,
          failed_before_and_passing_after_required: true,
          all_source_tests_required: true,
          on_failure: {
            owner: "worker-shotdiag-db00e8d1",
            action:
              "Reopen the same screenshot diagnosis with the same diagnostic seat if upstream does not close any cold test or the required failed-before/passing-after evidence remains missing.",
            before_final_install: true,
            may_accept_failed_test: false,
          },
        },
      },
      browser_preview_acceptance: {
        owner: "T3.07",
        source: {
          path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/lead-transfer/Preview-Screenshot-Diagnosis.json",
          sha256_at_intake: "ca4ad63000c471176ceafcbabf96dc327f310559cf612c30bb2bf9741928d446",
          field: "non_builder_acceptance.tests_to_run_after_candidate_exists",
          tests_sha256: "aa66266c1a98a2f6c066ebf3a3b9f461937f6d54f8cc19d5d51155e07100fa0f",
        },
        fixture: {
          path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/lead-transfer/Preview-Screenshot-Fixture.html",
          sha256: "83916807eb16b64be650b305b28b20fadba996041f4952e53ee76795ba932aeb",
        },
        candidate_upstream_commit: "ac8e9453ca0948469ccf5651b765086d8d9ecd64",
        upstream_fix_status: "UNPROVEN until the built-candidate cold tests pass",
        tests: [
          "Serve the supplied fixture on loopback; open a fresh background tab and capture without recording warmup.",
          "Repeat with visible and background tabs; fill, freeform 1280x800 and iphone-se; short and tall fixture; immediate and later captures.",
          "Exercise an unavailable capture surface, then evaluate 42 in the same tab: require bounded truthful failure and released control.",
          "Run the same cold regression on unchanged source and candidate; independently inspect actual failed-state and fixed-capture PNGs.",
        ],
        run_on:
          "Built ThroughLine candidate after upstream reconciliation; the unchanged source baseline and candidate run the same cold fixture regression. No recording warmup or unit-test-only substitute.",
        non_builder_required: true,
        evidence: {
          receipt: "{evidence}/T3.07/browser-preview-cold-capture.json",
          candidate_commit:
            "the full source commit of the built candidate; must match the final installed source",
          required: [
            "failed-before screenshot of the actual failed product state on unchanged source",
            "passing-after capture PNG from the built candidate",
            "non-builder inspection of both actual PNGs",
            "one result for every source-listed cold test, including bounded failure and released control",
          ],
          pair_required: true,
          synthetic_or_warm_capture_substitutes: false,
          missing_before_image_is_not_pass: true,
        },
        release_rule:
          "Do not accept this report, the 97 baseline tests, or the warm successful capture as a proven fix.",
        on_failure: {
          owner: "worker-shotdiag-db00e8d1",
          action:
            "Reopen the same screenshot diagnosis with the same diagnostic seat if upstream does not close any cold test or the required failed-before/passing-after evidence remains missing.",
          before_final_install: true,
          may_accept_failed_test: false,
        },
        proof_limits:
          "The diagnosis is incomplete and the upstream change is only a candidate repair. Existing 97 tests, the warm capture and the isolated failure-state image do not prove this product fix.",
      },
    },
    command_grammar: "IC-002",
  } as Task,
);

Object.assign(INSTRUCTION_COVERAGE, {
  raspberry_pi_pause: {
    instruction: "IC-008",
    state: "deferred",
    scope:
      "General Raspberry Pi software installation, account rollout, execution and device acceptance are paused; the Pi software provider on Mac and tower stays required.",
    active_targets: ["mac", "twr", "ios", "android"],
    foundation_targets: ["twr", "ios", "mac"],
    priority: [["mac", "twr", "ios"], ["android"]],
    exceptions: [
      {
        kind: "archive-drive",
        owners: ["T1.03", "T1.05"],
        purpose:
          "External archive storage and verified archive reads; not a general ThroughLine install.",
      },
      {
        kind: "watcher-responder",
        owners: ["T4.03", "T4.04", "T4.05", "T4.07", "T12.04", "T12.08", "T12.09"],
        purpose:
          "Watcher in the rpi account, local broker notification/provider prerequisites and the bounded recovery island only, under the Oct 10 design; never general execution.",
      },
    ],
    re_enable:
      "Requires a later explicit Ryan scope change; deferred is not passed and no current conjunction requires the deferred host.",
  },
});

TASKS.push({
  id: "T11.05",
  slice: "slice-11",
  title: "Installed target-ID-only startup and succession for every provider",
  serves: ["NG-073", "NG-074", "NG-075", "NG-081"],
  detail_state: "detailed",
  what: "After the central target owner and all provider adapters are installed, a non-builder fires the target-ID-only initial/replacement job for Claude, Codex and Pi on Mac and tower. This is the end-to-end proof, not a prerequisite of the adapters it tests; T9.01 keeps its separate exploratory and API acceptance. Partial work, exact current Ryan words, revisions and checks survive replacement without a hand-written handoff.",
  files: [
    {
      path: "packages/throughline-target/src/target-only-start.test.ts",
      side: "fork-namespace",
      action: "add",
      exists_now: false,
      note: "real installed launch route; no mock provider or lab-only substitute",
    },
  ],
  depends_on: ["T8.03", "T11.01", "T11.02", "T9.03", "T6.03"],
  executor: {
    role: "implementer",
    model_preference: "gpt-6.1-sol",
    effort: "high",
  },
  governing_shapes: [
    "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-07-27-ryan-slice-close-by-judge-not-self.yaml",
    "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-08-06-ryan-prove-it-in-the-environment-of-record-before-claiming-it-works.yaml",
  ],
  signatures: [
    "targetOnlyStart(installedHost, provider, target_id) -> source-bound non-builder receipt including initial and replacement generations, partial-work proof, current revision and all refusal polarities",
  ],
  failing_checks: ["PH2-C01"],
  done_when: {
    command:
      "Run packages/throughline-target/src/target-only-start.test.ts through installed ThroughLine on Mac and tower for Claude, Codex and Pi, following target_only_start.steps; input contains only target_id.",
    expect:
      "Every provider/host receipt proves exact-word/revision/check fetch, saved partial-work continuation without repeated committed effects or a hand-written handoff, and all target_only_start.refusals refuse. The named non-builder accepts only the current revision.",
    judge: "non-builder, not the target builder or any provider adapter builder",
  },
  rollback:
    "Keep all failed receipts. Revert the proof harness through its owning source lane; never change target history or weaken admission to pass.",
  risk: [
    "A mocked or lab-only worker is not installed ThroughLine proof.",
    "The core target task cannot depend on its downstream provider proof.",
  ],
  planned_checks: [
    {
      id: "T11.05-red",
      command:
        "A real installed target_id-only job cannot continue saved partial work before the adapters exist; preserve that refusal.",
    },
  ],
  target_only_start: {
    owner: "T11.05",
    implementation_file: "packages/throughline-target/src/target-only-start.test.ts",
    hosts: ["mac", "twr"],
    providers: ["claude", "codex", "pi"],
    input_keys: ["target_id"],
    non_builder_required: true,
    steps: [
      "Launch a real installed ThroughLine worker for each supported provider with job input containing only target_id; no prompt transcript, copied target text or hand-authored handoff.",
      "Read Ryan exact_words, current revision and checks through the central authority; compare bytes with the authoritative source and record the provider/session/generation.",
      "Record the failing check, save partial work plus a durable step/wait, then replace the worker.",
      "Launch the replacement with only the same target_id; it reads the authority and recorded partial work, continues without redoing the committed effect and without a hand-written handoff.",
      "Advance the target revision; a completion for the old revision refuses.",
      "Builder self-acceptance and acceptance by an unauthorized third seat refuse; the dispatcher-named non-builder can accept the current revision.",
      "Direct agent writes to target records refuse; add/fix/retract only through the common interface with recorded admission and revision events.",
    ],
    refusals: [
      "stale-revision-completion",
      "builder-self-acceptance",
      "unauthorized-check-acceptance",
      "direct-target-record-write",
      "stale-generation-tool-call",
    ],
    receipt: "{evidence}/target-only-start/<host>-<provider>.json",
    final_acceptance:
      "ACCEPT-ALL requires every supported provider on each active execution host; a missing cell is not a pass; unsupported/observe-only behavior cannot be advertised as bound",
    central_owner: "T9.01",
  },
  command_grammar: "IC-002",
} as Task);
Object.assign(INSTRUCTION_COVERAGE, {
  target_only_start: {
    owner: "T11.05",
    implementation_file: "packages/throughline-target/src/target-only-start.test.ts",
    hosts: ["mac", "twr"],
    providers: ["claude", "codex", "pi"],
    input_keys: ["target_id"],
    non_builder_required: true,
    steps: [
      "Launch a real installed ThroughLine worker for each supported provider with job input containing only target_id; no prompt transcript, copied target text or hand-authored handoff.",
      "Read Ryan exact_words, current revision and checks through the central authority; compare bytes with the authoritative source and record the provider/session/generation.",
      "Record the failing check, save partial work plus a durable step/wait, then replace the worker.",
      "Launch the replacement with only the same target_id; it reads the authority and recorded partial work, continues without redoing the committed effect and without a hand-written handoff.",
      "Advance the target revision; a completion for the old revision refuses.",
      "Builder self-acceptance and acceptance by an unauthorized third seat refuse; the dispatcher-named non-builder can accept the current revision.",
      "Direct agent writes to target records refuse; add/fix/retract only through the common interface with recorded admission and revision events.",
    ],
    refusals: [
      "stale-revision-completion",
      "builder-self-acceptance",
      "unauthorized-check-acceptance",
      "direct-target-record-write",
      "stale-generation-tool-call",
    ],
    receipt: "{evidence}/target-only-start/<host>-<provider>.json",
    final_acceptance:
      "ACCEPT-ALL requires every supported provider on each active execution host; a missing cell is not a pass; unsupported/observe-only behavior cannot be advertised as bound",
    central_owner: "T9.01",
  },
});

Object.assign(INSTRUCTION_COVERAGE.upstream_reconciliation, {
  owner: "T3.07",
  phase: 4,
  first: true,
  foundation: {
    release: "0.0.60",
    mode: "preserve-base",
    not_final_architecture: true,
  },
  pin: {
    fields: ["remote", "ref", "commit", "fetched_at", "previous_merge_base", "candidate_commit"],
    fresh_fetch_required: true,
  },
  dispositions: {
    coverage: "every incoming commit and changed path",
    choices: ["adopt", "retain", "replace", "defer"],
    requires: [
      "source citation",
      "reason",
      "conflict decision",
      "resulting path or deliberate non-inclusion",
    ],
    unclaimed_conflict: "refuse; never blanket take-upstream",
  },
  final_install: {
    owner: "T13.04",
    receipt: "{evidence}/upstream-reconciliation.json",
    same_candidate_required: true,
    gate: "pinned upstream head is an ancestor of the effective installed source OR every non-included incoming change has a deliberate source-backed disposition; no missing rows, unclaimed conflicts or stale candidate receipt",
    seam_ceilings: "unchanged; counts may only fall",
    capability_tests: "all pinned fork capability regressions; all must execute and pass",
    not_all_updates_when_exceptions: true,
    browser_preview: {
      owner: "T3.07",
      required: true,
      receipt: "{evidence}/T3.07/browser-preview-cold-capture.json",
      same_candidate_required: true,
      non_builder_required: true,
      failed_before_and_passing_after_required: true,
      all_source_tests_required: true,
      on_failure: {
        owner: "worker-shotdiag-db00e8d1",
        action:
          "Reopen the same screenshot diagnosis with the same diagnostic seat if upstream does not close any cold test or the required failed-before/passing-after evidence remains missing.",
        before_final_install: true,
        may_accept_failed_test: false,
      },
    },
  },
  browser_preview_acceptance: {
    owner: "T3.07",
    source: {
      path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/lead-transfer/Preview-Screenshot-Diagnosis.json",
      sha256_at_intake: "ca4ad63000c471176ceafcbabf96dc327f310559cf612c30bb2bf9741928d446",
      field: "non_builder_acceptance.tests_to_run_after_candidate_exists",
      tests_sha256: "aa66266c1a98a2f6c066ebf3a3b9f461937f6d54f8cc19d5d51155e07100fa0f",
    },
    fixture: {
      path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/lead-transfer/Preview-Screenshot-Fixture.html",
      sha256: "83916807eb16b64be650b305b28b20fadba996041f4952e53ee76795ba932aeb",
    },
    candidate_upstream_commit: "ac8e9453ca0948469ccf5651b765086d8d9ecd64",
    upstream_fix_status: "UNPROVEN until the built-candidate cold tests pass",
    tests: [
      "Serve the supplied fixture on loopback; open a fresh background tab and capture without recording warmup.",
      "Repeat with visible and background tabs; fill, freeform 1280x800 and iphone-se; short and tall fixture; immediate and later captures.",
      "Exercise an unavailable capture surface, then evaluate 42 in the same tab: require bounded truthful failure and released control.",
      "Run the same cold regression on unchanged source and candidate; independently inspect actual failed-state and fixed-capture PNGs.",
    ],
    run_on:
      "Built ThroughLine candidate after upstream reconciliation; the unchanged source baseline and candidate run the same cold fixture regression. No recording warmup or unit-test-only substitute.",
    non_builder_required: true,
    evidence: {
      receipt: "{evidence}/T3.07/browser-preview-cold-capture.json",
      candidate_commit:
        "the full source commit of the built candidate; must match the final installed source",
      required: [
        "failed-before screenshot of the actual failed product state on unchanged source",
        "passing-after capture PNG from the built candidate",
        "non-builder inspection of both actual PNGs",
        "one result for every source-listed cold test, including bounded failure and released control",
      ],
      pair_required: true,
      synthetic_or_warm_capture_substitutes: false,
      missing_before_image_is_not_pass: true,
    },
    release_rule:
      "Do not accept this report, the 97 baseline tests, or the warm successful capture as a proven fix.",
    on_failure: {
      owner: "worker-shotdiag-db00e8d1",
      action:
        "Reopen the same screenshot diagnosis with the same diagnostic seat if upstream does not close any cold test or the required failed-before/passing-after evidence remains missing.",
      before_final_install: true,
      may_accept_failed_test: false,
    },
    proof_limits:
      "The diagnosis is incomplete and the upstream change is only a candidate repair. Existing 97 tests, the warm capture and the isolated failure-state image do not prove this product fix.",
  },
});

// Fable delta JEV cost router (D25), applied verbatim: the route slot at admission (T3.08, after T3.02)
// and the JEV conditions behind K07 (T9.06, after T9.04).
TASKS.splice(TASKS.findIndex((t) => t.id === "T3.02") + 1, 0, {
  id: "T3.08",
  slice: "slice-3",
  title:
    "The route slot at admission: code-only rules, the policy floor, no wake on a notice, one wake per sleeping seat",
  serves: ["NG-086", "NG-088", "NG-091"],
  detail_state: "detailed",
  what: "A fork-namespace package packages/throughline-route (code only; no daemon, queue, watcher or credential client) that T3.01's admit() calls through the I-01 operations routeTurn and coalesceWake. Code pass: sender class from the admitted command's origin (operator, agent, system notice, instrument); the T7.01 envelope kind (notice, acknowledgment, request, reply, result) and its structured no_reply flag; exact facts answered from the record (is thread X alive: last event time, generation, state; counts; ids); duplicate and superseded notices by content hash within the recipient's generation; hold-flag changes (send-hold lifted, quiet window ended) applied as state writes with no turn. Policy pass: a floor file contracts/Route-Policy.json (versioned, carried by T10.10's settings lane, editable only by Ryan on the Mac and twr) that maps (sender class, envelope kind, code facts, JEV conditions when present) to a route and names the light model from ryan model list; the default route is standard, which is today's behaviour. Wake coalescing: a recipient whose worker is not in a turn receives one turn per batch of pending tasks; the adapter resumes it once with a code-built digest (ids, kinds, record pointers, the operator's bytes for operator messages) and the superseded entries listed, never one turn per message. A notice routed no_model to a sleeping seat records an annotation and starts nothing. Reset re-check: when the broker observer reports an account's reset (T11.04), every queued message for a seat stopped by that limit is re-evaluated against current state before any wake; notices superseded by a later message, older than the recipient's generation cut, or already applied as state are recorded and excluded from the digest. The JEV pass is absent until T9.06 binds it; the slot's decided_by records code or default until then. An operator message routed no_model must carry a record-built reply or the slot escalates it to light; the operator's bytes are never rewritten.",
  files: [
    {
      path: "packages/throughline-route/package.json",
      side: "fork-namespace",
      action: "add",
      exists_now: false,
      surface: "authoring",
    },
    {
      path: "packages/throughline-route/src/route-slot.ts",
      side: "fork-namespace",
      action: "add",
      exists_now: false,
      surface: "authoring",
    },
    {
      path: "packages/throughline-route/src/code-facts.ts",
      side: "fork-namespace",
      action: "add",
      exists_now: false,
      surface: "authoring",
    },
    {
      path: "packages/throughline-route/src/wake-digest.ts",
      side: "fork-namespace",
      action: "add",
      exists_now: false,
      surface: "authoring",
    },
    {
      path: "packages/throughline-route/src/route-slot.test.ts",
      side: "fork-namespace",
      action: "add",
      exists_now: false,
      surface: "authoring",
    },
    {
      path: "packages/throughline-route/fixtures/oct-10-wakes/",
      side: "fork-namespace",
      action: "add",
      exists_now: false,
      surface: "authoring",
    },
    {
      path: "contracts/Route-Policy.json",
      side: "config",
      action: "add",
      exists_now: false,
      surface: "authoring",
    },
    {
      path: "apps/server/src/throughline/admission/CommandAdmission.ts",
      side: "fork-namespace",
      action: "edit",
      exists_now: false,
      surface: "authoring",
    },
  ],
  signatures: [
    "routeTurn(admitted: AdmittedCommand, recipientGeneration: number, floor: RoutePolicy) -> RouteDecision",
    "coalesceWake(recipientPublicId: string, generation: number) -> WakeDigest",
    "codeFacts(admitted: AdmittedCommand, record: RecordPort) -> CodeFacts { senderClass; envelopeKind; noReply: boolean; recordedFactAnswer?: string; duplicateOf?: string; supersededBy?: string; holdChange?: string }",
    "contracts/Route-Policy.json: { version, default_route: 'standard', light_model: <from ryan model list>, rules: [{ when: {...}, route }], operator_floor: { never_drop: true, no_model_requires_reply: true } }",
    "test packages/throughline-route/src/route-slot.test.ts › 'the six Oct 10 notice fixtures route no_model and start no turn' and › 'an operator liveness fixture routes no_model with a record-built reply' and › 'one sleeping recipient with four pending tasks wakes once with a digest' and › 'a JEV no-answer leaves the code decision and the standard route' (specified, not yet implemented)",
  ],
  planned_checks: [
    {
      id: "S3-C13",
      kind: "real-disk",
      command:
        "node ./checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C13",
      expect:
        "packages/throughline-route exists with the four source files and the fixtures folder; CommandAdmission.ts calls routeTurn before dispatch for every turn-effect command type and the comsnet route; the admission_decisions row shape carries route, decided_by, jev_step_id and floor_version; contracts/Route-Policy.json parses with default_route standard",
      spec_projection: {
        kind: "real-disk",
        expected_today: "FAIL",
        file_ready: false,
        note: "add to spec.checks only when the check file carries S3-C13 on disk (spec check X05); until then this task's failing check is S3-C05",
      },
    },
  ],
  failing_checks: ["S3-C05"],
  failing_check_first:
    "before the work, the six Oct 10 notice fixtures replayed through the admission module each start a turn (route is not a concept the module has); recorded at intake as the red",
  done_when: {
    host: "twr, non-builder",
    command:
      "cd /Users/Admin/throughline && pnpm -C packages/throughline-route test && node ./docs/throughline/next-gen-spec/checks/slice-3-admission-record.mts --repo /Users/Admin/throughline --only S3-C05 S3-C13; then on the installed tower server: send the m1 notice fixture to three live seats whose workers are idle, send Ryan's liveness fixture as an operator message to one of them, and read the admission_decisions rows and the provider turn counts",
    expect:
      "tests green; the three notice sends record route no_model, decided_by code, and the provider turn count for those seats does not change; the liveness message records no_model with a reply row delivered to the operator surface within the rail's delivery; the floor file version in every row equals the installed contracts/Route-Policy.json",
    judge: "non-builder seat",
  },
  depends_on: ["T3.01", "T3.02"],
  executor: { role: "implementer", model_preference: "gpt-6.1-sol", effort: "high" },
  reviewer: { role: "reviewer", model_preference: "gpt-6-astra", effort: "medium" },
  risk: [
    "a wrong no_model silences a seat that needed the message: mitigated by the operator floor (never drop, reply required), by the default route standard, and by the recorded decision row a judge can replay",
    "a cold-cache wake costs ten times a cached poll on Astra (250 vs 25 credits per million input): coalescing is what makes a suspended seat cheaper than a polling one; the digest test is the guard",
  ],
  rollback:
    "remove the routeTurn call from CommandAdmission.ts and the package; every turn-effect command dispatches as before; the admission_decisions columns stay nullable",
  failure_test:
    "Fail if: any notice fixture starts a turn; an operator message is admitted no_model with no reply row; a recipient wakes more than once for one batch of pending tasks; the floor file is written by any code path",
  ryan_act: "none",
  governing_shapes: [
    "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-16-ryan-transfer-the-gate-to-a-floor-governed-process-never-operator-tokens-and-fix-before-delivery-not-at-stop.yaml",
    "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-30-ryan-jev-and-model-calls-have-no-limits-unless-ryan-mints-one.yaml",
  ],
  command_grammar: "IC-002",
  delta_sources: [
    "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-05/Fable-Delta-JEV-Cost-Router.json",
  ],
} as unknown as Task);
TASKS.splice(TASKS.findIndex((t) => t.id === "T9.04") + 1, 0, {
  id: "T9.06",
  slice: "slice-9",
  title: "JEV conditions feed the route slot through the K07 port; code still decides",
  serves: ["NG-086", "NG-088", "NG-089", "NG-091"],
  detail_state: "detailed",
  what: "Bind the JEV pass of the route slot (T3.08) to the one condition port (T9.02). For every admitted message the code pass could not decide, the slot asks the port one batched call over the message state: needs_new_work, notice_only, asks_recorded_fact, asks_judgment, names_deliverable (noul), and bounded_spans (the character ranges of the message that are bounded work versus judgment; the operator's bytes are never rewritten, the spans only annotate). Answers are typed, versioned and cached by content hash plus recipient generation; the floor file maps them to a route; a no-answer, timeout or refusal records the outcome and leaves the code decision and the standard route. Every call is a step on the recipient task's workflow with source ids, question version, model and confidence (K07), so a retry reads the recorded answer. The route decision row records decided_by jev and the step id. The slot registers itself in the port's consumer registry (NG-090). JEV out of credit or the broker route down is an observer fact: the port returns the named outage outcome and the slot runs code-only; no turn waits on JEV.",
  files: [
    {
      path: "packages/throughline-route/src/jev-pass.ts",
      side: "fork-namespace",
      action: "add",
      exists_now: false,
      surface: "authoring",
    },
    {
      path: "packages/throughline-route/src/jev-pass.test.ts",
      side: "fork-namespace",
      action: "add",
      exists_now: false,
      surface: "authoring",
    },
    {
      path: "packages/throughline-conditions/src/consumers/route-slot.ts",
      side: "fork-namespace",
      action: "add",
      exists_now: false,
      surface: "authoring",
    },
  ],
  signatures: [
    "jevPass(admitted: AdmittedCommand, port: ConditionPort, floor: RoutePolicy) -> { conditions: RouteConditions | NoAnswer | Timeout | Refusal | Outage; step_id?: string }",
    "RouteConditions { needs_new_work: number; notice_only: number; asks_recorded_fact: number; asks_judgment: number; names_deliverable: number; bounded_spans: Array<{ start: number; end: number; kind: 'bounded' | 'judgment' }> }",
    "test packages/throughline-route/src/jev-pass.test.ts › 'the Oct 10 corpus routes with decided_by jev and one step per message' and › 'a broadcast to five recipients makes one port call' and › 'outage, timeout, refusal and malformed each leave the code decision in force' (specified, not yet implemented)",
  ],
  planned_checks: [
    {
      id: "S9-C06",
      kind: "contract-test",
      command:
        "send the Oct 10 corpus through the installed admission service with the port bound; read the recipient workflows' steps and the admission_decisions rows",
      expect:
        "one JEV step per message with source ids, question version, model and confidence; a broadcast makes one step shared by its recipients; the retry of a send reuses the step; every row's decided_by is jev or code, never a route the floor file does not map",
      spec_projection: {
        kind: "real-disk",
        expected_today: "measure on first run",
        file_ready: false,
        note: "add to spec.checks only when the check file exists on disk (spec check X05)",
      },
    },
  ],
  failing_checks: ["S3-C05"],
  failing_check_first:
    "before the work, the route slot's decided_by is code or default on every row and the port's consumer registry has no route-slot entry; recorded at intake as the red",
  done_when: {
    host: "twr, non-builder",
    command:
      "K07 route test (the labelled wake corpus at 0.80 and two neighbours) on the installed tower, then the five-recipient broadcast and the outage, timeout, refusal and malformed cases from T9.02's done_when",
    expect:
      "false-no_model and false-wake rates recorded with the chosen value; one port call per broadcast; every outage case records its outcome and the code decision stands; no operator message is routed no_model without a reply row",
    judge: "non-builder seat",
  },
  depends_on: ["T9.02", "T9.04", "T3.08"],
  executor: { role: "implementer", model_preference: "gpt-6.1-sol", effort: "high" },
  reviewer: { role: "reviewer", model_preference: "gpt-6-astra", effort: "medium" },
  risk: [
    "the route conditions are not yet calibrated: until T9.04 records the chosen value the JEV pass annotates and the floor file maps only the code facts to no_model",
  ],
  rollback:
    "unbind the JEV pass; the slot runs code-only as in T3.08; recorded steps stay on the record",
  failure_test:
    "Fail if: a turn waits on a JEV call; a route the floor file does not map is applied; a broadcast makes one call per recipient; an operator message is silenced",
  ryan_act: "none",
  governing_shapes: [
    "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-30-ryan-jev-and-model-calls-have-no-limits-unless-ryan-mints-one.yaml",
    "/Users/Admin/core-root/vault/00_Core/Architecture/Intent-Layer/foundation/shape-adapter/corpus/SHAPE-2026-09-16-ryan-transfer-the-gate-to-a-floor-governed-process-never-operator-tokens-and-fix-before-delivery-not-at-stop.yaml",
  ],
  command_grammar: "IC-002",
  delta_sources: [
    "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-05/Fable-Delta-JEV-Cost-Router.json",
  ],
} as unknown as Task);

export const JEV_COST_ROUTER_DELTA = {
  source_documents: [
    {
      path: "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/plans/next-gen-spec-2026-10-07/execution/phase-05/Fable-Delta-JEV-Cost-Router.json",
      sha256: "aa20ea86062839e9bf973c99c9580a4d3d1190588898cca1727cc0bcd7ccb224",
    },
  ],
  decision: "D25",
  new_task_ids: ["T3.08", "T9.06"],
  amended: ["K07", "T3.01", "T3.02", "T7.03", "T8.01", "T9.02", "T9.04", "T11.02", "T11.04"],
  projection_notes: [
    "D25's rejected_alternative is carried in the decision's alternative field.",
    "New task file rows carry surface authoring; both new tasks carry command_grammar IC-002 like every task.",
    "done_when appends land on done_when.expect, the convention for done_when appends since R2.",
    "Ryan's Oct 10 words travel as D25.post_cutoff_ryan_words; the post-cutoff ledger item is outside the spec folder and not recorded in this pass, so D25 stands on its fable_call as the delta specifies.",
    "S3-C13 and S9-C06 stay planned checks (file_ready false) and are not added to spec.checks.",
  ],
};

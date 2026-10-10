// Negative fixtures for check-spec.mts (architecture finding A02): each mutation of a copy of the valid spec must FAIL the named check,
// and the unmutated copy must PASS. Run: node test-check-spec.mts    (exit 1 if any expectation is wrong)
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = ["check-spec.mts", "spec.json", "Spec-Map.html", "Seam-Baseline.json"];
type Case = { name: string; expect: "PASS" | "FAIL"; checks: string[]; mutate: (s: any) => void };
const cases: Case[] = [
  { name: "valid copy", expect: "PASS", checks: [], mutate: () => {} },
  {
    name: "slice cycle: slice-2 depends on slice-13",
    expect: "FAIL",
    checks: ["X03", "X14"],
    mutate: (s) => {
      s.slices.find((x: any) => x.id === "slice-2").depends_on.push("slice-13");
    },
  },
  {
    name: "invented task state",
    expect: "FAIL",
    checks: ["X13"],
    mutate: (s) => {
      s.tasks[0].detail_state = "banana";
    },
  },
  {
    name: "upstream edits up to exactly the admitted ceiling: X15 still passes",
    expect: "PASS",
    checks: [],
    mutate: (s) => {
      const ceiling = JSON.parse(
        readFileSync(join(HERE, "Seam-Baseline.json"), "utf8"),
      ).admitted_upstream_edit_count;
      const n = ceiling - s.seam.upstream_edit_count_in_spec;
      for (let i = 0; i < n; i++) {
        const p = `apps/server/src/at-ceiling-file-${i}.ts`;
        s.tasks[0].files.push({ path: p, side: "upstream-edit", action: "edit" });
        s.seam.upstream_edit_files_in_spec.push(p);
      }
      s.seam.upstream_edit_count_in_spec += n;
    },
  },
  {
    name: "one upstream edit above the admitted ceiling: X15 refuses",
    expect: "FAIL",
    checks: ["X15"],
    mutate: (s) => {
      const ceiling = JSON.parse(
        readFileSync(join(HERE, "Seam-Baseline.json"), "utf8"),
      ).admitted_upstream_edit_count;
      const n = Math.max(1, ceiling - s.seam.upstream_edit_count_in_spec + 1);
      for (let i = 0; i < n; i++) {
        const p = `apps/server/src/above-ceiling-file-${i}.ts`;
        s.tasks[0].files.push({ path: p, side: "upstream-edit", action: "edit" });
        s.seam.upstream_edit_files_in_spec.push(p);
      }
      s.seam.upstream_edit_count_in_spec += n;
    },
  },
  {
    name: "the original generation, with the seven verified fork files counted as upstream edits again: X15 refuses",
    expect: "FAIL",
    checks: ["X15"],
    mutate: (s) => {
      const fork = [
        "apps/server/src/orchestration/AbsurdRuntimeInProcess.ts",
        "apps/server/src/mcp/ComsNetTransport.ts",
        "apps/server/src/mcp/ComsNetCorrelation.ts",
        "apps/server/src/provider/Layers/PiProvider.ts",
        "packages/contracts/src/modelOffering.ts",
        "apps/desktop/linux/install-linux.sh",
        "apps/desktop/mac/install-mac.sh",
      ];
      for (const t of s.tasks)
        for (const f of t.files ?? []) if (fork.includes(f.path)) f.side = "upstream-edit";
      const set = new Set<string>();
      for (const t of s.tasks)
        for (const f of t.files ?? [])
          if (f.side === "upstream-edit" && f.action !== "read") set.add(f.path);
      s.seam.upstream_edit_files_in_spec = [...set].sort();
      s.seam.upstream_edit_count_in_spec = set.size;
    },
  },
  {
    name: "duplicate id across tasks and checks",
    expect: "FAIL",
    checks: ["X13"],
    mutate: (s) => {
      s.checks[0].id = s.tasks[0].id;
    },
  },
  {
    name: "a ledger item with no disposition",
    expect: "FAIL",
    checks: ["X11"],
    mutate: (s) => {
      s.ledger_dispositions.items.pop();
    },
  },
  {
    name: "an audit item dropped",
    expect: "FAIL",
    checks: ["X12"],
    mutate: (s) => {
      s.audit_dispositions.items = s.audit_dispositions.items.filter((x: any) => x.id !== "A03");
    },
  },
  {
    name: "acceptance node misses a task",
    expect: "FAIL",
    checks: ["X14"],
    mutate: (s) => {
      s.acceptance.depends_on.tasks.pop();
    },
  },
  {
    name: "stale rendered generation",
    expect: "FAIL",
    checks: ["X16"],
    mutate: (s) => {
      s.goal.note = (s.goal.note ?? "") + " (mutated)";
    },
  },
  ...[
    "/Users/Admin/core-root/src/tools/absurd-sandbox/dist/habitat-up.mjs",
    "~/.codex/hooks/test.mjs",
    "/Users/Admin/.claude/hooks/test.mjs",
    "/Applications/ThroughLine.app/Contents/Resources/test.js",
    "/home/twr/.local/share/throughline/app/test.js",
  ].map((path): Case => ({
    name: `deployed runtime edit: ${path}`,
    expect: "FAIL",
    checks: ["X17"],
    mutate: (s) => {
      s.tasks[0].files.push({ path, side: "outside-tool", action: "edit", surface: "authoring" });
    },
  })),
  {
    name: "task-owned labelled build output",
    expect: "PASS",
    checks: [],
    mutate: (s) => {
      const owner = "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox";
      s.tasks[0].files.push({
        path: `${owner}/dist/habitat-up.mjs`,
        side: "outside-tool",
        action: "run",
        surface: "build-output",
        owning_component: owner,
      });
    },
  },
  {
    name: "deployed runtime cannot masquerade as own build output",
    expect: "FAIL",
    checks: ["X17"],
    mutate: (s) => {
      s.tasks[0].files.push({
        path: "/Users/Admin/core-root/src/tools/absurd-sandbox/dist/habitat-up.mjs",
        side: "outside-tool",
        action: "edit",
        surface: "build-output",
        owning_component: "/Users/Admin/core-root/vault/01_Projects/workbench/tools/absurd-sandbox",
      });
    },
  },
  {
    name: "labelled runtime verification target",
    expect: "PASS",
    checks: [],
    mutate: (s) => {
      s.tasks[0].files.push({
        path: "/Users/Admin/core-root/src/tools/absurd-sandbox/dist/habitat-up.mjs",
        side: "outside-tool",
        action: "read",
        surface: "verification",
      });
    },
  },
  {
    name: "verification target cannot be edited",
    expect: "FAIL",
    checks: ["X17"],
    mutate: (s) => {
      s.tasks[0].files.push({
        path: "packages/throughline-example/src/index.ts",
        side: "fork-namespace",
        action: "edit",
        surface: "verification",
      });
    },
  },
  {
    name: "executor outside the live roster",
    expect: "FAIL",
    checks: ["X18"],
    mutate: (s) => {
      s.tasks[0].executor.model_preference = "not-a-live-model";
    },
  },
  {
    name: "one of the six alignment dispositions dropped",
    expect: "FAIL",
    checks: ["X12"],
    mutate: (s) => {
      s.audit_dispositions.items = s.audit_dispositions.items.filter((x: any) => x.id !== "IA-06");
    },
  },
  {
    name: "guessed system PostgreSQL unit",
    expect: "FAIL",
    checks: ["X19"],
    mutate: (s) => {
      s.tasks.find((t: any) => t.id === "T4.03").service_binding.unit = "postgresql.service";
    },
  },
  {
    name: "Mac-only observer cannot satisfy laptop-closed test",
    expect: "FAIL",
    checks: ["X19"],
    mutate: (s) => {
      s.tasks.find((t: any) => t.id === "T4.03").observer.host = "mac";
    },
  },
  {
    name: "notification grant prerequisite silently dropped",
    expect: "FAIL",
    checks: ["X19"],
    mutate: (s) => {
      s.tasks.find((t: any) => t.id === "T4.03").acceptance_prerequisites.pop();
    },
  },
  {
    name: "selected decision message identity forged with the same quote",
    expect: "FAIL",
    checks: ["X07"],
    mutate: (s) => {
      s.decisions.find((d: any) => d.id === "D03").ryan_quote.message_id =
        "not-the-admitted-message";
    },
  },
  {
    name: "authored decision message selector dropped",
    expect: "FAIL",
    checks: ["X07"],
    mutate: (s) => {
      delete s.decisions.find((d: any) => d.id === "D03").quote_selection;
    },
  },
  {
    name: "sender-unverified later reply promoted to Ryan",
    expect: "FAIL",
    checks: ["X07"],
    mutate: (s) => {
      s.decisions.find((d: any) => d.id === "D06").later_sources[0].speaker = "ryan";
    },
  },
  // X20 declaration-only discriminators. Runtime/native-device tests remain future work.
  {
    name: "T13.04 original generic row-tests placeholder despite nonempty signatures",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      s.tasks.find((t: any) => t.id === "T13.04").done_when.command =
        "row tests version on all five devices";
    },
  },
  {
    name: "T13.04 incomplete identities despite shortened task declaration",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      const t = s.tasks.find((t: any) => t.id === "T13.04");
      t.device_cells = t.device_cells.filter((x: string) => x !== "version@android");
      t.acceptance_interface.required_targets = t.acceptance_interface.required_targets.filter(
        (x: string) => x !== "android",
      );
      t.acceptance_interface.target_bindings = t.acceptance_interface.target_bindings.filter(
        (x: any) => x.target !== "android",
      );
    },
  },
  {
    name: "T13.04 five entries with duplicate ios and missing android",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      const t = s.tasks.find((t: any) => t.id === "T13.04");
      t.acceptance_interface.required_targets = t.acceptance_interface.required_targets.map(
        (x: string) => (x === "android" ? "ios" : x),
      );
      t.device_cells = t.device_cells.map((x: string) =>
        x === "version@android" ? "version@ios" : x,
      );
    },
  },
  {
    name: "T13.04 rpi binding cannot substitute twr readback evidence",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      s.tasks
        .find((t: any) => t.id === "T13.04")
        .acceptance_interface.target_bindings.find((x: any) => x.target === "rpi").readback_target =
        "twr";
    },
  },
  {
    name: "T13.04 immutable snapshot survives unrelated current goal regeneration",
    expect: "PASS",
    checks: [],
    mutate: (s) => {
      s.goal.note += " (unrelated metadata fixture)";
    },
  },
  {
    name: "T13.04 changed immutable snapshot digest refuses",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      s.tasks.find(
        (t: any) => t.id === "T13.04",
      ).acceptance_interface.required_targets_binding.source_snapshot.sha256 = "0".repeat(64);
    },
  },
  {
    name: "T13.04 read-only retry invocation is not itself build classification",
    expect: "PASS",
    checks: [],
    mutate: (s) => {
      const a = s.tasks.find((t: any) => t.id === "T13.04").acceptance_interface.actor_binding;
      a.exclude_invocation_alone = false;
      a.read_only_verifier_allowed_only_if_not_excluded = true;
    },
  },
  {
    name: "T13.04 no exemption for verified current build-ship caller",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      const a = s.tasks.find((t: any) => t.id === "T13.04").acceptance_interface.actor_binding;
      a.excluded_actual_actor_classes = a.excluded_actual_actor_classes.filter(
        (x: string) => x !== "verified-current-build-ship-caller",
      );
    },
  },
  {
    name: "T13.04 cannot exclude independent verifier merely for invoking retry",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      s.tasks.find(
        (t: any) => t.id === "T13.04",
      ).acceptance_interface.actor_binding.exclude_invocation_alone = true;
    },
  },
  {
    name: "T13.04 version-only helper metadata cannot prove installed commit",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      s.tasks.find(
        (t: any) => t.id === "T13.04",
      ).acceptance_interface.protected_readbacks.helper_metadata_alone_proves_installed_commit =
        true;
    },
  },
  {
    name: "T13.04 waiting remains existing non-pass outcome",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      s.tasks.find((t: any) => t.id === "T13.04").acceptance_interface.outcome_mapping.waiting =
        "passed";
    },
  },
  // 0.4.0: the executable acceptance contract (finding T13.04-EXECUTABLE-ACCEPTANCE-BINDING)
  {
    name: "T13.04 readback that reports only the release cannot prove one commit",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      s.tasks
        .find((t: any) => t.id === "T13.04")
        .acceptance_interface.per_target_readback.find((x: any) => x.target === "rpi").fields = [
        "release",
      ];
    },
  },
  {
    name: "T13.04 a target with no readback method refuses",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      const a = s.tasks.find((t: any) => t.id === "T13.04").acceptance_interface;
      a.per_target_readback = a.per_target_readback.filter((x: any) => x.target !== "twr");
    },
  },
  {
    name: "T13.04 commit mismatch refusal dropped",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      const a = s.tasks.find((t: any) => t.id === "T13.04").acceptance_interface;
      a.refusals = a.refusals.filter((x: any) => x.code !== "TARGET_COMMIT_MISMATCH:<target>");
    },
  },
  {
    name: "T13.04 Android screen wait cannot become a pass",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      s.tasks
        .find((t: any) => t.id === "T13.04")
        .acceptance_interface.refusals.find(
          (x: any) => x.code === "ANDROID_SCREEN_PROOF_WAITING",
        ).outcome = "passed";
    },
  },
  {
    name: "T13.04 a second pipeline cannot stand in for the existing step contract",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      s.tasks.find(
        (t: any) => t.id === "T13.04",
      ).acceptance_interface.pipeline_step.second_pipeline = true;
    },
  },
  {
    name: "T13.04 commit prefix match refuses",
    expect: "FAIL",
    checks: ["X20"],
    mutate: (s) => {
      s.tasks.find((t: any) => t.id === "T13.04").acceptance_interface.comparison.commit =
        "first 12 characters match";
    },
  },
];

let bad = 0;
for (const c of cases) {
  const dir = mkdtempSync(join(tmpdir(), "ngspec-check-"));
  for (const f of FILES) cpSync(join(HERE, f), join(dir, f));
  const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
  // The disposable fixture keeps the original design bindings, just as the old absolute-path spec did.
  for (const s of spec.generated_by?.source_files ?? []) s.path = resolve(HERE, s.path);
  for (const check of spec.checks) check.file = resolve(HERE, check.file);
  c.mutate(spec);
  writeFileSync(join(dir, "spec.json"), JSON.stringify(spec, null, 2) + "\n");
  if (c.name !== "stale rendered generation") {
    // keep X16 quiet for mutations that are not about rendering: re-stamp the HTML with the mutated spec's hash
    const { createHash } = await import("node:crypto");
    const h = createHash("sha256")
      .update(readFileSync(join(dir, "spec.json")))
      .digest("hex");
    writeFileSync(
      join(dir, "Spec-Map.html"),
      readFileSync(join(dir, "Spec-Map.html"), "utf8").replace(
        /name="spec-sha256"\s+content="[0-9a-f]{64}"/,
        `name="spec-sha256" content="${h}"`,
      ),
    );
  }
  const r = spawnSync("node", [join(dir, "check-spec.mts")], { encoding: "utf8" });
  const out = r.stdout + r.stderr;
  const verdict = r.status === 0 ? "PASS" : "FAIL";
  const named = c.checks.every((id) => new RegExp(`^FAIL  ${id} `, "m").test(out));
  const ok = verdict === c.expect && (c.expect === "PASS" || named);
  if (!ok) bad++;
  console.log(
    `${ok ? "OK  " : "BAD "} ${c.name}: expected ${c.expect}${c.checks.length ? " on " + c.checks.join(",") : ""}, got ${verdict}${c.checks.length ? (named ? " with the named checks" : " without " + c.checks.filter((id) => !new RegExp(`^FAIL  ${id} `, "m").test(out)).join(",")) : ""}`,
  );
  rmSync(dir, { recursive: true, force: true });
}
console.log(
  `\n${cases.length - bad} of ${cases.length} fixtures behaved  (${new Date().toISOString()})`,
);
process.exit(bad ? 1 : 0);

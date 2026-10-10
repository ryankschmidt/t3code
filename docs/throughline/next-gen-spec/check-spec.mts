// Structural checks on spec.json itself. Run: node check-spec.mts   (exit 1 on any FAIL)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { posix } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(HERE, "spec.json"), "utf8"));
const { threadMessages: selectedQuoteMessages } = await import(
  pathToFileURL(join(dirname(spec.ledger.path), "ledger-source.mts")).href
);
const decisionSourceFile = spec.generated_by?.source_files?.find((x: any) =>
  x.path.endsWith("/contracts-data.mts"),
)?.path;
if (!decisionSourceFile) throw Error("missing authored decision-selector source binding");
const { DECISION_SOURCES: authoredDecisionSources } = await import(
  pathToFileURL(resolve(HERE, decisionSourceFile)).href
);
type Fail = string;
const results: Array<{ id: string; title: string; fails: Fail[] }> = [];
const check = (id: string, title: string, fn: () => Fail[]) => {
  let fails: Fail[];
  try {
    fails = fn();
  } catch (e) {
    fails = [`threw: ${(e as Error).message}`];
  }
  results.push({ id, title, fails });
};

const taskIds = new Set<string>(spec.tasks.map((t: any) => t.id));
const sliceIds = new Set<string>(spec.slices.map((s: any) => s.id));
const preIds = new Set<string>(
  spec.slices.filter((s: any) => s.precondition).map((s: any) => s.precondition.id),
);
const checkIds = new Set<string>(spec.checks.map((c: any) => c.id));

check(
  "X01",
  "spec parses, carries the schema, a goal in Ryan's words and a bound ledger hash that matches the ledger on disk",
  () => {
    const f: Fail[] = [];
    if (spec.schema !== "throughline.next-gen-spec.v1") f.push("schema");
    if (!spec.goal?.quote) f.push("goal quote missing");
    if (!existsSync(spec.ledger.path)) f.push(`ledger missing: ${spec.ledger.path}`);
    else {
      const sha = createHash("sha256").update(readFileSync(spec.ledger.path)).digest("hex");
      if (sha !== spec.ledger.sha256)
        f.push(
          `ledger sha256 drifted: spec ${spec.ledger.sha256.slice(0, 12)} disk ${sha.slice(0, 12)}; rebuild`,
        );
    }
    return f;
  },
);
check(
  "X02",
  "every task is complete: id, slice, title, serves, what, done_when, executor, rollback; detailed tasks carry files, signatures and a failing check",
  () => {
    const f: Fail[] = [];
    for (const t of spec.tasks) {
      for (const k of ["id", "slice", "title", "what", "rollback"])
        if (!t[k] || String(t[k]).trim() === "") f.push(`${t.id ?? "?"}: ${k} empty`);
      if (!Array.isArray(t.serves) || t.serves.length === 0) f.push(`${t.id}: serves empty`);
      if (!sliceIds.has(t.slice)) f.push(`${t.id}: slice ${t.slice} unknown`);
      if (!t.executor?.model_preference) f.push(`${t.id}: executor`);
      if (t.detail_state === "detailed") {
        if (!t.files?.length) f.push(`${t.id}: detailed with no files`);
        if (!t.signatures?.length) f.push(`${t.id}: detailed with no signatures`);
        if (!t.failing_checks?.length) f.push(`${t.id}: detailed with no failing check`);
        if (!t.done_when?.command) f.push(`${t.id}: detailed with no done_when command`);
        for (const fe of t.files ?? [])
          if (
            ![
              "fork-namespace",
              "upstream-edit",
              "config",
              "vault",
              "outside-tool",
              "host-filesystem",
            ].includes(fe.side)
          )
            f.push(`${t.id}: file ${fe.path} side ${fe.side}`);
      }
    }
    return f;
  },
);
// The combined graph: tasks, slices, preconditions and the acceptance node as one node set. A task depends on its slice's
// prerequisite slices (every task of them) and on its own slice's precondition; a slice depends on its tasks and its prerequisite slices.
function combinedGraph(): { deps: Map<string, string[]>; fails: Fail[] } {
  const f: Fail[] = [];
  const deps = new Map<string, string[]>();
  const add = (n: string, d: string) => {
    if (!deps.has(n)) deps.set(n, []);
    deps.get(n)!.push(d);
  };
  for (const p of preIds) deps.set(p, []);
  for (const s of spec.slices) {
    deps.set(s.id, []);
    for (const d of s.depends_on ?? []) {
      if (sliceIds.has(d)) add(s.id, d);
      else f.push(`${s.id}: depends on unknown slice ${d}`);
    }
    for (const t of s.tasks ?? []) add(s.id, t);
    if (s.precondition) add(s.id, s.precondition.id);
  }
  for (const t of spec.tasks) {
    if (!deps.has(t.id)) deps.set(t.id, []);
    for (const d of t.depends_on ?? []) {
      if (taskIds.has(d) || preIds.has(d) || sliceIds.has(d)) add(t.id, d);
      else f.push(`${t.id}: depends on unknown ${d}`);
    }
    const slice = spec.slices.find((s: any) => s.id === t.slice);
    for (const d of slice?.depends_on ?? []) add(t.id, d);
    if (slice?.precondition) add(t.id, slice.precondition.id);
  }
  if (spec.acceptance) {
    deps.set(spec.acceptance.id, []);
    for (const k of ["tasks", "slices", "preconditions"] as const)
      for (const d of spec.acceptance.depends_on?.[k] ?? []) add(spec.acceptance.id, d);
  }
  return { deps, fails: f };
}
function cycles(deps: Map<string, string[]>): Fail[] {
  const f: Fail[] = [];
  const state = new Map<string, number>();
  const visit = (n: string, path: string[]): void => {
    const st = state.get(n) ?? 0;
    if (st === 1) {
      f.push(`cycle: ${[...path, n].join(" > ")}`);
      return;
    }
    if (st === 2) return;
    state.set(n, 1);
    for (const d of deps.get(n) ?? []) visit(d, [...path, n]);
    state.set(n, 2);
  };
  for (const id of deps.keys()) visit(id, []);
  return f;
}
check(
  "X03",
  "every dependency resolves to a task, a precondition or a slice, and the combined task-slice-precondition graph is acyclic",
  () => {
    const g = combinedGraph();
    return [...g.fails, ...cycles(g.deps)];
  },
);
check("X04", "every ledger id a task, slice or decision serves exists in the ledger", () => {
  const f: Fail[] = [];
  const ledger = JSON.parse(readFileSync(spec.ledger.path, "utf8"));
  const ids = new Set<string>(ledger.items.map((i: any) => i.id));
  const seen = new Set<string>();
  for (const x of [...spec.tasks, ...spec.slices, ...spec.decisions])
    for (const id of x.serves ?? []) {
      if (!ids.has(id)) f.push(`${x.id}: ${id} not in ledger`);
      seen.add(id);
    }
  return f;
});
check(
  "X05",
  "every check a task names exists, every check file exists on disk, and every check carries its expected state today",
  () => {
    const f: Fail[] = [];
    for (const t of spec.tasks)
      for (const c of t.failing_checks ?? [])
        if (!checkIds.has(c)) f.push(`${t.id}: check ${c} unknown`);
    for (const c of spec.checks) {
      if (!existsSync(resolve(HERE, c.file))) f.push(`${c.id}: file missing ${c.file}`);
      if (!["FAIL", "PASS"].includes(c.expected_today)) f.push(`${c.id}: expected_today`);
    }
    return f;
  },
);
check(
  "X06",
  "no task file or signature names the old home inside the vault (the spec is portable to the repository)",
  () => {
    const f: Fail[] = [];
    const old = spec.repository.old_home as string;
    for (const t of spec.tasks) {
      if (t.detail_state !== "detailed") continue;
      for (const fe of t.files ?? [])
        if (fe.path.startsWith(old) && !["move", "read", "run", "remove"].includes(fe.action))
          f.push(`${t.id}: ${fe.path} edits the old home`);
    }
    return f;
  },
);
check(
  "X07",
  "every decision carries a Ryan quote copied from the ledger item it names, or an explicit Fable call; quotes match the ledger bytes",
  () => {
    const f: Fail[] = [];
    const ledger = JSON.parse(readFileSync(spec.ledger.path, "utf8"));
    const byId = new Map(ledger.items.map((i: any) => [i.id, i]));
    for (const d of spec.decisions) {
      const expected = authoredDecisionSources[d.id];
      if (d.source_role !== expected?.role)
        f.push(`${d.id}: decision role differs from authored source contract`);
      if (
        expected?.quote_from_message &&
        (!d.quote_selection ||
          d.quote_selection.message_id !== expected.quote_from_message ||
          d.quote_selection.quote !== expected.quote_text)
      )
        f.push(`${d.id}: authored message-specific selection missing or changed`);
      if (!d.ryan_quote && !d.fable_call) f.push(`${d.id}: neither quote nor Fable call`);
      if (d.ryan_quote) {
        const item: any = byId.get(d.ryan_quote.ledger_item);
        const q = d.ryan_quote;
        const admitted =
          item &&
          (item.sources ?? []).some(
            (s: any) =>
              s.speaker === "ryan" &&
              s.message_id === q.message_id &&
              s.thread_id === q.thread_id &&
              (!d.quote_selection || d.quote_selection.message_id === s.message_id),
          );
        const m = admitted
          ? selectedQuoteMessages(q.thread_id).find((m: any) => m.messageId === q.message_id)
          : undefined;
        const ok =
          admitted &&
          m?.role === "user" &&
          m.text.includes(q.quote) &&
          (!d.quote_selection ||
            (d.quote_selection.speaker === "ryan" && d.quote_selection.quote === q.quote)) &&
          (d.quote_selection ||
            (item.sources ?? []).some(
              (s: any) =>
                s.speaker === "ryan" && s.message_id === q.message_id && s.quote === q.quote,
            ));
        if (!ok)
          f.push(
            `${d.id}: quote is not byte-identical to a Ryan source of ${d.ryan_quote.ledger_item}`,
          );
      }
      for (const s of d.later_sources ?? [])
        if (
          s.speaker !== "sender-unverified" ||
          !(byId.get(d.ryan_quote?.ledger_item)?.sources ?? []).some(
            (x: any) =>
              x.speaker === s.speaker && x.message_id === s.message_id && x.quote === s.quote,
          )
        )
          f.push(
            `${d.id}: later source was promoted or does not match the recorded sender-unverified source`,
          );
    }
    return f;
  },
);
check(
  "X08",
  "the seam accounting matches the tasks: the upstream-edit count equals the distinct upstream-edit files across tasks",
  () => {
    const f: Fail[] = [];
    const set = new Set<string>();
    for (const t of spec.tasks)
      for (const fe of t.files ?? [])
        if (fe.side === "upstream-edit" && fe.action !== "read") set.add(fe.path);
    if (set.size !== spec.seam.upstream_edit_count_in_spec)
      f.push(`computed ${set.size}, spec says ${spec.seam.upstream_edit_count_in_spec}`);
    return f;
  },
);
check(
  "X09",
  "the first slice is detailed and every later slice depends, directly or through others, on it",
  () => {
    const f: Fail[] = [];
    const first = spec.slices.find((s: any) => s.n === 1);
    if (!first || first.state !== "detailed") f.push("slice 1 is not detailed");
    const reach = (id: string, seen = new Set<string>()): boolean => {
      if (id === "slice-1") return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const s = spec.slices.find((x: any) => x.id === id);
      return (s?.depends_on ?? []).some((d: string) => reach(d, seen));
    };
    for (const s of spec.slices)
      if (s.n !== 1 && !reach(s.id)) f.push(`${s.id} does not depend on slice-1`);
    return f;
  },
);

check(
  "X10",
  "every pending Ryan decision carries its authority: a Ryan quote byte-identical to the ledger, an existing standard with its sentence, or an explicit proposal that requires nothing of Ryan",
  () => {
    const f: Fail[] = [];
    const ledger = JSON.parse(readFileSync(spec.ledger.path, "utf8"));
    const byId = new Map(ledger.items.map((i: any) => [i.id, i]));
    for (const r of spec.ryan_decisions_pending ?? []) {
      const a = r.authority;
      if (!a) {
        f.push(`${r.id}: no authority`);
        continue;
      }
      if (a.kind === "ryan-quote") {
        const item: any = byId.get(a.ledger_item);
        if (
          !item ||
          !(item.sources ?? []).some((s: any) => s.speaker === "ryan" && s.quote === a.quote)
        )
          f.push(`${r.id}: quote not byte-identical to a Ryan source of ${a.ledger_item}`);
      } else if (a.kind === "standard") {
        if (!a.source || !existsSync(a.source)) f.push(`${r.id}: standard source missing`);
        else if (!a.quote || !readFileSync(a.source, "utf8").includes(a.quote))
          f.push(`${r.id}: the quoted sentence is not in the standard`);
      } else if (a.kind === "proposal") {
        if (a.ryan_required !== false)
          f.push(`${r.id}: a proposal must state ryan_required: false`);
      } else f.push(`${r.id}: unknown authority kind ${a.kind}`);
    }
    return f;
  },
);

check(
  "X11",
  "K16: every ledger item has a disposition from the closed set; an implemented item carries an acceptance obligation; every external capability carries a consumption test",
  () => {
    const f: Fail[] = [];
    const ledger = JSON.parse(readFileSync(spec.ledger.path, "utf8"));
    const items = new Map<string, any>(
      (spec.ledger_dispositions?.items ?? []).map((x: any) => [x.id, x]),
    );
    const kinds = new Set([
      "implemented",
      "inherited-constraint",
      "external-capability",
      "deferred-exploration",
      "superseded",
    ]);
    for (const i of ledger.items) {
      const d = items.get(i.id);
      if (!d) {
        f.push(`${i.id}: no disposition`);
        continue;
      }
      if (!kinds.has(d.kind)) f.push(`${i.id}: kind ${d.kind}`);
      if (d.kind === "implemented" && (!d.by?.length || !d.acceptance))
        f.push(`${i.id}: implemented with no owner or no acceptance`);
      if (d.kind === "external-capability" && !d.consumption_test)
        f.push(`${i.id}: external capability with no consumption test`);
      if (d.kind === "superseded" && !d.by?.length) f.push(`${i.id}: superseded with no authority`);
    }
    return f;
  },
);
check(
  "X12",
  "every audit item (F01-F13, A01-A18, J2, the overlapping IA items) has one disposition from the closed set, and every id it names exists",
  () => {
    const f: Fail[] = [];
    const ids = new Set<string>([
      ...taskIds,
      ...sliceIds,
      ...preIds,
      ...checkIds,
      ...spec.decisions.map((d: any) => d.id),
      ...(spec.contracts ?? []).map((k: any) => k.id),
      ...(spec.ryan_decisions_pending ?? []).map((r: any) => r.id),
      "ACCEPTANCE",
      "DEVICE_MATRIX",
      "P0",
      "test-check-spec.mts",
      ...(spec.contracts ? ["X03", "X11", "X12", "X13", "X14", "X15", "X16"] : []),
    ]);
    const required = [
      ...Array.from({ length: 13 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`),
      ...Array.from({ length: 18 }, (_, i) => `A${String(i + 1).padStart(2, "0")}`),
      "J2",
      "IA-02",
      "IA-03",
      "IA-04",
      "IA-05",
      "IA-06",
      "IA-09",
    ];
    const items = new Map<string, any>(
      (spec.audit_dispositions?.items ?? []).map((x: any) => [x.id, x]),
    );
    const disp = new Set([
      "already-resolved",
      "consequential-choice",
      "bounded-repair",
      "evidence-needed",
    ]);
    for (const id of required) if (!items.has(id)) f.push(`${id}: no disposition`);
    for (const x of items.values()) {
      if (!disp.has(x.disposition)) f.push(`${x.id}: disposition ${x.disposition}`);
      if (!x.current_state) f.push(`${x.id}: no current_state`);
      if (!x.answered_by?.length) f.push(`${x.id}: answered_by empty`);
      for (const a of x.answered_by ?? []) if (!ids.has(a)) f.push(`${x.id}: names unknown ${a}`);
      if (x.disposition === "bounded-repair" && !x.opus_repair)
        f.push(`${x.id}: bounded-repair with no repair text`);
      if (x.disposition === "evidence-needed" && !x.evidence_test)
        f.push(`${x.id}: evidence-needed with no test`);
    }
    return f;
  },
);
check(
  "X13",
  "closed enums and unique ids: task detail_state, check kind and expected_today, disposition kinds, decision source roles; no id used twice across tasks, slices, checks, decisions, contracts, pending decisions",
  () => {
    const f: Fail[] = [];
    const seen = new Map<string, string>();
    const uniq = (id: string, where: string) => {
      if (seen.has(id)) f.push(`id ${id} used by ${seen.get(id)} and ${where}`);
      else seen.set(id, where);
    };
    for (const t of spec.tasks) {
      uniq(t.id, "tasks");
      if (!["detailed", "outline"].includes(t.detail_state))
        f.push(`${t.id}: detail_state ${t.detail_state}`);
      if (
        (t.files ?? []).some(
          (x: any) => !["add", "edit", "move", "remove", "read", "run"].includes(x.action),
        )
      )
        f.push(`${t.id}: file action outside the closed set`);
    }
    for (const s of spec.slices) {
      uniq(s.id, "slices");
      if (!["detailed", "outline"].includes(s.state)) f.push(`${s.id}: state ${s.state}`);
    }
    for (const c of spec.checks) {
      uniq(c.id, "checks");
      if (!["real-disk", "unit", "structural", "guard"].includes(c.kind))
        f.push(`${c.id}: kind ${c.kind}`);
    }
    for (const d of spec.decisions) {
      uniq(d.id, "decisions");
      if (
        !["requirement", "adopted-proposal", "approving-context", "fable-mechanism"].includes(
          d.source_role,
        )
      )
        f.push(`${d.id}: source_role ${d.source_role}`);
      if (d.source_role === "approving-context" && !d.reselect_quote_from?.length)
        f.push(`${d.id}: approving-context with no reselect source`);
    }
    for (const k of spec.contracts ?? []) {
      uniq(k.id, "contracts");
      if (!k.statement || !k.tests?.length || !k.answers?.length)
        f.push(`${k.id}: incomplete contract`);
      for (const s of k.binds_slices ?? [])
        if (!sliceIds.has(s)) f.push(`${k.id}: binds unknown slice ${s}`);
    }
    for (const r of spec.ryan_decisions_pending ?? []) uniq(r.id, "pending");
    if (spec.acceptance) uniq(spec.acceptance.id, "acceptance");
    return f;
  },
);
check(
  "X14",
  "K10: the acceptance node depends on every task, every slice, every precondition and every required device cell, and the combined graph with it is acyclic",
  () => {
    const f: Fail[] = [];
    if (!spec.acceptance) return ["no acceptance node"];
    const dep = spec.acceptance.depends_on ?? {};
    for (const t of taskIds)
      if (!(dep.tasks ?? []).includes(t)) f.push(`acceptance misses task ${t}`);
    for (const s of sliceIds)
      if (!(dep.slices ?? []).includes(s)) f.push(`acceptance misses slice ${s}`);
    for (const p of preIds)
      if (!(dep.preconditions ?? []).includes(p)) f.push(`acceptance misses precondition ${p}`);
    const required = (spec.device_matrix?.rows ?? []).flatMap((r: any) =>
      r.cells
        .filter((c: any) => c.state === "required")
        .map((c: any) => `${r.key ?? r.capability.split(":")[0]}@${c.device}`),
    );
    for (const c of required)
      if (!(dep.device_cells ?? []).includes(c)) f.push(`acceptance misses device cell ${c}`);
    for (const r of spec.device_matrix?.rows ?? [])
      for (const c of r.cells) {
        if (c.state === "required" && (!c.owner || !taskIds.has(c.owner) || !c.test))
          f.push(
            `matrix ${r.capability.split(":")[0]}@${c.device}: required cell without an existing owner task or a test`,
          );
        if (c.state === "not-applicable" && !c.reason)
          f.push(
            `matrix ${r.capability.split(":")[0]}@${c.device}: not-applicable without a reason`,
          );
      }
    const g = combinedGraph();
    f.push(...cycles(g.deps));
    return f;
  },
);
check(
  "X15",
  "the edited-upstream count does not rise against the admitted baseline in Seam-Baseline.json",
  () => {
    const p = join(HERE, "Seam-Baseline.json");
    if (!existsSync(p)) return ["Seam-Baseline.json missing"];
    const b = JSON.parse(readFileSync(p, "utf8"));
    const n = spec.seam?.upstream_edit_count_in_spec ?? NaN;
    return Number.isFinite(n) && n <= b.admitted_upstream_edit_count
      ? []
      : [`spec names ${n} upstream files; admitted baseline is ${b.admitted_upstream_edit_count}`];
  },
);
check(
  "X16",
  "the rendered map is bound to this generation: Spec-Map.html carries the sha256 of spec.json and build inputs have not changed since the build",
  () => {
    const f: Fail[] = [];
    const html = join(HERE, "Spec-Map.html");
    if (!existsSync(html)) return ["Spec-Map.html missing"];
    const want = createHash("sha256")
      .update(readFileSync(join(HERE, "spec.json")))
      .digest("hex");
    const m = /name="spec-sha256"\s+content="([0-9a-f]{64})"/.exec(readFileSync(html, "utf8"));
    if (!m) f.push("Spec-Map.html carries no spec-sha256 meta");
    else if (m[1] !== want)
      f.push(
        `Spec-Map.html was rendered from ${m[1].slice(0, 12)}, spec.json is ${want.slice(0, 12)}: re-render`,
      );
    for (const s of spec.generated_by?.source_files ?? []) {
      const path = resolve(HERE, s.path);
      if (!existsSync(path)) {
        f.push(`source missing ${s.path}`);
        continue;
      }
      const now = createHash("sha256").update(readFileSync(path)).digest("hex");
      if (now !== s.sha256) f.push(`${s.path.split("/").pop()} changed since the build: rebuild`);
    }
    return f;
  },
);

check(
  "X17",
  "task edit surfaces are authoring sources; own labelled build outputs and runtime verification are distinct",
  () => {
    const f: Fail[] = [];
    const mutates = new Set(["add", "edit", "move", "remove"]);
    const normalize = (p: string) =>
      posix.normalize(p.startsWith("~/") ? `${homedir()}/${p.slice(2)}` : p);
    const inside = (p: string, root: string) => p === root || p.startsWith(`${root}/`);
    const deployed = (p: string) =>
      inside(p, "/Users/Admin/core-root/src") ||
      inside(p, "/Applications") ||
      /^\/(?:Users|home)\/[^/]+\/\.(?:codex|claude|agents|cowork|t3)(?:\/|$)/.test(p) ||
      /^\/(?:Users|home)\/[^/]+\/\.local\/share\/(?:throughline|t3code)(?:\/|$)/.test(p) ||
      /^\/(?:opt|usr\/lib|srv\/agents-runtime-state)\/(?:throughline|t3code)(?:\/|$)/.test(p);
    for (const t of spec.tasks)
      for (const fe of t.files ?? []) {
        const p = normalize(fe.path);
        if (deployed(p) && mutates.has(fe.action))
          f.push(`${t.id}: deployed runtime ${fe.path} cannot be an edit target`);
        if (
          fe.surface &&
          !["authoring", "build-output", "verification", "deployment"].includes(fe.surface)
        )
          f.push(`${t.id}: unknown surface ${fe.surface}`);
        if (fe.surface === "verification" && mutates.has(fe.action))
          f.push(`${t.id}: verification target ${fe.path} is mutated`);
        if (deployed(p) && fe.surface && fe.surface !== "verification")
          f.push(
            `${t.id}: deployed runtime ${fe.path} is labelled ${fe.surface}, not verification`,
          );
        if (fe.surface === "build-output") {
          const owner = fe.owning_component && normalize(fe.owning_component);
          const authoringOwner =
            owner &&
            (inside(owner, "/Users/Admin/core-root/vault/01_Projects/workbench") ||
              owner === spec.repository.home);
          const output = p.startsWith("/") ? p : normalize(`${spec.repository.home}/${p}`);
          if (!authoringOwner || !inside(output, owner))
            f.push(
              `${t.id}: build output ${fe.path} is not inside its declared authoring component`,
            );
        }
        if (fe.surface === "deployment" && (!fe.delivery_path || !fe.owning_component))
          f.push(`${t.id}: deployment ${fe.path} lacks an owning delivery contract`);
      }
    return f;
  },
);
check(
  "X18",
  "task executors resolve to the live seat roster; T4.03 uses the live Codex workhorse model and effort",
  () => {
    const r = spawnSync("ryan", ["model", "list", "--json"], { encoding: "utf8", timeout: 30000 });
    if (r.status !== 0)
      return [`live model policy did not resolve: ${r.error?.message ?? r.stderr.trim()}`];
    const live = JSON.parse(r.stdout).result;
    if (!live?.models?.length || !live?.policy?.task_roles?.length)
      return ["live model roster or task-role policy is empty"];
    const roster = new Map<string, any>(
      live.models
        .filter((m: any) => m.status === "current" && m.seat_launch === true)
        .map((m: any) => [m.id, m]),
    );
    const f: Fail[] = [];
    for (const t of spec.tasks)
      for (const [label, e] of [
        ["executor", t.executor],
        ["reviewer", t.reviewer],
      ] as const) {
        if (!e) continue;
        if (!["manager", "implementer", "implementer-light", "reviewer", "judge"].includes(e.role))
          f.push(`${t.id}: ${label} role ${e.role} outside roster contract`);
        const model = roster.get(e.model_preference);
        if (!model) {
          f.push(`${t.id}: ${label} model ${e.model_preference} outside live roster`);
          continue;
        }
        const roles = live.policy.task_roles.filter((p: any) => p.model === model.id);
        if (!roles.some((p: any) => (p.allowed_efforts ?? [p.effort]).includes(e.effort)))
          f.push(`${t.id}: ${label} effort ${e.effort} not admitted for ${model.id}`);
      }
    const workhorse = live.policy.task_roles.find(
      (p: any) => p.name === live.policy.defaults.codex_workhorse,
    );
    const task = spec.tasks.find((t: any) => t.id === "T4.03");
    if (
      task &&
      (!workhorse ||
        task.executor.role !== "implementer" ||
        task.executor.model_preference !== workhorse.model ||
        task.executor.effort !== workhorse.effort)
    )
      f.push("T4.03 does not match the live Codex workhorse");
    return f;
  },
);

check(
  "X19",
  "watch-before-retirement binds the read-back unit and independent observer; unresolved delivery/grant prerequisites cannot disappear",
  () => {
    const f: Fail[] = [];
    const t = spec.tasks.find((t: any) => t.id === "T4.03");
    const cutover = spec.tasks.find((t: any) => t.id === "T4.02");
    if (!t) return ["T4.03 missing"];
    if (!(cutover?.depends_on ?? []).includes(t.id)) f.push("T4.02 does not require T4.03");
    if ((t.depends_on ?? []).some((id: string) => /^T(?:6|12)\./.test(id)))
      f.push("T4.03 cannot depend on a later launcher/fleet slice");
    const b = t.service_binding;
    if (
      !b ||
      b.host !== "twr" ||
      b.unit !== "state-dependent" ||
      b.scope !== "state-dependent" ||
      b.address !== "100.96.34.116:5432"
    )
      f.push("T4.03 state-scoped record binding missing");
    for (const [state, owner, scope, unit] of [
      ["shared-account", "twr", "user", "absurd-pg.service"],
      [
        "record-isolated-seats-shared",
        "throughline-record",
        "system",
        "throughline-record.service",
      ],
      ["authority-isolated", "throughline-record", "system", "throughline-record.service"],
    ]) {
      const row = b?.state_bindings?.find((r: any) => r.state === state);
      if (
        !row ||
        row.owner !== owner ||
        row.scope !== scope ||
        row.unit !== unit ||
        !row.readback?.includes("systemctl") ||
        !row.readback.includes("Restart")
      )
        f.push("T4.03 incorrect unit for state " + state);
    }
    if (
      !t.done_when.command.includes("Restart=always") ||
      !b?.proof_scope?.includes("no live record")
    )
      f.push("T4.03 lacks state-scoped restart proof boundary");
    if (!b?.readback_source || !existsSync(b.readback_source) || !b.configuration_at_intake)
      f.push("unit readback source or intake probe missing");
    if (
      t.observer?.host !== "rpi" ||
      t.observer?.owner !== "rpi" ||
      !t.observer?.availability ||
      !t.observer?.status_path ||
      !t.observer?.independent_delivery ||
      !t.observer?.acceptance
    )
      f.push("independent laptop-closed observer contract missing");
    for (const id of ["rpi-user-unit-delivery", "rpi-independent-notification"]) {
      const p = (t.acceptance_prerequisites ?? []).find((p: any) => p.id === id);
      if (!p || p.status !== "required" || !p.owner || !p.first_action || !p.test)
        f.push(`T4.03 prerequisite ${id} is not a required owned contract`);
    }
    if (!(t.governing_shapes ?? []).length) f.push("T4.03 governing shapes missing");
    for (const p of t.governing_shapes ?? [])
      if (!existsSync(p)) f.push(`governing shape missing: ${p}`);
    return f;
  },
);

// Bounded design-declaration check only: no release/device/runtime action is executed.
check(
  "X20",
  "T13.04 binds the owned acceptance declaration and immutable required target identities",
  () => {
    const f: Fail[] = [],
      t = spec.tasks.find((x: any) => x.id === "T13.04");
    if (!t) return ["T13.04 missing"];
    const command = "ryan throughline ship <release> --retry-step five-device-acceptance --json";
    if (t.done_when?.command !== command)
      f.push("original generic row-tests placeholder or wrong owned invocation");
    const a = t.acceptance_interface;
    if (!a) return [...f, "owned acceptance interface missing"];
    const owner = "/Users/Admin/core-root/vault/01_Projects/workbench/tools/throughline-ship";
    for (const [key, want] of Object.entries({
      id: "I-07/FiveDeviceReleaseAcceptance",
      owner: "throughline-ship",
      adapter: "five-device-acceptance",
      input_schema: "throughline.five-device-acceptance-input.v1",
      result_schema: "throughline.five-device-release-acceptance.v1",
      receipt: "{evidence}/T13.04/five-device-acceptance.attempt-{attempt}.json",
      runtime_state: "proposed-not-implemented",
      source_module: owner + "/src/five-device-acceptance.ts",
      compiled_module:
        "/Users/Admin/core-root/src/tools/throughline-ship/dist/five-device-acceptance.js",
    }))
      if (a[key] !== want) f.push("acceptance declaration mismatch: " + key);
    if (
      a.function_signature !==
      "export async function fiveDeviceAcceptance(context: OwnedAcceptanceContext, input: FiveDeviceAcceptanceInput, probes: FiveDeviceAcceptanceProbes): Promise<FiveDeviceAcceptanceResult>"
    )
      f.push("exact typed owning function signature missing");
    if (
      JSON.stringify(a.invocation_argv) !==
      JSON.stringify([
        "ryan",
        "throughline",
        "ship",
        "<release>",
        "--retry-step",
        "five-device-acceptance",
        "--json",
      ])
    )
      f.push("owning argv mismatch");
    if (
      !(t.interfaces?.consumes ?? []).includes("I-07") ||
      !t.files?.some(
        (x: any) => x.path === a.source_module && x.action === "add" && x.side === "outside-tool",
      )
    )
      f.push("I-07/source ownership declaration missing");
    const b = a.required_targets_binding;
    const sourceRoot = dirname(dirname(dirname(spec.ledger.path)));
    const expectedSnapshot = join(
      sourceRoot,
      "execution",
      "phase-02",
      "packets",
      "Acceptance-Correction-Before-spec.json",
    );
    if (!b || b.source_snapshot?.path !== expectedSnapshot || !existsSync(expectedSnapshot))
      return [...f, "immutable target snapshot binding missing"];
    const bytes = readFileSync(expectedSnapshot),
      digest = createHash("sha256").update(bytes).digest("hex");
    if (b.source_snapshot.sha256 !== digest)
      return [...f, "immutable target snapshot digest mismatch"];
    const snapshot = JSON.parse(bytes.toString("utf8")),
      row = snapshot.device_matrix.rows.find((x: any) => x.key === "version");
    if (!row) return [...f, "admitted version contract missing"];
    const rowDigest = createHash("sha256").update(JSON.stringify(row)).digest("hex");
    if (b.version_row?.sha256 !== rowDigest) f.push("stable version-row digest mismatch");
    const admitted: string[] = row.cells
      .filter((x: any) => x.state === "required")
      .map((x: any) => x.device);
    const amendment = b.scope_amendment;
    if (
      !amendment ||
      amendment.instruction !== "IC-008" ||
      amendment.source !== spec.instruction_coverage?.source?.path ||
      amendment.source_message_id !== "5a024d4c-6a95-4d33-a6b6-77124d0a2471" ||
      JSON.stringify(amendment.removed_targets) !== '["rpi"]' ||
      amendment.counts_as_passed !== false
    )
      return [...f, "Raspberry Pi pause is not bound to the exact later instruction"];
    const expected = admitted.filter((id) => id !== "rpi");
    if (
      !expected.length ||
      new Set(expected).size !== expected.length ||
      expected.some((x) => !Object.keys(snapshot.device_matrix.roles).includes(x))
    )
      return [...f, "invalid admitted target identities"];
    const sameIds = (got: unknown) =>
      Array.isArray(got) &&
      got.every((x) => typeof x === "string") &&
      new Set(got).size === got.length &&
      JSON.stringify([...got].sort()) === JSON.stringify([...expected].sort());
    if (
      !sameIds(a.required_targets) ||
      JSON.stringify(b.version_row.target_ids) !== JSON.stringify(admitted)
    )
      f.push("incomplete/duplicate/mismatched required target coverage");
    if (
      !Array.isArray(t.device_cells) ||
      t.device_cells.some((x: any) => typeof x !== "string" || !x.startsWith("version@")) ||
      !sameIds(t.device_cells.map((x: string) => x.slice("version@".length)))
    )
      f.push("device-cell identities do not equal admitted contract");
    const currentRow = spec.device_matrix.rows.find((x: any) => x.key === "version");
    if (
      !currentRow ||
      createHash("sha256")
        .update(
          JSON.stringify({
            ...currentRow,
            cells: currentRow.cells.map((c: any) => (c.device === "rpi" ? c.deferred_contract : c)),
          }),
        )
        .digest("hex") !== rowDigest
    )
      f.push("current version contract drift from preserved source");
    const pausedCell = currentRow?.cells.find((c: any) => c.device === "rpi");
    if (
      pausedCell?.state !== "deferred" ||
      pausedCell?.instruction !== "IC-008" ||
      pausedCell?.counts_as_passed !== false
    )
      f.push("paused version cell is missing, required or counted passed");
    const deferred = a.deferred_targets?.rpi;
    if (
      deferred?.state !== "deferred" ||
      deferred?.counts_as_passed !== false ||
      JSON.stringify(deferred.protected_steps) !== '["rpi-cold-turn"]' ||
      createHash("sha256")
        .update(
          JSON.stringify({
            target_bindings: deferred.target_bindings,
            per_target_readback: deferred.per_target_readback,
            protected_steps: deferred.protected_steps,
          }),
        )
        .digest("hex") !== "05401991b81577c90b1f1f41d7a87dcea6c72e8675e0c407cecabd0d595e1119"
    )
      f.push("deferred Raspberry Pi bindings or readback history changed");
    const bindings = a.target_bindings;
    if (
      !Array.isArray(bindings) ||
      !sameIds(bindings.map((x: any) => x.target)) ||
      bindings.some((x: any) => x.readback_target !== x.target || x.screenshot_target !== x.target)
    )
      f.push("mismatched installed-readback/screenshot target declaration");
    const actor = a.actor_binding,
      exclusions = ["build", "install", "proof-author", "verified-current-build-ship-caller"];
    if (
      !actor ||
      actor.authority !== "I-07 and identity ownership, not caller labels" ||
      JSON.stringify([...(actor.excluded_actual_actor_classes ?? [])].sort()) !==
        JSON.stringify(exclusions.sort()) ||
      actor.exclude_invocation_alone !== false ||
      actor.read_only_verifier_allowed_only_if_not_excluded !== true
    )
      f.push("actual actor exclusions/current build-ship caller/read-only distinction invalid");
    const protectedSteps = ["testflight-readback", "tower-cold-turn"],
      p = a.protected_readbacks;
    if (
      !p ||
      JSON.stringify([...(p.step_ids ?? [])].sort()) !== JSON.stringify(protectedSteps.sort()) ||
      p.require_run_source_install_effects !== true ||
      p.helper_metadata_alone_proves_installed_commit !== false
    )
      f.push("protected legacy readbacks lack effective source/install bindings");
    const retained = (t.planned_checks ?? []).find((x: any) => x.id === "T13.04-protect");
    if (!retained || !protectedSteps.every((id) => retained.command?.includes(id)))
      f.push("protected helper declarations dropped");
    const outcomes = a.outcome_mapping;
    if (
      !outcomes ||
      outcomes.passed !== "passed" ||
      outcomes.waiting !== "waiting" ||
      outcomes.failed !== "failed" ||
      outcomes.non_pass_behavior !== "existing runner/PIPELINE_STEP_NOT_PASSED" ||
      outcomes.adds_runner_state !== false
    )
      f.push("waiting/failed mapping adds state or permits pass");
    if (
      spec.acceptance?.id !== "ACCEPT-ALL" ||
      !t.what?.includes("ACCEPT-ALL") ||
      !t.signatures?.some((x: string) => x.includes("slice release never grants ACCEPT-ALL"))
    )
      f.push("slice-release/whole-design distinction missing");
    if (
      a.android_proof_modes?.full_release !==
        "requires both obligations; no Android omission or trace-as-screen substitution" ||
      JSON.stringify(t.proof_limits) !==
        JSON.stringify(snapshot.tasks.find((x: any) => x.id === "T13.04").proof_limits)
    )
      f.push("Android/current proof limits weakened");
    // 0.4.0: the executable contract itself, so a nonempty but generic declaration cannot pass (finding T13.04-EXECUTABLE-ACCEPTANCE-BINDING)
    const step = a.pipeline_step;
    if (
      !step ||
      step.id !== "five-device-acceptance" ||
      step.second_pipeline !== false ||
      !step.file?.endsWith("/Ship-Pipeline.json") ||
      !step.k12_fields?.retry_class ||
      !step.k12_fields?.lease
    )
      f.push("acceptance step is not bound into the existing pipeline step contract");
    if (
      a.candidate_identity?.source !== "{evidence}/source-commit.json" ||
      a.candidate_identity?.refuse_before_probing !== "CANDIDATE_IDENTITY_INCONSISTENT"
    )
      f.push("expected candidate identity source missing");
    const reads = a.per_target_readback;
    if (!Array.isArray(reads) || !sameIds(reads.map((x: any) => x.target)))
      f.push("per-target readback does not cover exactly the admitted targets");
    else
      for (const r of reads) {
        if (
          !r.method ||
          !r.command ||
          !r.run_on ||
          !r.readback_receipt?.includes(`readback-${r.target}`)
        )
          f.push(`readback method incomplete for ${r.target}`);
        if (!(r.fields ?? []).includes("release") || !(r.fields ?? []).includes("commit"))
          f.push(`readback for ${r.target} does not report both release and commit`);
        if (!r.screenshot?.path?.endsWith(`version-${r.target}.png`) || !r.screenshot?.how)
          f.push(`screenshot evidence missing for ${r.target}`);
      }
    if (reads?.find?.((x: any) => x.target === "android")?.screenshot?.prerequisite === undefined)
      f.push("Android physical-screen prerequisite dropped");
    const codes = (a.refusals ?? []).map((x: any) => x.code);
    for (const need of [
      "CANDIDATE_IDENTITY_INCONSISTENT",
      "TARGET_RELEASE_MISMATCH:<target>",
      "TARGET_COMMIT_MISMATCH:<target>",
      "TARGET_READBACK_MISSING:<target>",
      "TARGET_SCREENSHOT_MISSING:<target>",
      "ANDROID_SCREEN_PROOF_WAITING",
      "STALE_PROOF:<target>",
      "PROTECTED_READBACK_NOT_PASSED:<step>",
    ])
      if (!codes.includes(need)) f.push(`refusal code missing: ${need}`);
    if (
      (a.refusals ?? []).some((x: any) => x.outcome === "passed") ||
      (a.refusals ?? []).find((x: any) => x.code === "ANDROID_SCREEN_PROOF_WAITING")?.outcome !==
        "waiting"
    )
      f.push(
        "a refusal maps to pass, or the Android screen wait is not the existing waiting outcome",
      );
    if (!/whole 40-character string/.test(a.comparison?.commit ?? ""))
      f.push("commit comparison is not a whole-string match");
    for (const id of [
      "T13.04-neg-commit",
      "T13.04-neg-missing",
      "T13.04-neg-android-screen",
      "T13.04-neg-stale",
    ])
      if (!(t.planned_checks ?? []).some((x: any) => x.id === id))
        f.push(`negative fixture missing: ${id}`);
    return f;
  },
);

check(
  "X21",
  "watcher/server/reboot delta keeps its pinned source, corrected ownership, recovery exception and zero-output proof clauses",
  () => {
    const f: Fail[] = [],
      binding = spec.watcher_server_reboot_delta;
    const root = spec.repository.spec_home_until_then + "/execution/phase-04/";
    const paths = [
      "Fable-Delta-Watcher-Server-Reboot.json",
      "Fable-Delta-Watcher-Server-Reboot-R2.json",
    ].map((name) => root + name);
    if (
      !binding ||
      !Array.isArray(binding.source_documents) ||
      binding.source_documents.length !== 2
    )
      return ["watcher delta source binding absent"];
    for (const path of paths) {
      const source = binding.source_documents.find((s: any) => s.path === path);
      if (
        !source ||
        !existsSync(path) ||
        createHash("sha256").update(readFileSync(path)).digest("hex") !== source.sha256
      )
        f.push(`watcher delta source hash mismatch: ${path}`);
    }
    if (f.length) return f;
    const [r1, r2] = paths.map((path) => JSON.parse(readFileSync(path, "utf8")));
    const remap = (text: string) =>
      text.replace(
        /T6\.04|T4\.06|T12\.06/g,
        (id) => ({ "T6.04": "T4.06", "T4.06": "T12.08", "T12.06": "T12.09" })[id]!,
      );
    const remapValue = (value: any): any =>
      typeof value === "string"
        ? remap(value)
        : Array.isArray(value)
          ? value.map(remapValue)
          : value && typeof value === "object"
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapValue(v)]))
            : value;
    const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
    const task = (id: string) => spec.tasks.find((t: any) => t.id === id);
    const common = r2.row_packing_rule_for_the_writer.fields_common_to_all_four_new_tasks;
    for (const row of r2.new_tasks_corrected) {
      const t = task(row.id);
      if (!t) {
        f.push(`watcher delta task absent: ${row.id}`);
        continue;
      }
      for (const key of [
        "slice",
        "serves",
        "detail_state",
        "depends_on",
        "executor",
        "signatures",
        "rollback",
      ])
        if (!same(t[key], row[key])) f.push(`${row.id}: authored ${key} changed`);
      if (
        !same(t.failing_checks, common.failing_checks) ||
        !same(t.risk, common.risk) ||
        !same(t.governing_shapes, common[`governing_shapes_${row.id}`])
      )
        f.push(`${row.id}: authorized inherited fields changed`);
      if (t.files?.length !== row.files.length + (row.id === "T4.06" ? 4 : 0))
        f.push(`${row.id}: source file row count changed`);
      for (const sourceFile of row.files) {
        const file = t.files?.find((x: any) => x.path === sourceFile.path);
        if (!file || file.side !== sourceFile.side) {
          f.push(`${row.id}: file binding missing ${sourceFile.path}`);
          continue;
        }
        if (file.side === "host-filesystem") {
          if (
            file.action !== "read" ||
            file.surface !== "verification" ||
            file.intended_install_action !== sourceFile.action ||
            !file.owning_source
          )
            f.push(`${row.id}: deployed verification lost its source/action boundary`);
        } else if (file.action !== sourceFile.action || file.surface !== "authoring")
          f.push(`${row.id}: authoring file changed`);
      }
    }
    for (const id of ["T4.06", "T4.07"])
      if (!same(task(id)?.done_when, r2.verification_clause_fixes[`${id}_done_when_replacement`]))
        f.push(`${id}: zero-output credential verification clause changed`);
    for (const edit of r2.edge_edits_corrected) {
      const t = task(edit.task);
      if (
        edit.field === "depends_on" &&
        !edit.append.every((id: string) => t?.depends_on.includes(id))
      )
        f.push(`${edit.task}: corrected dependency missing`);
      if (
        edit.field === "what" &&
        !edit.append.startsWith("unchanged from") &&
        !t?.what.includes(
          edit.task === "T12.05"
            ? r2.r2_amendment_2026_10_10_writer_questions.t12_05_conflict.replacement_text[
                "T12.05_what_append"
              ]
            : edit.task === "T4.03"
              ? r2.r2_amendment_2026_10_10_phase_scoped_bindings.tier_0_acceptance_wording[
                  "T4.03_what_final_append"
                ]
              : edit.append,
        )
      )
        f.push(`${edit.task}: corrected text missing`);
    }
    const ordering = r2.r2_amendment_2026_10_10_review_findings.finding_b_t4_03_ordering;
    if (
      !task("T4.03")?.done_when.expect.includes(
        ordering["T4.03_done_when_expect_append_replacement"].replace(
          "replace the earlier T4.03 expect append with: ",
          "",
        ),
      ) ||
      !task("T12.08")?.done_when.expect.includes(ordering["T12.08_done_when_expect_append"])
    )
      f.push("phase-scoped notification and responder acceptance missing");
    const phase =
      r2.r2_amendment_2026_10_10_phase_scoped_bindings.record_ownership_phase_scoped_replacements;
    const probe = phase["T4.03_probe_path_by_state"];
    const watch = task("T4.03"),
      rehearsal = task("T4.06")?.rehearsal_contract;
    const expectedGrant = {
      principal: "twr",
      unit: "throughline-record-rehearsal.service",
      verbs: ["kill", "stop", "start"],
      production_unit_grants: [],
      scope:
        "throwaway rehearsal unit only; no real data; no grant on throughline-record.service or throughline-server.service",
    };
    if (!probe || !same(watch?.service_binding?.probe_path_by_state, probe))
      f.push("state-scoped rehearsal probes or receipt rule differ from the source");
    for (const key of [
      "before_T4.06_shared_account",
      "after_T4.06_record_isolated_seats_shared",
      "receipt_rule",
    ])
      if (typeof probe?.[key] !== "string" || !watch?.done_when.command.includes(probe[key]))
        f.push(`state-scoped probe command missing: ${key}`);
    if (
      !same(watch?.service_binding?.rehearsal_grant, expectedGrant) ||
      !same(rehearsal?.grant, expectedGrant)
    )
      f.push("rehearsal-only twr grant is missing or widened");
    if (
      !rehearsal ||
      rehearsal.owner !== "T4.06" ||
      rehearsal.source_clause !== probe?.["after_T4.06_record_isolated_seats_shared"] ||
      !same(rehearsal.unit, {
        name: "throughline-record-rehearsal.service",
        owner: "root",
        runs_as: "throughline-record",
        restart: "always",
        restart_sec: 3,
        port: "not 5432",
        real_data: false,
      })
    )
      f.push("rehearsal unit ownership, policy or disposable data boundary changed");
    const extraFiles = [
      [
        "packages/throughline-launcher/systemd/throughline-record-rehearsal.service",
        "fork-namespace",
        "add",
        "authoring",
      ],
      ["packages/throughline-launcher/install/", "fork-namespace", "edit", "authoring"],
      [
        "/etc/systemd/system/throughline-record-rehearsal.service",
        "host-filesystem",
        "read",
        "verification",
      ],
      ["/etc/polkit-1/rules.d/", "host-filesystem", "read", "verification"],
    ];
    for (const [path, side, action, surface] of extraFiles) {
      const row = task("T4.06")?.files.find((x: any) => x.path === path);
      if (
        !row ||
        row.side !== side ||
        row.action !== action ||
        row.surface !== surface ||
        (side === "host-filesystem" &&
          (row.host !== "twr" ||
            row.owner !== "root" ||
            row.intended_install_action !== "add" ||
            !row.owning_source))
      )
        f.push(`rehearsal deployment/source boundary missing: ${path}`);
    }
    for (const [id, key] of [
      ["T4.01", "T4.01_what_replace"],
      ["T6.01", "T6.01_what_replace"],
    ])
      if (!task(id)?.what.includes(phase[key].to) || task(id)?.what.includes(phase[key].from))
        f.push(id + ": stale ownership clause");
    if (
      task("T4.02")?.completion_condition !== phase["T4.02_completion_condition_replace"].to ||
      task("T4.02")?.not_guaranteed_in_this_state !== phase["T4.02_not_guaranteed_replace"].to
    )
      f.push("Mac cutover uses superseded ownership state");
    const responder = task("T12.08"),
      reboot = task("T12.09");
    const heal = r2.r2_amendment_2026_10_10_writer_questions.t12_05_conflict;
    for (const [id, field, sourceKey] of [
      ["T12.05", "what", "T12.05_what_append"],
      ["T6.01", "what", "T6.01_what_append"],
      ["T4.06", "counterexample_must_fail", "T4.06_counterexample_append"],
      ["T12.08", "done_when", "T12.08_done_when_append"],
    ]) {
      const t = task(id);
      const text = field === "done_when" ? t?.done_when?.expect : t?.[field];
      if (
        typeof heal.replacement_text[sourceKey] !== "string" ||
        !text?.includes(heal.replacement_text[sourceKey])
      )
        f.push(`${id}: conditional supervisor heal boundary missing`);
    }
    if (!same(responder?.design_details?.conditional_heal, heal))
      f.push("conditional heal design differs from the source author's correction");
    if (/polkit grant scoped to exactly throughline-server\.service/.test(task("T12.05")?.what))
      f.push("withdrawn twr polkit grant remains");
    if (!same(responder?.design_details?.authority, remapValue(r1.items[0].authority)))
      f.push("responder authority list changed");
    if (!same(responder?.design_details?.recovery_island, r2.k05_recovery_exception))
      f.push("bounded recovery island design changed");
    if (
      !same(
        reboot?.design_details?.unlock_proposal_not_for_this_install,
        r1.items[2].unlock_proposal_not_for_this_install,
      )
    )
      f.push("future-only unlock proposal changed");
    for (const id of ["T12.01", "T12.04"])
      if (
        /one reboot or|a real reboot receipt|a Mac reboot/.test(
          JSON.stringify(task(id)?.done_when),
        ) ||
        !task(id)?.unit_proof_rule?.operator_words.includes("never a machine reboot")
      )
        f.push(`${id}: machine reboot became a proof step`);
    const towerRule = remap(r1.items[2].spec_edits["T12.01"].what.replace(/^append: /, ""));
    if (!task("T12.01")?.what.includes(towerRule))
      f.push("tower unit-only reboot-survival constraint missing");
    const k4 = spec.contracts.find((c: any) => c.id === "K04")?.statement ?? "";
    const k5 = spec.contracts.find((c: any) => c.id === "K05")?.statement ?? "";
    if (!k4.includes(remap(r1.items[1].spec_edits.K04.append_sentence)))
      f.push("locked account ownership contract missing");
    for (const sentence of [
      r2.k05_interval_settled.replace_sentence.to,
      r2.k05_recovery_exception.K05_append_sentence,
      remap(r1.items[0].spec_edits.K05.append_sentence),
      remap(r1.items[2].spec_edits.K05.append_sentence),
    ])
      if (!k5.includes(sentence))
        f.push("corrected K05 ownership/recovery/reboot sentence missing");
    if (
      k5.includes(r2.k05_interval_settled.replace_sentence.from) ||
      k5.includes(r1.items[1].spec_edits.K05.replace_sentence.from)
    )
      f.push("superseded twr-owned interval or unit statement remains");
    return f;
  },
);

check(
  "X22",
  "instruction audit words stay source-bound and upstream reconciliation is Phase 4's first task",
  () => {
    const f: Fail[] = [],
      b = spec.instruction_coverage;
    if (!b?.source?.path || !existsSync(b.source.path)) return ["instruction audit source missing"];
    const bytes = readFileSync(b.source.path);
    if (createHash("sha256").update(bytes).digest("hex") !== b.source.sha256)
      f.push("instruction audit hash changed");
    const source = JSON.parse(bytes.toString("utf8"));
    for (const id of ["IC-049", "IC-052", "IC-056", "IC-002", "IC-008"]) {
      const row = b.rows?.find((r: any) => r.id === id),
        original = source.instructions.find((r: any) => r.id === id);
      if (
        !row ||
        row.ryan_exact_words !== original?.ryan_exact_words ||
        JSON.stringify(row.source) !== JSON.stringify(original?.source)
      )
        f.push(`${id}: source words/provenance changed`);
    }
    const task = spec.tasks.find((t: any) => t.id === "T3.07"),
      u = task?.upstream_reconciliation;
    if (
      !task ||
      task.slice !== "slice-3" ||
      !["T1.10", "T2.04"].every((id) => task.depends_on.includes(id)) ||
      !u?.first ||
      u.phase !== 4
    )
      f.push("upstream reconciliation is not Phase 4 entry");
    const reaches = (id: string, seen = new Set<string>()): boolean => {
      if (id === "T3.07") return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const t = spec.tasks.find((t: any) => t.id === id);
      return (t?.depends_on ?? []).some((d: string) => reaches(d, seen));
    };
    for (const t of spec.tasks.filter((t: any) =>
      ["slice-3", "slice-4", "slice-5", "slice-6"].includes(t.slice),
    ))
      if (!reaches(t.id)) f.push(`${t.id}: can precede upstream reconciliation`);
    if (spec.slices.find((s: any) => s.id === "slice-3")?.tasks[0] !== "T3.07")
      f.push("first Phase 4 task is not displayed first");
    if (
      u?.foundation?.mode !== "preserve-base" ||
      u.foundation.release !== "0.0.60" ||
      u.foundation.not_final_architecture !== true ||
      u.pin?.fresh_fetch_required !== true ||
      !["commit", "fetched_at", "candidate_commit"].every((k) => u.pin?.fields?.includes(k))
    )
      f.push("foundation mode or fresh upstream pin missing");
    if (
      u?.dispositions?.coverage !== "every incoming commit and changed path" ||
      u.dispositions.unclaimed_conflict !== "refuse; never blanket take-upstream"
    )
      f.push("incoming-change coverage or conflict refusal missing");
    const final = spec.tasks.find((t: any) => t.id === "T13.04");
    if (
      !final?.depends_on.includes("T3.07") ||
      JSON.stringify(final.upstream_reconciliation) !== JSON.stringify(u?.final_install) ||
      u?.final_install?.same_candidate_required !== true ||
      u.final_install.seam_ceilings !== "unchanged; counts may only fall" ||
      !u.final_install.gate.includes("OR every non-included incoming change") ||
      !spec.acceptance.rule.includes("T3.07 upstream reconciliation")
    )
      f.push("final installed-source upstream gate missing");
    return f;
  },
);

check(
  "X23",
  "target-only startup and provider target tools have one authority and installed non-builder acceptance",
  () => {
    const f: Fail[] = [],
      t = spec.tasks.find((t: any) => t.id === "T9.01"),
      start = t?.target_only_start,
      api = t?.target_interface;
    const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
    if (
      !api ||
      !same(api.operations, ["read", "add", "fix", "retract"]) ||
      api.owner !== "T9.01" ||
      api.module !== "packages/throughline-target/src/provider-tools.ts" ||
      !api.authority.includes("No direct record writes, per-provider target store")
    )
      f.push("common target authority missing");
    if (
      !start ||
      !same(start.input_keys, ["target_id"]) ||
      !same(start.providers, ["claude", "codex", "pi"]) ||
      !same(start.hosts, ["mac", "twr"]) ||
      start.non_builder_required !== true ||
      start.steps?.length !== 7
    )
      f.push("target-ID-only cold provider/host proof incomplete");
    for (const refusal of [
      "stale-revision-completion",
      "builder-self-acceptance",
      "unauthorized-check-acceptance",
      "direct-target-record-write",
      "stale-generation-tool-call",
    ])
      if (!start?.refusals?.includes(refusal)) f.push(`target refusal missing: ${refusal}`);
    if (!start?.steps.some((x: string) => /compare bytes/i.test(x) && x.includes("exact_words")))
      f.push("exact-word source comparison missing");
    if (
      !start?.steps.some((x: string) => x.includes("partial work")) ||
      !start.steps.some((x: string) => x.includes("without a hand-written handoff"))
    )
      f.push("partial-work succession missing");
    const proof = spec.tasks.find((t: any) => t.id === "T11.05");
    if (
      !proof?.done_when.command.includes("target-only-start.test.ts") ||
      !t?.done_when.command.includes("no admitted target") ||
      !["T8.03", "T11.01", "T11.02", "T9.03", "T6.03"].every((id) =>
        proof?.depends_on.includes(id),
      ) ||
      start?.owner !== "T11.05" ||
      !same(proof?.target_only_start, start) ||
      !spec.acceptance.rule.includes("T11.05 owns installed target-ID-only")
    )
      f.push("installed target-only proof must follow its providers and retain exploration");
    for (const [provider, id, file] of [
      ["claude", "T8.03", "packages/throughline-claude-mod/src/target-tools.ts"],
      ["codex", "T11.02", "packages/throughline-target/src/codex-tools.ts"],
      ["pi", "T11.01", "packages/throughline-target/src/pi-tools.ts"],
    ]) {
      const row = spec.tasks.find((t: any) => t.id === id),
        tools = row?.target_tools;
      if (
        !tools ||
        tools.provider !== provider ||
        tools.file !== file ||
        tools.interface_owner !== "T9.01" ||
        tools.interface_module !== api?.module ||
        tools.no_provider_store !== true ||
        !same(tools.operations, ["read", "add", "fix", "retract"]) ||
        tools.launch_owner !== "T6.02" ||
        !row.depends_on.includes("T9.01") ||
        !row.files.some((f: any) => f.path === file) ||
        !row.done_when.command.includes(tools.cold_test)
      )
        f.push(`${provider}: target tools lack file, launch or cold consumption binding`);
    }
    const launch = spec.tasks.find((t: any) => t.id === "T6.02")?.target_tool_launch;
    if (
      !same(launch?.input_keys, ["target_id"]) ||
      launch?.owner !== "T9.01" ||
      !launch?.tested_after.includes("T11.02")
    )
      f.push("target-only launcher binding missing");
    if (!spec.acceptance.rule.includes("T9.01 target-ID-only startup/succession"))
      f.push("target-only proof not required by final acceptance");
    return f;
  },
);

check(
  "X24",
  "every command-touching task inherits grammar and caller-preservation obligations",
  () => {
    const f: Fail[] = [],
      g = spec.instruction_coverage?.command_grammar;
    const sources = [
      "/Users/Admin/core-root/vault/01_Projects/workbench/infra/first-class-command-layer/Command-Grammar-Standard-V1.html",
      "/Users/Admin/core-root/vault/01_Projects/workbench/infra/grammar/Folder-Grammar-Standard-V1.html",
      "/Users/Admin/core-root/vault/01_Projects/workbench/infra/grammar/Folder-Grammar-Standard-V1-Dependencies.json",
    ];
    if (
      g?.id !== "IC-002" ||
      g.skill !== "/Users/Admin/.codex/skills/ryan-command-layer/SKILL.md" ||
      JSON.stringify(g.sources) !== JSON.stringify(sources) ||
      ![...sources, g?.skill ?? ""].every(existsSync)
    )
      return ["grammar skill/standards binding missing"];
    if (
      !g.required?.some(
        (x: string) => x.includes("old callers answering") && x.includes("drains before removal"),
      ) ||
      !g.required.some((x: string) => x.includes("correction of a touched violation")) ||
      !g.required.some((x: string) => x.includes("this spec pass renames no live command"))
    )
      f.push("caller preservation, touched repair or no-live-rename boundary missing");
    for (const t of spec.tasks)
      if (t.command_grammar !== "IC-002") f.push(`${t.id}: command grammar not bound`);
    return f;
  },
);

check(
  "X25",
  "Raspberry Pi remains deferred without losing archive/watcher exceptions or Pi-provider coverage",
  () => {
    const f: Fail[] = [],
      p = spec.instruction_coverage?.raspberry_pi_pause;
    if (
      p?.state !== "deferred" ||
      JSON.stringify(p.active_targets) !== '["mac","twr","ios","android"]' ||
      JSON.stringify(p.foundation_targets) !== '["twr","ios","mac"]' ||
      JSON.stringify(p.priority) !== '[["mac","twr","ios"],["android"]]'
    )
      f.push("pause/active release target set or priority changed");
    if (
      JSON.stringify(p?.exceptions?.map((x: any) => x.kind)) !==
      '["archive-drive","watcher-responder"]'
    )
      f.push("archive/watcher exceptions lost or broadened");
    for (const r of spec.device_matrix.rows)
      for (const c of r.cells)
        if (
          c.device === "rpi" &&
          c.state !== "not-applicable" &&
          c.state !== "deferred-exploration" &&
          (c.state !== "deferred" ||
            c.counts_as_passed !== false ||
            c.instruction !== "IC-008" ||
            c.deferred_contract?.state !== "required")
        )
          f.push(`${r.key}: paused hardware cell requires execution or lost history`);
    if (spec.acceptance.depends_on.device_cells.some((x: string) => x.endsWith("@rpi")))
      f.push("paused hardware remains in the acceptance conjunction");
    for (const t of spec.tasks) {
      if (t.device_cells?.some((x: string) => x.endsWith("@rpi")))
        f.push(`${t.id}: active Raspberry Pi device cell`);
      if (
        !["T4.03", "T4.04", "T4.05", "T4.07", "T12.04", "T12.08", "T12.09"].includes(t.id) &&
        t.files?.some((f: any) => f.host === "rpi" && f.action !== "read")
      )
        f.push(`${t.id}: general Raspberry Pi deployment remains active`);
      const active = JSON.stringify({ what: t.what, done_when: t.done_when });
      if (
        /Mac, tower and Raspberry Pi|mac, twr and rpi|<mac\|twr\|rpi>|then the real Raspberry Pi batch|two receipts, one per host/.test(
          active,
        )
      )
        f.push(`${t.id}: paused execution remains in an active body`);
    }
    for (const id of ["T4.03", "T4.04", "T4.05", "T4.07", "T12.08", "T12.09"])
      if (!spec.acceptance.depends_on.tasks.includes(id))
        f.push(`${id}: watcher/responder scope lost`);
    for (const host of ["mac", "twr"])
      if (!spec.acceptance.depends_on.device_cells.includes(`exec-pi@${host}`))
        f.push(`Pi software provider was confused with paused hardware on ${host}`);
    if (
      !spec.acceptance.rule.includes("all four active targets") ||
      spec.acceptance.rule.includes("0.0.60 declares mac, twr, rpi")
    )
      f.push("active acceptance prose retains five-host demand");
    return f;
  },
);

check(
  "X26",
  "upstream acceptance requires cold built-candidate browser captures and failed-before/passing-after proof",
  () => {
    const f: Fail[] = [];
    const t = spec.tasks.find((t: any) => t.id === "T3.07"),
      a = t?.upstream_reconciliation?.browser_preview_acceptance;
    const source =
      spec.repository.spec_home_until_then +
      "/execution/lead-transfer/Preview-Screenshot-Diagnosis.json";
    if (!a || a.source?.path !== source || !existsSync(source))
      return ["browser-preview acceptance source missing"];
    const diagnosis = JSON.parse(readFileSync(source, "utf8"));
    const tests = diagnosis.non_builder_acceptance?.tests_to_run_after_candidate_exists;
    const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
    if (
      !Array.isArray(tests) ||
      tests.length === 0 ||
      !same(a.tests, tests) ||
      a.source.field !== "non_builder_acceptance.tests_to_run_after_candidate_exists" ||
      a.source.tests_sha256 !== createHash("sha256").update(JSON.stringify(tests)).digest("hex")
    )
      f.push("cold preview tests differ from the diagnostic source");
    const fixture = diagnosis.artifacts?.find((x: any) =>
      x.path.endsWith("/Preview-Screenshot-Fixture.html"),
    );
    if (
      !fixture ||
      a.fixture?.path !== fixture.path ||
      a.fixture.sha256 !== fixture.sha256 ||
      !existsSync(fixture.path) ||
      createHash("sha256").update(readFileSync(fixture.path)).digest("hex") !== fixture.sha256
    )
      f.push("supplied loopback fixture binding changed");
    if (
      a.owner !== "T3.07" ||
      a.non_builder_required !== true ||
      a.candidate_upstream_commit !== diagnosis.upstream.relevant_commit ||
      a.upstream_fix_status !== "UNPROVEN until the built-candidate cold tests pass" ||
      a.release_rule !== diagnosis.non_builder_acceptance.release_rule
    )
      f.push("preview evidence promoted to a proven fix or lost non-builder authority");
    if (
      a.evidence?.pair_required !== true ||
      a.evidence.synthetic_or_warm_capture_substitutes !== false ||
      a.evidence.missing_before_image_is_not_pass !== true ||
      !same(a.evidence.required, [
        "failed-before screenshot of the actual failed product state on unchanged source",
        "passing-after capture PNG from the built candidate",
        "non-builder inspection of both actual PNGs",
        "one result for every source-listed cold test, including bounded failure and released control",
      ])
    )
      f.push("actual failed-before/passing-after screenshot pair or cold coverage is optional");
    if (
      a.on_failure?.owner !== "worker-shotdiag-db00e8d1" ||
      a.on_failure.before_final_install !== true ||
      a.on_failure.may_accept_failed_test !== false ||
      !a.on_failure.action.includes("same diagnostic seat")
    )
      f.push("failed capture does not reopen the same diagnosis before final install");
    const final = spec.tasks.find((t: any) => t.id === "T13.04"),
      gate = final?.upstream_reconciliation?.browser_preview;
    if (
      !gate ||
      gate.owner !== "T3.07" ||
      gate.required !== true ||
      gate.same_candidate_required !== true ||
      gate.non_builder_required !== true ||
      gate.failed_before_and_passing_after_required !== true ||
      gate.all_source_tests_required !== true ||
      gate.receipt !== a.evidence?.receipt ||
      !same(gate.on_failure, a.on_failure) ||
      !same(gate, t.upstream_reconciliation.final_install.browser_preview)
    )
      f.push("final-install browser-preview gate is incomplete or not candidate-bound");
    if (
      !t.done_when.command.includes("browser_preview_acceptance.tests") ||
      !t.done_when.expect.includes("prevents final install") ||
      !final?.done_when.expect.includes("Browser-preview cold-capture acceptance")
    )
      f.push("browser-preview tests are metadata only, not task/install acceptance");
    return f;
  },
);

let green = 0;
for (const r of results) {
  if (r.fails.length === 0) {
    green++;
    console.log(`PASS  ${r.id} ${r.title}`);
  } else {
    console.log(`FAIL  ${r.id} ${r.title}  (${r.fails.length})`);
    for (const x of r.fails.slice(0, 12)) console.log(`        - ${x}`);
    if (r.fails.length > 12) console.log(`        - … ${r.fails.length - 12} more`);
  }
}
console.log(`\n${green} of ${results.length} checks green`);
process.exit(green === results.length ? 0 : 1);

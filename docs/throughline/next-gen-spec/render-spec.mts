// Renders Spec-Map.html from spec.json (and the latest slice-1 check run, if present). Run: node render-spec.mts
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(HERE, "spec.json"), "utf8"));
const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Run records do not travel with the design; read them only at their physical vault home.
const evidenceRoot = spec.repository.spec_home_until_then;
const evidenceDirs = [evidenceRoot, join(evidenceRoot, "execution", "phase-02")];
const runs = evidenceDirs
  .filter((dir) => existsSync(dir))
  .flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => /^Check-Run-Slice-1-.*\.txt$/.test(f))
      .map((f) => join(dir, f)),
  )
  .sort((a, b) => a.split("/").at(-1).localeCompare(b.split("/").at(-1)));
const lastRun = runs.length ? readFileSync(runs[runs.length - 1], "utf8") : "";
const runState = new Map<string, "PASS" | "FAIL">();
for (const line of lastRun.split("\n")) {
  const m = /^(PASS|FAIL)\s+(S1-[A-Z]\d\d)/.exec(line);
  if (m) runState.set(m[2], m[1] as "PASS" | "FAIL");
}
const runSummary = (lastRun.split("\n").find((l) => /checks green/.test(l)) ?? "").trim();
const checksBySlice = Object.fromEntries(
  [...new Set(spec.checks.map((c: any) => c.slice))].map((slice) => [
    String(slice),
    spec.checks.filter((c: any) => c.slice === slice).length,
  ]),
);
const slice1CheckCount = spec.checks.filter((c: any) => c.slice === "slice-1").length;

const pacific = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
};
const taskById = new Map<string, any>(spec.tasks.map((t: any) => [t.id, t]));
const sideClass: Record<string, string> = {
  "fork-namespace": "ours",
  "upstream-edit": "upstream",
  config: "config",
  vault: "vault",
  "outside-tool": "tool",
  "host-filesystem": "host",
};

const chip = (txt: string, cls = "") => `<span class="chip ${cls}">${esc(txt)}</span>`;
const designDetails = (value: any): string => {
  if (Array.isArray(value))
    return `<ul>${value.map((v) => `<li>${designDetails(v)}</li>`).join("")}</ul>`;
  if (value && typeof value === "object")
    return `<dl>${Object.entries(value)
      .map(
        ([key, v]) =>
          `<dt><b>${esc(key.replaceAll("_", " "))}</b></dt><dd>${designDetails(v)}</dd>`,
      )
      .join("")}</dl>`;
  return `<p>${esc(String(value ?? ""))}</p>`;
};
const taskCard = (t: any) => {
  const detailed = t.detail_state === "detailed";
  const sides = [
    ...new Set((t.files ?? []).filter((f: any) => f.action !== "read").map((f: any) => f.side)),
  ] as string[];
  return `<details class="task ${detailed ? "detailed" : "outline"}" id="${esc(t.id)}">
  <summary><span class="tid">${esc(t.id)}</span><span class="ttitle">${esc(t.title)}</span>
    <span class="meta">${detailed ? chip("fixed contract", "ok") : chip("outline — contract not fixed", "warn")} ${chip(t.executor.model_preference + " · " + t.executor.effort, "exec")}${t.reviewer ? chip("review " + t.reviewer.model_preference, "exec") : ""}</span>
    <span class="serves">${(t.serves ?? []).map((s: string) => chip(s, "ng")).join("")}</span>
    <span class="sides">${sides.map((s) => chip(s, sideClass[s] ?? "")).join("")}</span></summary>
  <div class="body">
    <p class="what">${esc(t.what)}</p>
    ${t.command_grammar ? `<p><b>Command changes:</b> <a href="#instruction-coverage">${esc(t.command_grammar)} grammar, caller preservation and drain proof apply before any command change.</a></p>` : ""}
    ${[
      "upstream_reconciliation",
      "target_interface",
      "target_only_start",
      "target_tools",
      "target_tool_launch",
      "service_binding",
      "phase_scoped_acceptance",
      "rehearsal_contract",
    ]
      .filter((k) => t[k])
      .map(
        (k) =>
          `<details><summary>${esc(k.replaceAll("_", " "))}</summary>${designDetails(t[k])}</details>`,
      )
      .join("")}
    ${t.deferred_rpi ? `<details><summary>Deferred Raspberry Pi clauses — history only, not passed</summary>${designDetails(t.deferred_rpi)}</details>` : ""}
    ${t.design_details ? `<details class="design-details"><summary>Source-bound design details</summary><p>The corrected delta governs identifiers, proof clauses and the declared ownership interval. Original decision context below is retained; it does not authorize a runtime action.</p>${designDetails(t.design_details)}</details>` : ""}
    ${t.delta_sources?.length ? `<p><b>Design sources</b> ${t.delta_sources.map((p: string) => `<code>${esc(p)}</code>`).join("<br>")}</p>` : ""}
    ${t.depends_on?.length ? `<p class="deps"><b>After</b> ${t.depends_on.map((d: string) => (taskById.has(d) ? `<a href="#${esc(d)}">${esc(d)}</a>` : chip(d, "pre"))).join(" ")}</p>` : ""}
    ${t.files?.length ? `<table class="files"><thead><tr><th>file</th><th>side</th><th>act</th><th>note</th></tr></thead><tbody>${t.files.map((f: any) => `<tr><td><code>${esc(f.path)}</code></td><td>${chip(f.side, sideClass[f.side] ?? "")}</td><td>${esc(f.action)}</td><td>${esc(f.note ?? "")}</td></tr>`).join("")}</tbody></table>` : ""}
    ${t.signatures?.length ? `<div class="sig"><b>Fixed contract signatures</b><ul>${t.signatures.map((s: string) => `<li><code>${esc(s)}</code></li>`).join("")}</ul></div>` : ""}
    ${t.failing_checks?.length ? `<p><b>Failing check first</b> ${t.failing_checks.map((c: string) => `<a href="#${esc(c)}" class="chip ${runState.get(c) === "PASS" ? "ok" : "fail"}">${esc(c)} ${runState.get(c) ?? "—"}</a>`).join(" ")}</p>` : ""}
    ${t.done_when?.command ? `<p><b>Done when</b> <code class="cmd">${esc(t.done_when.command)}</code> ${t.done_when.expect ? `<span class="expect">→ ${esc(t.done_when.expect)}</span>` : ""}</p>` : ""}
    ${t.risk?.length ? `<p class="risk"><b>Risk</b> ${t.risk.map((r: string) => `<span>${esc(r)}</span>`).join("<br>")}</p>` : ""}
    <p class="rb"><b>Rollback</b> ${esc(t.rollback)}</p>
    ${t.ryan_act ? `<p class="ryan"><b>Ryan's act</b> ${esc(t.ryan_act)}</p>` : ""}
  </div></details>`;
};

const sliceBlock = (s: any) => `<section class="slice ${s.state}" id="${esc(s.id)}">
  <header><span class="n">${s.n}</span><h3>${esc(s.title)}</h3>
    <div class="smeta">${chip(s.state === "detailed" ? "fixed contract" : "outline", s.state === "detailed" ? "ok" : "warn")} ${s.depends_on.length ? `<span class="after">after ${s.depends_on.map((d: string) => `<a href="#${esc(d)}">${esc(d.replace("slice-", "slice "))}</a>`).join(", ")}</span>` : '<span class="after">first</span>'} <span class="count">${s.tasks.length} tasks</span></div>
    <p class="why">${esc(s.why_this_order)}</p>
    ${s.precondition ? `<p class="pre"><b>Precondition ${esc(s.precondition.id)}</b> ${esc(s.precondition.what)}<br><code class="cmd">${esc(s.precondition.command)}</code></p>` : ""}
    <p class="serves">${s.serves.map((x: string) => chip(x, "ng")).join("")}</p></header>
  <div class="tasks">${s.tasks.map((id: string) => taskCard(taskById.get(id))).join("\n")}</div></section>`;

const decisionCard = (
  d: any,
) => `<article class="decision" id="${esc(d.id)}"><div class="dhead"><span class="did">${esc(d.id)}</span><h4>${esc(d.title)}</h4></div>
  <p>${esc(d.statement)}</p>
  ${d.ryan_quote ? `<blockquote>“${esc(d.ryan_quote.quote)}”<footer>Ryan${d.ryan_quote.created_at ? ", " + esc(pacific(d.ryan_quote.created_at)) : ""} · ledger ${esc(d.ryan_quote.ledger_item)}${d.ryan_quote.thread_id ? " · thread " + esc(String(d.ryan_quote.thread_id).slice(0, 8)) : ""}</footer></blockquote>` : ""}
  ${d.fable_call ? `<p class="fable"><b>Design call</b> ${esc(d.fable_call)}</p>` : ""}
  ${d.alternative ? `<p class="alt"><b>Alternative</b> ${esc(d.alternative)}</p>` : ""}
  <p class="serves">${(d.serves ?? []).map((x: string) => chip(x, "ng")).join("")}</p></article>`;

const checkRow = (c: any) =>
  `<tr id="${esc(c.id)}"><td><code>${esc(c.id)}</code></td><td>${esc(c.title)}</td><td>${chip(c.kind)}</td><td>${chip("expected " + c.expected_today, c.expected_today === "FAIL" ? "fail" : "ok")}</td><td>${runState.has(c.id) ? chip("recorded slice-1 run " + runState.get(c.id), runState.get(c.id) === "PASS" ? "ok" : "fail") : chip("no recorded run")}</td></tr>`;

const edges: Array<[string, string]> = [];
for (const t of spec.tasks)
  for (const d of t.depends_on ?? []) if (taskById.has(d)) edges.push([d, t.id]);

const specSha = createHash("sha256")
  .update(readFileSync(join(HERE, "spec.json")))
  .digest("hex");
const dispClass: Record<string, string> = {
  "already-resolved": "ok",
  "consequential-choice": "ours",
  "bounded-repair": "warn",
  "evidence-needed": "tool",
};
const kindClass: Record<string, string> = {
  implemented: "ok",
  "inherited-constraint": "config",
  "external-capability": "tool",
  "deferred-exploration": "warn",
  superseded: "host",
};
const contractCard = (
  k: any,
) => `<article class="decision" id="${esc(k.id)}"><div class="dhead"><span class="did">${esc(k.id)}</span><h4>${esc(k.title)}</h4></div>
  <p>${esc(k.statement)}</p>
  <p class="sub"><b>Tests</b><br>${(k.tests ?? []).map((t: string) => "· " + esc(t)).join("<br>")}</p>
  ${k.fable_call ? `<p class="fable"><b>Design call</b> ${esc(k.fable_call)}</p>` : ""}${k.alternative ? `<p class="alt"><b>Alternative</b> ${esc(k.alternative)}</p>` : ""}${(k.deferred_tasks ?? []).map((t: any) => `<p class="alt" id="${esc(t.id)}"><b>Deferred task ${esc(t.id)}, outside the first-install required graph</b> ${esc(t.title)}. ${esc(t.deferred?.enters_required_graph_when ? "Enters the required graph when " + t.deferred.enters_required_graph_when + "." : "")}</p>`).join("")}
  <p class="serves">answers ${(k.answers ?? []).map((a: string) => chip(a, "pre")).join("")} · binds ${(k.binds_slices ?? []).map((s: string) => `<a href="#${esc(s)}">${esc(s.replace("slice-", "slice "))}</a>`).join(", ") || "no slice"} · ${(k.inherited_by ?? []).length} tasks inherit it</p>
  <p class="serves">${(k.serves ?? []).map((x: string) => chip(x, "ng")).join("")}</p></article>`;
const auditRow = (x: any) =>
  `<tr id="${esc(x.id)}"><td><code>${esc(x.id)}</code><br><span class="sub">${esc(x.source)}</span></td><td><b>${esc(x.title)}</b><br><span class="sub">${esc(x.current_state)}</span>${x.opus_repair ? `<br><span class="sub"><b>Repair for the implementer:</b> ${esc(x.opus_repair)}</span>` : ""}${x.evidence_test ? `<br><span class="sub"><b>Evidence:</b> ${esc(x.evidence_test)}</span>` : ""}</td><td>${chip(x.disposition, dispClass[x.disposition] ?? "")}${x.overlaps?.length ? "<br>" + chip("with " + x.overlaps.join(", "), "pre") : ""}</td><td>${(x.answered_by ?? []).map((a: string) => `<a href="#${esc(a)}" class="chip">${esc(a)}</a>`).join(" ")}</td></tr>`;
const ledgerRow = (x: any) =>
  `<tr><td><code>${esc(x.id)}</code></td><td>${esc(x.title)}</td><td>${chip(x.kind, kindClass[x.kind] ?? "")}</td><td>${(x.by ?? []).map((b: string) => `<a href="#${esc(b)}" class="chip">${esc(b)}</a>`).join(" ")}</td><td class="sub">${esc(x.note)}${x.consumption_test ? "<br><b>consumption test:</b> " + esc(x.consumption_test) : ""}</td></tr>`;
const matrixTable = (m: any) =>
  `<table class="checks"><thead><tr><th>capability</th>${["mac", "twr", "rpi", "ios", "android"].map((d) => `<th>${d}<br><span class="sub">${esc(m.roles[d])}</span></th>`).join("")}</tr></thead><tbody>${(
    m.rows ?? []
  )
    .map(
      (r: any) =>
        `<tr><td><b>${esc(r.capability)}</b><br>${(r.serves ?? []).map((x: string) => chip(x, "ng")).join("")}</td>${[
          "mac",
          "twr",
          "rpi",
          "ios",
          "android",
        ]
          .map((d) => {
            const c = r.cells.find((c: any) => c.device === d);
            return c
              ? c.state === "required"
                ? `<td>${chip("required", "ok")} <a href="#${esc(c.owner)}">${esc(c.owner)}</a><br><span class="sub">${esc(c.test)}</span></td>`
                : `<td>${chip(["deferred-exploration", "deferred"].includes(c.state) ? "deferred" : "n/a", "host")}<br><span class="sub">${esc(c.reason)}</span></td>`
              : "<td></td>";
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody></table>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ThroughLine next-generation implementation spec — map</title>
<meta name="spec-sha256" content="${specSha}"><meta name="spec-version" content="${esc(spec.version)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{--bg:#0f1115;--panel:#161a22;--panel2:#1c212c;--ink:#e7eaf0;--muted:#9aa3b2;--line:#2a3140;--ok:#2fbf71;--warn:#e0a526;--fail:#e5533d;--ours:#4f8cff;--upstream:#c678dd;--config:#56b6c2;--vault:#98c379;--tool:#d19a66;--host:#7f8c8d;--ng:#2d3550}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
a{color:#8ab4ff;text-decoration:none}a:hover{text-decoration:underline}
header.top{padding:28px 32px 18px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#141821,#0f1115)}
h1{margin:0 0 6px;font-size:24px;font-weight:650}h2{font-size:18px;margin:36px 0 12px}h3{margin:0;font-size:16px}h4{margin:0;font-size:14px}
.goal{font-size:16px;color:var(--ink);margin:6px 0 2px}.goal b{color:var(--muted);font-weight:500}
.sub{color:var(--muted);font-size:13px}.wrap{padding:0 32px 60px;max-width:100%;min-width:0}.slice,.decision,.body,details.task{min-width:0;overflow-wrap:anywhere}table{table-layout:fixed;width:100%}code,pre{overflow-wrap:anywhere;white-space:pre-wrap}svg{max-width:100%;height:auto}
.kpis{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0 0}.kpi{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 14px;min-width:150px}.kpi .v{font-size:20px;font-weight:650}.kpi .l{color:var(--muted);font-size:12px}
.chip{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px;line-height:18px;background:#263044;color:#cfd7e6;margin:1px 3px 1px 0;white-space:nowrap}
.chip.ok{background:rgba(47,191,113,.18);color:#7fe3a9}.chip.warn{background:rgba(224,165,38,.18);color:#f1c76a}.chip.fail{background:rgba(229,83,61,.2);color:#ff9c8a}
.chip.ng{background:var(--ng);color:#b9c6ea}.chip.exec{background:#2b2f3a;color:#d7dbe6}.chip.pre{background:#3a2d4d;color:#dcc6ff}
.chip.ours{background:rgba(79,140,255,.2);color:#9dbcff}.chip.upstream{background:rgba(198,120,221,.22);color:#e3b4f0}.chip.config{background:rgba(86,182,194,.2);color:#9fe0e8}.chip.vault{background:rgba(152,195,121,.2);color:#c2e3a5}.chip.tool{background:rgba(209,154,102,.22);color:#f0c79e}.chip.host{background:rgba(127,140,141,.3);color:#c9d1d2}
.legend{display:flex;flex-wrap:wrap;gap:6px;align-items:center;color:var(--muted);font-size:12px;margin:10px 0 0}
.decisions{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(360px,100%),1fr));gap:12px}
.decision{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.dhead{display:flex;gap:10px;align-items:baseline}.did{color:var(--muted);font-weight:600;font-size:12px}
.decision blockquote{margin:8px 0;padding:8px 12px;border-left:3px solid #4f8cff;background:var(--panel2);border-radius:6px;color:#dfe6f5;font-style:italic}.decision blockquote footer{font-style:normal;color:var(--muted);font-size:12px;margin-top:4px}
.decision .fable,.decision .alt{color:#c9d1dd;font-size:13px}.decision .alt{color:var(--muted)}
.slices{display:flex;flex-direction:column;gap:14px}
.slice{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px}.slice.detailed{border-color:#2fbf71aa}.slice header{display:grid;grid-template-columns:44px 1fr;gap:6px 12px;align-items:start}
.slice header > *:not(.n){grid-column:2}.slice .n{grid-row:1/-1;width:36px;height:36px;border-radius:50%;background:#263044;display:flex;align-items:center;justify-content:center;font-weight:700}
.smeta{color:var(--muted);font-size:12px;display:flex;gap:10px;align-items:center}.why{margin:2px 0;color:#c9d1dd}.pre{margin:4px 0;background:var(--panel2);border-radius:8px;padding:8px 10px;color:#dcc6ff;font-size:13px}
.tasks{margin-top:10px;display:flex;flex-direction:column;gap:8px}
details.task{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:0 12px}details.task.detailed{border-left:4px solid var(--ok)}details.task.outline{border-left:4px solid var(--warn)}
details.task summary{cursor:pointer;list-style:none;display:grid;grid-template-columns:62px 1fr auto;grid-template-areas:"id title meta" "id serves sides";gap:2px 10px;padding:9px 0;align-items:center}
details.task summary::-webkit-details-marker{display:none}.tid{grid-area:id;font-weight:700;color:#8ab4ff}.ttitle{grid-area:title;font-weight:600}.meta{grid-area:meta;text-align:right}.serves{grid-area:serves}.sides{grid-area:sides;text-align:right}
.body{padding:4px 0 12px;border-top:1px dashed var(--line)}.body p{margin:8px 0}.what{color:#dfe6f5}
table.files{width:100%;border-collapse:collapse;font-size:12.5px;margin:6px 0}table.files th{text-align:left;color:var(--muted);font-weight:600;padding:4px 6px;border-bottom:1px solid var(--line)}table.files td{padding:4px 6px;border-bottom:1px solid #222838;vertical-align:top}
code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:#0c0e12;padding:1px 5px;border-radius:4px;color:#e6edf3;white-space:pre-wrap;word-break:break-word}code.cmd{display:inline-block;padding:4px 8px;margin:2px 0}
.sig ul{margin:4px 0 0 18px;padding:0}.sig li{margin:3px 0}.risk span{display:inline-block;color:#f1c76a}.rb{color:var(--muted)}.expect{color:var(--muted);font-size:12.5px}
table.checks{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}table.checks th,table.checks td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top;font-size:13px}table.checks th{color:var(--muted)}
.graph{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px;overflow:auto}
.pending{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}.pending article{background:var(--panel);border:1px solid #e0a52666;border-radius:12px;padding:12px 14px;font-size:13px}
.repo{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:10px}.repo div{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:13px}.repo b{color:var(--muted);font-weight:600;display:block;font-size:12px}
footer.bottom{color:var(--muted);font-size:12px;padding:20px 32px;border-top:1px solid var(--line)}
</style></head><body>
<header class="top">
<h1>ThroughLine next-generation implementation spec</h1>
<p class="goal"><b>Ryan's goal:</b> “${esc(spec.goal.quote)}”</p>
<p class="sub">Machine-readable task graph <code>spec.json</code> version ${esc(spec.version)}. Original design authorship: ${esc(spec.authored_by.agent_name)} (ThroughLine thread ${esc(spec.authored_by.throughline_thread)}). Current generation built ${esc(pacific(spec.generated_at))} by ${esc(spec.generated_by.runtime)} session ${esc(spec.generated_by.session_uuid)}. Bound to ledger sha256 ${esc(spec.ledger.sha256.slice(0, 12))} (${spec.ledger.items} items). Every task names the ledger ids it serves. The technical execution lead, lead-execlead-1ad87c0b, works from the JSON; this page is rendered from it.</p>
<div class="kpis">
<div class="kpi"><div class="v">${spec.slices.length}</div><div class="l">slices, dependency-ordered</div></div>
<div class="kpi"><div class="v">${spec.tasks.length}</div><div class="l">tasks (${spec.tasks.filter((t: any) => t.detail_state === "detailed").length} detailed, ${spec.tasks.filter((t: any) => t.detail_state === "outline").length} outline)</div></div>
<div class="kpi" data-check-population="all-slices"><div class="v">${spec.checks.length}</div><div class="l">checks across all slices · ${slice1CheckCount} slice-1 definitions</div></div>
<div class="kpi"><div class="v">${spec.decisions.length}</div><div class="l">decisions, ${spec.decisions.filter((d: any) => d.ryan_quote).length} with Ryan's quote</div></div>
<div class="kpi"><div class="v">${spec.seam.upstream_edit_count_in_spec}</div><div class="l">upstream files this spec edits (baseline measured ${spec.seam.measured_baseline.fork_edited_stock_files})</div></div>
</div>
<div class="legend"><b>Seam sides:</b> ${chip("fork-namespace", "ours")} ours, new or inside the namespace ${chip("upstream-edit", "upstream")} edits a stock upstream file ${chip("config", "config")} ${chip("vault", "vault")} ${chip("outside-tool", "tool")} a tool outside the repository ${chip("host-filesystem", "host")} · <b>State:</b> ${chip("fixed contract", "ok")} detailed contract; execution still needs release ${chip("outline", "warn")} not executable until its contract is fixed and admitted</div>
</header>
<div class="wrap">

<h2>Where the repository lives after slice 1</h2>
<div class="repo">
<div><b>historical intake (Oct 7, inside the vault)</b><code>${esc(spec.repository.old_home)}</code><br><span class="sub">17 GB, 317,000 files; two release worktrees of 12 GB each beside it; 43 GB of build outputs under the evidence root</span></div>
<div><b>home</b><code>${esc(spec.repository.home)}</code></div>
<div><b>release worktrees</b><code>${esc(spec.repository.release_checkout)}</code></div>
<div><b>build outputs</b><code>&lt;release worktree&gt;/release/</code><br><span class="sub">${esc(spec.repository.build_output_rule)}</span></div>
<div><b>rollback snapshots</b><code>${esc(spec.repository.backup_root)}</code></div>
<div><b>evidence (records only)</b><code>${esc(spec.repository.evidence_root)}</code></div>
<div><b>vault copies of the documents</b><code>${esc(spec.repository.vault_copy.destination)}</code><br><span class="sub">${esc(spec.repository.vault_copy.patterns.join(", "))} · ${esc(spec.repository.vault_copy.why_not_symlinks)}</span></div>
<div><b>tower build root · Raspberry Pi template deferred</b><code>${esc(spec.repository.tower_build_root)}</code> <code>${esc(spec.repository.rpi_build_root)}</code></div>
<div><b>the spec itself</b><code>${esc(spec.repository.spec_home_in_repository)}</code> in the repository after T1.08; until then <code>${esc(spec.repository.spec_home_until_then)}</code></div>
<div><b>remotes</b><code>origin ${esc(spec.repository.origin)}</code> <code>upstream ${esc(spec.repository.upstream)}</code></div>
</div>

<h2>Slices and tasks</h2>
<div class="slices">${spec.slices.map(sliceBlock).join("\n")}</div>

<h2>Dependencies: tasks, slice gates and the acceptance node</h2>
<p class="sub">Solid arrows are task dependencies; dashed arrows between column headers are slice gates (every task of the later slice waits for every task of the earlier one); the precondition on slice 1 is a gate on every slice-1 task; the last column is the whole-design acceptance node, which depends on every task, every slice and every required device cell.</p>
<div class="graph"><svg id="g" width="100%" height="10"></svg></div>

<h2>Checks across all slices (${spec.checks.length} definitions)</h2>
<p class="sub">Definitions by slice: ${Object.entries(checksBySlice)
  .map(([slice, count]) => esc(slice) + ": " + count)
  .join(" · ")}. Expected states are design inventory, not execution results.</p>
<p class="sub"><b>Last recorded slice-1 core run:</b> ${runSummary ? esc(runSummary) + " · " + esc(runs[runs.length - 1]) : "No slice-1 run recorded"}. This recorded run is separate from the current ${slice1CheckCount} slice-1 definitions and disposable design fixtures.</p>
<table class="checks"><thead><tr><th>id</th><th>what turns green</th><th>kind</th><th>expected state (design inventory)</th><th>last recorded slice-1 run</th></tr></thead><tbody>${spec.checks.map(checkRow).join("")}</tbody></table>
<p class="sub">Run: <code class="cmd">node ${esc(spec.checks[0].file)}</code> · one check: <code class="cmd">${esc(spec.checks[0].command)}</code></p>

<h2>Cross-cutting decisions</h2>
<div class="decisions">${spec.decisions.map(decisionCard).join("\n")}</div>

<h2>Decisions that are Ryan's (carried, never done first)</h2>
<div class="pending">${spec.ryan_decisions_pending.map((r: any) => `<article><b>${esc(r.id)}</b> ${esc(r.what)}<br><span class="sub">brought as: ${esc(r.brought_as)} · default: ${esc(r.default)} · blocks: ${esc(r.blocks)}</span><br>${(r.serves ?? []).map((x: string) => chip(x, "ng")).join("")}</article>`).join("")}</div>

<h2>Roles</h2>
<div class="repo">
<div><b>manager</b>${esc(spec.roles.manager.model_preference)} · ${esc(spec.roles.manager.effort)}</div>
<div><b>implementers</b>${spec.roles.implementers.map((e: any) => esc(e.model_preference + " · " + e.effort)).join(" &nbsp;|&nbsp; ")}</div>
<div><b>reviewer</b>${esc(spec.roles.reviewer.model_preference)} · ${esc(spec.roles.reviewer.effort)}</div>
<div><b>judge</b>${esc(spec.roles.judge_rule)}</div>
<div><b>rule</b>${esc(spec.roles.rule)}<br><span class="sub">${esc(spec.roles.note)}</span></div>
</div>

${
  spec.contracts
    ? `<h2>Cross-cutting contracts every task inherits (second pass, Oct 8, 2026)</h2>
<p class="sub">${spec.contracts.length} contracts settle the consequential choices the two reviews and the slice-1 judge raised; a task inherits every contract that binds its slice. Each carries its own tests.</p>
<div class="decisions">${spec.contracts.map(contractCard).join("\n")}</div>`
    : ""
}

${
  spec.acceptance
    ? `<h2>Whole-design acceptance (K10)</h2>
<article class="decision" id="${esc(spec.acceptance.id)}"><div class="dhead"><span class="did">${esc(spec.acceptance.id)}</span><h4>${esc(spec.acceptance.title)}</h4></div><p>${esc(spec.acceptance.rule)}</p><p class="sub">depends on ${spec.acceptance.depends_on.tasks.length} tasks, ${spec.acceptance.depends_on.slices.length} slices, ${spec.acceptance.depends_on.preconditions.length} precondition(s) and ${spec.acceptance.depends_on.device_cells.length} required device cells · test: ${esc(spec.acceptance.test)}</p></article>`
    : ""
}

${spec.instruction_coverage ? `<section id="instruction-coverage"><h2>Current instruction coverage</h2><p>Phase 4 starts with fresh upstream reconciliation. Target-only jobs and provider tools are installed acceptance obligations, not current runtime claims. Raspberry Pi general rollout is deferred; archive storage and the bounded watcher/responder remain in scope.</p>${designDetails(spec.instruction_coverage)}</section>` : ""}
${spec.device_matrix ? `<h2>Device capability matrix — four active targets, Raspberry Pi deferred (K09)</h2><p class="sub">${esc(spec.device_matrix.rule)}</p>${matrixTable(spec.device_matrix)}` : ""}

${
  spec.audit_dispositions
    ? `<h2>Disposition of every audit item</h2>
<p class="sub">${esc(spec.audit_dispositions.rule)}</p>
<table class="checks"><thead><tr><th>item</th><th>what and current state</th><th>disposition</th><th>answered by</th></tr></thead><tbody>${spec.audit_dispositions.items.map(auditRow).join("")}</tbody></table>`
    : ""
}

${
  spec.ledger_dispositions
    ? `<h2>Every ledger item's disposition (K16)</h2>
<p class="sub">${Object.entries(spec.ledger_dispositions.counts)
        .map(([k, v]) => `${chip(k, kindClass[k] ?? "")} ${v}`)
        .join(
          " &nbsp; ",
        )} · implemented items are derived from the serves fields; the rest are authored. Showing the authored ones; the implemented ones are reachable by id in spec.json.</p>
<table class="checks"><thead><tr><th>item</th><th>title</th><th>kind</th><th>by</th><th>note</th></tr></thead><tbody>${spec.ledger_dispositions.items
        .filter((x: any) => x.note !== "named by serves")
        .map(ledgerRow)
        .join("")}</tbody></table>`
    : ""
}
</div>
<footer class="bottom">Rendered by render-spec.mts from spec.json · spec-data.mts is the source, spec.json is generated, this page is generated · ${esc(spec.ledger.path)}</footer>
<script>
(function(){
  var edges=${JSON.stringify(edges)};
  var svg=document.getElementById('g');
  var ids={};edges.forEach(function(e){ids[e[0]]=1;ids[e[1]]=1;});
  var list=Object.keys(ids);
  var slices=${JSON.stringify([...spec.slices.map((s: any) => ({ id: s.id, n: s.n, tasks: s.tasks, deps: s.depends_on })), ...(spec.acceptance ? [{ id: "accept", n: "accept", tasks: [spec.acceptance.id], deps: spec.slices.map((s: any) => s.id) }] : [])])};
  var colW=150,rowH=34,pad=20,cols={},rows={};
  slices.forEach(function(s,ci){s.tasks.forEach(function(t,ri){cols[t]=ci;rows[t]=ri;});});
  var maxRows=Math.max.apply(null,slices.map(function(s){return s.tasks.length;}));
  var W=pad*2+slices.length*colW,H=pad*2+(maxRows+1)*rowH;
  svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.setAttribute('height',H);
  var ns='http://www.w3.org/2000/svg';
  function pos(t){return {x:pad+cols[t]*colW+colW/2,y:pad+rowH+rows[t]*rowH};}
  var defs=document.createElementNS(ns,'defs');defs.innerHTML='<marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#8ab4ff"/></marker>';svg.appendChild(defs);
  slices.forEach(function(s,ci){var tx=document.createElementNS(ns,'text');tx.setAttribute('x',pad+ci*colW+colW/2);tx.setAttribute('y',pad+8);tx.setAttribute('text-anchor','middle');tx.setAttribute('fill','#9aa3b2');tx.setAttribute('font-size','11');tx.textContent=s.id==='accept'?'acceptance':'slice '+s.n;svg.appendChild(tx);});
  var colOf={};slices.forEach(function(s,ci){colOf[s.id]=ci;});
  slices.forEach(function(s,ci){(s.deps||[]).forEach(function(d){if(colOf[d]===undefined)return;var x1=pad+colOf[d]*colW+colW/2,x2=pad+ci*colW+colW/2,y=pad+rowH-14;var p=document.createElementNS(ns,'path');p.setAttribute('d','M'+x1+' '+y+' C '+((x1+x2)/2)+' '+(y-22)+', '+((x1+x2)/2)+' '+(y-22)+', '+x2+' '+y);p.setAttribute('fill','none');p.setAttribute('stroke',s.id==='accept'?'#2fbf71':'#e0a526');p.setAttribute('stroke-dasharray','4 3');p.setAttribute('stroke-opacity','0.7');p.setAttribute('marker-end','url(#ar)');svg.appendChild(p);});});
  edges.forEach(function(e){var a=pos(e[0]),b=pos(e[1]);var p=document.createElementNS(ns,'path');var mx=(a.x+b.x)/2;p.setAttribute('d','M'+(a.x+40)+' '+a.y+' C '+mx+' '+a.y+', '+mx+' '+b.y+', '+(b.x-40)+' '+b.y);p.setAttribute('fill','none');p.setAttribute('stroke','#4f8cff');p.setAttribute('stroke-opacity','0.55');p.setAttribute('marker-end','url(#ar)');svg.appendChild(p);});
  slices.forEach(function(s){s.tasks.forEach(function(t){var q=pos(t);var g=document.createElementNS(ns,'a');g.setAttribute('href','#'+t);var r=document.createElementNS(ns,'rect');r.setAttribute('x',q.x-40);r.setAttribute('y',q.y-11);r.setAttribute('width',80);r.setAttribute('height',22);r.setAttribute('rx',6);var det=${JSON.stringify(Object.fromEntries([...spec.tasks.map((t: any) => [t.id, t.detail_state]), ...(spec.acceptance ? [[spec.acceptance.id, "accept"]] : [])]))};r.setAttribute('fill',det[t]==='detailed'?'#1f3b2e':det[t]==='accept'?'#163b3b':'#3a2f17');r.setAttribute('stroke',det[t]==='detailed'?'#2fbf71':det[t]==='accept'?'#56b6c2':'#e0a526');var tx=document.createElementNS(ns,'text');tx.setAttribute('x',q.x);tx.setAttribute('y',q.y+4);tx.setAttribute('text-anchor','middle');tx.setAttribute('fill','#e7eaf0');tx.setAttribute('font-size','11');tx.textContent=t;g.appendChild(r);g.appendChild(tx);svg.appendChild(g);});});
})();
</script>
</body></html>`;

writeFileSync(join(HERE, "Spec-Map.html"), html);
console.log(
  `wrote Spec-Map.html (${html.length} bytes), ${edges.length} dependency edges, last check run: ${runs.length ? runs[runs.length - 1] : "none"}`,
);

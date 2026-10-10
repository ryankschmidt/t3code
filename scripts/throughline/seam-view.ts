// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - This native repository projector uses the existing workspace formatter, not an Effect runtime.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SeamManifest } from "./check-seam.ts";
import { bindRepository, git, RepositoryBindingError } from "./seam/repo-binding.ts";

const OUTPUT = "docs/throughline/seam-view.html";
const INSTALLED =
  "/Users/Admin/core-root/vault/01_Projects/workbench/infra/throughline/references/repository/repository.json";
const SHA = /^[a-f0-9]{40}$/;
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function render(root: string, manifest: SeamManifest, digest: string, override?: string) {
  let commit: string | null = override ?? null;
  let release: string | null = null;
  const source = override
    ? "explicit fixture/inspection override (not an installation witness)"
    : INSTALLED;
  if (!override && existsSync(INSTALLED)) {
    const snapshot = JSON.parse(readFileSync(INSTALLED, "utf8")) as {
      commit?: string;
      release?: string;
    };
    if (!snapshot.commit || !SHA.test(snapshot.commit))
      throw Error(`INSTALLED_COMMIT_INVALID: ${INSTALLED}`);
    commit = snapshot.commit;
    release = snapshot.release ?? null;
  }
  if (commit) {
    if (!SHA.test(commit))
      throw new RepositoryBindingError("--installed-commit requires a full commit SHA");
    try {
      git(root, "cat-file", "-e", `${commit}^{commit}`);
    } catch {
      throw new RepositoryBindingError(
        `Installed commit is absent from the bound repository: ${commit}`,
      );
    }
  }
  const entries = manifest.entries.map((entry) => {
    if (
      !entry.path ||
      entry.path.startsWith("/") ||
      entry.path.split("/").some((p) => !p || p === "." || p === "..") ||
      !["upstream-edit", "upstream-removed", "fork-added", "fork-namespace"].includes(entry.class)
    )
      throw Error(`INVALID_ENTRY: ${entry.path}`);
    let presence: "live" | "absent" | "unknown" = "unknown";
    if (commit) {
      try {
        git(root, "cat-file", "-e", `${commit}:${entry.path}`);
        presence = "live";
      } catch {
        presence = "absent";
      }
    }
    return { ...entry, presence };
  });
  const facts = {
    manifest_sha256: digest,
    upstream: manifest.upstream,
    fork: manifest.fork,
    merge_base: manifest.merge_base,
    counts: manifest.counts,
    admitted: manifest.admitted ?? null,
    conflict_rules: manifest.conflict_rules,
    installed: { commit, release, source },
    entries,
  };
  // Escaping '<' prevents a reason or source quote from ending the data script element.
  const data = JSON.stringify(facts)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const c = manifest.counts;
  const rows = entries
    .map(
      (entry, i) =>
        `<tr data-row="${i}" data-class="${escape(entry.class)}" data-presence="${entry.presence}"><td><button class="path" data-entry="${i}">${escape(entry.path)}</button></td><td><span class="tag ${entry.class}">${escape(entry.class)}</span></td><td><span class="tag ${entry.presence}">${entry.presence === "live" ? "live · path present" : entry.presence}</span></td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Keep the real binding element on one line for the slice-2 check's literal parser. -->
<!-- prettier-ignore -->
<meta name="seam-manifest-sha256" content="${digest}">
<meta name="format-choice" content="html — shows fork sides, thin mounts, measured counts and installed presence"><title>ThroughLine · Fork seam</title><style>
:root{--bg:#0a0d12;--card:#141b25;--line:#232d3c;--text:#e8eef7;--muted:#93a0b2;--upstream:#5b8def;--ours:#3fd28b;--boundary:#f2b34a;--patch:#c08bff;--danger:#ff5f6e;--unknown:#9aa5b1;--radius:14px}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,sans-serif}main{max-width:1380px;margin:auto;padding:32px 36px}h1{font-size:36px;letter-spacing:-.03em;margin:8px 0}h2{font-size:20px;margin:0 0 10px}p{margin:8px 0;color:var(--muted)}.eyebrow{color:var(--boundary);font:12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.12em}.hero{padding:20px 24px;border:1px solid var(--line);border-radius:var(--radius);background:linear-gradient(105deg,#132039,var(--card) 58%,#10251d)}.banner{margin:18px 0;padding:12px 16px;background:#211d15;border:1px solid #63512e;border-radius:10px;color:var(--boundary)}.counts{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.metric,.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px}.metric strong{display:block;font:32px ui-monospace,monospace}.metric span{color:var(--muted)}.metric.up{border-top:3px solid var(--upstream)}.metric.our{border-top:3px solid var(--ours)}.metric.patch{border-top:3px solid var(--patch)}.seam{display:grid;grid-template-columns:1fr 70px 1fr 70px 1fr;align-items:stretch;margin:20px 0}.zone{padding:20px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius)}.zone.up{border-top:3px solid var(--upstream)}.zone.boundary{border-top:3px solid var(--boundary)}.zone.our{border-top:3px solid var(--ours)}.edge{display:grid;place-items:center;color:var(--boundary);font-size:30px}.readout{display:grid;grid-template-columns:130px 1fr;gap:8px;margin:18px 0;font-size:13px}.readout dt{color:var(--muted)}.readout dd{margin:0;overflow-wrap:anywhere;font-family:ui-monospace,monospace}.controls{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}input,select,button{font:inherit;color:var(--text);background:#0e1520;border:1px solid var(--line);border-radius:8px;padding:9px 12px}input{min-width:250px;flex:1}button{cursor:pointer}button:hover,button:focus-visible{border-color:var(--boundary)}label{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:13px}.layout{display:grid;grid-template-columns:minmax(0,1fr) 365px;gap:18px}.table-scroll{max-height:580px;overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th{text-align:left;color:var(--muted);position:sticky;top:0;background:var(--card);z-index:1}th,td{padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}.path{font:12px ui-monospace,monospace;text-align:left;border:none;background:none;padding:0;overflow-wrap:anywhere;word-break:break-word}.tag{display:inline-block;font:10px ui-monospace,monospace;border:1px solid var(--line);border-radius:20px;padding:3px 7px;white-space:nowrap}.upstream-edit,.upstream-removed{color:var(--upstream)}.fork-namespace,.live{color:var(--ours)}.fork-added{color:var(--patch)}.unknown{color:var(--unknown)}.absent{color:var(--danger)}.inspector{position:sticky;top:18px;align-self:start;overflow-wrap:anywhere;font-size:13px}.inspector pre{white-space:pre-wrap;max-height:230px;overflow:auto;font:11px ui-monospace,monospace}.inspector a{color:var(--upstream)}.inspector dt{color:var(--muted);margin-top:10px}.inspector dd{margin:3px 0}.selected{background:#223047}footer{padding:22px 0;color:var(--muted);font-size:12px}.status{font-size:12px;color:var(--boundary)}[hidden]{display:none!important}@media(max-width:1000px){.layout{grid-template-columns:1fr}.inspector{position:static}.seam{grid-template-columns:1fr}.edge{transform:rotate(90deg)}main{padding:18px}.counts{grid-template-columns:1fr 1fr}}@media print{.table-scroll{max-height:none;overflow:visible}.inspector,.controls{display:none}.layout{display:block}}
</style></head><body><main>
<header class="hero"><div class="eyebrow">ThroughLine · repository seam · current pinned facts</div><h1>Fork seam</h1><p>What is custom, where new behavior belongs, and what the installed commit contains. This is a pinned facts view, not a release approval.</p><span class="tag ${manifest.admitted ? "live" : "unknown"}">${manifest.admitted ? "admitted ceiling recorded" : "draft · no admission"}</span></header>
${!manifest.admitted ? '<div class="banner">Measured, not admitted. First admission waits for the fully composed source; no ceiling is established by this view.</div>' : '<div class="banner">Admitted counts may only fall. Thin mounts preserve the first admitted fork baseline.</div>'}
<section class="counts" aria-label="Manifest class counts"><div class="metric up"><strong>${c.upstream_edit}</strong><span>upstream edits</span></div><div class="metric up"><strong>${c.upstream_removed}</strong><span>upstream removals</span></div><div class="metric our"><strong>${c.fork_namespace}</strong><span>fork namespace files</span></div><div class="metric patch"><strong>${c.fork_added}</strong><span>outside the namespace</span></div></section>
<section class="seam" aria-label="Where behavior belongs"><article class="zone up"><h2>Upstream entry point</h2><p>Keep upstream behavior on its side. Historical edits are measured, not retroactively failed.</p></article><div class="edge" aria-hidden="true">→</div><article class="zone boundary"><h2>Thin mount</h2><p>After admission: at most three added lines, all namespace imports or calls. The count check and mount check are separate gates.</p></article><div class="edge" aria-hidden="true">→</div><article class="zone our"><h2>Fork behavior</h2><p><code>apps/&lt;app&gt;/src/throughline/</code><br><code>packages/throughline-*</code></p><p>Outside files carry a relocation plan or a reason to stay.</p></article></section>
<section class="panel"><h2>Source and installed presence</h2><dl class="readout"><dt>Manifest SHA-256</dt><dd>${digest}</dd><dt>Pinned fork</dt><dd>${escape(manifest.fork.sha)}</dd><dt>Pinned upstream</dt><dd>${escape(manifest.upstream.sha)}</dd><dt>True merge base</dt><dd>${escape(manifest.merge_base)}</dd><dt>Installed commit</dt><dd>${escape(commit ?? "unknown — publication record absent")}</dd><dt>Installed release</dt><dd>${escape(release ?? "unknown")}</dd><dt>Presence source</dt><dd>${escape(source)}</dd></dl><p>${commit ? "Path presence only: live means the path exists at the named installed/inspection commit. It does not prove byte equality, behavior or acceptance." : "Installed file presence is unknown. No entry is marked live without a known commit from the publication record or an explicitly labelled inspection override."}</p></section>
<section style="margin-top:24px"><h2>Find a custom path</h2><p>Manifest entries only. For a new or unlisted path, run <code>node scripts/throughline/seam-side.ts --repo &lt;root&gt; &lt;path&gt;</code> against Git.</p><div class="controls"><input id="search" aria-label="Search paths and reasons" placeholder="Search paths and reasons"><label>Side <select id="side"><option value="">All sides</option><option>upstream-edit</option><option>upstream-removed</option><option>fork-namespace</option><option>fork-added</option></select></label><label>Presence <select id="presence"><option value="">All presence states</option><option value="live">Live · path present</option><option value="absent">Absent at commit</option><option value="unknown">Unknown</option></select></label></div><p id="matches" role="status">${entries.length} entries</p><div class="layout"><div class="panel table-scroll"><table><thead><tr><th>Path · click to inspect</th><th>Fork class</th><th>Installed presence</th></tr></thead><tbody>${rows}</tbody></table></div><aside class="panel inspector" id="inspector" aria-label="Path inspector"><h2>Inspect a path</h2><p>Select a row to see its reason, conflict rule, relocation and recorded mount count.</p></aside></div></section>
<footer>Generated from throughline-seam.json. Default conflict rule: ${escape(manifest.conflict_rules.default)}. Capability paths: ${escape(manifest.conflict_rules.capability_paths)}. Verify with seam-view.ts --verify; do not hand-edit this HTML.</footer>
</main><script type="application/json" id="seam-facts">${data}</script><script>
const facts=JSON.parse(document.getElementById('seam-facts').textContent);const rows=[...document.querySelectorAll('[data-row]')];let selected=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function filter(){const q=document.getElementById('search').value.toLowerCase(),side=document.getElementById('side').value,presence=document.getElementById('presence').value;let shown=0;rows.forEach((row,i)=>{const e=facts.entries[i];row.hidden=!!((side&&e.class!==side)||(presence&&e.presence!==presence)||q&&!(e.path+' '+e.reason).toLowerCase().includes(q));if(!row.hidden)shown++;});document.getElementById('matches').textContent=shown+' of '+rows.length+' entries';}
['search','side','presence'].forEach(id=>document.getElementById(id).addEventListener('input',filter));
document.querySelectorAll('[data-entry]').forEach(button=>button.addEventListener('click',()=>{selected=facts.entries[Number(button.dataset.entry)];rows.forEach(r=>r.classList.toggle('selected',r.dataset.row===button.dataset.entry));const e=selected;document.getElementById('inspector').innerHTML='<h2>'+esc(e.path)+'</h2><span class="tag '+esc(e.class)+'">'+esc(e.class)+'</span><dl><dt>Reason · '+esc(e.reason_source)+'</dt><dd><pre>'+esc(e.reason)+'</pre></dd><dt>Conflict rule</dt><dd>'+esc(e.conflict_rule)+'</dd><dt>Relocation</dt><dd>'+esc(e.relocation??'not applicable')+' '+esc(e.relocation_reason??'')+'</dd><dt>Historical non-import mount lines</dt><dd>'+esc(e.mount_lines??'not applicable')+'</dd><dt>Contract inspection</dt><dd>'+esc(e.contract_inspection)+'</dd><dt>Installed presence</dt><dd>'+esc(e.presence)+' · path presence only</dd></dl><p><a href="../../'+e.path.split('/').map(encodeURIComponent).join('/')+'">Open source path</a></p><button id="copy">Copy path context</button><p id="copy-status" class="status" role="status"></p>';document.getElementById('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(JSON.stringify({manifest_sha256:facts.manifest_sha256,installed:facts.installed,entry:selected},null,2));document.getElementById('copy-status').textContent='Copied path context';}catch{document.getElementById('copy-status').textContent='Clipboard unavailable — source facts remain in this page.';}});}));
</script></body></html>\n`;
}

function main() {
  const args = process.argv.slice(2);
  let repo = "",
    out = OUTPUT,
    override: string | undefined,
    verify = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--verify") verify = true;
    else if (flag === "--repo" || flag === "--out" || flag === "--installed-commit") {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new RepositoryBindingError(`Missing value for ${flag}`);
      if (flag === "--repo") repo = value;
      else if (flag === "--out") out = value;
      else override = value;
    } else throw new RepositoryBindingError(`Unknown option: ${flag}`);
  }
  if (out !== OUTPUT)
    throw new RepositoryBindingError(
      `--out must be ${OUTPUT}; the projector never overwrites another source file`,
    );
  const { root } = bindRepository(repo);
  const bytes = readFileSync(join(root, "throughline-seam.json"));
  const manifest = JSON.parse(bytes.toString("utf8")) as SeamManifest;
  if (manifest.schema !== "throughline.seam-manifest.v1" || !Array.isArray(manifest.entries))
    throw Error("INVALID_SEAM_MANIFEST");
  const digest = createHash("sha256").update(bytes).digest("hex");
  // Match the repository's active pre-commit formatter without writing in --verify mode.
  // The ship step runs after frozen dependencies and before any signed build.
  // Invoke the installed formatter directly: pnpm exec may auto-install when module
  // metadata differs, which would make a supposedly read-only verification mutate dependencies.
  const formatted = spawnSync(
    join(root, "node_modules/.bin/vp"),
    ["fmt", `--stdin-filepath=${OUTPUT}`],
    {
      cwd: root,
      input: render(root, manifest, digest, override),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (formatted.status !== 0 || !formatted.stdout.trimStart().startsWith("<!doctype html>"))
    throw Error(
      `FORMATTER_REFUSED: install the frozen workspace first; exit ${formatted.status}; ${formatted.error?.message ?? ""}; ${formatted.stderr}; ${formatted.stdout.slice(0, 1000)}`,
    );
  const html = formatted.stdout;
  const file = join(root, out);
  if (verify) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== html)
      throw Error(
        `VIEW_STALE_OR_MODIFIED: ${out}; regenerate from the current manifest and installed presence source`,
      );
    console.log(`seam-view: verified ${digest}`);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
    console.log(`seam-view: generated ${out} from ${digest}`);
  }
}
try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof RepositoryBindingError ? 2 : 1;
}

// Design-contract validation only. Never executes planned product, install, fault or credential probes.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const home = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = JSON.parse(readFileSync(join(home, "spec.json"), "utf8"));
const ids = new Set(spec.tasks.map((t: any) => t.id)),
  errors: string[] = [];
const policy = spawnSync("ryan", ["model", "list", "--json"], { encoding: "utf8", timeout: 30000 });
let roles: any[] = [];
if (policy.status !== 0) errors.push("live execution policy unavailable");
else {
  try {
    roles = JSON.parse(policy.stdout).result.policy.task_roles;
  } catch {
    errors.push("live execution policy malformed");
  }
}
for (const t of spec.tasks) {
  if (
    t.detail_state !== "detailed" ||
    !t.what ||
    !t.files?.length ||
    !t.signatures?.length ||
    !t.done_when?.command ||
    !t.done_when?.expect ||
    !t.governing_shapes?.length
  )
    errors.push(t.id + ": incomplete executable design contract");
  for (const p of t.governing_shapes ?? [])
    if (!existsSync(p)) errors.push(t.id + ": missing governing shape " + p);
  for (const d of t.depends_on ?? [])
    if (!ids.has(d) && !spec.slices.some((s: any) => s.id === d || s.precondition?.id === d))
      errors.push(t.id + ": unresolved dependency " + d);
  if (
    t.executor?.role !== "implementer" ||
    !roles.some(
      (r) =>
        r.model === t.executor?.model_preference &&
        (r.allowed_efforts ?? [r.effort]).includes(t.executor?.effort),
    )
  )
    errors.push(t.id + ": stale execution role");
  if (t.planned_checks?.some((c: any) => !c.command || !c.id))
    errors.push(t.id + ": incomplete planned check");
}
for (const r of spec.device_matrix.rows)
  for (const c of r.cells)
    if (
      c.state === "required" &&
      (!ids.has(c.owner) ||
        !c.test ||
        (["ios", "android"].includes(c.device) && c.proof !== "physical"))
    )
      errors.push(r.capability + ": invalid required cold device contract");
const t = spec.tasks.find((t: any) => t.id === "T4.03");
if (!t?.depends_on.includes("T4.04") || !t.depends_on.includes("T4.05"))
  errors.push("observer prerequisite execution owners missing");
if (spec.tasks.some((t: any) => t.id === "T10.11"))
  errors.push("withdrawn terminal exploration became required");
for (const e of errors) console.error(e);
console.log(
  `${spec.tasks.length - errors.length} of ${spec.tasks.length} task design contracts checked; ${errors.length} failures; no product behavior certified`,
);
process.exit(errors.length ? 1 : 0);

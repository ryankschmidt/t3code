// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - This native repository inspection contract runs before workspace installation or an Effect runtime.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SeamManifest } from "./check-seam.ts";
import { classifyAdded, nameStatuses } from "./seam/classify.ts";
import { bindRepository, git, RepositoryBindingError } from "./seam/repo-binding.ts";

function main() {
  const args = process.argv.slice(2);
  if (args[0] !== "--repo" || !args[1] || args.length < 3)
    throw new RepositoryBindingError("Usage: seam-side.ts --repo <absolute root> <path>...");
  const { root } = bindRepository(args[1]);
  const paths = args.slice(2);
  for (const path of paths)
    if (
      path.startsWith("-") ||
      path.startsWith("/") ||
      /[\\\t\r\n]/.test(path) ||
      path.split("/").some((p) => !p || p === "." || p === "..")
    )
      throw new RepositoryBindingError(`Invalid repository-relative path: ${JSON.stringify(path)}`);
  const manifest = JSON.parse(
    readFileSync(join(root, "throughline-seam.json"), "utf8"),
  ) as SeamManifest;
  if (
    manifest.schema !== "throughline.seam-manifest.v1" ||
    !/^[a-f0-9]{40}$/.test(manifest.merge_base)
  )
    throw Error("INVALID_SEAM_MANIFEST");
  const entries = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  // Includes staged and unstaged tracked changes, not merely the pinned manifest snapshot.
  const changes = new Map(
    nameStatuses(
      git(
        root,
        "diff",
        "--name-status",
        "-z",
        "-M",
        manifest.merge_base,
        "--",
        ...paths.map((path) => `:(literal)${path}`),
      ),
    ).map((change) => [change.path, change]),
  );
  for (const path of paths) {
    const entry = entries.get(path),
      change = changes.get(path);
    let upstream = false;
    try {
      git(root, "cat-file", "-e", `${manifest.merge_base}:${change?.renamedFrom ?? path}`);
      upstream = true;
    } catch {}
    const cls = change
      ? change.status === "D"
        ? "upstream-removed"
        : change.status === "A" && !upstream
          ? classifyAdded(path)
          : "upstream-edit"
      : upstream
        ? "upstream-unmodified"
        : classifyAdded(path);
    const upstreamEdit = cls === "upstream-edit" || cls === "upstream-removed";
    if (
      upstreamEdit &&
      (!entry || (entry.class !== "upstream-edit" && entry.class !== "upstream-removed"))
    ) {
      console.log(
        `${path}\t${cls}\tUNLISTED_UPSTREAM_EDIT: register the real diff before shipping; new behavior belongs in the namespace, upstream gets thin mount lines only`,
      );
      process.exitCode = 1;
      continue;
    }
    const advice = upstream
      ? "new behavior -> apps/<app>/src/throughline/ or packages/throughline-*; upstream entry point -> at most three namespace import/call lines after admission"
      : cls === "fork-namespace"
        ? "new behavior belongs here, on the fork side"
        : `new behavior -> namespace; outside-namespace relocation: ${entry?.relocation ?? "planned"}${entry?.relocation_reason ? ` (${entry.relocation_reason})` : ""}`;
    console.log(
      `${path}\t${cls}\t${advice}${entry && entry.class !== cls ? `; pinned manifest class: ${entry.class}` : ""}`,
    );
  }
}
try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof RepositoryBindingError ? 2 : 1;
}

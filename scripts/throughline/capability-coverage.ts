import type { SeamManifest } from "./check-seam.ts";

type CapabilityPaths = { readonly paths: readonly string[] };
type ForkPathManifest = {
  readonly entries: readonly Pick<SeamManifest["entries"][number], "path">[];
};
type CoverageManifest = ForkPathManifest & {
  readonly admitted?: { readonly uncovered_fork_path_count?: number } | null;
};

export function uncoveredForkPaths(
  manifest: ForkPathManifest,
  capabilities: readonly CapabilityPaths[],
): string[] {
  const covered = new Set(capabilities.flatMap((capability) => capability.paths));
  return [...new Set(manifest.entries.map((entry) => entry.path))]
    .filter((path) => !covered.has(path))
    .sort();
}

export function capabilityCoverage(
  manifest: CoverageManifest,
  capabilities: readonly CapabilityPaths[],
) {
  const paths = uncoveredForkPaths(manifest, capabilities);
  const admitted = manifest.admitted;
  if (admitted == null) return { count: paths.length, paths, admitted_count: null };
  const limit = admitted.uncovered_fork_path_count;
  if (limit === undefined || !Number.isSafeInteger(limit) || limit < 0) {
    throw new Error("CAPABILITY_COVERAGE_BASELINE_MISSING");
  }
  if (paths.length > limit) {
    throw new Error(`CAPABILITY_COVERAGE_INCREASED: ${paths.length} > ${limit}`);
  }
  return { count: paths.length, paths, admitted_count: limit };
}

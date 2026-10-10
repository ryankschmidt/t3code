import { describe, expect, it } from "vite-plus/test";
import { capabilityCoverage, uncoveredForkPaths } from "./capability-coverage.ts";

const entries = [
  { path: "apps/server/src/throughline/rewind/a.ts" },
  { path: "apps/mobile/src/menu.ts" },
  { path: "docs/throughline/capabilities/rewind/Capability.json" },
];
const capabilities = [{ paths: [entries[0]!.path] }];

describe("repository capability coverage", () => {
  it("counts exact uncovered fork entries, sorted and without prefix matches", () => {
    expect(uncoveredForkPaths({ entries }, capabilities)).toEqual([
      "apps/mobile/src/menu.ts",
      "docs/throughline/capabilities/rewind/Capability.json",
    ]);
    expect(
      uncoveredForkPaths({ entries }, [{ paths: entries.map((entry) => entry.path) }]),
    ).toEqual([]);
  });

  it("measures intermediate heads without creating the first seam admission", () => {
    const manifest = { entries, admitted: null };
    expect(capabilityCoverage(manifest, capabilities)).toEqual({
      count: 2,
      paths: [entries[1]!.path, entries[2]!.path],
      admitted_count: null,
    });
    expect(manifest.admitted).toBeNull();
  });

  it("the first admitted uncovered count allows only equal or lower coverage debt", () => {
    expect(
      capabilityCoverage({ entries, admitted: { uncovered_fork_path_count: 2 } }, capabilities)
        .count,
    ).toBe(2);
    expect(
      capabilityCoverage({ entries, admitted: { uncovered_fork_path_count: 3 } }, capabilities)
        .count,
    ).toBe(2);
    expect(() =>
      capabilityCoverage({ entries, admitted: { uncovered_fork_path_count: 1 } }, capabilities),
    ).toThrow("CAPABILITY_COVERAGE_INCREASED");
  });

  it("an admitted seam with no valid coverage baseline cannot silently acquire one", () => {
    for (const admitted of [
      {},
      { uncovered_fork_path_count: -1 },
      { uncovered_fork_path_count: 1.5 },
    ]) {
      expect(() => capabilityCoverage({ entries, admitted }, capabilities)).toThrow(
        "CAPABILITY_COVERAGE_BASELINE_MISSING",
      );
    }
  });
});

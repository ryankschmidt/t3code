// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeFS from "node:fs";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import {
  assertClaudeRewindPopulation,
  compileProviderRewindFixture,
  consumeCompiledRewindFixture,
  consumeUnsupportedVersionFixture,
  type CompiledRewindFixture,
} from "./providerRewind.ts";

const workspaceRoot = process.env.T3_REWIND_CALLER_ROOT
  ? NodePath.resolve(process.env.T3_REWIND_CALLER_ROOT)
  : NodePath.resolve(import.meta.dirname, "../../../../..");
const outputParent =
  process.env.T3_REWIND_PROOF_OUTPUT ?? "/Users/Admin/throughline-worktrees/.proof-fixtures";
const nativePiBinary = process.env.T3_PI_NATIVE_TEST_BINARY;
let fixture: CompiledRewindFixture;

describe("source-bound Claude population", () => {
  const current = {
    testSha256: "a1d74dd682f2262ddab28a1d6c81c18406e4e839bbb22fe34ef6f69d54dee05a",
    callerSha256: "89627de401a33d9344187bc767a809c44c8fac68ecd7ffc144196fb5a78f9633",
  };
  const report = (passed: number, excluded: number) => ({
    success: true,
    numTotalTests: passed + excluded,
    numPassedTests: passed,
    numFailedTests: 0,
    numPendingTests: excluded,
    numTodoTests: 0,
    testResults: [
      {
        assertionResults: [
          ...Array.from({ length: passed }, () => ({ status: "passed" })),
          ...Array.from({ length: excluded }, () => ({ status: "pending" })),
        ],
      },
    ],
  });
  it("requires the complete exact current source population", () => {
    expect(assertClaudeRewindPopulation(current, report(21, 145))).toMatchObject({
      passed: 21,
      excluded: 145,
      total: 166,
    });
  });
  it.each([
    [0, 145],
    [20, 145],
    [22, 145],
    [21, 144],
  ])("rejects zero/partial/wrong population %s/%s", (passed, excluded) => {
    expect(() => assertClaudeRewindPopulation(current, report(passed!, excluded!))).toThrow(
      "population mismatch",
    );
  });
  it("rejects an unknown caller/test association", () => {
    expect(() =>
      assertClaudeRewindPopulation({ ...current, callerSha256: "unreviewed" }, report(21, 145)),
    ).toThrow("not an admitted");
  });
  it("retains the historical 20-case population only with its exact old source pins", () => {
    const old = {
      testSha256: "205d7d783ef9a7f471cff5e129e8661f4a502bf6fcff10db4ae97d02d9a500f6",
      callerSha256: "6e51bc40747b9526f99e80cf9068df3e9825d23a43f73d399fc5c7f74f25c63c",
    };
    expect(assertClaudeRewindPopulation(old, report(20, 144))).toMatchObject({
      passed: 20,
      excluded: 144,
    });
    expect(() => assertClaudeRewindPopulation(current, report(20, 144))).toThrow(
      "population mismatch",
    );
  });
});

beforeAll(async () => {
  fixture = await compileProviderRewindFixture({
    workspaceRoot,
    nodeExecutable: process.execPath,
    outputParent,
  });
}, 60_000);

it("builds compiled-only provider consumer artifacts", async () => {
  expect(fixture.artifacts.length).toBeGreaterThanOrEqual(5);
  expect(fixture.artifacts.every((file) => file.endsWith(".mjs"))).toBe(true);
  expect(fixture.externalTypeScriptImports).toEqual([]);
  expect(Object.keys(fixture.sourceHashes).some((file) => file.endsWith("/PiAdapter.ts"))).toBe(
    true,
  );
  expect(
    Object.keys(fixture.sourceHashes).some((file) => file.endsWith("/piNativeNavigation.ts")),
  ).toBe(true);
  expect(
    Object.values(fixture.workspaceOverrides).every((file) =>
      file.startsWith(workspaceRoot + NodePath.sep),
    ),
  ).toBe(true);
  for (const file of fixture.artifacts) expect(NodeFS.statSync(file).size).toBeGreaterThan(0);
});

describe("compiled provider rewind consumers", () => {
  it("fails truthfully when the compiled launcher cannot load its generated extension path", () => {
    if (!nativePiBinary) throw new Error("Native Pi binary was not supplied.");
    const receipt = consumeCompiledRewindFixture(fixture, {
      nativePiBinary,
      selection: "native-pi",
      breakExtensionLookup: true,
    });
    expect(receipt.status).not.toBe(0);
    expect(receipt.lookupNegative?.args).toContain(receipt.lookupNegative?.requestedExtension);
    expect(NodeFS.existsSync(receipt.lookupNegative!.requestedExtension)).toBe(false);
    expect(receipt.output).toMatch(
      /Pi RPC process exited \(1\)|navigation extension is unavailable/,
    );
  }, 190_000);
  it.each(["old", "unknown"] as const)(
    "reports %s-version protocol failure without replacing state or starting a model turn",
    (kind) => {
      const receipt = consumeUnsupportedVersionFixture(fixture, kind);
      expect(receipt.status, receipt.output).toBe(0);
      expect(receipt.advertisedVersion).toBe(kind === "old" ? "0.0.1" : "unknown");
      expect(receipt.output).toContain('"status":"Failure"');
      expect(receipt.output).toContain('"sameSession":true');
      expect(receipt.output).toContain('"auditUnchanged":true');
      expect(receipt.output).toContain('"externalUnchanged":true');
      expect(receipt.output).toMatch(/unsupported/);
    },
  );
  it("requires a measured native binary rather than silently skipping native proof", () => {
    expect(
      nativePiBinary,
      "Set T3_PI_NATIVE_TEST_BINARY to the measured native Pi entry point.",
    ).toBeTruthy();
  });

  it("consumes compiled Pi/Codex behavior, including native navigation and cancellation", () => {
    if (!nativePiBinary) throw new Error("Native Pi binary was not supplied.");
    const receipt = consumeCompiledRewindFixture(fixture, {
      nativePiBinary,
      selection: "pi-codex",
    });
    expect(receipt.nodeVersion).toBe("v24.13.1");
    expect(receipt.status, receipt.output).toBe(0);
    expect(receipt.output).toMatch(/120 passed/);
    expect(receipt.output).not.toMatch(/skipped/);
    expect(
      receipt.preservation.filter((row) => row.phase === "after").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      receipt.preservation.filter((row) => row.phase === "initial").length,
    ).toBeGreaterThanOrEqual(2);
    expect(receipt.preservation.every((row) => row.auditUnchanged && row.externalUnchanged)).toBe(
      true,
    );
  }, 190_000);

  it("retains compiled Claude same-session rewind protection", () => {
    if (!nativePiBinary) throw new Error("Native Pi binary was not supplied.");
    const receipt = consumeCompiledRewindFixture(fixture, { nativePiBinary, selection: "claude" });
    expect(receipt.status, receipt.output).toBe(0);
    expect(receipt.claudeSourceBinding).toBeDefined();
    assertClaudeRewindPopulation(receipt.claudeSourceBinding!, receipt.claudePopulationReport);
  }, 190_000);

  it("rejects a compiled artifact whose emitted extension does not register", async () => {
    if (!nativePiBinary) throw new Error("Native Pi binary was not supplied.");
    const broken = await compileProviderRewindFixture({
      workspaceRoot,
      nodeExecutable: process.execPath,
      outputParent,
      variant: "broken-extension",
    });
    const receipt = consumeCompiledRewindFixture(broken, {
      nativePiBinary,
      selection: "native-pi",
    });
    expect(receipt.status).not.toBe(0);
    expect(receipt.output).toMatch(
      /navigation extension is unavailable; same-session rewind is unsupported/,
    );
  }, 190_000);

  it("preserves truthful unsupported/cancellation failures through compiled code", () => {
    if (!nativePiBinary) throw new Error("Native Pi binary was not supplied.");
    const receipt = consumeCompiledRewindFixture(fixture, {
      nativePiBinary,
      selection: "unsupported",
    });
    expect(receipt.status, receipt.output).toBe(0);
    expect(receipt.output).toMatch(/2 passed/);
  }, 190_000);
});

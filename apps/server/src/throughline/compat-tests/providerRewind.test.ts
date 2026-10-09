// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeFS from "node:fs";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import {
  inspectPackagedProviderContract,
  compileProviderRewindFixture,
  consumeCompiledRewindFixture,
  consumeUnsupportedVersionFixture,
  type CompiledRewindFixture,
} from "./providerRewind.ts";

const workspaceRoot = NodePath.resolve(import.meta.dirname, "../../../../..");
const outputParent =
  process.env.T3_REWIND_PROOF_OUTPUT ?? "/Users/Admin/throughline-worktrees/.proof-fixtures";
const nativePiBinary = process.env.T3_PI_NATIVE_TEST_BINARY;
let fixture: CompiledRewindFixture;

describe("packaged path safety", () => {
  it("refuses an old vault payload before reading or executing it", async () => {
    await expect(
      inspectPackagedProviderContract({
        artifactRoot: "/Users/Admin/core-root/vault/old-payload",
        custodyManifest: "/not-read",
        asarReader: "/not-read",
        fuseReader: "/not-read",
        outputParent,
      }),
    ).rejects.toThrow("old vault payload paths are refused");
  });
});

describe.skipIf(Boolean(process.env.T3_PACKAGED_REWIND_ARTIFACT_ROOT))(
  "compiled fixture protection",
  () => {
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
        expect(
          receipt.preservation.every((row) => row.auditUnchanged && row.externalUnchanged),
        ).toBe(true);
      }, 190_000);

      it("retains compiled Claude same-session rewind protection", () => {
        if (!nativePiBinary) throw new Error("Native Pi binary was not supplied.");
        const receipt = consumeCompiledRewindFixture(fixture, {
          nativePiBinary,
          selection: "claude",
        });
        expect(receipt.status, receipt.output).toBe(0);
        expect(receipt.output).toMatch(/20 passed/);
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
  },
);

describe.skipIf(!process.env.T3_PACKAGED_REWIND_ARTIFACT_ROOT)(
  "actual packaged snapshot boundary",
  () => {
    let receipt: Awaited<ReturnType<typeof inspectPackagedProviderContract>>;
    beforeAll(async () => {
      receipt = await inspectPackagedProviderContract({
        artifactRoot: process.env.T3_PACKAGED_REWIND_ARTIFACT_ROOT!,
        custodyManifest: process.env.T3_PACKAGED_REWIND_MANIFEST!,
        asarReader: process.env.T3_PACKAGED_ASAR_READER!,
        fuseReader: process.env.T3_PACKAGED_FUSE_READER!,
        outputParent,
      });
      NodeFS.writeFileSync(
        NodePath.join(outputParent, "Latest-Packaged-Receipt-Path.txt"),
        NodePath.join(receipt.directory, "Packaged-Consumer-Receipt.json") + "\n",
      );
    }, 60_000);
    it("consumes byte-matched package interpreter/public CLI without GUI or backend state", () => {
      expect(receipt.zipCustodyMatched).toBe(true);
      expect(receipt.interpreter.status).toBe(0);
      expect(receipt.help.status).toBe(0);
      expect(receipt.actualInterpreter.home).toBe(receipt.home);
      expect(receipt.backendStarted).toBe(false);
      expect(receipt.guiStarted).toBe(false);
      expect(receipt.freshlyBundledFixtureUsed).toBe(false);
    });
    it("records the real missing packaged export boundary instead of substituting source", () => {
      expect(receipt.exportsProbe.status).toBe(0);
      expect(receipt.publicExports).toEqual(["cli", "makeCli"]);
      expect(receipt.missingPublicFactories).toEqual([
        "makePiAdapter",
        "makePiSessionRuntime",
        "registerPiNativeNavigation",
      ]);
      expect(receipt.modelRequests).toBe(false);
      expect(receipt.credentialsRead).toBe(false);
    });
    it("exposes early c668 Pi refusal truthfully, not as final installed acceptance", () => {
      expect(receipt.sourceSha).toBe("c6682e32f65752b1bdb2170793df12bba1cbed94");
      expect(receipt.nativePiRefusal.present).toBe(true);
      expect(receipt.nativeBridgeMarkers.every((marker) => !marker.present)).toBe(true);
      expect(receipt.providerAcceptance).toContain("not proven");
    });
  },
);

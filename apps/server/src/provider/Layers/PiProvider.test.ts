// @effect-diagnostics nodeBuiltinImport:off - Writes a throwaway fake `pi` script for the health-check tests.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { PiSettings } from "@t3tools/contracts";

import {
  PI_VERSION_PROBE_TIMEOUT_MS,
  buildInitialPiProviderSnapshot,
  checkPiProviderStatus,
  piModelsFromSettings,
  piModelsFromCatalog,
} from "./PiProvider.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);

describe("piModelsFromSettings", () => {
  it("offers discovered Astra with native reasoning and leaves Claude names unchanged", () => {
    const models = piModelsFromCatalog([
      { slug: "openai-codex/gpt-6-astra", name: "GPT-6 Astra" },
      { slug: "anthropic/claude-opus-5", name: "Claude Opus 5" },
    ]);
    expect(models.map(({ slug, name }) => ({ slug, name }))).toEqual([
      { slug: "openai-codex/gpt-6-astra", name: "GPT-6-Astra" },
      { slug: "anthropic/claude-opus-5", name: "Claude Opus 5" },
    ]);
    expect(models[0]?.capabilities?.optionDescriptors?.[0]?.id).toBe("thinkingLevel");
    expect(piModelsFromCatalog([])).toEqual([]);
  });
  it("leaves headroom for the governed ryan-pi wrapper before declaring a timeout", () => {
    expect(PI_VERSION_PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
  });

  it("attaches pi's native thinkingLevel Reasoning descriptor to every model", () => {
    const models = piModelsFromSettings(["anthropic/claude-x", "openai/gpt-x"]);
    expect(models).toHaveLength(2);
    for (const model of models) {
      const descriptors = model.capabilities?.optionDescriptors ?? [];
      expect(descriptors).toHaveLength(1);
      const descriptor = descriptors[0];
      expect(descriptor?.id).toBe("thinkingLevel");
      expect(descriptor?.label).toBe("Reasoning");
      expect(descriptor?.type).toBe("select");
      expect(descriptor && "options" in descriptor ? descriptor.options : []).toEqual([
        { id: "off", label: "Off" },
        { id: "minimal", label: "Minimal" },
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High", isDefault: true },
        { id: "xhigh", label: "Extra High" },
      ]);
    }
  });

  it("still ships zero built-in models (#402: models come from Pi, never a static list)", () => {
    expect(piModelsFromSettings(undefined)).toHaveLength(0);
    expect(piModelsFromSettings([])).toHaveLength(0);
  });
});

describe("checkPiProviderStatus under a slow machine", () => {
  const fakePi = (body: string) => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pi-health-"));
    const bin = NodePath.join(dir, "pi");
    NodeFS.writeFileSync(bin, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return bin;
  };

  it.live("a check that only times out keeps the last ready result", () =>
    Effect.gen(function* () {
      const bin = fakePi("echo 0.99.1");
      const settings = decodePiSettings({ enabled: true, binaryPath: bin });
      const first = yield* checkPiProviderStatus(settings, process.env, 5_000);
      expect(first.status).toBe("ready");

      NodeFS.writeFileSync(bin, "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
      const second = yield* checkPiProviderStatus(settings, process.env, 200);
      expect(second.status).toBe("ready");
      expect(second.version).toBe("0.99.1");
      expect(second.message).toContain("timed out");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("a timeout with no earlier ready check still reports the timeout", () =>
    Effect.gen(function* () {
      const settings = decodePiSettings({ enabled: true, binaryPath: fakePi("sleep 5") });
      const snapshot = yield* checkPiProviderStatus(settings, process.env, 200);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toContain("timed out while running `pi --version`");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("buildInitialPiProviderSnapshot", () => {
  it.effect("returns a disabled snapshot when settings.enabled is false", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialPiProviderSnapshot(decodePiSettings({ enabled: false }));
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.installed).toBe(false);
      expect(snapshot.message).toContain("disabled");
    }),
  );

  it.effect("carries the thinkingLevel descriptor on settings-derived models", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialPiProviderSnapshot(
        decodePiSettings({ customModels: ["anthropic/claude-x"] }),
      );
      const model = snapshot.models[0];
      expect(model?.capabilities?.optionDescriptors?.[0]?.id).toBe("thinkingLevel");
    }),
  );
});

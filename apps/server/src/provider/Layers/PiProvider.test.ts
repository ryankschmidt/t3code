import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { PiSettings } from "@t3tools/contracts";

import { buildInitialPiProviderSnapshot, piModelsFromSettings } from "./PiProvider.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);

describe("piModelsFromSettings", () => {
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

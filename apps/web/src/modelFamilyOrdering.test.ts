import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";
import {
  applyModelFamilyOrdering,
  DEFAULT_PI_MODEL_FLOOR,
  modelFamilyKey,
  modelVersionTuple,
  resolveInstanceModelFloor,
} from "./modelFamilyOrdering";
import { getAppModelOptionsForInstance } from "./modelSelection";
import { deriveProviderInstanceEntries } from "./providerInstances";

const PI = ProviderDriverKind.make("pi");
const CODEX = ProviderDriverKind.make("codex");

/** A realistic raw pi discovery catalog (unsorted, mixed families). */
const PI_CATALOG = [
  "anthropic/claude-opus-4-7",
  "anthropic/claude-opus-4-8",
  "openai/gpt-4o",
  "openai/gpt-5.4",
  "kimi/k2",
  "anthropic/claude-sonnet-4-9",
  "openrouter/meta-llama-3",
  "openai/gpt-5.5",
];

function toModels(slugs: ReadonlyArray<string>, isCustom = false) {
  return slugs.map((slug) => ({ slug, isCustom }));
}

function piProvider(models: ReadonlyArray<string>): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("pi"),
    driver: PI,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: models.map((slug) => ({ slug, name: slug, isCustom: false, capabilities: {} })),
    slashCommands: [],
    skills: [],
  };
}

function settingsWithPiConfig(config?: Record<string, unknown>): UnifiedSettings {
  if (config === undefined) {
    return DEFAULT_UNIFIED_SETTINGS;
  }
  return {
    ...DEFAULT_UNIFIED_SETTINGS,
    providerInstances: {
      [ProviderInstanceId.make("pi")]: {
        driver: PI,
        config,
      },
    },
  };
}

describe("modelFamilyKey / modelVersionTuple", () => {
  it("keys pi slugs by their subprovider prefix", () => {
    expect(modelFamilyKey({ slug: "openai/gpt-5.5" })).toBe("openai");
    expect(modelFamilyKey({ slug: "anthropic/claude-opus-4-8" })).toBe("anthropic");
    expect(modelFamilyKey({ slug: "kimi/k2" })).toBe("kimi");
  });

  it("keys native slugs by their leading alphabetic token", () => {
    expect(modelFamilyKey({ slug: "claude-fable-5" })).toBe("claude");
    expect(modelFamilyKey({ slug: "gpt-5.5-codex" })).toBe("gpt");
  });

  it("extracts version tuples from the model-id part", () => {
    expect(modelVersionTuple("openai/gpt-5.5")).toEqual([5, 5]);
    expect(modelVersionTuple("anthropic/claude-opus-4-8")).toEqual([4, 8]);
    expect(modelVersionTuple("gpt-5.4")).toEqual([5, 4]);
    expect(modelVersionTuple("kimi/k2")).toEqual([2]);
    expect(modelVersionTuple("codex-mini-latest")).toEqual([]);
  });
});

describe("resolveInstanceModelFloor", () => {
  it("defaults pi instances to the gpt-5.4 / claude-4.8 floor", () => {
    expect(resolveInstanceModelFloor(PI, undefined)).toEqual(DEFAULT_PI_MODEL_FLOOR);
    expect(resolveInstanceModelFloor(PI, { customModels: [] })).toEqual(DEFAULT_PI_MODEL_FLOOR);
  });

  it("leaves other drivers unfiltered by default", () => {
    expect(resolveInstanceModelFloor(CODEX, undefined)).toBeUndefined();
  });

  it("honors an explicit config.modelFloor, including an empty record to disable", () => {
    expect(resolveInstanceModelFloor(PI, { modelFloor: { openai: "gpt-5.5" } })).toEqual({
      openai: "gpt-5.5",
    });
    expect(resolveInstanceModelFloor(PI, { modelFloor: {} })).toEqual({});
    expect(resolveInstanceModelFloor(CODEX, { modelFloor: { gpt: "gpt-5.4" } })).toEqual({
      gpt: "gpt-5.4",
    });
  });

  it("drops non-string floor values instead of trusting raw config", () => {
    expect(
      resolveInstanceModelFloor(PI, { modelFloor: { openai: "gpt-5.4", anthropic: 42 } }),
    ).toEqual({ openai: "gpt-5.4" });
  });
});

describe("applyModelFamilyOrdering", () => {
  it("sorts pi families newest-first and floors old openai/anthropic models", () => {
    const ordered = applyModelFamilyOrdering(toModels(PI_CATALOG), {
      driverKind: PI,
      floor: DEFAULT_PI_MODEL_FLOOR,
    });
    expect(ordered.map((model) => model.slug)).toEqual([
      "anthropic/claude-sonnet-4-9",
      "anthropic/claude-opus-4-8",
      "openai/gpt-5.5",
      "openai/gpt-5.4",
      "kimi/k2",
      "openrouter/meta-llama-3",
    ]);
  });

  it("never sorts gpt-5.5 last", () => {
    const ordered = applyModelFamilyOrdering(toModels(PI_CATALOG), {
      driverKind: PI,
      floor: DEFAULT_PI_MODEL_FLOOR,
    });
    const slugs = ordered.map((model) => model.slug);
    expect(slugs.at(-1)).not.toBe("openai/gpt-5.5");
    expect(slugs.indexOf("openai/gpt-5.5")).toBeLessThan(slugs.indexOf("openai/gpt-5.4"));
  });

  it("keeps below-floor CUSTOM models: an authored slug is an explicit request", () => {
    const models = [...toModels(["openai/gpt-5.5"]), ...toModels(["openai/gpt-3-custom"], true)];
    const ordered = applyModelFamilyOrdering(models, {
      driverKind: PI,
      floor: DEFAULT_PI_MODEL_FLOOR,
    });
    expect(ordered.map((model) => model.slug)).toEqual(["openai/gpt-5.5", "openai/gpt-3-custom"]);
  });

  it("sorts without filtering when the floor is disabled", () => {
    const ordered = applyModelFamilyOrdering(toModels(PI_CATALOG), {
      driverKind: PI,
      floor: {},
    });
    expect(ordered).toHaveLength(PI_CATALOG.length);
    const slugs = ordered.map((model) => model.slug);
    expect(slugs.indexOf("anthropic/claude-opus-4-8")).toBeLessThan(
      slugs.indexOf("anthropic/claude-opus-4-7"),
    );
    expect(slugs.indexOf("openai/gpt-5.5")).toBeLessThan(slugs.indexOf("openai/gpt-4o"));
  });

  it("is the identity for curated (non-pi) drivers without a floor", () => {
    const models = toModels(["claude-fable-5", "claude-opus-4-8", "claude-opus-4-7"]);
    const ordered = applyModelFamilyOrdering(models, { driverKind: CODEX });
    expect(ordered).toEqual(models);
  });
});

describe("getAppModelOptionsForInstance (pi end-to-end)", () => {
  function piOptions(config?: Record<string, unknown>): string[] {
    const providers = [piProvider(PI_CATALOG)];
    const entry = deriveProviderInstanceEntries(providers).find(
      (candidate) => candidate.driverKind === PI,
    );
    expect(entry).toBeDefined();
    if (!entry) {
      return [];
    }
    return getAppModelOptionsForInstance(settingsWithPiConfig(config), entry).map(
      (option) => option.slug,
    );
  }

  it("applies the default floor + newest-first family sort to the picker list", () => {
    expect(piOptions()).toEqual([
      "anthropic/claude-sonnet-4-9",
      "anthropic/claude-opus-4-8",
      "openai/gpt-5.5",
      "openai/gpt-5.4",
      "kimi/k2",
      "openrouter/meta-llama-3",
    ]);
  });

  it("honors a per-instance floor override from config.modelFloor", () => {
    const slugs = piOptions({ modelFloor: { openai: "gpt-5.5" } });
    expect(slugs).not.toContain("openai/gpt-5.4");
    expect(slugs).toContain("openai/gpt-5.5");
    // An explicit record replaces the default entirely: anthropic unfloored.
    expect(slugs).toContain("anthropic/claude-opus-4-7");
  });

  it("shows the full sorted catalog when the floor is explicitly disabled", () => {
    const slugs = piOptions({ modelFloor: {} });
    expect(slugs).toHaveLength(PI_CATALOG.length);
    expect(slugs.at(-1)).not.toBe("openai/gpt-5.5");
  });
});

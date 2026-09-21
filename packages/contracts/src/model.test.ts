import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  PREFERRED_DEFAULT_CODEX_MODELS,
  isCurrentCodexModel,
  isAllowedProviderModel,
  buildCatalogueParity,
  compareSelectedAndAnsweringModel,
  isOfferedProviderModel,
} from "./model.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

it("recognizes OpenAI model identities across providers and preserves other models", () => {
  for (const model of [
    "openai/gpt-5.5",
    "openai-codex/gpt-5.4",
    "openrouter/openai/gpt-5.3-codex",
    "gpt-5.4",
    "o3",
  ]) {
    expect(isAllowedProviderModel(model, "pi")).toBe(false);
  }
  for (const model of [
    "openai-codex/gpt-5.3-codex-spark",
    "openai/gpt-6-astra",
    "openai/gpt-5.6-sol",
    "anthropic/claude-opus-5",
    "kimi/k2",
  ]) {
    expect(isAllowedProviderModel(model, "pi")).toBe(true);
  }
});

describe("one catalogue across providers", () => {
  const sourceProviders = [
    {
      driver: "claudeAgent",
      models: [
        { slug: "claude-fable-5-1" },
        { slug: "claude-opus-5" },
        { slug: "claude-sonnet-5" },
      ],
    },
    {
      driver: "codex",
      models: [{ slug: "gpt-6-astra" }, { slug: "gpt-5.6-luna" }],
    },
  ];

  it("derives the parity set from what the source providers report", () => {
    expect([...buildCatalogueParity(sourceProviders)].sort()).toEqual([
      "claude-fable-5-1",
      "claude-opus-5",
      "claude-sonnet-5",
      "gpt-5.6-luna",
      "gpt-6-astra",
    ]);
  });

  it("offers a mirror driver exactly the source models, no more and no less", () => {
    const parity = buildCatalogueParity(sourceProviders);
    for (const model of [
      "anthropic/claude-opus-5",
      "anthropic/claude-fable-5-1",
      "openai/gpt-6-astra",
    ]) {
      expect(isOfferedProviderModel(model, "pi", { parity })).toBe(true);
    }
    // The models the operator has watched Pi list and never uses.
    for (const model of ["kimi/k2", "openrouter/deepseek-v3", "anthropic/claude-haiku-4-5"]) {
      expect(isOfferedProviderModel(model, "pi", { parity })).toBe(false);
    }
  });

  it("leaves source drivers and authored custom models unfiltered", () => {
    const parity = buildCatalogueParity(sourceProviders);
    // A Claude model absent from the parity set is still offered BY Claude:
    // a source driver reports its own catalog and is never mirrored.
    expect(isOfferedProviderModel("claude-haiku-4-5", "claudeAgent", { parity })).toBe(true);
    expect(isOfferedProviderModel("kimi/k2", "pi", { parity, isCustom: true })).toBe(true);
    // A custom slug waives parity, never the retired-model allowlist.
    expect(isOfferedProviderModel("openai/gpt-5.4", "pi", { parity, isCustom: true })).toBe(false);
  });

  // FIRST PAINT. This is the state Ryan photographed: a cold app start, neither source provider
  // reported yet, and the Pi picker showing all 331 models it proxies before shrinking a moment
  // later. An empty list that fills in is correct; a full list that shrinks is the defect.
  it("offers nothing from a mirror before any source provider has reported", () => {
    const parity = buildCatalogueParity([{ driver: "pi", models: [{ slug: "kimi/k2" }] }]);
    expect(parity.size).toBe(0);
    expect(isOfferedProviderModel("kimi/k2", "pi", { parity })).toBe(false);
    expect(isOfferedProviderModel("claude-opus-5", "pi", { parity })).toBe(false);
  });

  // The same screen reached through the other door: a caller that cannot compute parity at all.
  // "Unknown" must not render as "everything".
  it("offers nothing from a mirror when parity was never computed", () => {
    expect(isOfferedProviderModel("kimi/k2", "pi", {})).toBe(false);
    expect(isOfferedProviderModel("kimi/k2", "pi")).toBe(false);
  });

  // A source driver is never emptied by this, at first paint or ever — only mirrors are.
  it("still offers a source driver's models before parity exists", () => {
    const parity = buildCatalogueParity([]);
    expect(parity.size).toBe(0);
    expect(isOfferedProviderModel("claude-opus-5", "claudeAgent", { parity })).toBe(true);
    expect(isOfferedProviderModel("gpt-6-astra", "codex", { parity })).toBe(true);
    expect(isOfferedProviderModel("claude-opus-5", "claudeAgent")).toBe(true);
  });

  // A user-authored slug on the mirror is that user's explicit request, not a catalogue entry,
  // so it survives first paint.
  it("still offers a custom model on a mirror before parity exists", () => {
    expect(isOfferedProviderModel("kimi/k2", "pi", { isCustom: true })).toBe(true);
  });

  it("excludes a source provider's custom models from parity", () => {
    const parity = buildCatalogueParity([
      {
        driver: "claudeAgent",
        models: [{ slug: "claude-opus-5" }, { slug: "my-proxy", isCustom: true }],
      },
    ]);
    expect([...parity]).toEqual(["claude-opus-5"]);
  });
});

describe("the picker cannot lie", () => {
  it("calls the model the operator saw a mismatch when another model answered", () => {
    // Measured on the Mac: the picker showed Fable and every assistant turn
    // recorded Opus.
    expect(compareSelectedAndAnsweringModel("claude-fable-5-1", "claude-opus-5")).toBe("mismatch");
    expect(compareSelectedAndAnsweringModel("gpt-6-astra", "gpt-5.6-luna")).toBe("mismatch");
  });

  it("accepts the same model under a different stamp or prefix", () => {
    expect(compareSelectedAndAnsweringModel("claude-opus-5", "anthropic/claude-opus-5")).toBe(
      "match",
    );
    expect(compareSelectedAndAnsweringModel("claude-opus-5", "claude-opus-5-20260214")).toBe(
      "match",
    );
    expect(compareSelectedAndAnsweringModel("claude-opus-5[1m]", "claude-opus-5")).toBe("match");
  });

  it("never calls a missing answering model a match", () => {
    expect(compareSelectedAndAnsweringModel("claude-opus-5", undefined)).toBe("unknown");
    expect(compareSelectedAndAnsweringModel(undefined, "claude-opus-5")).toBe("unknown");
  });

  it("does not absorb a different model that merely shares a prefix", () => {
    expect(compareSelectedAndAnsweringModel("gpt-6", "gpt-60")).toBe("mismatch");
  });
});

it("offers Spark and GPT-5.6/GPT-6 families without admitting retired models", () => {
  for (const model of [
    "gpt-5.3-codex-spark",
    "gpt-5.6",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-6",
    "gpt-6-astra",
  ]) {
    expect(isCurrentCodexModel(model)).toBe(true);
  }
  for (const model of [
    "gpt-5.3-codex",
    "gpt-5.4",
    "gpt-5.5",
    "gpt-5.60",
    "gpt-60",
    "gpt-reserve",
    "codex-auto-review",
  ]) {
    expect(isCurrentCodexModel(model)).toBe(false);
  }
});

describe("Astra Codex catalog defaults", () => {
  const codex = ProviderDriverKind.make("codex");
  it("defaults Codex to Astra ahead of the retained Sol fallback", () => {
    expect(DEFAULT_MODEL).toBe("gpt-6-astra");
    expect(DEFAULT_MODEL_BY_PROVIDER[codex]).toBe("gpt-6-astra");
    expect(PREFERRED_DEFAULT_CODEX_MODELS).toEqual(["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra"]);
  });
  it("resolves Astra aliases without changing Sol aliases", () => {
    for (const alias of ["astra", "6", "gpt-6", "gpt-6-astra"]) {
      expect(MODEL_SLUG_ALIASES_BY_PROVIDER[codex]?.[alias]).toBe("gpt-6-astra");
    }
    expect(MODEL_SLUG_ALIASES_BY_PROVIDER[codex]?.sol).toBe("gpt-5.6-sol");
  });
});

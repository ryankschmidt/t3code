import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  PREFERRED_DEFAULT_CODEX_MODELS,
  isCurrentCodexModel,
  isAllowedProviderModel,
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

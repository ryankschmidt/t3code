import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  PREFERRED_DEFAULT_CODEX_MODELS,
} from "./model.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

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

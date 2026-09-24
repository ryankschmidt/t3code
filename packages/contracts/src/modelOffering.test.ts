import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { DEFAULT_MODEL_BY_PROVIDER, MODEL_SLUG_ALIASES_BY_PROVIDER } from "./model.ts";
import {
  applyModelOffering,
  DEFAULT_CLAUDE_NEW_THREAD_SELECTION,
  DEFAULT_MODEL_OFFERING,
  isRetiredModel,
  retireModelSelection,
  type ModelOffering,
} from "./modelOffering.ts";
import { ModelSelection } from "./orchestration.ts";
import { ProviderDriverKind } from "./providerInstance.ts";
import { ServerSettings } from "./settings.ts";

const provider = (driver: string, slugs: ReadonlyArray<string>) => ({
  driver,
  models: slugs.map((slug) => ({ slug, isCustom: false })),
});

// What the Mac server reported on Sep 23, 2026 before this change, trimmed to
// the entries that matter (from ~/.t3/caches/{claudeAgent,codex,pi}.json).
const reported = [
  provider("claudeAgent", [
    "claude-opus-5-5",
    "claude-fable-5-1",
    "claude-fable-5",
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-opus-4-5",
    "claude-sonnet-5",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
  ]),
  provider("codex", [
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.3-codex-spark",
    "gpt-5.5",
  ]),
  provider("pi", [
    "anthropic/claude-opus-5",
    "anthropic/claude-opus-4-5-20251101",
    "anthropic/claude-sonnet-5",
    "anthropic/claude-fable-5-1",
    "anthropic/claude-opus-5-5",
    "openrouter/anthropic/claude-opus-5-5",
    "tower-anthropic/claude-fable-5-1",
    "openai/gpt-6-astra",
    "openai-codex/gpt-6-astra",
    "openai-codex/gpt-5.6-sol",
    "openai-codex/gpt-5.6-terra",
    "openai-codex/gpt-5.6-luna",
    "openai-codex/gpt-5.3-codex-spark",
    "openai/gpt-5.5",
    "kimi-coding/k3",
  ]),
  provider("cursor", ["claude-opus-5", "composer-2"]),
];

const slugsOf = (providers: ReturnType<typeof applyModelOffering>, driver: string) =>
  providers.find((entry) => entry.driver === driver)?.models.map((model) => model.slug) ?? [];

describe("applyModelOffering", () => {
  const offered = applyModelOffering(reported, DEFAULT_MODEL_OFFERING);

  it("drops every retired id from every provider, Pi and non-source drivers included", () => {
    for (const entry of offered) {
      for (const model of entry.models) {
        expect(
          isRetiredModel(model.slug, DEFAULT_MODEL_OFFERING),
          `${entry.driver} ${model.slug}`,
        ).toBe(false);
      }
    }
    expect(slugsOf(offered, "cursor")).toEqual(["composer-2"]);
  });

  it("offers Claude exactly Ryan's list, Opus 5.5 first", () => {
    expect(slugsOf(offered, "claudeAgent")).toEqual([
      "claude-opus-5-5",
      "claude-fable-5-1",
      "claude-sonnet-5",
    ]);
  });

  it("offers Codex exactly today's list, gpt-6-astra first", () => {
    expect(slugsOf(offered, "codex")).toEqual([
      "gpt-6-astra",
      "gpt-5.3-codex-spark",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
  });

  it("offers Pi exactly the union of Claude and Codex, one route per model", () => {
    expect(slugsOf(offered, "pi")).toEqual([
      "anthropic/claude-opus-5-5",
      "anthropic/claude-fable-5-1",
      "anthropic/claude-sonnet-5",
      "openai-codex/gpt-6-astra",
      "openai-codex/gpt-5.3-codex-spark",
      "openai-codex/gpt-5.6-sol",
      "openai-codex/gpt-5.6-terra",
      "openai-codex/gpt-5.6-luna",
    ]);
  });

  it("never lets a retired id absorb a longer allowed one", () => {
    expect(isRetiredModel("claude-opus-5", DEFAULT_MODEL_OFFERING)).toBe(true);
    expect(isRetiredModel("claude-opus-5-5", DEFAULT_MODEL_OFFERING)).toBe(false);
    expect(isRetiredModel("claude-opus-5[1m]", DEFAULT_MODEL_OFFERING)).toBe(true);
    expect(isRetiredModel("anthropic/claude-opus-4-5-20251101", DEFAULT_MODEL_OFFERING)).toBe(true);
  });

  it("gives Pi nothing when no source provider has reported", () => {
    const piOnly = applyModelOffering([reported[2]!], DEFAULT_MODEL_OFFERING);
    expect(slugsOf(piOnly, "pi")).toEqual([]);
  });

  it("follows a written offering instead of the compiled one", () => {
    const written: ModelOffering = {
      offeredModels: { claudeAgent: ["claude-sonnet-5"], codex: ["gpt-6-astra"] },
      retiredModels: [],
    };
    const result = applyModelOffering(reported, written);
    expect(slugsOf(result, "claudeAgent")).toEqual(["claude-sonnet-5"]);
    expect(slugsOf(result, "pi")).toEqual([
      "anthropic/claude-sonnet-5",
      "openai-codex/gpt-6-astra",
    ]);
  });

  it("keeps a user-authored custom model unless it is retired", () => {
    const withCustom = [
      {
        driver: "claudeAgent",
        models: [
          { slug: "claude-opus-5-5", isCustom: false },
          { slug: "my-proxy/claude-x", isCustom: true },
          { slug: "claude-opus-5", isCustom: true },
        ],
      },
    ];
    expect(slugsOf(applyModelOffering(withCustom, DEFAULT_MODEL_OFFERING), "claudeAgent")).toEqual([
      "claude-opus-5-5",
      "my-proxy/claude-x",
    ]);
  });
});

describe("the Claude new-thread default", () => {
  const claudeOpus5 = Schema.decodeUnknownSync(ModelSelection)({
    instanceId: "claudeAgent",
    model: "claude-opus-5",
  });

  it("resolves a stored retired default to Opus 5.5 with the 1M window", () => {
    const resolved = retireModelSelection(claudeOpus5, DEFAULT_MODEL_OFFERING);
    expect(resolved).toEqual(DEFAULT_CLAUDE_NEW_THREAD_SELECTION);
    expect(resolved?.model).toBe("claude-opus-5-5");
    expect(resolved?.options).toEqual([{ id: "contextWindow", value: "1m" }]);
  });

  it("keeps a retired Codex default on Codex", () => {
    const gpt55 = Schema.decodeUnknownSync(ModelSelection)({
      instanceId: "codex",
      model: "gpt-5.5",
    });
    expect(retireModelSelection(gpt55, DEFAULT_MODEL_OFFERING)).toEqual({
      instanceId: "codex",
      model: "gpt-6-astra",
    });
  });

  it("leaves an allowed default and an unset default alone", () => {
    const sol = Schema.decodeUnknownSync(ModelSelection)({
      instanceId: "codex",
      model: "gpt-5.6-sol",
    });
    expect(retireModelSelection(sol, DEFAULT_MODEL_OFFERING)).toBe(sol);
    expect(retireModelSelection(null, DEFAULT_MODEL_OFFERING)).toBeNull();
  });

  it("never falls back to Opus 5 when nothing is stored", () => {
    const claude = ProviderDriverKind.make("claudeAgent");
    expect(DEFAULT_MODEL_BY_PROVIDER[claude]).toBe("claude-opus-5-5");
    const claudeAliases = MODEL_SLUG_ALIASES_BY_PROVIDER[claude] ?? {};
    for (const alias of ["opus", "opus-5", "claude-opus-5.0", "claude-opus-5-0", "opus-5.5"]) {
      expect(claudeAliases[alias], alias).toBe("claude-opus-5-5");
    }
  });

  it("ships the offering as the server settings default", () => {
    const decoded = Schema.decodeUnknownSync(ServerSettings)({});
    expect(decoded.modelOffering).toEqual(DEFAULT_MODEL_OFFERING);
  });
});

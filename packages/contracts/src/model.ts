import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

export const ProviderOptionDescriptorType = Schema.Literals(["select", "boolean"]);
export type ProviderOptionDescriptorType = typeof ProviderOptionDescriptorType.Type;

export const ProviderOptionChoice = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  isDefault: Schema.optional(Schema.Boolean),
});
export type ProviderOptionChoice = typeof ProviderOptionChoice.Type;

const ProviderOptionDescriptorBase = {
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
} as const;

export const SelectProviderOptionDescriptor = Schema.Struct({
  ...ProviderOptionDescriptorBase,
  type: Schema.Literal("select"),
  options: Schema.Array(ProviderOptionChoice),
  currentValue: Schema.optional(TrimmedNonEmptyString),
  promptInjectedValues: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type SelectProviderOptionDescriptor = typeof SelectProviderOptionDescriptor.Type;

export const BooleanProviderOptionDescriptor = Schema.Struct({
  ...ProviderOptionDescriptorBase,
  type: Schema.Literal("boolean"),
  currentValue: Schema.optional(Schema.Boolean),
});
export type BooleanProviderOptionDescriptor = typeof BooleanProviderOptionDescriptor.Type;

export const ProviderOptionDescriptor = Schema.Union([
  SelectProviderOptionDescriptor,
  BooleanProviderOptionDescriptor,
]);
export type ProviderOptionDescriptor = typeof ProviderOptionDescriptor.Type;

export const ProviderOptionSelectionValue = Schema.Union([TrimmedNonEmptyString, Schema.Boolean]);
export type ProviderOptionSelectionValue = typeof ProviderOptionSelectionValue.Type;

export const ProviderOptionSelection = Schema.Struct({
  id: TrimmedNonEmptyString,
  value: ProviderOptionSelectionValue,
});
export type ProviderOptionSelection = typeof ProviderOptionSelection.Type;

/**
 * Legacy on-disk shape for provider option selections, kept readable by the
 * decoder so we can tolerate stored data written before the v3 array shape.
 *
 * Persisted historically as `{ effort: "max", fastMode: true, ... }` inside
 * `modelSelection.options`. Migration 026 rewrites stored rows to the
 * canonical array shape, but we still see the legacy form in:
 *   - `settings.json` files from older client builds,
 *   - SQLite databases that have not yet run migration 026,
 *   - any future regression that re-introduces the legacy shape.
 */
const LegacyProviderOptionSelectionsObject = Schema.Record(Schema.String, Schema.Unknown);

const ProviderOptionSelectionsFromLegacyObject = LegacyProviderOptionSelectionsObject.pipe(
  Schema.decodeTo(
    Schema.Array(ProviderOptionSelection),
    SchemaTransformation.transformOrFail({
      decode: (record) => Effect.succeed(coerceLegacyOptionsObjectToArray(record)),
      encode: (selections) => Effect.succeed(canonicalSelectionsToLegacyObject(selections)),
    }),
  ),
);

/**
 * Schema for the `options` field of every `ModelSelection` variant.
 *
 * Accepts both:
 *   - the canonical array shape `Array<{ id, value }>` (preferred), and
 *   - the legacy object shape `Record<string, string | boolean | …>` from
 *     pre-migration data.
 *
 * Always normalizes to the canonical array on decode and re-encodes as the
 * canonical array, so any legacy storage gets cleaned up the next time the
 * containing record is written back.
 */
export const ProviderOptionSelections = Schema.Union([
  Schema.Array(ProviderOptionSelection),
  ProviderOptionSelectionsFromLegacyObject,
]);
export type ProviderOptionSelections = typeof ProviderOptionSelections.Type;

function coerceLegacyOptionsObjectToArray(
  record: Record<string, unknown>,
): ReadonlyArray<ProviderOptionSelection> {
  const entries: Array<ProviderOptionSelection> = [];
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const id = typeof rawKey === "string" ? rawKey.trim() : "";
    if (id.length === 0) continue;
    if (typeof rawValue === "string") {
      const trimmed = rawValue.trim();
      if (trimmed.length > 0) entries.push({ id, value: trimmed });
    } else if (typeof rawValue === "boolean") {
      entries.push({ id, value: rawValue });
    }
    // Drop anything else (numbers, null, nested objects/arrays) to match the
    // permissive normalization performed by migration 026.
  }
  return entries;
}

function canonicalSelectionsToLegacyObject(
  selections: ReadonlyArray<ProviderOptionSelection>,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const { id, value } of selections) {
    out[id] = value;
  }
  return out;
}

export const ModelCapabilities = Schema.Struct({
  optionDescriptors: Schema.optional(Schema.Array(ProviderOptionDescriptor)),
});
export type ModelCapabilities = typeof ModelCapabilities.Type;

/**
 * A user-authored custom model. `name` and `capabilities` are optional so a
 * bare slug keeps its driver-default presentation; when `capabilities` is
 * set, its descriptors replace the driver default in the model picker.
 */
export const CustomModelEntry = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: Schema.optional(TrimmedNonEmptyString),
  capabilities: Schema.optional(ModelCapabilities),
});
export type CustomModelEntry = typeof CustomModelEntry.Type;

/** On-disk custom model setting: the legacy bare slug, or a full entry. */
export const CustomModelSetting = Schema.Union([Schema.String, CustomModelEntry]);
export type CustomModelSetting = typeof CustomModelSetting.Type;

const CODEX_DRIVER_KIND = ProviderDriverKind.make("codex");
const CLAUDE_DRIVER_KIND = ProviderDriverKind.make("claudeAgent");
const CURSOR_DRIVER_KIND = ProviderDriverKind.make("cursor");
const GROK_DRIVER_KIND = ProviderDriverKind.make("grok");
const OPENCODE_DRIVER_KIND = ProviderDriverKind.make("opencode");

export const DEFAULT_MODEL = "gpt-6-astra";

export function isCurrentCodexModel(model: string): boolean {
  return model === "gpt-5.3-codex-spark" || /^gpt-(?:5\.6|6)(?:$|[.-])/.test(model);
}

export function isAllowedProviderModel(model: string, driver: string): boolean {
  const parts = model.split("/");
  const modelId = parts.at(-1) ?? model;
  const isOpenAi =
    driver === "codex" ||
    parts.some((part) => part === "openai" || part === "openai-codex") ||
    /^(?:gpt-|codex-|o\d(?:-|$))/.test(modelId);
  return !isOpenAi || isCurrentCodexModel(modelId);
}

/**
 * ThroughLine: one catalogue across providers.
 *
 * Drivers whose own reported catalogs DEFINE what is on offer. These two are
 * the only places a model enters the product, and each reports its own list
 * from its own runtime — nothing here is a written list.
 */
export const CATALOGUE_SOURCE_DRIVER_KINDS: ReadonlyArray<string> = ["claudeAgent", "codex"];

/**
 * Drivers that MIRROR the source drivers instead of offering their own
 * catalog. Pi proxies other vendors and reports hundreds of models it was
 * never meant to serve here, so its offer is derived: exactly the models the
 * Claude and Codex providers already offer, no more and no less. A model is
 * added or removed in exactly one place — the source provider's own runtime.
 */
export const CATALOGUE_MIRROR_DRIVER_KINDS: ReadonlyArray<string> = ["pi"];

/**
 * Identity of a model across providers. The same model reaches the product
 * under several slugs (`claude-opus-5`, `anthropic/claude-opus-5`), so the
 * last path segment, lowercased, is what parity compares.
 */
export function modelIdentity(model: string): string {
  const parts = model.split("/");
  return (parts.at(-1) ?? model).trim().toLowerCase();
}

export function isCatalogueSourceDriver(driver: string): boolean {
  return CATALOGUE_SOURCE_DRIVER_KINDS.includes(driver);
}

export function isCatalogueMirrorDriver(driver: string): boolean {
  return CATALOGUE_MIRROR_DRIVER_KINDS.includes(driver);
}

/** A provider and the models it reports, as both web and mobile hold them. */
export type CatalogueProviderLike = {
  readonly driver: string;
  readonly models: ReadonlyArray<{ readonly slug: string; readonly isCustom?: boolean }>;
};

/**
 * The parity set: every model identity the source drivers actually offer
 * right now. Custom (user-authored) models are excluded — an authored slug is
 * one user's explicit request on one provider, not a catalogue entry.
 */
export function buildCatalogueParity(
  providers: ReadonlyArray<CatalogueProviderLike>,
): ReadonlySet<string> {
  const parity = new Set<string>();
  for (const provider of providers) {
    if (!isCatalogueSourceDriver(provider.driver)) continue;
    for (const model of provider.models) {
      if (model.isCustom === true) continue;
      if (!isAllowedProviderModel(model.slug, provider.driver)) continue;
      parity.add(modelIdentity(model.slug));
    }
  }
  return parity;
}

/**
 * Whether a model is offered for a driver: the allowlist for every driver,
 * plus catalogue parity for mirror drivers. An empty or absent parity set
 * means the source providers have not reported yet, and a mirror then offers
 * NOTHING rather than falling back to its own catalogue. Custom models are
 * never filtered.
 */
export function isOfferedProviderModel(
  model: string,
  driver: string,
  context?: {
    readonly parity?: ReadonlySet<string> | undefined;
    readonly isCustom?: boolean | undefined;
  },
): boolean {
  // The allowlist applies to authored models too: a retired model stays
  // retired however it was entered. Only parity is waived for custom slugs.
  if (!isAllowedProviderModel(model, driver)) return false;
  if (context?.isCustom === true) return true;
  if (!isCatalogueMirrorDriver(driver)) return true;

  // A mirror driver with nothing to mirror offers NOTHING, and the order of these two lines is
  // the whole fix. This used to return true when parity was empty or absent, so on a cold start
  // — before either source provider had reported — Pi fell back to its own unfiltered catalogue
  // and the picker showed all 331 models it proxies, then shrank a moment later once Claude and
  // Codex reported. Ryan photographed exactly that screen. His ruling is "the same models as
  // Claude provider and Codex provider and nothing more, nothing more", and a list that briefly
  // shows 331 shows 331.
  //
  // An empty list that fills in is correct. A full list that shrinks is the defect. Absent
  // parity is treated the same as empty parity on purpose: a caller that cannot compute parity
  // does not know what the mirror may offer, and "unknown" must not render as "everything".
  const parity = context?.parity;
  if (parity === undefined || parity.size === 0) return false;
  return parity.has(modelIdentity(model));
}

/**
 * ThroughLine: the picker cannot lie.
 *
 * The model NAMED in the picker and the model that ANSWERS a turn are two
 * separate facts that have twice disagreed in front of the operator. This
 * compares them so the disagreement is a reported event rather than
 * something only a transcript reader finds later.
 *
 * `unknown` means the runtime reported no model for the turn, which is not
 * evidence of agreement and must never be reported as a match.
 */
export type ModelAnswerVerdict = "match" | "mismatch" | "unknown";

/**
 * Comparable form of a model id: provider prefix dropped, lowercased, a
 * trailing API date stamp (`-20260214`) removed, and a context-window suffix
 * (`[1m]`) removed. Vendors stamp their own dates and windows onto the id of
 * the SAME model, and those are not a different model.
 */
export function normalizeModelIdentityForComparison(model: string): string {
  return modelIdentity(model)
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-latest$/, "")
    .trim();
}

export function compareSelectedAndAnsweringModel(
  selected: string | null | undefined,
  answering: string | null | undefined,
): ModelAnswerVerdict {
  const selectedId = selected ? normalizeModelIdentityForComparison(selected) : "";
  const answeringId = answering ? normalizeModelIdentityForComparison(answering) : "";
  if (selectedId.length === 0 || answeringId.length === 0) return "unknown";
  if (selectedId === answeringId) return "match";
  // One side may carry a finer variant of the same model (`claude-opus-5`
  // answered by `claude-opus-5-1`). A prefix is the same model only when it
  // ends at a segment boundary, so `claude-opus-5` never absorbs
  // `claude-opus-50` and never absorbs a different family.
  const [shorter, longer] =
    selectedId.length <= answeringId.length ? [selectedId, answeringId] : [answeringId, selectedId];
  return longer.startsWith(`${shorter}-`) ? "match" : "mismatch";
}

/**
 * Codex default-model preference, most preferred first. The provider snapshot
 * marks the first of these present in the live `model/list` response as
 * default; when none are available, Codex's own `isDefault` flag wins.
 */
export const PREFERRED_DEFAULT_CODEX_MODELS: ReadonlyArray<string> = [
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
];
export const DEFAULT_TEXT_GENERATION_MODEL = "gpt-5.6-luna";
/** Keep the official Antigravity session's current model. Never send this ID to ACP. */
export const ANTIGRAVITY_DEFAULT_MODEL = "antigravity-default";
export const DEFAULT_TEXT_GENERATION_REASONING_EFFORT = "low";

export const DEFAULT_MODEL_BY_PROVIDER: Partial<Record<ProviderDriverKind, string>> = {
  // ThroughLine new-thread composer: Codex is the bounded-work default and Opus is the
  // Claude seat default. Fable is never a default; it requires an explicitly authorized launch.
  [CODEX_DRIVER_KIND]: DEFAULT_MODEL,
  // Opus 5 is retired (modelOffering.ts); a missing setting must never fall back to it.
  [CLAUDE_DRIVER_KIND]: "claude-opus-5-5",
  [CURSOR_DRIVER_KIND]: "auto",
  // Product slug, not an ACP model id. The Grok adapter treats it as "the session's current model".
  [GROK_DRIVER_KIND]: "grok-build",
  [OPENCODE_DRIVER_KIND]: "openai/gpt-5",
  [ProviderDriverKind.make("antigravity")]: ANTIGRAVITY_DEFAULT_MODEL,
};

/**
 * ThroughLine: the product decides its own default, not the provider.
 *
 * A provider reports its OWN default in `model/list`, and the Claude CLI reports Fable. The
 * pickers used that flag directly, so Fable was marked Default and was what a new thread got —
 * even though DEFAULT_MODEL_BY_PROVIDER has said Opus since 73bf11e1c0. Ryan, 2026-09-20: "I do
 * not want Fable to be the default. With agents launching threads, I don't ever want Fable as
 * the default. It's not worth it. It should be opus with low thinking." Fable is roughly six
 * times Opus, so an inherited default is a standing cost, not a preference.
 *
 * Where the product declares a default for a driver, that declaration wins and the provider's
 * own flag is ignored. Where it declares none, the provider's flag still decides.
 */
export function isProductDefaultModel(
  model: string,
  driver: string,
  providerReportedDefault: boolean,
): boolean {
  const declared = (DEFAULT_MODEL_BY_PROVIDER as Record<string, string | undefined>)[driver];
  if (declared === undefined) return providerReportedDefault;
  return modelIdentity(model) === modelIdentity(declared);
}

/**
 * Reasoning effort a new thread starts at, per driver. Claude starts low because the default
 * seat is Opus and a default should be the cheap end of a capable model, not its most expensive
 * setting. A driver absent here keeps whatever the provider's own descriptor defaults to.
 */
export const DEFAULT_REASONING_EFFORT_BY_PROVIDER: Partial<Record<string, string>> = {
  [CLAUDE_DRIVER_KIND as unknown as string]: "low",
};

export function defaultReasoningEffortForDriver(driver: string): string | undefined {
  return DEFAULT_REASONING_EFFORT_BY_PROVIDER[driver];
}

/** Per-provider text generation model defaults. */
export const DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER: Partial<
  Record<ProviderDriverKind, string>
> = {
  [CODEX_DRIVER_KIND]: DEFAULT_TEXT_GENERATION_MODEL,
  [ProviderDriverKind.make("antigravity")]: ANTIGRAVITY_DEFAULT_MODEL,
  [CLAUDE_DRIVER_KIND]: "claude-haiku-4-5",
  [CURSOR_DRIVER_KIND]: "composer-2",
  [OPENCODE_DRIVER_KIND]: "openai/gpt-5",
};

export const MODEL_SLUG_ALIASES_BY_PROVIDER: Partial<
  Record<ProviderDriverKind, Record<string, string>>
> = {
  [CODEX_DRIVER_KIND]: {
    astra: "gpt-6-astra",
    "6": "gpt-6-astra",
    "gpt-6": "gpt-6-astra",
    "gpt-6-astra": "gpt-6-astra",
    "gpt-5-codex": "gpt-5.4",
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
    "5.6": "gpt-5.6-sol",
    sol: "gpt-5.6-sol",
    "5.6-sol": "gpt-5.6-sol",
    "gpt-5.6": "gpt-5.6-sol",
    luna: "gpt-5.6-luna",
    "5.6-luna": "gpt-5.6-luna",
    terra: "gpt-5.6-terra",
    "5.6-terra": "gpt-5.6-terra",
  },
  [CLAUDE_DRIVER_KIND]: {
    fable: "claude-fable-5",
    "fable-5": "claude-fable-5",
    "claude-fable": "claude-fable-5",
    "claude-sonnet-5": "claude-sonnet-5",
    // ThroughLine: Opus 5 is retired, so every name that meant it resolves to its successor
    // rather than to a model no picker offers.
    opus: "claude-opus-5-5",
    "opus-5.5": "claude-opus-5-5",
    "claude-opus-5.5": "claude-opus-5-5",
    "opus-5": "claude-opus-5-5",
    "claude-opus-5.0": "claude-opus-5-5",
    "claude-opus-5-0": "claude-opus-5-5",
    "opus-4.8": "claude-opus-4-8",
    "claude-opus-4.8": "claude-opus-4-8",
    "opus-4.7": "claude-opus-4-7",
    "claude-opus-4.7": "claude-opus-4-7",
    "opus-4.6": "claude-opus-4-6",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-opus-4-6-20251117": "claude-opus-4-6",
    sonnet: "claude-sonnet-5",
    "sonnet-5": "claude-sonnet-5",
    "claude-sonnet-5.0": "claude-sonnet-5",
    "claude-sonnet-5-0": "claude-sonnet-5",
    "sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4-6-20251117": "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",
    "haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  },
  [CURSOR_DRIVER_KIND]: {
    composer: "composer-2",
    "composer-1.5": "composer-1.5",
    "composer-1": "composer-1.5",
    "opus-4.6-thinking": "claude-opus-4-6",
    "opus-4.6": "claude-opus-4-6",
    "sonnet-4.6-thinking": "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "opus-4.5-thinking": "claude-opus-4-5",
    "opus-4.5": "claude-opus-4-5",
  },
  [OPENCODE_DRIVER_KIND]: {},
};

// ── Provider display names ────────────────────────────────────────────

export const PROVIDER_DISPLAY_NAMES: Partial<Record<ProviderDriverKind, string>> = {
  [ProviderDriverKind.make("antigravity")]: "Antigravity",
  [CODEX_DRIVER_KIND]: "Codex",
  [CLAUDE_DRIVER_KIND]: "Claude",
  [CURSOR_DRIVER_KIND]: "Cursor",
  [GROK_DRIVER_KIND]: "Grok",
  [OPENCODE_DRIVER_KIND]: "OpenCode",
};

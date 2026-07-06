import type { ProviderDriverKind } from "@t3tools/contracts";

/**
 * Family-version ordering + floor filtering for provider model lists.
 *
 * Pi's discovered catalog arrives in raw provider order with no
 * created/release metadata (the catalog handling keeps only slug + name),
 * so "newest first" is derived from a family-version comparator: version
 * runs inside the model id sort descending within a family block
 * (gpt-5.5 > gpt-5.4, claude 4.9 > 4.8), and family blocks keep their
 * first-appearance order from the catalog.
 *
 * The floor hides sub-minimum models per family (defaults below). It is a
 * per-instance config field (`config.modelFloor`) — an explicit record
 * (even `{}`, which disables filtering) always wins over the default.
 * Custom models are never filtered: an explicitly authored slug is an
 * explicit user request.
 */

export interface FamilyOrderableModel {
  readonly slug: string;
  readonly isCustom: boolean;
  readonly subProvider?: string | undefined;
}

/** Family key → minimum version slug, e.g. `{ openai: "gpt-5.4" }`. */
export type ModelFloorConfig = Readonly<Record<string, string>>;

/**
 * Default floor for pi instances: hide models below gpt-5.4 (openai
 * families) and below claude-4.8 (anthropic families); other families
 * (kimi/openrouter/...) stay unfiltered. Keep in sync with the
 * `PiSettings.modelFloor` decoding default in `contracts/settings.ts`.
 */
export const DEFAULT_PI_MODEL_FLOOR: ModelFloorConfig = {
  openai: "gpt-5.4",
  anthropic: "claude-4.8",
};

const PI_DRIVER_KIND = "pi";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Resolve the effective model floor for an instance from its raw persisted
 * config. An explicit `config.modelFloor` record is authoritative (empty
 * record = floor disabled); otherwise pi instances get the default floor
 * and every other driver is unfiltered.
 */
export function resolveInstanceModelFloor(
  driverKind: ProviderDriverKind,
  instanceConfig: unknown,
): ModelFloorConfig | undefined {
  const explicit = asRecord(asRecord(instanceConfig)?.modelFloor);
  if (explicit !== undefined) {
    return Object.fromEntries(
      Object.entries(explicit).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].trim().length > 0,
      ),
    );
  }
  return driverKind === PI_DRIVER_KIND ? DEFAULT_PI_MODEL_FLOOR : undefined;
}

function modelIdPart(value: string): string {
  const slashIndex = value.indexOf("/");
  return slashIndex > 0 && slashIndex < value.length - 1 ? value.slice(slashIndex + 1) : value;
}

/**
 * Family key for floor matching and block grouping: the pi subprovider
 * prefix when the slug is `provider/modelId`, else the model's
 * `subProvider`, else the slug's leading alphabetic token.
 */
export function modelFamilyKey(model: {
  readonly slug: string;
  readonly subProvider?: string | undefined;
}): string {
  const slashIndex = model.slug.indexOf("/");
  if (slashIndex > 0) {
    return model.slug.slice(0, slashIndex).toLowerCase();
  }
  if (model.subProvider) {
    return model.subProvider.toLowerCase();
  }
  const alpha = /^[a-zA-Z]+/.exec(model.slug);
  return (alpha?.[0] ?? model.slug).toLowerCase();
}

/** Every integer run in the model-id part, e.g. "gpt-5.4-codex" → [5, 4]. */
export function modelVersionTuple(value: string): ReadonlyArray<number> {
  return Array.from(modelIdPart(value).matchAll(/\d+/g), (match) => Number(match[0]));
}

function compareVersionTuples(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const left = a[index] ?? -1;
    const right = b[index] ?? -1;
    if (left !== right) {
      return left - right;
    }
  }
  return 0;
}

function meetsFloor(model: FamilyOrderableModel, floor: ModelFloorConfig): boolean {
  const minimum = floor[modelFamilyKey(model)];
  if (minimum === undefined) {
    return true;
  }
  return compareVersionTuples(modelVersionTuple(model.slug), modelVersionTuple(minimum)) >= 0;
}

/**
 * Apply the per-instance floor filter (any driver with a resolved floor)
 * and, for pi instances, the newest-first family sort. Non-pi drivers keep
 * their deliberately curated snapshot order.
 */
export function applyModelFamilyOrdering<T extends FamilyOrderableModel>(
  models: ReadonlyArray<T>,
  options: {
    readonly driverKind: ProviderDriverKind;
    readonly floor?: ModelFloorConfig | undefined;
  },
): ReadonlyArray<T> {
  const floor = options.floor;
  const floored =
    floor === undefined
      ? models
      : models.filter((model) => model.isCustom || meetsFloor(model, floor));
  if (options.driverKind !== PI_DRIVER_KIND) {
    return floored;
  }

  const nonCustom = floored.filter((model) => !model.isCustom);
  const custom = floored.filter((model) => model.isCustom);
  const familyRank = new Map<string, number>();
  for (const model of nonCustom) {
    const key = modelFamilyKey(model);
    if (!familyRank.has(key)) {
      familyRank.set(key, familyRank.size);
    }
  }
  const originalRank = new Map(nonCustom.map((model, index) => [model, index] as const));
  const sorted = [...nonCustom].sort((left, right) => {
    const familyDelta =
      (familyRank.get(modelFamilyKey(left)) ?? 0) - (familyRank.get(modelFamilyKey(right)) ?? 0);
    if (familyDelta !== 0) {
      return familyDelta;
    }
    const versionDelta = compareVersionTuples(
      modelVersionTuple(right.slug),
      modelVersionTuple(left.slug),
    );
    if (versionDelta !== 0) {
      return versionDelta;
    }
    return (originalRank.get(left) ?? 0) - (originalRank.get(right) ?? 0);
  });
  return [...sorted, ...custom];
}

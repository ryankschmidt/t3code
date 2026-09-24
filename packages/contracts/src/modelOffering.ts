import * as Schema from "effect/Schema";
import { ModelSelection } from "./orchestration.ts";
import { modelIdentity } from "./model.ts";

/**
 * ThroughLine: the one model list, owned by the server.
 *
 * Ryan, Sep 23, 2026: "We have 100% control over Pi, so why do we have to hide
 * anything? Why aren't we just dictating what the model list is and is not?"
 *
 * Every client (the Mac window, the Linux window, the iPhone) shows exactly
 * what its server reports, and the server reports exactly this list. Nothing
 * is hidden on a client. The hourly upstream manifest fetch can still refresh a
 * model's capabilities, but it cannot add a model here or bring back a retired
 * one. This value is persisted in the server's own settings.json under
 * `modelOffering`; the compiled default below is what every build ships with.
 */
export const ModelOffering = Schema.Struct({
  /**
   * The models each source driver offers, in picker order. A driver absent
   * from this record is not restricted by it (retired models still apply).
   * Pi is never listed: it offers exactly the union of the source drivers.
   */
  offeredModels: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  /** Model ids no provider may report, Pi included. */
  retiredModels: Schema.Array(Schema.String),
});
export type ModelOffering = typeof ModelOffering.Type;

export const DEFAULT_MODEL_OFFERING: ModelOffering = {
  offeredModels: {
    claudeAgent: ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5"],
    codex: ["gpt-6-astra", "gpt-5.3-codex-spark", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
  },
  retiredModels: [
    "claude-opus-5",
    "claude-opus-4-5",
    "claude-opus-4-6",
    "claude-opus-4-7",
    "gpt-5.5",
  ],
};

/** The Claude new-thread default: Opus 5.5 with the 1M context window. */
export const DEFAULT_CLAUDE_NEW_THREAD_SELECTION: ModelSelection = Schema.decodeUnknownSync(
  ModelSelection,
)({
  instanceId: "claudeAgent",
  model: "claude-opus-5-5",
  options: [{ id: "contextWindow", value: "1m" }],
});

const MIRROR_DRIVER = "pi";

/**
 * Pi reaches one model through several routes. The first route prefix that
 * carries a model is the one offered, so each model appears once: Claude over
 * the Meridian route Pi's config names first, Codex over Pi's native Codex
 * sign-in rather than the metered OpenAI API.
 */
const MIRROR_ROUTE_PREFERENCE: ReadonlyArray<string> = [
  "anthropic/",
  "openai-codex/",
  "tower-anthropic/",
  "openai/",
];

/**
 * Comparable id: last path segment, lowercased, with a context-window suffix
 * (`[1m]`) and a trailing API date stamp (`-20251101`) removed. Exact
 * comparison on purpose: `claude-opus-5` never matches `claude-opus-5-5`.
 */
export function offeringModelId(slug: string): string {
  return modelIdentity(slug)
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-\d{8}$/, "")
    .trim();
}

export function isRetiredModel(slug: string, offering: ModelOffering): boolean {
  const id = offeringModelId(slug);
  return offering.retiredModels.some((retired) => offeringModelId(retired) === id);
}

/** The part of a reported provider the offering reads; `ServerProvider` satisfies it. */
type OfferableModel = { readonly slug: string; readonly isCustom?: boolean | undefined };
type OfferableProvider<M extends OfferableModel> = {
  readonly driver: string;
  readonly models: ReadonlyArray<M>;
};

function routeRank(slug: string): number {
  const index = MIRROR_ROUTE_PREFERENCE.findIndex((prefix) => slug.startsWith(prefix));
  return index === -1 ? MIRROR_ROUTE_PREFERENCE.length : index;
}

function orderByList<M extends OfferableModel>(
  models: ReadonlyArray<M>,
  order: ReadonlyArray<string>,
): ReadonlyArray<M> {
  const position = new Map(order.map((id, index) => [offeringModelId(id), index] as const));
  return [...models.map((model, index) => ({ model, index }))]
    .sort((left, right) => {
      const leftAt = position.get(offeringModelId(left.model.slug)) ?? order.length;
      const rightAt = position.get(offeringModelId(right.model.slug)) ?? order.length;
      return leftAt - rightAt || left.index - right.index;
    })
    .map(({ model }) => model);
}

function offerSourceModels<M extends OfferableModel>(
  provider: OfferableProvider<M>,
  offering: ModelOffering,
): ReadonlyArray<M> {
  const kept = provider.models.filter((model) => !isRetiredModel(model.slug, offering));
  const offered = offering.offeredModels[provider.driver];
  if (offered === undefined) return kept;
  const allowed = new Set(offered.map(offeringModelId));
  return orderByList(
    kept.filter((model) => model.isCustom === true || allowed.has(offeringModelId(model.slug))),
    offered,
  );
}

/**
 * Apply the offering to the providers a server reports. Source drivers keep
 * only their offered models, in offered order. Pi keeps exactly one route per
 * model the source drivers report after filtering, in the same order, and
 * nothing when no source driver has reported. Every other driver loses only
 * its retired models.
 */
export function applyModelOffering<M extends OfferableModel, P extends OfferableProvider<M>>(
  providers: ReadonlyArray<P>,
  offering: ModelOffering,
): ReadonlyArray<P> {
  const sourced = providers.map((provider) =>
    provider.driver === MIRROR_DRIVER
      ? provider
      : { ...provider, models: offerSourceModels(provider, offering) },
  );

  const union: Array<string> = [];
  for (const driver of Object.keys(offering.offeredModels)) {
    for (const provider of sourced) {
      if (provider.driver !== driver) continue;
      for (const model of provider.models) {
        if (model.isCustom === true) continue;
        const id = offeringModelId(model.slug);
        if (!union.includes(id)) union.push(id);
      }
    }
  }

  return sourced.map((provider) => {
    if (provider.driver !== MIRROR_DRIVER) return provider;
    const byId = new Map<string, M>();
    const custom: Array<M> = [];
    for (const model of provider.models) {
      if (isRetiredModel(model.slug, offering)) continue;
      if (model.isCustom === true) {
        custom.push(model);
        continue;
      }
      const id = offeringModelId(model.slug);
      if (!union.includes(id)) continue;
      const current = byId.get(id);
      if (current === undefined || routeRank(model.slug) < routeRank(current.slug)) {
        byId.set(id, model);
      }
    }
    const mirrored = union.flatMap((id) => {
      const model = byId.get(id);
      return model === undefined ? [] : [model];
    });
    return { ...provider, models: [...mirrored, ...custom] };
  });
}

/**
 * A new-thread default naming a retired model moves to the first offered model
 * of the same provider (Claude to Opus 5.5 with the 1M window), so a stored
 * setting never starts a thread on a retired model and never switches
 * provider behind the user's back. A provider with no offered list falls back
 * to the Claude default.
 */
export function retireModelSelection(
  selection: ModelSelection | null,
  offering: ModelOffering,
): ModelSelection | null {
  if (selection === null) return null;
  if (!isRetiredModel(selection.model, offering)) return selection;
  if (selection.instanceId === DEFAULT_CLAUDE_NEW_THREAD_SELECTION.instanceId) {
    return DEFAULT_CLAUDE_NEW_THREAD_SELECTION;
  }
  const successor = offering.offeredModels[selection.instanceId]?.[0];
  if (successor === undefined) return DEFAULT_CLAUDE_NEW_THREAD_SELECTION;
  return Schema.decodeUnknownSync(ModelSelection)({
    instanceId: selection.instanceId,
    model: successor,
  });
}

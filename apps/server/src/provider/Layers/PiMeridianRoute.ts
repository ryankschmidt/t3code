/**
 * PiMeridianRoute — the T3-side guard for the Pi provider's Anthropic seam.
 *
 * Route split (PLAN-T3-Meridian-Seam-Patch): OpenAI/Codex-family models stay
 * on Pi's native auth + transport; Anthropic/Claude-family models route
 * through Meridian (loopback) and the official Claude Code SDK. The transport
 * retarget itself lives in pi's own provider config (`~/.pi/agent/models.json`
 * — versioned copy under `provider/pi-runtime-config/`); this module is the
 * FAIL-CLOSED guard and diagnostics on the T3 side of that seam:
 *
 *   - classify a Pi model slug into its route family
 *     (`openai-native-pi` | `anthropic-meridian-claude-code-sdk`)
 *   - at session/turn start for Anthropic-family models, verify the Meridian
 *     route override is configured (parse models.json server-side) and that
 *     the loopback Meridian endpoint is reachable (cheap GET /health with a
 *     short timeout, cached briefly)
 *   - on any failure, fail the turn with an error that NAMES the seam —
 *     never fall back to Pi native Anthropic OAuth
 *
 * Credential hygiene: the models.json parse decodes ONLY `providers.*.baseUrl`.
 * The `apiKey`/`headers` fields are dropped by the schema (excess properties),
 * so a placeholder or real credential value can never reach a log, an error
 * message, or an event payload from this module.
 *
 * @module provider/Layers/PiMeridianRoute
 */
// @effect-diagnostics nodeBuiltinImport:off - Resolving the operator's ~/.pi/agent/models.json path is a Node OS boundary.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { RuntimeRouteFamily } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { parsePiModelSlug } from "./PiSessionRuntime.ts";

/** Pi model-slug provider segment that routes through the Meridian seam. */
const ANTHROPIC_PROVIDER_SEGMENT = "anthropic";

export const PI_ROUTE_FAMILY_OPENAI_NATIVE: RuntimeRouteFamily = "openai-native-pi";
export const PI_ROUTE_FAMILY_ANTHROPIC_MERIDIAN: RuntimeRouteFamily =
  "anthropic-meridian-claude-code-sdk";

/** Default location of pi's provider-override config (the deployed route). */
export const PI_MODELS_JSON_RELATIVE_PATH = ".pi/agent/models.json";

// Meridian's FIRST /health answer after an idle stretch takes ~1.6s cold
// (measured live 2026-07-06: 1.59s then ~1ms warm) — a 750ms timeout failed
// every first-turn-after-idle and the false result cached across both gates.
// 4s absorbs the cold start while staying snappy for a turn-start gate.
const PROBE_TIMEOUT_MS = 4_000;
const DEFAULT_PROBE_CACHE_TTL_MS = 5_000;

/**
 * Classifies a Pi model slug (`provider/modelId`) into its transport route
 * family. Unparseable/absent slugs return `undefined` — the caller must not
 * claim a route it cannot prove.
 */
export function piRouteFamilyForModel(
  model: string | null | undefined,
): RuntimeRouteFamily | undefined {
  const parsed = parsePiModelSlug(model);
  if (!parsed) {
    return undefined;
  }
  return parsed.provider === ANTHROPIC_PROVIDER_SEGMENT
    ? PI_ROUTE_FAMILY_ANTHROPIC_MERIDIAN
    : PI_ROUTE_FAMILY_OPENAI_NATIVE;
}

export function isAnthropicFamilyPiModel(model: string | null | undefined): boolean {
  return piRouteFamilyForModel(model) === PI_ROUTE_FAMILY_ANTHROPIC_MERIDIAN;
}

/**
 * Machine contract for the subset of `~/.pi/agent/models.json` the guard
 * reads. Excess properties (`apiKey`, `headers`, model lists, ...) are
 * dropped at decode time — credential values are unrepresentable here.
 */
const PiProviderOverrideSubset = Schema.Struct({
  baseUrl: Schema.optional(Schema.String),
});
const PiModelsJsonSubset = Schema.Struct({
  providers: Schema.optional(Schema.Record(Schema.String, PiProviderOverrideSubset)),
});
const decodePiModelsJson = Schema.decodeUnknownEffect(Schema.fromJsonString(PiModelsJsonSubset));

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export interface PiMeridianRouteTarget {
  /** Anthropic override base URL from models.json (loopback-validated). */
  readonly baseUrl: string;
  /** `GET`-able health endpoint derived from the base URL. */
  readonly healthUrl: string;
  /** `host:port` rendering for operator-facing error messages. */
  readonly displayTarget: string;
}

export type PiMeridianRouteConfigResult =
  | { readonly _tag: "configured"; readonly target: PiMeridianRouteTarget }
  | { readonly _tag: "not-configured"; readonly reason: string }
  | { readonly _tag: "invalid"; readonly reason: string };

function toRouteTarget(baseUrl: string): PiMeridianRouteTarget | undefined {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return {
    baseUrl,
    healthUrl: new URL("/health", url).toString(),
    displayTarget: `${url.hostname}:${port}`,
  };
}

/**
 * Parses models.json contents into the guard's route decision. The route is
 * only "configured" when `providers.anthropic.baseUrl` exists, parses as an
 * http(s) URL, AND points at loopback — Meridian beyond loopback is a
 * credential-leak surface and is treated as an invalid route, not a
 * reachable one (plan §Configuration expectations).
 */
export function parsePiMeridianRouteConfig(
  contents: string,
): Effect.Effect<PiMeridianRouteConfigResult> {
  return decodePiModelsJson(contents).pipe(
    Effect.map((parsed): PiMeridianRouteConfigResult => {
      const override = parsed.providers?.[ANTHROPIC_PROVIDER_SEGMENT];
      if (!override) {
        return {
          _tag: "not-configured",
          reason: "models.json has no providers.anthropic override",
        };
      }
      const baseUrl = override.baseUrl?.trim();
      if (!baseUrl) {
        return {
          _tag: "not-configured",
          reason: "providers.anthropic override has no baseUrl",
        };
      }
      const target = toRouteTarget(baseUrl);
      if (!target) {
        return {
          _tag: "invalid",
          reason: "providers.anthropic.baseUrl is not a valid http(s) URL",
        };
      }
      if (!LOOPBACK_HOSTNAMES.has(new URL(target.baseUrl).hostname)) {
        return {
          _tag: "invalid",
          reason:
            "providers.anthropic.baseUrl is not loopback — Meridian must stay on 127.0.0.1 for this local setup",
        };
      }
      return { _tag: "configured", target };
    }),
    Effect.orElseSucceed(
      (): PiMeridianRouteConfigResult => ({
        _tag: "invalid",
        reason: "models.json is not parseable JSON in the expected shape",
      }),
    ),
  );
}

/**
 * PiMeridianRouteError — the Anthropic seam is unavailable for this turn.
 * `reason` is machine-routable; `detail` is the operator-facing message that
 * names the seam. Never carries credential values.
 */
export class PiMeridianRouteError extends Schema.TaggedErrorClass<PiMeridianRouteError>()(
  "PiMeridianRouteError",
  {
    reason: Schema.Literals(["not-configured", "config-invalid", "unreachable"]),
    model: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }

  get errorClass(): "provider_error" | "transport_error" {
    return this.reason === "unreachable" ? "transport_error" : "provider_error";
  }
}

function notConfiguredMessage(model: string, reason: string): string {
  return (
    `Anthropic route unavailable for '${model}': Anthropic/Claude models route through ` +
    `the Meridian Claude Code SDK seam, and that route is not configured (${reason}; ` +
    `expected a providers.anthropic override in ~/${PI_MODELS_JSON_RELATIVE_PATH}). ` +
    `Pi native Anthropic OAuth is disabled for Claude turns — the turn was not sent.`
  );
}

function unreachableMessage(model: string, displayTarget: string): string {
  return (
    `Anthropic route unavailable for '${model}': Meridian is down or unreachable at ` +
    `${displayTarget}. Anthropic/Claude models route through the Meridian Claude Code ` +
    `SDK seam — the turn was not sent, and no Pi native Anthropic OAuth fallback was attempted.`
  );
}

/**
 * Default reachability probe: one cheap GET against Meridian's stable
 * `/health` route with a short abort timeout. Any transport failure is
 * "unreachable" — the guard fails closed, it never guesses.
 */
const defaultProbe = (healthUrl: string): Effect.Effect<boolean> =>
  Effect.tryPromise({
    try: async () => {
      // @effect-diagnostics-next-line globalFetchInEffect:off - Deliberately tiny, injectable, timeout-bounded loopback health probe; threading HttpClient through the Pi adapter would widen the driver SPI for no gain.
      const response = await fetch(healthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return response.ok;
    },
    catch: (error) => {
      // Surface WHY the seam probe failed (raw stderr: pre-Effect diagnostics
      // for a loopback health check; never carries secrets).
      const errno = (error as { cause?: NodeJS.ErrnoException })?.cause;
      const detail = errno?.code ?? (error instanceof Error ? error.name : String(error));
      process.stderr.write(`[pi-meridian-probe] ${healthUrl} probe failed: ${detail}\n`);
      return false;
    },
  }).pipe(Effect.orElseSucceed(() => false));

export interface PiMeridianRouteGuardOptions {
  /** Overrides the models.json path (tests; default `~/.pi/agent/models.json`). */
  readonly configPath?: string;
  /** Overrides the reachability probe (tests; default GET /health). */
  readonly probe?: (healthUrl: string) => Effect.Effect<boolean>;
  /** Probe result cache TTL; 0 disables caching. */
  readonly probeCacheTtlMs?: number;
}

export interface PiMeridianRouteGuardShape {
  /**
   * Fail-closed gate for one Anthropic-family turn. Succeeds only when the
   * Meridian route override is configured AND the loopback endpoint answers
   * the health probe. Callers must run this BEFORE any Pi RPC for the turn
   * (no `set_model`, no `prompt` on failure).
   */
  readonly guardAnthropicTurn: (model: string) => Effect.Effect<void, PiMeridianRouteError>;
}

export function defaultPiModelsJsonPath(): string {
  return NodePath.join(NodeOS.homedir(), PI_MODELS_JSON_RELATIVE_PATH);
}

export function makePiMeridianRouteGuard(
  fileSystem: FileSystem.FileSystem,
  options?: PiMeridianRouteGuardOptions,
): PiMeridianRouteGuardShape {
  const configPath = options?.configPath ?? defaultPiModelsJsonPath();
  const probe = options?.probe ?? defaultProbe;
  const probeCacheTtlMs = options?.probeCacheTtlMs ?? DEFAULT_PROBE_CACHE_TTL_MS;
  const probeCache = new Map<string, { readonly atMillis: number; readonly ok: boolean }>();

  const cachedProbe = (healthUrl: string): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const nowMillis = DateTime.toEpochMillis(yield* DateTime.now);
      const cached = probeCache.get(healthUrl);
      if (cached && probeCacheTtlMs > 0 && nowMillis - cached.atMillis < probeCacheTtlMs) {
        return cached.ok;
      }
      const ok = yield* probe(healthUrl);
      probeCache.set(healthUrl, { atMillis: nowMillis, ok });
      return ok;
    });

  const guardAnthropicTurn: PiMeridianRouteGuardShape["guardAnthropicTurn"] = (model) =>
    Effect.gen(function* () {
      const contents = yield* fileSystem
        .readFileString(configPath)
        .pipe(Effect.map((value): string | undefined => value), Effect.orElseSucceed(() => undefined));
      if (contents === undefined) {
        return yield* new PiMeridianRouteError({
          reason: "not-configured",
          model,
          detail: notConfiguredMessage(model, "models.json is missing or unreadable"),
        });
      }
      const config = yield* parsePiMeridianRouteConfig(contents);
      if (config._tag === "not-configured") {
        return yield* new PiMeridianRouteError({
          reason: "not-configured",
          model,
          detail: notConfiguredMessage(model, config.reason),
        });
      }
      if (config._tag === "invalid") {
        return yield* new PiMeridianRouteError({
          reason: "config-invalid",
          model,
          detail: notConfiguredMessage(model, config.reason),
        });
      }
      const reachable = yield* cachedProbe(config.target.healthUrl);
      if (!reachable) {
        return yield* new PiMeridianRouteError({
          reason: "unreachable",
          model,
          detail: unreachableMessage(model, config.target.displayTarget),
        });
      }
    });

  return { guardAnthropicTurn };
}

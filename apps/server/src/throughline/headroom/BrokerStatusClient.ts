import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as DateTime from "effect/DateTime";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { ObserverSnapshot, QuotaObservation } from "./observer.ts";

const QuotaSchema = Schema.Struct({
  state: Schema.Literals(["unknown", "available", "empty"]),
  observed_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  reset_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const StatusSchema = Schema.Struct({
  schema: Schema.Literals(["throughline-provider-broker.observer-status.v1"]),
  last_sequence: Schema.Number,
  identities: Schema.Array(
    Schema.Struct({
      identity: Schema.String,
      provider: Schema.String,
      credential_loaded: Schema.Boolean,
      configured: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
      quota: Schema.optionalKey(QuotaSchema),
    }),
  ),
});
type Status = typeof StatusSchema.Type;
const decodeStatus = Schema.decodeSync(Schema.fromJsonString(StatusSchema));
function timestamp(value: string | null | undefined): number {
  if (!value) return NaN;
  try {
    return DateTime.toEpochMillis(DateTime.makeUnsafe(value));
  } catch {
    return NaN;
  }
}

export interface BrokerStatusClientOptions {
  readonly statusUrl?: string;
  readonly freshnessMs: number;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly now?: () => number;
}
export interface CachedBrokerIdentity {
  readonly identity: string;
  readonly provider: string;
  readonly configured: boolean | null;
  readonly loaded: boolean | null;
  readonly available: boolean | null;
  readonly quota?: QuotaObservation;
}
export interface CachedBrokerStatus {
  readonly state: "unknown" | "fresh" | "stale" | "failed" | "closed";
  readonly receivedAt: number | null;
  readonly identities: readonly CachedBrokerIdentity[];
  readonly snapshot?: ObserverSnapshot;
}

export class BrokerStatusClient {
  readonly freshnessMs: number;
  readonly #statusUrl: string | undefined;
  readonly #requestTimeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #now: () => number;
  #status: Status | undefined;
  #receivedAt: number | null = null;
  #state: "unknown" | "fresh" | "failed" = "unknown";
  #closed = false;
  #controller: AbortController | undefined;
  #inFlight: Promise<void> | undefined;

  /** Transport/cache only. No configuration reader, credentials, quota acquisition or admission rule. */
  constructor(options: BrokerStatusClientOptions) {
    this.freshnessMs = options.freshnessMs;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    this.#maxResponseBytes = options.maxResponseBytes ?? 262_144;
    this.#now =
      options.now ?? (() => Effect.runSync(DateTime.now.pipe(Effect.map(DateTime.toEpochMillis))));
    if (
      ![this.freshnessMs, this.#requestTimeoutMs, this.#maxResponseBytes].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      )
    )
      throw new Error("Invalid observer client bounds");
    if (options.statusUrl !== undefined) {
      let url: URL;
      try {
        url = new URL(options.statusUrl);
      } catch {
        throw new Error("Invalid observer status URL");
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.pathname !== "/v1/status" ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      )
        throw new Error("Invalid observer status URL");
      this.#statusUrl = url.href;
    }
  }

  /** Caller owns refresh scheduling/lifetime. Concurrent refreshes share one GET. */
  refresh(): Promise<void> {
    if (this.#closed || this.#statusUrl === undefined) return Promise.resolve();
    if (this.#inFlight) return this.#inFlight;
    const controller = new AbortController();
    this.#controller = controller;
    this.#inFlight = this.#refresh(controller).finally(() => {
      this.#controller = undefined;
      this.#inFlight = undefined;
    });
    return this.#inFlight;
  }

  async #refresh(controller: AbortController): Promise<void> {
    const statusUrl = this.#statusUrl!;
    const maxResponseBytes = this.#maxResponseBytes;
    try {
      const status = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const response = yield* HttpClient.get(statusUrl);
            if (response.status < 200 || response.status >= 300)
              throw new Error("Observer unavailable");
            const body = yield* Stream.runFold(
              response.stream,
              () => ({ bytes: 0, chunks: [] as Uint8Array[] }),
              (body, chunk) => {
                const bytes = body.bytes + chunk.byteLength;
                if (bytes > maxResponseBytes) throw new Error("Observer body exceeds bounds");
                body.chunks.push(chunk);
                return { bytes, chunks: body.chunks };
              },
            );
            const data = new Uint8Array(body.bytes);
            let offset = 0;
            for (const chunk of body.chunks) {
              data.set(chunk, offset);
              offset += chunk.byteLength;
            }
            return decodeStatus(new TextDecoder("utf-8", { fatal: true }).decode(data));
          }),
        ).pipe(
          Effect.provide(FetchHttpClient.layer),
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
          Effect.timeout(`${this.#requestTimeoutMs} millis`),
        ),
        { signal: controller.signal },
      );
      if (
        !Number.isSafeInteger(status.last_sequence) ||
        status.last_sequence < 0 ||
        status.identities.some((row) => !row.identity.trim() || !row.provider.trim())
      )
        throw new Error("Invalid observer status");
      const receivedAt = this.#clock();
      if (!Number.isFinite(receivedAt)) throw new Error("Observer clock unavailable");
      if (this.#closed || controller.signal.aborted) return;
      this.#status = status;
      this.#receivedAt = receivedAt;
      this.#state = "fresh";
    } catch {
      // No response body, error cause, URL or credentials cross this public boundary.
      if (!this.#closed) this.#state = "failed";
    }
  }

  #clock(): number {
    try {
      return this.#now();
    } catch {
      return NaN;
    }
  }

  /** Synchronous, defensive copies. Receipt time never replaces quota observation time. */
  read(): CachedBrokerStatus {
    const now = this.#clock();
    const age = this.#receivedAt === null ? NaN : now - this.#receivedAt;
    const state: CachedBrokerStatus["state"] = this.#closed
      ? "closed"
      : this.#state !== "fresh"
        ? this.#state
        : !Number.isFinite(age) || age < 0
          ? "unknown"
          : age >= this.freshnessMs
            ? "stale"
            : "fresh";
    const fresh = state === "fresh";
    const identities = (this.#status?.identities ?? []).map((row): CachedBrokerIdentity => {
      const observed = timestamp(row.quota?.observed_at);
      const reset = timestamp(row.quota?.reset_at);
      const quotaFresh =
        fresh && Number.isFinite(observed) && observed <= now && now - observed < this.freshnessMs;
      const resetPassed = Number.isFinite(reset) && reset <= now;
      const quotaState =
        quotaFresh && !resetPassed && (row.quota?.state !== "empty" || Number.isFinite(reset))
          ? (row.quota?.state ?? "unknown")
          : "unknown";
      return {
        identity: row.identity,
        provider: row.provider,
        configured: fresh ? (row.configured ?? null) : null,
        loaded: fresh ? row.credential_loaded : null,
        available: quotaState === "available" ? true : quotaState === "empty" ? false : null,
        ...(row.quota ? { quota: { ...row.quota, state: quotaState } } : {}),
      };
    });
    return {
      state,
      receivedAt: this.#receivedAt,
      identities,
      ...(fresh && this.#status
        ? {
            snapshot: {
              identities: this.#status.identities.map((row) => ({
                identity: row.identity,
                provider: row.provider,
                credential_loaded: row.credential_loaded,
                ...(row.quota ? { quota: { ...row.quota } } : {}),
              })),
            },
          }
        : {}),
    };
  }

  close(): void {
    this.#closed = true;
    this.#controller?.abort();
  }
}

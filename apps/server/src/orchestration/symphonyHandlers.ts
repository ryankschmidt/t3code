/**
 * Pure decision logic for the symphony WS methods (TQ-039 slice 1), extracted
 * from ws.ts so the negative controls are mechanically testable without the full
 * server graph. Nothing here performs IO; the ws.ts handlers compose these with
 * `runtime.app.spawn` / `fetchTaskResult`.
 */
import type { AbsurdRuntimeHandle } from "@t3tools/absurd-runtime";
import {
  isRoutedSymphonyModel,
  SymphonyRuntimeUnavailableError,
  SymphonySpawnError,
  type SymphonyTaskStatusOutput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * Structural view of the absurd-sdk `TaskResultSnapshot` — kept local so
 * apps/server does not import absurd-sdk directly. `fetchTaskResult`'s return
 * type is assignable to this.
 */
export type AbsurdTaskSnapshot =
  | { readonly state: "pending" | "running" | "sleeping" }
  | { readonly state: "completed"; readonly result: unknown }
  | { readonly state: "failed"; readonly failure: unknown }
  | { readonly state: "cancelled" };

/**
 * NC1 — fail closed when the server-owned AbsurdRuntime service is absent:
 * a typed error, zero partial state. `Effect.serviceOption` yields None when the
 * worker layer was not wired; the symphony methods must not proceed.
 */
export const resolveSymphonyRuntime = (
  option: Option.Option<AbsurdRuntimeHandle>,
): Effect.Effect<AbsurdRuntimeHandle, SymphonyRuntimeUnavailableError> =>
  Option.isNone(option)
    ? Effect.fail(
        new SymphonyRuntimeUnavailableError({
          message: "AbsurdRuntime service is unavailable; symphony spawn failed closed.",
        }),
      )
    : Effect.succeed(option.value);

/**
 * NC2 — reject a missing or off-routing-table model. There is no silent default
 * anywhere on this path.
 */
export const assertRoutedSymphonyModel = (
  model: string,
): Effect.Effect<void, SymphonySpawnError> =>
  isRoutedSymphonyModel(model)
    ? Effect.void
    : Effect.fail(
        new SymphonySpawnError({
          message: `Model is not in the Symphony routing table (no default permitted): ${model}`,
        }),
      );

/** Short human summary from an absurd task result/failure payload. */
export const symphonySummaryFromPayload = (payload: unknown): string | undefined => {
  if (payload && typeof payload === "object" && "summary" in payload) {
    const summary = (payload as { summary?: unknown }).summary;
    if (typeof summary === "string") return summary;
  }
  if (payload === null || payload === undefined) return undefined;
  const encoded = JSON.stringify(payload);
  return encoded.length > 500 ? `${encoded.slice(0, 500)}…` : encoded;
};

/** Map an absurd task snapshot to the Symphony status contract. */
export const mapSymphonyTaskSnapshot = (snapshot: AbsurdTaskSnapshot): SymphonyTaskStatusOutput => {
  switch (snapshot.state) {
    case "pending":
    case "sleeping":
      return { state: "pending" };
    case "running":
      return { state: "running" };
    case "completed": {
      const summary = symphonySummaryFromPayload(snapshot.result);
      return summary === undefined
        ? { state: "completed" }
        : { state: "completed", resultSummary: summary };
    }
    case "failed": {
      const summary = symphonySummaryFromPayload(snapshot.failure);
      return summary === undefined ? { state: "failed" } : { state: "failed", resultSummary: summary };
    }
    case "cancelled":
      return { state: "failed", resultSummary: "task cancelled" };
  }
};

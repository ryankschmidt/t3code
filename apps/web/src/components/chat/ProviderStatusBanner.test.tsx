import type { ServerProvider, SymphonyRuntimeReadyOutput } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProviderStatusBanner } from "./ProviderStatusBanner";

const readyCodex = {
  status: "ready",
  driver: "codex",
  auth: { status: "authenticated" },
  displayName: "Codex",
} as ServerProvider;

const unavailableCodex = {
  status: "error",
  driver: "codex",
  auth: { status: "authenticated" },
  displayName: "Codex",
  message: "Codex provider is unavailable.",
} as ServerProvider;

function readiness(
  worker: "ready" | "not-ready",
  queue: "ready" | "not-ready" | "unknown",
  session: "ready" | "not-ready" = "ready",
): SymphonyRuntimeReadyOutput {
  return {
    ready: worker === "ready" && queue === "ready" && session === "ready",
    checks: [
      {
        name: "absurd-worker-layer",
        state: worker,
        ...(worker === "not-ready" ? { category: "uninitialized" as const } : {}),
      },
      {
        name: "queue-reachability",
        state: queue,
        ...(queue !== "ready" ? { category: "unreachable" as const } : {}),
      },
      {
        name: "session-boundary",
        state: session,
        ...(session === "not-ready" ? { category: "protected-lane" as const } : {}),
      },
    ],
  };
}

describe("ProviderStatusBanner durable turn-rail readiness", () => {
  it("warns when Codex is reachable but the Absurd queue is not ready", () => {
    const markup = renderToStaticMarkup(
      <ProviderStatusBanner
        status={readyCodex}
        runtimeReadiness={readiness("ready", "not-ready")}
      />,
    );

    expect(markup).toContain('data-runtime-readiness="not-ready"');
    expect(markup).toContain("Codex is reachable, but the durable task runtime is not ready");
    expect(markup).toContain("queue-reachability");
  });

  it("does not warn when only the Symphony session boundary is not ready", () => {
    const markup = renderToStaticMarkup(
      <ProviderStatusBanner
        status={readyCodex}
        runtimeReadiness={readiness("ready", "ready", "not-ready")}
      />,
    );

    expect(markup).toBe("");
  });

  it("does not warn when provider and turn rail are both ready", () => {
    const markup = renderToStaticMarkup(
      <ProviderStatusBanner status={readyCodex} runtimeReadiness={readiness("ready", "ready")} />,
    );

    expect(markup).toBe("");
  });

  it("does not claim the provider is reachable when provider and turn rail both fail", () => {
    const markup = renderToStaticMarkup(
      <ProviderStatusBanner
        status={unavailableCodex}
        runtimeReadiness={readiness("ready", "not-ready")}
      />,
    );

    expect(markup).toContain("Codex provider is unavailable.");
    expect(markup).toContain("durable task runtime is also not ready");
    expect(markup).not.toContain("Codex is reachable");
  });
});

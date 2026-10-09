// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { BrokerLimits, type BrokerObserverSnapshot } from "./BrokerLimits";

it("renders every configured identity, loading, freshness and only observed quota", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const now = Date.parse("2026-10-09T15:00:00Z");
  const snapshot: BrokerObserverSnapshot = {
    identities: [
      {
        identity: "loaded-empty",
        provider: "codex",
        credential_loaded: true,
        quota: {
          state: "empty",
          reset_at: "2026-10-09T16:00:00Z",
          observed_at: "2026-10-09T14:59:59Z",
        },
      },
      { identity: "configured-unloaded", provider: "claude", credential_loaded: false },
      {
        identity: "stale-empty",
        provider: "claude",
        credential_loaded: true,
        quota: { state: "empty", observed_at: "2026-10-08T15:00:00Z" },
      },
    ],
  };
  const configured = [
    ...snapshot.identities.map(({ identity, provider }) => ({ identity, provider })),
    { identity: "not-yet-observed", provider: "codex" },
  ];
  try {
    await act(() =>
      root.render(
        <BrokerLimits snapshot={snapshot} configured={configured} now={now} freshnessMs={60_000} />,
      ),
    );
    expect(container.textContent).toContain("configured-unloaded");
    expect(container.textContent).toContain("Not loaded");
    expect(container.textContent).toContain("Quota unknown");
    expect(container.textContent).toContain("Quota empty");
    expect(container.textContent).toContain("Stale observation");
    expect(container.textContent).toContain("2026-10-09T16:00:00Z");
    expect(container.querySelectorAll("h3")).toHaveLength(configured.length);
    expect(container.textContent).toContain("not-yet-observed");
    await act(() =>
      root.render(<BrokerLimits configured={configured} now={now} freshnessMs={60_000} />),
    );
    expect(container.textContent).toContain("Broker headroom unknown");
    expect(container.textContent).not.toContain("Quota available");
    expect(container.querySelectorAll("h3")).toHaveLength(configured.length);
    expect(container.textContent).toContain("Loading unknown");
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

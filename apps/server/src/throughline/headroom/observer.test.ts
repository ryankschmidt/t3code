import { describe, expect, it } from "vite-plus/test";
import { readHeadroom } from "./observer";

const now = Date.parse("2026-10-09T15:00:00Z");
const configured = [
  { identity: "active", provider: "codex" },
  { identity: "unloaded", provider: "claude" },
];

describe("optional broker observation consumer", () => {
  it("admits unknown and preserves all configured identities", () => {
    const rows = readHeadroom({ configured, now, freshnessMs: 60_000 });
    expect(rows.map((row) => row.identity)).toEqual(["active", "unloaded"]);
    expect(rows.every((row) => row.admit && row.state === "unknown" && row.loaded === null)).toBe(
      true,
    );
  });
  it("excludes fresh known-empty, admits stale and re-admits on reset", () => {
    const quota = {
      state: "empty" as const,
      observed_at: "2026-10-09T14:59:59Z",
      reset_at: "2026-10-09T16:00:00Z",
    };
    const snapshot = {
      identities: [{ identity: "active", provider: "codex", credential_loaded: true, quota }],
    };
    expect(readHeadroom({ configured, snapshot, now, freshnessMs: 60_000 })[0]?.admit).toBe(false);
    expect(
      readHeadroom({ configured, snapshot, now: now + 120_000, freshnessMs: 60_000 })[0]?.admit,
    ).toBe(true);
    expect(
      readHeadroom({
        configured,
        snapshot,
        now: Date.parse(quota.reset_at),
        freshnessMs: 4_000_000,
      })[0]?.admit,
    ).toBe(true);
    const recovered = {
      identities: [
        {
          ...snapshot.identities[0]!,
          quota: { state: "available" as const, observed_at: "2026-10-09T16:00:00Z" },
        },
      ],
    };
    expect(
      readHeadroom({
        configured,
        snapshot: recovered,
        now: Date.parse(quota.reset_at),
        freshnessMs: 60_000,
      })[0]?.state,
    ).toBe("available");
  });
  it("does not turn cooldown, loading or malformed timestamps into quota", () => {
    const snapshot = {
      identities: [
        {
          identity: "active",
          provider: "codex",
          credential_loaded: false,
          cooldown_until: "2026-10-09T16:00:00Z",
          quota: { state: "empty" as const, observed_at: "invalid" },
        },
      ],
    };
    const row = readHeadroom({ configured, snapshot, now, freshnessMs: 60_000 })[0]!;
    expect(row.loaded).toBe(false);
    expect(row.state).toBe("unknown");
    expect(row.admit).toBe(true);
  });
});

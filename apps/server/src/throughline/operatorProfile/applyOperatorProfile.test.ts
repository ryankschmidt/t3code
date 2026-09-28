import {
  DEFAULT_SERVER_SETTINGS,
  OPERATOR_PROFILE,
  ProviderInstanceId,
  ServerSettings,
  type OperatorProfileEntry,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { applyOperatorProfile, type ApplyOperatorProfileInput } from "./applyOperatorProfile.ts";

const decode = Schema.decodeUnknownSync(ServerSettings);
const source = { kind: "none-on-file", note: "test" } as const;

const continueEntry: OperatorProfileEntry = {
  key: "continueThreadsAfterServerUpdate",
  value: true,
  merge: "replace",
  scope: "all",
  reason: "resume after restarts",
  decided: "2026-09-28",
  source,
};

const claudeEntry: OperatorProfileEntry = {
  key: "providerInstances",
  item: "claudeAgent",
  value: {
    claudeAgent: {
      driver: "claudeAgent",
      displayName: "ryan-claude",
      enabled: true,
      config: { binaryPath: "{home}/.local/bin/ryan-claude" },
    },
  },
  merge: "deep",
  scope: "all",
  requires_launcher: "{home}/.local/bin/ryan-claude",
  reason: "governed launcher",
  decided: "2026-09-28",
  source,
};

const run = (overrides: Partial<ApplyOperatorProfileInput>) =>
  applyOperatorProfile({
    settings: DEFAULT_SERVER_SETTINGS,
    profile: [continueEntry],
    host: "linux",
    home: "/home/twr",
    launcherExists: () => true,
    overrides: new Map(),
    ...overrides,
  });

describe("applyOperatorProfile", () => {
  it("applies over a settings-file value and says it replaced one", () => {
    const settings = decode({ continueThreadsAfterServerUpdate: false });
    const result = run({ settings });
    expect(result.settings.continueThreadsAfterServerUpdate).toBe(true);
    expect(result.rows).toMatchObject([
      {
        entry: "continueThreadsAfterServerUpdate",
        outcome: "applied",
        code: "APPLIED_OVER_FILE_VALUE",
      },
    ]);
  });

  it("reports a value the host already held", () => {
    const result = run({});
    expect(result.rows[0]).toMatchObject({
      outcome: "applied",
      code: "APPLIED_ALREADY_HELD",
      effective: true,
    });
  });

  it("applies over the upstream default", () => {
    const entry: OperatorProfileEntry = {
      ...continueEntry,
      key: "sidebarAutoSettleAfterDays",
      value: 7,
    };
    const result = run({ profile: [entry] });
    expect(result.settings.sidebarAutoSettleAfterDays).toBe(7);
    expect(result.rows[0]).toMatchObject({ outcome: "applied", code: "APPLIED_OVER_DEFAULT" });
  });

  it("keeps a deliberate local override and reports it", () => {
    const settings = decode({ continueThreadsAfterServerUpdate: false });
    const result = run({
      settings,
      overrides: new Map([["continueThreadsAfterServerUpdate", "debugging restarts"]]),
    });
    expect(result.settings.continueThreadsAfterServerUpdate).toBe(false);
    expect(result.rows[0]).toMatchObject({
      outcome: "overridden-locally",
      code: "OVERRIDDEN_LOCALLY",
      detail: "kept local: debugging restarts",
      effective: false,
    });
  });

  it("rejects an entry whose launcher is missing and leaves the setting alone", () => {
    const result = run({ profile: [claudeEntry], launcherExists: () => false });
    expect(result.settings.providerInstances).toEqual(DEFAULT_SERVER_SETTINGS.providerInstances);
    expect(result.rows[0]).toMatchObject({
      entry: "providerInstances.claudeAgent",
      outcome: "rejected",
      code: "LAUNCHER_MISSING",
      detail: "launcher not found at /home/twr/.local/bin/ryan-claude",
    });
  });

  it("rejects a value the settings schema refuses", () => {
    const bad = {
      ...continueEntry,
      key: "sidebarAutoSettleAfterDays",
      value: -3,
    } as OperatorProfileEntry;
    const result = run({ profile: [bad] });
    expect(result.settings).toBe(DEFAULT_SERVER_SETTINGS);
    expect(result.rows[0]).toMatchObject({ outcome: "rejected", code: "SCHEMA_REJECTED" });
  });

  it("skips an entry scoped to another host", () => {
    const entry: OperatorProfileEntry = {
      ...continueEntry,
      key: "enableDeviceSupport",
      scope: "mac",
    };
    const result = run({ profile: [entry] });
    expect(result.settings.enableDeviceSupport).toBe(false);
    expect(result.rows[0]).toMatchObject({ outcome: "not-for-this-host", code: "HOST_SCOPE" });
  });

  it("merges a provider instance without touching the fields it does not own", () => {
    const settings = decode({
      providerInstances: {
        claudeAgent: {
          driver: "claudeAgent",
          environment: [{ name: "ANTHROPIC_API_KEY", value: "broker-token", sensitive: false }],
          config: { binaryPath: "claude", customModels: ["kept"] },
        },
      },
    });
    const result = run({ settings, profile: [claudeEntry], host: "mac", home: "/Users/Admin" });
    const instance = result.settings.providerInstances[ProviderInstanceId.make("claudeAgent")];
    expect(instance?.environment).toEqual([
      { name: "ANTHROPIC_API_KEY", value: "broker-token", sensitive: false },
    ]);
    expect(instance?.config).toEqual({
      binaryPath: "/Users/Admin/.local/bin/ryan-claude",
      customModels: ["kept"],
    });
    expect(result.rows[0]?.code).toBe("APPLIED_OVER_FILE_VALUE");
    // The receipt carries only the owned fields, so the credential never reaches it.
    expect(JSON.stringify(result.rows)).not.toContain("broker-token");
  });

  it("brings a fresh host's settings to the declared profile", () => {
    const result = run({ profile: OPERATOR_PROFILE, host: "mac", home: "/Users/Admin" });
    expect(result.rows.filter((row) => row.outcome !== "applied")).toEqual([]);
    expect(result.settings.continueThreadsAfterServerUpdate).toBe(true);
    expect(result.settings.backgroundActivityProfile).toBe("performance");
    expect(
      result.settings.providerInstances[ProviderInstanceId.make("codex")]?.config,
    ).toMatchObject({ binaryPath: "/Users/Admin/.local/bin/ryan-codex" });
  });
});

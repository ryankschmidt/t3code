import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_SERVER_SETTINGS, ServerSettings } from "../settings.ts";
import {
  OPERATOR_PROFILE,
  OPERATOR_PROFILE_NOT_OWNED,
  operatorProfileEntryId,
  type OperatorProfileEntry,
} from "./operatorProfile.ts";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);

const withHome = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value).replaceAll("{home}", "/home/example"));

// A key upstream renames or removes must fail the build, not the install. If `key` ever widened
// to any string, this directive would go unused and typecheck would fail.
const renamedKey: OperatorProfileEntry = {
  // @ts-expect-error — "continueThreadsAfterServerRestart" is not a server settings key
  key: "continueThreadsAfterServerRestart",
  value: true,
  merge: "replace",
  scope: "all",
  reason: "compile-time guard",
  decided: "2026-09-28",
  source: { kind: "none-on-file", note: "test" },
};

describe("ThroughLine operator profile declaration", () => {
  it("names only real server settings keys", () => {
    void renamedKey;
    for (const entry of OPERATOR_PROFILE) {
      expect(Object.hasOwn(DEFAULT_SERVER_SETTINGS, entry.key), entry.key).toBe(true);
    }
  });

  it("gives every entry a unique id, and an item entry sets only its own item", () => {
    const ids = OPERATOR_PROFILE.map(operatorProfileEntryId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of OPERATOR_PROFILE) {
      if (entry.item === undefined) continue;
      expect(Object.keys(entry.value as object)).toEqual([entry.item]);
    }
  });

  it("decodes every value through the settings schema", () => {
    for (const entry of OPERATOR_PROFILE) {
      expect(() => decodeServerSettings({ [entry.key]: withHome(entry.value) })).not.toThrow();
    }
  });

  it("declares no model ids and no credentials", () => {
    const ownedElsewhere = new Set([
      "defaultModelSelection",
      "modelOffering",
      "textGenerationModelSelection",
      "sourceControlWriterModelSelection",
      "usageLimitSources",
    ]);
    for (const entry of OPERATOR_PROFILE) {
      expect(ownedElsewhere.has(entry.key), entry.key).toBe(false);
      const text = JSON.stringify(entry.value);
      expect(text).not.toMatch(/"environment"|"customModels"|"serverPassword"|claude-|gpt-/);
    }
    for (const name of ownedElsewhere) {
      expect(
        OPERATOR_PROFILE_NOT_OWNED.some((item) => item.name === name),
        name,
      ).toBe(true);
    }
  });

  it("keeps each protected value equal to the release's source default", () => {
    const protectedEntries = OPERATOR_PROFILE.filter((entry) => entry.protected);
    expect(protectedEntries.map((entry) => entry.key).toSorted()).toEqual([
      "continueThreadsAfterServerUpdate",
      "enableAgentDeviceAccess",
    ]);
    for (const entry of protectedEntries) {
      expect(entry.scope).toBe("all");
      expect(DEFAULT_SERVER_SETTINGS[entry.key]).toEqual(entry.value);
    }
  });

  it("points every launcher-bound entry at the launcher it requires", () => {
    for (const entry of OPERATOR_PROFILE) {
      if (entry.requires_launcher === undefined) continue;
      expect(JSON.stringify(entry.value)).toContain(`"binaryPath":"${entry.requires_launcher}"`);
    }
  });
});

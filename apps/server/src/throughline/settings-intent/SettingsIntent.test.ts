import { describe, expect, it } from "vite-plus/test";

import { createSettingsIntent, type SettingsHostAdapter } from "./SettingsIntent";

function hosts() {
  const values = { mac: true, twr: false, rpi: false };
  const writes: string[] = [];
  const adapters: SettingsHostAdapter[] = (["mac", "twr", "rpi"] as const).map((host) => ({
    host,
    read: async () => values[host],
    write: async (_key, value) => {
      writes.push(host);
      values[host] = value;
    },
  }));
  return { values, writes, adapters };
}

describe("settings intent on existing settings adapters", () => {
  it("returns one event with effective readback and each prior value", async () => {
    const state = hosts();
    const intent = createSettingsIntent(state.adapters);
    const event = await intent.applyIntent("continueThreadsAfterServerUpdate", true);
    expect(state.values).toEqual({ mac: true, twr: true, rpi: true });
    expect(state.writes).toEqual(["twr", "rpi"]);
    expect(event.setting).toBe("continueThreadsAfterServerUpdate");
    expect(
      event.hosts.map((host) => [host.host, host.before, host.effective, host.status]),
    ).toEqual([
      ["mac", true, true, "unchanged"],
      ["twr", false, true, "applied"],
      ["rpi", false, true, "applied"],
    ]);
  });

  it.each([
    "enableAgentDeviceAccess",
    "enableAgentBrowserAccess",
    "enableDeviceSupport",
    "deviceHosts",
    "providerInstances",
    "usageLimitSources",
    "binaryPath",
    "credentialAccess",
    "theme",
    "unknown",
    "__proto__",
    "constructor",
  ])("rejects excluded %s before reading or writing any host", async (key) => {
    let reads = 0;
    let writes = 0;
    const adapters: SettingsHostAdapter[] = (["mac", "twr", "rpi"] as const).map((host) => ({
      host,
      read: async () => {
        reads++;
        return false;
      },
      write: async () => {
        writes++;
      },
    }));
    await expect(createSettingsIntent(adapters).applyIntent(key, true)).rejects.toThrow(
      "SETTING_EXCLUDED",
    );
    expect([reads, writes]).toEqual([0, 0]);
  });

  it.each(["true", 1, null, {}, undefined])(
    "rejects invalid value %s with zero writes",
    async (value) => {
      const state = hosts();
      await expect(
        createSettingsIntent(state.adapters).applyIntent("continueThreadsAfterServerUpdate", value),
      ).rejects.toThrow("SETTING_VALUE_INVALID");
      expect(state.writes).toEqual([]);
    },
  );

  it("refuses missing hosts before mutating any eligible host", async () => {
    const state = hosts();
    await expect(
      createSettingsIntent(state.adapters.slice(0, 2)).applyIntent(
        "continueThreadsAfterServerUpdate",
        true,
      ),
    ).rejects.toThrow("ELIGIBLE_HOST_MISSING");
    expect(state.writes).toEqual([]);
  });

  it("reports readback drift instead of equating a successful write with effective state", async () => {
    const state = hosts();
    state.adapters[1] = { host: "twr", read: async () => false, write: async () => {} };
    const event = await createSettingsIntent(state.adapters).applyIntent(
      "continueThreadsAfterServerUpdate",
      true,
    );
    expect(event.hosts[1]).toMatchObject({
      host: "twr",
      before: false,
      effective: false,
      status: "drift",
    });
    expect(event.hosts[2].status).toBe("applied");
  });

  it("rolls back changed hosts to their own prior values, leaving unchanged hosts alone", async () => {
    const state = hosts();
    const intent = createSettingsIntent(state.adapters);
    const event = await intent.applyIntent("continueThreadsAfterServerUpdate", true);
    state.writes.length = 0;
    const rollback = await intent.rollbackIntent(event);
    expect(state.values).toEqual({ mac: true, twr: false, rpi: false });
    expect(state.writes).toEqual(["twr", "rpi"]);
    expect(rollback.map((host) => host.status)).toEqual(["unchanged", "restored", "restored"]);
  });

  it("does not overwrite an intervening host change during rollback", async () => {
    const state = hosts();
    const intent = createSettingsIntent(state.adapters);
    const event = await intent.applyIntent("continueThreadsAfterServerUpdate", true);
    state.values.twr = false;
    state.writes.length = 0;
    const rollback = await intent.rollbackIntent(event);
    expect(rollback[1].status).toBe("rollback-conflict");
    expect(state.writes).toEqual(["rpi"]);
  });

  it("cannot use a forged rollback event to write an excluded field", async () => {
    const state = hosts();
    const intent = createSettingsIntent(state.adapters);
    const event = await intent.applyIntent("continueThreadsAfterServerUpdate", true);
    state.writes.length = 0;
    await expect(
      intent.rollbackIntent({ ...event, setting: "enableAgentDeviceAccess" } as typeof event),
    ).rejects.toThrow("SETTING_EXCLUDED");
    expect(state.writes).toEqual([]);
  });
});

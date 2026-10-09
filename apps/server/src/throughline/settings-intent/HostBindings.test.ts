import { describe, expect, it } from "vite-plus/test";
import {
  createHostBindings,
  type HostBindingOptions,
  type PublicHostMap,
  type SettingsBindingRecord,
} from "./HostBindings";

function fixture() {
  const map: PublicHostMap = {
    source: "fixture://public-host-map",
    revision: "v1",
    hosts: [
      { role: "rpi", environmentId: "environment-rpi" },
      { role: "mac", environmentId: "environment-mac" },
      { role: "twr", environmentId: "environment-twr" },
    ],
  };
  const values = new Map(map.hosts.map((host) => [host.environmentId, false]));
  const calls: string[] = [];
  const records: SettingsBindingRecord[] = [];
  const existingThreads = new Set(["existing-thread"]);
  const options: HostBindingOptions = {
    publicHostMap: map,
    verifyPublicHostMap: async (candidate) =>
      candidate.source === map.source && candidate.revision === "v1",
    ports: map.hosts.map(({ environmentId }) => ({
      environmentId,
      verifyAuthenticated: async () => ({ environmentId, authenticated: true }),
      readContinuation: async () => values.get(environmentId)!,
      patchContinuation: async (value) => {
        calls.push(`write:${environmentId}`);
        values.set(environmentId, value);
        return values.get(environmentId)!;
      },
    })),
    consumer: {
      context: {
        owner: "OrchestrationEngine",
        environmentId: "environment-mac",
        threadId: "existing-thread",
      },
      verifyExistingContext: async (context) => {
        calls.push("record:verify");
        return existingThreads.has(context.threadId);
      },
      append: async (record, context) => {
        records.push(record);
        return {
          commandId: `fixture-command-${records.length}`,
          sequence: records.length,
          threadId: context.threadId,
          environmentId: context.environmentId,
        };
      },
    },
  };
  return { options, values, calls, records, existingThreads };
}

describe("explicit host bindings (fixture ports, not real transport proof)", () => {
  it("binds shuffled public roles to exact authenticated identities and one existing consumer", async () => {
    const state = fixture();
    const result = await createHostBindings(state.options).applyIntent(
      "continueThreadsAfterServerUpdate",
      true,
    );
    expect([...state.values.values()]).toEqual([true, true, true]);
    expect(state.calls[0]).toBe("record:verify");
    expect(state.records).toHaveLength(1);
    expect(state.records[0].operation).toBe("apply");
    expect(result.effectiveMatch).toBe(true);
    expect(result.receipt).toEqual({
      commandId: "fixture-command-1",
      sequence: 1,
      threadId: "existing-thread",
      environmentId: "environment-mac",
    });
    expect(result.event.hosts.map((host) => host.host)).toEqual(["mac", "twr", "rpi"]);
  });

  it.each([
    ["missing-map", "PUBLIC_HOST_MAP_MISSING"],
    ["unadmitted-map", "PUBLIC_HOST_MAP_NOT_ADMITTED"],
    ["missing-consumer", "DURABLE_CONSUMER_UNBOUND"],
    ["missing-record", "DURABLE_CONTEXT_UNAVAILABLE"],
    ["wrong-owner", "DURABLE_CONTEXT_INVALID"],
    ["missing-port", "HOST_PORT_UNBOUND"],
    ["duplicate-role", "PUBLIC_HOST_MAP_INVALID"],
    ["duplicate-environment", "PUBLIC_HOST_MAP_INVALID"],
    ["unknown-role", "PUBLIC_HOST_MAP_INVALID"],
    ["wrong-peer", "HOST_AUTHENTICATION_UNVERIFIED"],
    ["unauthenticated", "HOST_AUTHENTICATION_UNVERIFIED"],
  ])("refuses %s before any host write", async (scenario, error) => {
    const state = fixture();
    let options = state.options;
    if (scenario === "missing-map") options = { ...options, publicHostMap: null };
    if (scenario === "unadmitted-map")
      options = { ...options, verifyPublicHostMap: async () => false };
    if (scenario === "missing-consumer") options = { ...options, consumer: null };
    if (scenario === "missing-record") state.existingThreads.clear();
    if (scenario === "wrong-owner")
      options = {
        ...options,
        consumer: {
          ...options.consumer!,
          context: {
            owner: "new-store" as "OrchestrationEngine",
            environmentId: "environment-mac",
            threadId: "existing-thread",
          },
        },
      };
    if (scenario === "missing-port") options = { ...options, ports: options.ports!.slice(1) };
    if (scenario === "duplicate-role")
      options = {
        ...options,
        publicHostMap: {
          ...options.publicHostMap!,
          hosts: [
            { role: "mac", environmentId: "a" },
            { role: "mac", environmentId: "b" },
            { role: "rpi", environmentId: "c" },
          ],
        },
      };
    if (scenario === "duplicate-environment")
      options = {
        ...options,
        publicHostMap: {
          ...options.publicHostMap!,
          hosts: options.publicHostMap!.hosts.map((host) => ({ ...host, environmentId: "same" })),
        },
      };
    if (scenario === "unknown-role")
      options = {
        ...options,
        publicHostMap: {
          ...options.publicHostMap!,
          hosts: [
            { role: "icon-derived" as "mac", environmentId: "a" },
            ...options.publicHostMap!.hosts.slice(1),
          ],
        },
      };
    if (scenario === "wrong-peer" || scenario === "unauthenticated")
      options = {
        ...options,
        ports: options.ports!.map((port) => ({
          ...port,
          verifyAuthenticated: async () => ({
            environmentId: scenario === "wrong-peer" ? "other" : port.environmentId,
            authenticated: scenario !== "unauthenticated",
          }),
        })),
      };
    await expect(
      createHostBindings(options).applyIntent("continueThreadsAfterServerUpdate", true),
    ).rejects.toThrow(error);
    expect(state.calls.filter((call) => call.startsWith("write:"))).toEqual([]);
    expect(state.records).toEqual([]);
  });

  it("never uses a label or icon to fill an absent role", async () => {
    const state = fixture();
    const map = {
      ...state.options.publicHostMap!,
      hosts: [{ environmentId: "environment-mac", label: "mac", icon: "laptop" }],
    };
    await expect(
      createHostBindings({
        ...state.options,
        publicHostMap: map as unknown as PublicHostMap,
      }).applyIntent("continueThreadsAfterServerUpdate", true),
    ).rejects.toThrow("PUBLIC_HOST_MAP_INVALID");
    expect(state.calls).toEqual([]);
  });

  it.each(["enableAgentDeviceAccess", "providerInstances", "deviceHosts", "unknown"])(
    "excludes %s before contacting ports",
    async (setting) => {
      const state = fixture();
      await expect(createHostBindings(state.options).applyIntent(setting, true)).rejects.toThrow(
        "SETTING_EXCLUDED",
      );
      expect(state.calls).toEqual([]);
    },
  );

  it("rejects a complete settings response rather than treating it as a field projection", async () => {
    const state = fixture();
    const options = {
      ...state.options,
      ports: state.options.ports!.map((port) => ({
        ...port,
        readContinuation: async () =>
          ({
            continueThreadsAfterServerUpdate: true,
            enableAgentDeviceAccess: false,
          }) as unknown as boolean,
      })),
    };
    await expect(
      createHostBindings(options).applyIntent("continueThreadsAfterServerUpdate", true),
    ).rejects.toThrow("HOST_READ_FAILED");
    expect(state.calls.filter((call) => call.startsWith("write:"))).toEqual([]);
  });

  it("does not report matching effective state when a port write response violates the boolean contract", async () => {
    const state = fixture();
    const options = {
      ...state.options,
      ports: state.options.ports!.map((port) => ({
        ...port,
        patchContinuation: async () =>
          ({ continueThreadsAfterServerUpdate: true }) as unknown as boolean,
      })),
    };
    const result = await createHostBindings(options).applyIntent(
      "continueThreadsAfterServerUpdate",
      true,
    );
    expect(result.effectiveMatch).toBe(false);
    expect(result.event.hosts.every((host) => host.status === "write-failed")).toBe(true);
  });

  it("refuses to claim success when the durable acknowledgement names another context", async () => {
    const state = fixture();
    const options = {
      ...state.options,
      consumer: {
        ...state.options.consumer!,
        append: async () => ({
          commandId: "command",
          sequence: 1,
          threadId: "other-thread",
          environmentId: "environment-mac",
        }),
      },
    };
    await expect(
      createHostBindings(options).applyIntent("continueThreadsAfterServerUpdate", true),
    ).rejects.toThrow("DURABLE_RECEIPT_UNCONFIRMED");
  });

  it("surfaces an unconfirmed append without leaking the consumer error or inventing durable success", async () => {
    const state = fixture();
    const options = {
      ...state.options,
      consumer: {
        ...state.options.consumer!,
        append: async () => {
          throw new Error("untrusted transport details");
        },
      },
    };
    await expect(
      createHostBindings(options).applyIntent("continueThreadsAfterServerUpdate", true),
    ).rejects.toMatchObject({ message: "DURABLE_RECEIPT_UNCONFIRMED" });
  });

  it.each(["", "environment-not-admitted"])(
    "refuses an unbound durable record environment (%s) before writes",
    async (environmentId) => {
      const state = fixture();
      const options = {
        ...state.options,
        consumer: {
          ...state.options.consumer!,
          context: { ...state.options.consumer!.context, environmentId },
        },
      };
      await expect(
        createHostBindings(options).applyIntent("continueThreadsAfterServerUpdate", true),
      ).rejects.toThrow("DURABLE_CONTEXT_INVALID");
      expect(state.calls.filter((call) => call.startsWith("write:"))).toEqual([]);
    },
  );

  it("rejects another environment's durable acknowledgement even when the thread id matches", async () => {
    const state = fixture();
    const options = {
      ...state.options,
      consumer: {
        ...state.options.consumer!,
        append: async () => ({
          commandId: "command",
          sequence: 1,
          threadId: "existing-thread",
          environmentId: "environment-twr",
        }),
      },
    };
    await expect(
      createHostBindings(options).applyIntent("continueThreadsAfterServerUpdate", true),
    ).rejects.toThrow("DURABLE_RECEIPT_UNCONFIRMED");
  });

  it("rolls back only against the same admitted binding and records the existing core result", async () => {
    const state = fixture();
    const binding = createHostBindings(state.options);
    const applied = await binding.applyIntent("continueThreadsAfterServerUpdate", true);
    const rollback = await binding.rollbackIntent(applied);
    expect([...state.values.values()]).toEqual([false, false, false]);
    expect(rollback.hosts.every((host) => host.status === "restored")).toBe(true);
    expect(state.records.map((record) => record.operation)).toEqual(["apply", "rollback"]);
  });
});

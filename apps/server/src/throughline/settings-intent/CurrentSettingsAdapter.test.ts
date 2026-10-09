import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { createCurrentSettingsAdapter } from "./CurrentSettingsAdapter";
import { createSettingsIntent } from "./SettingsIntent";

describe("current-settings adapter", () => {
  it("persists only the eligible field, rereads effective state and restores per-host prior values", async () => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "settings-intent-"));
    try {
      const initial = {
        continueThreadsAfterServerUpdate: false,
        enableAgentDeviceAccess: false,
        deviceSupport: "local",
      };
      const files = (["mac", "twr", "rpi"] as const).map((host) => ({
        host,
        file: NodePath.join(dir, `${host}.json`),
      }));
      for (const { file } of files) await NodeFSP.writeFile(file, JSON.stringify(initial));
      const patches: unknown[] = [];
      const adapters = files.map(({ host, file }) =>
        createCurrentSettingsAdapter(host, {
          readContinuation: async () =>
            JSON.parse(await NodeFSP.readFile(file, "utf8")).continueThreadsAfterServerUpdate,
          patchContinuation: async (patch) => {
            patches.push(patch);
            const current = JSON.parse(await NodeFSP.readFile(file, "utf8"));
            await NodeFSP.writeFile(file, JSON.stringify({ ...current, ...patch }));
          },
        }),
      );
      const intent = createSettingsIntent(adapters);
      const event = await intent.applyIntent("continueThreadsAfterServerUpdate", true);
      expect(event.hosts.every((host) => host.effective === true)).toBe(true);
      expect(patches).toEqual(
        Array.from({ length: 3 }, () => ({ continueThreadsAfterServerUpdate: true })),
      );
      for (const { file } of files)
        expect(JSON.parse(await NodeFSP.readFile(file, "utf8"))).toEqual({
          ...initial,
          continueThreadsAfterServerUpdate: true,
        });
      await intent.rollbackIntent(event);
      for (const { file } of files)
        expect(JSON.parse(await NodeFSP.readFile(file, "utf8"))).toEqual(initial);
    } finally {
      await NodeFSP.rm(dir, { recursive: true });
    }
  });

  it("rejects direct excluded adapter writes even if a caller bypasses the coordinator", async () => {
    let writes = 0;
    const adapter = createCurrentSettingsAdapter("mac", {
      readContinuation: async () => true,
      patchContinuation: async () => {
        writes++;
      },
    });
    await expect(
      adapter.write("enableAgentDeviceAccess" as "continueThreadsAfterServerUpdate", true),
    ).rejects.toThrow("SETTING_EXCLUDED");
    await expect(
      adapter.write("continueThreadsAfterServerUpdate", "true" as unknown as boolean),
    ).rejects.toThrow("SETTING_VALUE_INVALID");
    expect(writes).toBe(0);
  });
});

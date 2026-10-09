import type { SettingsHost, SettingsHostAdapter } from "./SettingsIntent";

/** Ports bind to the existing settings service or its typed remote client.
 * Read a scalar; write a one-field patch. Never carry a full settings snapshot. */
export interface CurrentSettingsPort {
  readonly readContinuation: () => Promise<boolean>;
  readonly patchContinuation: (patch: {
    readonly continueThreadsAfterServerUpdate: boolean;
  }) => Promise<unknown>;
}

export function createCurrentSettingsAdapter(
  host: SettingsHost,
  port: CurrentSettingsPort,
): SettingsHostAdapter {
  const assertSetting = (setting: string) => {
    if (setting !== "continueThreadsAfterServerUpdate") throw new Error("SETTING_EXCLUDED");
  };
  return {
    host,
    read: async (setting) => {
      assertSetting(setting);
      const value = await port.readContinuation();
      if (typeof value !== "boolean") throw new Error("SETTING_VALUE_INVALID");
      return value;
    },
    write: async (setting, value) => {
      assertSetting(setting);
      if (typeof value !== "boolean") throw new Error("SETTING_VALUE_INVALID");
      await port.patchContinuation({ continueThreadsAfterServerUpdate: value });
    },
  };
}

export type SettingsHost = "mac" | "twr" | "rpi";
export type EligibleSetting = "continueThreadsAfterServerUpdate";

export interface SettingsHostAdapter {
  readonly host: SettingsHost;
  readonly read: (setting: EligibleSetting) => Promise<boolean>;
  readonly write: (setting: EligibleSetting, value: boolean) => Promise<void>;
}

export interface SettingsHostResult {
  readonly host: SettingsHost;
  readonly before: boolean;
  readonly effective: boolean | null;
  readonly status: "unchanged" | "applied" | "drift" | "write-failed" | "readback-failed";
}

export interface SettingsIntentEvent {
  readonly setting: EligibleSetting;
  readonly value: boolean;
  readonly hosts: readonly SettingsHostResult[];
}

export interface SettingsRollbackResult {
  readonly host: SettingsHost;
  readonly effective: boolean | null;
  readonly status: "unchanged" | "restored" | "rollback-conflict" | "rollback-failed";
}

const ELIGIBLE_HOSTS = ["mac", "twr", "rpi"] as const;

function assertEligible(setting: string): asserts setting is EligibleSetting {
  // Deliberately allowlist one existing setting. Never copy a settings object,
  // derive eligibility from Protected-Settings, or forward arbitrary patches.
  if (setting !== "continueThreadsAfterServerUpdate") throw new Error("SETTING_EXCLUDED");
}

function assertBoolean(value: unknown): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error("SETTING_VALUE_INVALID");
}

export function createSettingsIntent(adapters: readonly SettingsHostAdapter[]) {
  let pending: Promise<unknown> = Promise.resolve();
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const result = pending.then(run);
    pending = result.catch(() => undefined);
    return result;
  };

  const eligibleAdapters = () => {
    if (adapters.some((adapter) => !ELIGIBLE_HOSTS.includes(adapter.host))) {
      throw new Error("HOST_EXCLUDED");
    }
    return ELIGIBLE_HOSTS.map((host) => {
      const matches = adapters.filter((adapter) => adapter.host === host);
      if (matches.length === 0) throw new Error("ELIGIBLE_HOST_MISSING");
      if (matches.length !== 1) throw new Error("ELIGIBLE_HOST_DUPLICATE");
      return matches[0]!;
    });
  };

  const read = async (adapter: SettingsHostAdapter, setting: EligibleSetting) => {
    try {
      const value = await adapter.read(setting);
      assertBoolean(value);
      return value;
    } catch {
      // Never forward transport errors: they can carry paths or credential material.
      throw new Error("HOST_READ_FAILED");
    }
  };

  return {
    applyIntent: async (setting: string, value: unknown): Promise<SettingsIntentEvent> => {
      assertEligible(setting);
      assertBoolean(value);
      return serialize(async () => {
        const targets = eligibleAdapters();
        // All hosts must be readable before the first write, so missing access
        // never creates a partially applied intent without prior-value evidence.
        const before = await Promise.all(targets.map((adapter) => read(adapter, setting)));
        const hosts: SettingsHostResult[] = [];
        for (const [index, adapter] of targets.entries()) {
          const prior = before[index]!;
          if (prior === value) {
            hosts.push({
              host: adapter.host,
              before: prior,
              effective: prior,
              status: "unchanged",
            });
            continue;
          }
          let writeFailed = false;
          try {
            await adapter.write(setting, value);
          } catch {
            writeFailed = true;
          }
          let effective: boolean | null = null;
          try {
            effective = await read(adapter, setting);
          } catch {
            /* Report absent readback. */
          }
          hosts.push({
            host: adapter.host,
            before: prior,
            effective,
            status: writeFailed
              ? "write-failed"
              : effective === null
                ? "readback-failed"
                : effective === value
                  ? "applied"
                  : "drift",
          });
        }
        // The caller persists this one event through the existing record lane.
        // This module does not introduce another settings store or record owner.
        return Object.freeze({
          setting,
          value,
          hosts: Object.freeze(hosts.map((host) => Object.freeze(host))),
        });
      });
    },
    rollbackIntent: async (
      event: SettingsIntentEvent,
    ): Promise<readonly SettingsRollbackResult[]> => {
      assertEligible(event.setting);
      assertBoolean(event.value);
      const targets = eligibleAdapters();
      if (
        event.hosts.length !== targets.length ||
        targets.some(
          (adapter) => event.hosts.filter((host) => host.host === adapter.host).length !== 1,
        )
      ) {
        throw new Error("ROLLBACK_HOSTS_INVALID");
      }
      for (const host of event.hosts) {
        assertBoolean(host.before);
        if (host.effective !== null) assertBoolean(host.effective);
      }
      return serialize(async () => {
        const results: SettingsRollbackResult[] = [];
        for (const adapter of targets) {
          const host = event.hosts.find((result) => result.host === adapter.host)!;
          if (host.status === "unchanged" || host.effective === host.before) {
            results.push({ host: adapter.host, effective: host.effective, status: "unchanged" });
            continue;
          }
          try {
            const current = await read(adapter, event.setting);
            if (host.effective === null || current !== host.effective) {
              results.push({ host: adapter.host, effective: current, status: "rollback-conflict" });
              continue;
            }
            await adapter.write(event.setting, host.before);
            const effective = await read(adapter, event.setting);
            results.push({
              host: adapter.host,
              effective,
              status: effective === host.before ? "restored" : "rollback-failed",
            });
          } catch {
            results.push({ host: adapter.host, effective: null, status: "rollback-failed" });
          }
        }
        return results;
      });
    },
  };
}

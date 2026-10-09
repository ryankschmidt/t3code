import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { createCurrentSettingsAdapter } from "./CurrentSettingsAdapter.ts";
import { createSettingsIntent } from "./SettingsIntent.ts";

const settingsJson = Schema.fromJsonString(
  Schema.Struct({
    continueThreadsAfterServerUpdate: Schema.Boolean,
    enableAgentDeviceAccess: Schema.Boolean,
    deviceSupport: Schema.String,
  }),
);
// Whole-file assertions must not hide an unexpected persisted key.
const decodeSettings = Schema.decodeUnknownSync(settingsJson, { onExcessProperty: "error" });
const encodeSettings = Schema.encodeSync(settingsJson);

effectIt.layer(Layer.merge(NodeFileSystem.layer, Path.layer))(
  "current-settings adapter files",
  (it) => {
    it.effect(
      "persists only the eligible field, rereads effective state and restores per-host prior values",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "settings-intent-" });
          // Promise ports reuse this test's supplied services and scoped fiber set.
          const runPort = yield* FiberSet.makeRuntimePromise();
          const initial = {
            continueThreadsAfterServerUpdate: false,
            enableAgentDeviceAccess: false,
            deviceSupport: "local",
          };
          const files = (["mac", "twr", "rpi"] as const).map((host) => ({
            host,
            file: path.join(dir, `${host}.json`),
          }));
          for (const { file } of files) yield* fs.writeFileString(file, encodeSettings(initial));
          const patches: unknown[] = [];
          const adapters = files.map(({ host, file }) =>
            createCurrentSettingsAdapter(host, {
              readContinuation: async () =>
                decodeSettings(await runPort(fs.readFileString(file)))
                  .continueThreadsAfterServerUpdate,
              patchContinuation: async (patch) => {
                patches.push(patch);
                const current = decodeSettings(await runPort(fs.readFileString(file)));
                await runPort(fs.writeFileString(file, encodeSettings({ ...current, ...patch })));
              },
            }),
          );
          const intent = createSettingsIntent(adapters);
          const event = yield* Effect.promise(() =>
            intent.applyIntent("continueThreadsAfterServerUpdate", true),
          );
          expect(event.hosts.every((host) => host.effective === true)).toBe(true);
          expect(patches).toEqual(
            Array.from({ length: 3 }, () => ({ continueThreadsAfterServerUpdate: true })),
          );
          for (const { file } of files)
            expect(decodeSettings(yield* fs.readFileString(file))).toEqual({
              ...initial,
              continueThreadsAfterServerUpdate: true,
            });
          yield* Effect.promise(() => intent.rollbackIntent(event));
          for (const { file } of files)
            expect(decodeSettings(yield* fs.readFileString(file))).toEqual(initial);
        }).pipe(Effect.scoped),
    );

    it.effect("rejects unexpected persisted keys before whole-file comparisons", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "settings-intent-excess-" });
        const file = path.join(dir, "settings.json");
        yield* fs.writeFileString(
          file,
          '{"continueThreadsAfterServerUpdate":false,"enableAgentDeviceAccess":false,"deviceSupport":"local","unexpectedSetting":"MUST_NOT_BE_HIDDEN"}',
        );
        const persisted = yield* fs.readFileString(file);
        expect(() => decodeSettings(persisted)).toThrow("unexpectedSetting");
      }).pipe(Effect.scoped),
    );
  },
);

describe("current-settings adapter", () => {
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

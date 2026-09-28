import * as NodeServices from "@effect/platform-node/NodeServices";
import type { OperatorProfileEntry } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as ServerSettingsModule from "../../serverSettings.ts";
import * as OperatorProfileModule from "./OperatorProfile.ts";

const continueEntry: OperatorProfileEntry = {
  key: "continueThreadsAfterServerUpdate",
  value: true,
  merge: "replace",
  scope: "all",
  reason: "resume after restarts",
  decided: "2026-09-28",
  source: { kind: "none-on-file", note: "test" },
};

const testConfigLayer = () =>
  Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3code-operator-profile-test-" }));

const settingsLayer = () =>
  ServerSettingsModule.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
  );

const mountedLayer = () =>
  settingsLayer().pipe(
    Layer.provideMerge(
      OperatorProfileModule.layerWith({
        profile: [continueEntry],
        host: "linux",
        home: "/home/twr",
      }),
    ),
    Layer.provideMerge(testConfigLayer()),
  );

const unmountedLayer = () => settingsLayer().pipe(Layer.provideMerge(testConfigLayer()));

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const fileTurningResumeOff = '{"continueThreadsAfterServerUpdate":false}\n';

const readReceipt = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fs.readFileString(
    path.join(config.stateDir, OperatorProfileModule.OPERATOR_PROFILE_RECEIPT_FILE),
  );
  const parsed = yield* decodeJson(text);
  return parsed as OperatorProfileModule.OperatorProfileReport;
});

it.layer(NodeServices.layer)("operator profile on the settings load path", (it) => {
  it.effect("applies the profile, writes the receipt, and never rewrites settings.json", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(config.settingsPath, fileTurningResumeOff);

      const settings = yield* (yield* ServerSettingsModule.ServerSettingsService).getSettings;
      assert.strictEqual(settings.continueThreadsAfterServerUpdate, true);

      const receipt = yield* readReceipt;
      assert.strictEqual(receipt.ok, true);
      assert.strictEqual(receipt.host.platform, "linux");
      assert.deepStrictEqual(receipt.effective, { continueThreadsAfterServerUpdate: true });
      assert.strictEqual(receipt.rows[0]?.code, "APPLIED_OVER_FILE_VALUE");
      assert.strictEqual(receipt.overrides_file.state, "absent");

      const latest = yield* (yield* OperatorProfileModule.OperatorProfile).latest;
      assert.deepStrictEqual(Option.getOrUndefined(latest), receipt);
      assert.strictEqual(yield* fs.readFileString(config.settingsPath), fileTurningResumeOff);
    }).pipe(Effect.provide(mountedLayer())),
  );

  it.effect("keeps a value listed in operator-profile-overrides.json", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.writeFileString(config.settingsPath, fileTurningResumeOff);
      yield* fs.writeFileString(
        path.join(config.stateDir, OperatorProfileModule.OPERATOR_PROFILE_OVERRIDES_FILE),
        '{"overrides":[{"entry":"continueThreadsAfterServerUpdate","reason":"testing restarts"}]}',
      );

      const settings = yield* (yield* ServerSettingsModule.ServerSettingsService).getSettings;
      assert.strictEqual(settings.continueThreadsAfterServerUpdate, false);

      const receipt = yield* readReceipt;
      assert.strictEqual(receipt.overrides_file.state, "read");
      assert.strictEqual(receipt.rows[0]?.outcome, "overridden-locally");
      assert.strictEqual(receipt.counts.overridden_locally, 1);
    }).pipe(Effect.provide(mountedLayer())),
  );

  it.effect("does nothing where the profile is not mounted", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.writeFileString(config.settingsPath, fileTurningResumeOff);

      const settings = yield* (yield* ServerSettingsModule.ServerSettingsService).getSettings;
      assert.strictEqual(settings.continueThreadsAfterServerUpdate, false);
      const receiptExists = yield* fs.exists(
        path.join(config.stateDir, OperatorProfileModule.OPERATOR_PROFILE_RECEIPT_FILE),
      );
      assert.strictEqual(receiptExists, false);
    }).pipe(Effect.provide(unmountedLayer())),
  );
});

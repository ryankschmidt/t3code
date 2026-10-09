import { test } from "node:test";
import assert from "node:assert/strict";
import * as source from "./rpi.js";
test("unit bytes are bound to the exact no-userdata descriptor", () => {
  const r = (source as unknown as Record<string, (...args: unknown[]) => any>)
    .rpiAf60PackageRecipe!();
  assert.doesNotThrow(() =>
    source.verifyRpiAf60UnitBytes(new TextEncoder().encode(r.unit), "server-af60-057"),
  );
  for (const bad of [
    r.unit.replace("--help", "serve"),
    r.unit + "[Install]\nWantedBy=default.target\n",
    r.unit.replace("/isolated/home", "/.t3"),
  ])
    assert.throws(
      () => source.verifyRpiAf60UnitBytes(new TextEncoder().encode(bad), "server-af60-057"),
      /UNIT_BINDING/,
    );
});
const api = source as unknown as Record<string, (...args: unknown[]) => any>;
const inputs = () => api.rpiAf60PackageInputs!();
const request = () => ({
  schema: "rpi-server-package-job.v1",
  operation: "server-package-unit-preflight",
  workspace: "server-af60-057",
  source_commit: "af60be0f620fdb9441d233f6dcce1461f452b796",
  release: "0.0.57",
  inputs: structuredClone(inputs().inputs),
});

test("owner recipe is a fixed immutable af60 registration, not a caller script", () => {
  const r = api.rpiAf60PackageRecipe!();
  assert.equal(r.source_commit, request().source_commit);
  assert.equal(r.release, "0.0.57");
  assert.equal(r.source_support_only, true);
  assert.deepEqual(r.outputs, [
    "server-linux-arm64.tar",
    "package-manifest.json",
    "staged-unit.service",
    "staged-unit-readiness.json",
  ]);
  assert.deepEqual(r.network_ports, []);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.inputs));
  assert.equal(r.native_externals["@ff-labs/fff-node"], "0.9.4");
  assert.equal(r.interpreter.version, "v24.19.0");
  assert.equal(r.interpreter.platform, "linux-arm64");
  assert.doesNotMatch(
    JSON.stringify(r.steps),
    /\bssh\b|\bscp\b|\bsudo\b|systemctl|\/home\/admin|\/home\/rpi\/\.t3|\brm\b/,
  );
});
test("exact dense four-input request is admitted as data only", () => {
  assert.equal(api.parseRpiAf60PackageRequest!(request()).source_commit, request().source_commit);
});
for (const key of [
  "command",
  "program",
  "argv",
  "env",
  "host",
  "root",
  "endpoint",
  "recipe_script",
  "native_proof",
])
  test("caller field rejected: " + key, () => {
    assert.throws(
      () => api.parseRpiAf60PackageRequest!({ ...request(), [key]: "untrusted" }),
      /UNKNOWN_FIELD/,
    );
  });
for (const commit of [
  "234a135cca74f0971fb670d5ffb540b3a5ee59d0",
  "f03e6ad350ae349efb9e919f56f1afc7d55aaf84",
  "HEAD",
  "af60",
])
  test("wrong source rejected: " + commit, () =>
    assert.throws(
      () => api.parseRpiAf60PackageRequest!({ ...request(), source_commit: commit }),
      /BINDING/,
    ),
  );
for (const workspace of ["../x", "/home/admin/x", "a;b", "x/../y", "x y"])
  test("workspace escape rejected: " + workspace, () =>
    assert.throws(() => api.parseRpiAf60PackageRequest!({ ...request(), workspace }), /WORKSPACE/),
  );
test("missing, duplicate, sparse and altered byte pins fail closed", () => {
  const r = request();
  for (const files of [
    [],
    new Array(4),
    [r.inputs[0], r.inputs[0], r.inputs[2], r.inputs[3]],
    r.inputs.slice(1),
    r.inputs.map((x: any, i: number) => (i ? x : { ...x, bytes: 0 })),
    r.inputs.map((x: any, i: number) => (i ? x : { ...x, sha256: "0".repeat(64) })),
  ])
    assert.throws(() => api.parseRpiAf60PackageRequest!({ ...r, inputs: files }), /INPUT|DENSE/);
});
test("accessor input fields never execute", () => {
  let read = false;
  const r = request();
  Object.defineProperty(r, "inputs", {
    enumerable: true,
    get() {
      read = true;
      return [];
    },
  });
  assert.throws(() => api.parseRpiAf60PackageRequest!(r), /FIELD/);
  assert.equal(read, false);
});
test("wrong actual bytes cannot be accepted merely by passing metadata", () =>
  assert.throws(
    () => api.verifyRpiAf60InputBytes!(inputs().inputs[0].name, new Uint8Array([1, 2, 3])),
    /BYTES/,
  ));
test("staged unit is help-only with empty owned home and no installation section", () => {
  const r = api.rpiAf60PackageRecipe!();
  assert.match(r.unit, /Type=oneshot/);
  assert.match(r.unit, /dist\/bin.mjs --help/);
  assert.doesNotMatch(r.unit, /\[Install\]|WantedBy|Restart=always|\.t3|EnvironmentFile|User=root/);
});
test("runner refuses non-native identity before reading inputs or acting", async () => {
  let actions = 0;
  await assert.rejects(
    api.runRpiAf60PackageSupport!(request(), {
      observe: async () => ({
        user: "twr",
        platform: "linux",
        arch: "arm64",
        node_version: "v24.19.0",
      }),
      readInput: async () => {
        actions++;
        return new Uint8Array();
      },
      perform: async () => {
        actions++;
      },
    }),
    /IDENTITY/,
  );
  assert.equal(actions, 0);
});
test("runner refuses reuse and wrong real path before acting", async () => {
  for (const override of [
    { build_exists: true },
    { root_realpath: "/home/admin/x" },
    { typed_support_admitted: false },
    { app_commit_allowed: false },
  ]) {
    let actions = 0;
    const c = {
      user: "rpi",
      platform: "linux",
      arch: "arm64",
      node_version: "v24.19.0",
      root_realpath: "/home/rpi/rpi-jobs/server-af60-057",
      build_exists: false,
      outputs_exist: false,
      typed_support_admitted: true,
      app_commit_allowed: true,
      ...override,
    };
    await assert.rejects(
      api.runRpiAf60PackageSupport!(request(), {
        observe: async () => c,
        readInput: async () => {
          actions++;
          return new Uint8Array();
        },
        perform: async () => {
          actions++;
        },
      }),
      /LOCATION|REUSE|ADMISSION/,
    );
    assert.equal(actions, 0);
  }
});
test("native unknown, wrong architecture, missing modules and zero checks cannot become a green total", () => {
  const e = {
    user: "rpi",
    platform: "linux",
    arch: "arm64",
    node_version: "v24.19.0",
    modules: [
      { name: "node-pty", version: "1.2.0-beta.15", loaded: true, checks: 1 },
      { name: "@ff-labs/fff-node", version: "0.9.4", loaded: true, checks: 1 },
      { name: "@napi-rs/keyring", version: "1.3.0", loaded: true, checks: 1 },
    ],
    resource_monitor: { machine: 183, checks: 1 },
    help_version: { exit_code: 0, checks: 2, version: "0.0.57" },
    staged_unit: { exit_code: 0, checks: 1, live_userdata: false },
  };
  assert.doesNotThrow(() => api.validateRpiAf60NativeEvidence!(e));
  for (const bad of [
    undefined,
    { ...e, arch: "x64" },
    { ...e, modules: [] },
    { ...e, modules: new Array(3) },
    { ...e, modules: e.modules.map((x) => ({ ...x, checks: 0 })) },
    { ...e, help_version: { ...e.help_version, checks: 0 } },
    { ...e, staged_unit: { ...e.staged_unit, live_userdata: true } },
  ])
    assert.throws(() => api.validateRpiAf60NativeEvidence!(bad), /NATIVE|DENSE/);
});

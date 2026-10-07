import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadPublisherConfig } from "../src/publisher-runtime.ts";

test("publisher config requires an explicit exhaustive grant backend", async () => {
  const root = await mkdtemp(join(homedir(), ".publisher-backend-"));
  try {
    const path = join(root, "config.json");
    const config = {
      schema: "throughline.publisher-runtime.v1",
      socketPath: join(root, "socket"),
      stateRoot: root,
      grantRoot: root,
      grantAuthorityUid: process.getuid!(),
      peerHelper: "/trusted/helper",
      nodeExecutable: "/trusted/node",
      connectionEntry: "/trusted/entry.js",
      maxConnections: 4,
      maxRequestBytes: 8192,
      readTimeoutMs: 1000,
    };
    for (const grantBackend of [undefined, "json", "fallback"]) {
      await writeFile(
        path,
        JSON.stringify({ ...config, ...(grantBackend ? { grantBackend } : {}) }),
        { mode: 0o600 },
      );
      await assert.rejects(loadPublisherConfig(path, process.getuid!()), /INVALID_RUNTIME_CONFIG/);
    }
    for (const grantBackend of ["sqlite-authority", "legacy-json-rehearsal"]) {
      await writeFile(path, JSON.stringify({ ...config, grantBackend }), { mode: 0o600 });
      assert.equal((await loadPublisherConfig(path, process.getuid!())).grantBackend, grantBackend);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publisher runtime rejects config writable by workers before starting a listener", async () => {
  const root = await mkdtemp(join(homedir(), ".publisher-config-"));
  try {
    const path = join(root, "config.json");
    await writeFile(path, JSON.stringify({ schema: "throughline.publisher-runtime.v1" }), {
      mode: 0o666,
    });
    await chmod(path, 0o666);
    await assert.rejects(loadPublisherConfig(path, process.getuid!()), /UNTRUSTED_PATH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publisher runtime rejects unrecognized configuration rather than accepting caller-selected process settings", async () => {
  const root = await mkdtemp(join(homedir(), ".publisher-config-"));
  try {
    const path = join(root, "config.json");
    await writeFile(
      path,
      JSON.stringify({
        schema: "throughline.publisher-runtime.v1",
        env: { NODE_OPTIONS: "--inspect" },
      }),
      { mode: 0o600 },
    );
    await assert.rejects(loadPublisherConfig(path, process.getuid!()), /INVALID_RUNTIME_CONFIG/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadPublisherConfig } from "../src/publisher-runtime.ts";

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

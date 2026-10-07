// @effect-diagnostics nodeBuiltinImport:off -- exercises the real test-fixture path alias.
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";

let platform = "darwin";
vi.mock("../hostProcess.ts", () => ({
  HostProcessPlatform: { defaultValue: () => platform },
}));

let directory: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (directory !== undefined) await NodeFS.rm(directory, { recursive: true });
});

it.each(["darwin", "win32"])("canonicalizes a %s temporary-directory alias", async (host) => {
  platform = host;
  directory = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-temp-alias-"));
  const target = await NodeFS.realpath(directory);
  const alias = NodePath.join(directory, "alias");
  await NodeFS.symlink(target, alias, "dir");
  vi.stubEnv("TMPDIR", alias);
  vi.stubEnv("TEMP", alias);
  vi.stubEnv("TMP", alias);
  vi.resetModules();

  await import("./longTempDir.ts");

  if (host === "darwin") {
    expect(process.env.TMPDIR).toBe(target);
    expect(NodeOS.tmpdir()).toBe(target);
  } else {
    expect(process.env.TEMP).toBe(target);
    expect(process.env.TMP).toBe(target);
  }
});

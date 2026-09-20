import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, lstat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { assertProtectedPath } from "./protected-files.ts";
import { runWorkerBootstrap, bootstrapDigest } from "./worker-bootstrap.ts";
import type { ExecutionBinding } from "./systemd-execution.ts";

export type WorkerEntryConfig = {
  binding: ExecutionBinding;
  expiresAt: number;
  workspace: string;
  home: string;
  executable: string;
  executableSha256: string;
  args: string[];
};
/** Static installed entry; its JSON argument is built only by the trusted host adapter. */
export async function executeWorkerEntry(config: WorkerEntryConfig): Promise<number> {
  if (
    !config ||
    Object.keys(config).some(
      (k) =>
        ![
          "binding",
          "expiresAt",
          "workspace",
          "home",
          "executable",
          "executableSha256",
          "args",
        ].includes(k),
    )
  )
    throw Error("INVALID_WORKER_CONFIG");
  const frozen = structuredClone(config);
  bootstrapDigest(frozen.binding, frozen.expiresAt);
  if (
    !Array.isArray(frozen.args) ||
    frozen.args.some((a) => typeof a !== "string" || a.includes("\0")) ||
    !/^[a-f0-9]{64}$/.test(frozen.executableSha256)
  )
    throw Error("INVALID_WORKER_CONFIG");
  await assertProtectedPath(frozen.executable, 0);
  const executable = await lstat(frozen.executable);
  if (!executable.isFile() || !(executable.mode & 0o111))
    throw Error("PROVIDER_EXECUTABLE_REQUIRED");
  if (
    createHash("sha256")
      .update(await readFile(frozen.executable))
      .digest("hex") !== frozen.executableSha256
  )
    throw Error("PROVIDER_EXECUTABLE_CHANGED");
  if (
    (await realpath(process.cwd())) !== (await realpath(frozen.workspace)) ||
    process.env.HOME !== frozen.home
  )
    throw Error("WORKER_LOCATION_MISMATCH");
  return runWorkerBootstrap({
    binding: frozen.binding,
    expiresAt: frozen.expiresAt,
    input: process.stdin,
    output: process.stdout,
    launch: async (input, output) => {
      const child = spawn(frozen.executable, frozen.args, {
        cwd: frozen.workspace,
        env: { PATH: "/usr/bin:/bin", HOME: frozen.home, LANG: "C" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      input.pipe(child.stdin);
      child.stdout.pipe(output, { end: false });
      child.stderr.pipe(process.stderr, { end: false });
      child.stdin.on("error", () => {
        input.unpipe(child.stdin);
      });
      const controllerGone = () => child.kill("SIGTERM");
      output.once("error", controllerGone);
      return new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => {
          output.off("error", controllerGone);
          resolve(code ?? 1);
        });
      });
    },
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2] || Buffer.byteLength(process.argv[2]) > 32768)
    throw Error("WORKER_CONFIG_REQUIRED");
  process.exitCode = await executeWorkerEntry(JSON.parse(process.argv[2]));
}

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { runWorkerBootstrap } from "../../src/worker-bootstrap.ts";
const [expiresAt, marker] = process.argv.slice(2);
if (!expiresAt || !marker) throw Error("fixture arguments");
process.exitCode = await runWorkerBootstrap({
  binding: { agentId: "agent-a", taskId: "task-a", runId: "run-a" },
  expiresAt: Number(expiresAt),
  input: process.stdin,
  output: process.stdout,
  launch: async (input, output) => {
    await writeFile(marker, String(process.pid), { flag: "wx" });
    const child = spawn("/usr/bin/cat", [], {
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
      stdio: ["pipe", "pipe", "inherit"],
    });
    input.pipe(child.stdin);
    child.stdout.pipe(output, { end: false });
    return new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
  },
});

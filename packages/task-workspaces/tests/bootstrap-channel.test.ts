import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { BootstrapChannel } from "../src/bootstrap-channel.ts";
test("real child cannot start provider before release and duplicate release never enters provider input", async (t) => {
  const root = await mkdtemp(join(homedir(), ".bootstrap-channel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = join(root, "provider-started"),
    expiresAt = Date.now() + 5000;
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./native/worker-bootstrap-fixture.js", import.meta.url)),
      String(expiresAt),
      marker,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGTERM");
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  const channel = new BootstrapChannel(
    child.stdin,
    child.stdout,
    { agentId: "agent-a", taskId: "task-a", runId: "run-a" },
    expiresAt,
  );
  const ready = await channel.ready();
  assert.equal(ready.pid, child.pid);
  assert.equal(ready.uid, process.getuid!());
  await assert.rejects(access(marker));
  assert.throws(() => channel.providerStreams(), /PROVIDER_NOT_RELEASED/);
  await channel.release("grant-a");
  await channel.release("grant-a");
  await assert.rejects(channel.release("grant-b"), /REUSED/);
  const streams = channel.providerStreams();
  streams.input.end("native-input\n");
  let output = "";
  for await (const chunk of streams.output) output += chunk.toString();
  assert.equal(await exited, 0);
  assert.equal(output, "native-input\n");
  assert.equal(await readFile(marker, "utf8"), String(ready.pid));
});

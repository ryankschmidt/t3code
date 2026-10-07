import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { bootstrapDigest, runWorkerBootstrap } from "../src/worker-bootstrap.ts";
const binding = { agentId: "agent-a", taskId: "task-a", runId: "run-a" };
test("provider is withheld until exact release and coalesced provider bytes survive", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  let text = "",
    launched = false;
  output.on("data", (b) => {
    text += b.toString();
  });
  const expiresAt = Date.now() + 5000;
  const run = runWorkerBootstrap({
    binding,
    expiresAt,
    input,
    output,
    launch: async (source, sink) => {
      launched = true;
      let received = "";
      for await (const b of source) received += b.toString();
      assert.equal(received, '{"method":"initialize"}\n');
      sink.write("provider-output\n");
      return 0;
    },
  });
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(launched, false);
  assert.match(text, /throughline.worker-ready.v1/);
  input.end(
    JSON.stringify({
      schema: "throughline.worker-release.v1",
      digest: bootstrapDigest(binding, expiresAt),
      grantId: "grant-a",
      expiresAt,
    }) + '\n{"method":"initialize"}\n',
  );
  assert.equal(await run, 0);
  assert.equal(launched, true);
  assert.match(text, /throughline.worker-released.v1/);
  assert.match(text, /provider-output/);
});
test("changed identity, extra authority fields, EOF and deadline never launch provider", async () => {
  for (const kind of ["changed", "extra", "eof", "timeout"]) {
    const input = new PassThrough(),
      output = new PassThrough();
    output.resume();
    let launched = false;
    const expiresAt = Date.now() + 5000;
    const run = runWorkerBootstrap({
      binding,
      expiresAt,
      input,
      output,
      timeoutMs: 15,
      launch: async () => {
        launched = true;
        return 0;
      },
    });
    const denied = assert.rejects(run);
    if (kind === "eof") input.end();
    else if (kind !== "timeout")
      input.end(
        JSON.stringify({
          schema: "throughline.worker-release.v1",
          digest: kind === "changed" ? "bad" : bootstrapDigest(binding, expiresAt),
          grantId: "grant-a",
          expiresAt,
          ...(kind === "extra" ? { uid: 0 } : {}),
        }) + "\n",
      );
    await denied;
    assert.equal(launched, false);
  }
});
test("binding digest is semantic and expired bootstrap refuses before ready", async () => {
  const expiresAt = Date.now() + 5000;
  assert.equal(
    bootstrapDigest(binding, expiresAt),
    bootstrapDigest({ runId: "run-a", taskId: "task-a", agentId: "agent-a" }, expiresAt),
  );
  const input = new PassThrough(),
    output = new PassThrough();
  let text = "";
  output.on("data", (b) => {
    text += b.toString();
  });
  await assert.rejects(
    runWorkerBootstrap({
      binding,
      expiresAt: Date.now() - 1,
      input,
      output,
      launch: async () => {
        throw Error("must not launch");
      },
    }),
  );
  assert.equal(text, "");
});

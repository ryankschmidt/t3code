import test from "node:test";
import assert from "node:assert/strict";
import { Readable, PassThrough, Writable } from "node:stream";
const url = new URL(
  `../src/publisher-connection${import.meta.url.endsWith(".ts") ? ".ts" : ".js"}`,
  import.meta.url,
).href;
async function fixture() {
  const m = (await import(url)) as {
    servePublisherConnection: (options: {
      input: Readable;
      output: Writable;
      environment: Record<string, string>;
      maxBytes: number;
      readTimeoutMs: number;
      dispatch: (
        peer: { uid: number; gid: number; pid: number },
        raw: Uint8Array,
      ) => Promise<unknown>;
    }) => Promise<void>;
  };
  let response = "",
    calls = 0;
  const output = new Writable({
    write(chunk, _encoding, done) {
      response += String(chunk);
      done();
    },
  });
  return {
    serve: m.servePublisherConnection,
    output,
    response: () => JSON.parse(response),
    calls: () => calls,
    dispatch: async (peer: { uid: number; gid: number; pid: number }, raw: Uint8Array) => {
      calls++;
      return { ok: true, peer, text: Buffer.from(raw).toString() };
    },
  };
}
const environment = {
  THROUGHL_PEER_UID: "1002",
  THROUGHL_PEER_GID: "1002",
  THROUGHL_PEER_PID: "20001",
};
test("connection passes only wrapper-supplied peer metadata and bounded bytes", async () => {
  const f = await fixture();
  await f.serve({
    input: Readable.from([Buffer.from('{"uid":0}')]),
    output: f.output,
    environment,
    maxBytes: 100,
    readTimeoutMs: 1000,
    dispatch: f.dispatch,
  });
  assert.equal(f.calls(), 1);
  assert.deepEqual(f.response().peer, { uid: 1002, gid: 1002, pid: 20001 });
});
test("oversized input cannot reach the dispatcher", async () => {
  const f = await fixture();
  await f.serve({
    input: Readable.from([Buffer.alloc(101)]),
    output: f.output,
    environment,
    maxBytes: 100,
    readTimeoutMs: 1000,
    dispatch: f.dispatch,
  });
  assert.equal(f.calls(), 0);
  assert.equal(f.response().ok, false);
});
test("missing native peer fields fail closed before dispatch", async () => {
  const f = await fixture();
  await f.serve({
    input: Readable.from([Buffer.from("{}")]),
    output: f.output,
    environment: { ...environment, THROUGHL_PEER_PID: "" },
    maxBytes: 100,
    readTimeoutMs: 1000,
    dispatch: f.dispatch,
  });
  assert.equal(f.calls(), 0);
  assert.equal(f.response().ok, false);
});
test("idle input has a bounded read deadline without authorizing an operation", async () => {
  const f = await fixture();
  const input = new PassThrough();
  await f.serve({
    input,
    output: f.output,
    environment,
    maxBytes: 100,
    readTimeoutMs: 25,
    dispatch: f.dispatch,
  });
  assert.equal(f.calls(), 0);
  assert.equal(f.response().error.code, "REQUEST_READ_TIMEOUT");
  input.destroy();
});

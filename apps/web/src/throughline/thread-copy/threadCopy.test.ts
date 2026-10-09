import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { copyThreadValue, threadCopyItems } from "./threadCopy.ts";

const ref = { environmentId: "tower", threadId: "thread-actual" };
const identity = {
  ...ref,
  session: { providerSessionId: "native-actual", nativeTranscriptPath: "/host/transcripts/actual.jsonl" },
};

describe("owning-host thread copy", () => {
  it("copies exact server-provided values without substituting native identity", async () => {
    for (const item of threadCopyItems(identity).filter((item) => item.value !== null)) {
      const written: string[] = [];
      const result = await copyThreadValue({
        ref, field: item.field,
        read: (requested) => {
          assert.deepEqual(requested, ref);
          return identity;
        },
        write: async (value) => { written.push(value); },
      });
      assert.equal(result, "copied");
      assert.deepEqual(written, [item.value]);
    }
  });

  it("never writes another environment's identity", async () => {
    const written: string[] = [];
    await assert.rejects(copyThreadValue({
      ref, field: "provider-session",
      read: () => ({ ...identity, environmentId: "mac" }),
      write: async (value) => { written.push(value); },
    }), /owning environment/);
    assert.deepEqual(written, []);
  });

  it("never substitutes a thread id or guessed path for absent native values", async () => {
    const absent = { ...ref, session: null };
    assert.deepEqual(threadCopyItems(absent).map((item) => item.value), [ref.threadId, null, null, null]);
    const written: string[] = [];
    assert.equal(await copyThreadValue({
      ref, field: "transcript", read: () => absent,
      write: async (value) => { written.push(value); },
    }), "unavailable");
    assert.deepEqual(written, []);
  });

  it("reports an unavailable thread without writing", async () => {
    assert.equal(await copyThreadValue({
      ref, field: "thread", read: () => null,
      write: async () => { throw new Error("must not write"); },
    }), "unavailable");
  });

  it("propagates clipboard failure rather than claiming a copy", async () => {
    await assert.rejects(copyThreadValue({
      ref, field: "thread", read: () => identity,
      write: async () => { throw new Error("clipboard refused"); },
    }), /clipboard refused/);
  });
});

it("never labels an opaque provider session as a native session", () => {
  assert.equal(threadCopyItems(identity).find((item) => item.field === "native-session")?.value, null);
});

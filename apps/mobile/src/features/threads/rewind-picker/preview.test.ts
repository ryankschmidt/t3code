import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { readableRewindPreview, rewindHistoryCoverage } from "./preview.ts";

describe("readable phone rewind picker", () => {
  it("hides transport metadata while preserving recognizable human text", () => {
    const original =
      'Fix the copy menu.\n<t3_context version="1">\nsecret transport ids\n</t3_context>\nKeep this sentence.';
    assert.equal(readableRewindPreview(original), "Fix the copy menu.\n\nKeep this sentence.");
    assert.ok(original.includes("secret transport ids"));
  });
  it("shows attachment names rather than raw image URLs", () => {
    assert.equal(
      readableRewindPreview("Review ![screen.png](http://host/image) please"),
      "Review [Attachment: screen.png] please",
    );
  });
  it("keeps ordinary text and whitespace within the prompt", () => {
    assert.equal(readableRewindPreview("  first line\nsecond line  "), "first line\nsecond line");
  });
  it("does not claim earliest-turn coverage when older history remains", () => {
    assert.equal(rewindHistoryCoverage({ hasMore: true, loadingOlder: false }), "more");
    assert.equal(rewindHistoryCoverage({ hasMore: true, loadingOlder: true }), "loading");
    assert.equal(rewindHistoryCoverage({ hasMore: false, loadingOlder: false }), "complete");
    assert.equal(rewindHistoryCoverage(null), "unknown");
  });
});

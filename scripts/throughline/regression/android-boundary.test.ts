import assert from "node:assert/strict";
import { test } from "node:test";
import { getLocalVoiceTranscriber } from "../../../apps/mobile/src/native/voiceTranscription.ts";

test("non-iOS native voice remains explicitly unavailable, not simulated transcription", () => {
  assert.equal(getLocalVoiceTranscriber(), null);
});

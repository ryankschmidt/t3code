import type { VoiceDraftSnapshot } from "@t3tools/client-runtime/voice-input";

export type VoiceUndo = {
  readonly ownerKey: string;
  readonly beforeText: string;
  readonly beforeSelection: { start: number; end: number };
  readonly afterText: string;
  readonly afterRevision: number;
  readonly rawTranscript: string;
};

export function createVoiceUndo(
  before: VoiceDraftSnapshot,
  afterText: string,
  rawTranscript: string,
): VoiceUndo {
  return {
    ownerKey: before.ownerKey,
    beforeText: before.text,
    beforeSelection: { ...before.selection },
    afterText,
    afterRevision: before.revision + (before.text === afterText ? 0 : 1),
    rawTranscript,
  };
}

export function restoreVoiceUndo(undo: VoiceUndo | null, current: VoiceDraftSnapshot | null) {
  if (
    !undo ||
    !current ||
    undo.ownerKey !== current.ownerKey ||
    undo.afterText !== current.text ||
    undo.afterRevision !== current.revision
  )
    return null;
  return {
    text: undo.beforeText,
    selection: { ...undo.beforeSelection },
    rawTranscript: undo.rawTranscript,
  };
}

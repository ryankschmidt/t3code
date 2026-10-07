import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { VoiceInputController, VoiceTranscriptionError } from "@t3tools/client-runtime/voice-input";
import {
  withMessageOptimizer,
  type VoiceOptimizationProvider,
  type OptimizerFetch,
} from "./messageOptimizer";

const raw = "um please fix the mobile voice input thanks";

function harness(provider: VoiceOptimizationProvider = "claude") {
  const fetcher = vi
    .fn<OptimizerFetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ optimized: "Please fix the mobile voice input." })),
    );
  const transcribe = vi.fn(async () => raw);
  const transcriber = withMessageOptimizer(
    { prepare: async () => ({ locale: "en-US", transcribe }) },
    () => provider,
    fetcher,
  );
  const commits: string[] = [];
  const draft = {
    ownerKey: "phone:thread",
    text: "",
    selection: { start: 0, end: 0 },
    revision: 1,
  };
  const controller = new VoiceInputController({
    recorder: {
      uri: "file:///voice.m4a",
      prepareToRecordAsync: async () => undefined,
      record: () => undefined,
      stop: async () => undefined,
    },
    getTranscriber: () => transcriber,
    requestPermission: async () => ({ granted: true, canAskAgain: true }),
    configureRecording: async () => undefined,
    releaseRecording: async () => undefined,
    deleteRecording: () => undefined,
    readDraft: () => draft,
    commitDraft: (text) => commits.push(text),
    onStateChange: () => undefined,
  });
  const dictate = async () => {
    await controller.start();
    await controller.stop();
  };
  return { fetcher, transcribe, transcriber, controller, commits, dictate };
}

afterEach(() => vi.useRealTimers());

describe("phone voice Message Optimizer", () => {
  it("commits optimized text after local transcription using the credential-free phone contract", async () => {
    const h = harness();
    await h.dictate();
    expect(h.commits).toEqual(["Please fix the mobile voice input."]);
    expect(h.transcribe).toHaveBeenCalledOnce();
    expect(h.fetcher).toHaveBeenCalledWith(
      "https://twr.tailec334b.ts.net:8443/optimize",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-message-optimizer-client": "clipboard-v1",
        },
        body: JSON.stringify({ text: raw, provider: "claude" }),
        credentials: "omit",
      }),
    );
  });

  it("sends the selected Codex provider", async () => {
    const h = harness("codex");
    await h.dictate();
    expect(JSON.parse(h.fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      text: raw,
      provider: "codex",
    });
  });

  it("Off commits the raw transcript without a network call", async () => {
    const h = harness("off");
    await h.dictate();
    expect(h.commits).toEqual([raw]);
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["HTTP error", () => new Response("failure", { status: 503 })],
    ["non-200 success", () => new Response("{}", { status: 202 })],
    ["empty optimization", () => new Response(JSON.stringify({ optimized: "  " }))],
    ["wrong result type", () => new Response(JSON.stringify({ optimized: 42 }))],
    ["missing result", () => new Response("{}")],
    ["malformed JSON", () => new Response("not json")],
  ])("%s commits the raw transcript", async (_name, response) => {
    const h = harness();
    h.fetcher.mockResolvedValue(response());
    await h.dictate();
    expect(h.commits).toEqual([raw]);
  });

  it("an offline device keeps the raw transcript byte-for-byte", async () => {
    const h = harness();
    h.transcribe.mockResolvedValue("  raw words\nunchanged  ");
    h.fetcher.mockRejectedValue(new TypeError("Network request failed"));
    const prepared = await h.transcriber.prepare({ signal: new AbortController().signal });
    await expect(
      prepared.transcribe("file:///voice.m4a", { signal: new AbortController().signal }),
    ).resolves.toBe("  raw words\nunchanged  ");
  });

  it("times out after 20 seconds even if fetch never settles, aborting the request", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.fetcher.mockImplementation(() => new Promise(() => {}));
    const prepared = await h.transcriber.prepare({ signal: new AbortController().signal });
    const result = prepared.transcribe("file:///voice.m4a", {
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(result).resolves.toBe(raw);
    expect(h.fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it("cancellation during optimization settles and does not commit into another thread", async () => {
    const h = harness();
    let entered!: () => void;
    const requestEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    h.fetcher.mockImplementation(() => {
      entered();
      return new Promise(() => {});
    });
    await h.controller.start();
    const stopping = h.controller.stop();
    await requestEntered;
    h.controller.ownerChanged();
    await stopping;
    expect(h.commits).toEqual([]);
    expect(h.fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it("local transcription errors remain errors and never call the optimizer", async () => {
    const h = harness();
    h.transcribe.mockRejectedValue(new VoiceTranscriptionError("transcription-failed", "Failed"));
    await h.dictate();
    expect(h.commits).toEqual([]);
    expect(h.fetcher).not.toHaveBeenCalled();
  });
});

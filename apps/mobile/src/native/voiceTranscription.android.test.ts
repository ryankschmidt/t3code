import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { VoiceTranscriptionError } from "@t3tools/client-runtime/voice-input";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const native = {
    isRecognitionAvailable: vi.fn(() => true),
    supportsOnDeviceRecognition: vi.fn(() => true),
    supportsRecording: vi.fn(() => true),
    getPermissionsAsync: vi.fn(async () => ({ granted: true })),
    requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
    getSupportedLocales: vi.fn(async () => ({ locales: ["en-US"], installedLocales: ["en-US"] })),
    start: vi.fn<(options: Record<string, unknown>) => void>(),
    abort: vi.fn(),
    addListener: vi.fn((kind: string, listener: (event: unknown) => void) => {
      const set = listeners.get(kind) ?? new Set();
      set.add(listener);
      listeners.set(kind, set);
      return {
        remove: () => {
          set.delete(listener);
          if (!set.size) listeners.delete(kind);
        },
      };
    }),
  };
  return {
    native,
    listeners,
    platform: { OS: "android", Version: 35 },
    requireModule: vi.fn((): typeof native | null => native),
    emit: (kind: string, event: unknown = null) => {
      for (const listener of listeners.get(kind) ?? []) listener(event);
    },
  };
});
vi.mock("expo", () => ({ requireOptionalNativeModule: mocks.requireModule }));
vi.mock("react-native", () => ({ Platform: mocks.platform }));
import { getLocalVoiceTranscriber } from "./voiceTranscription.android";

beforeEach(() => {
  vi.resetAllMocks();
  const locale = Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...locale,
    locale: "en-US",
  });
  mocks.listeners.clear();
  mocks.platform.Version = 35;
  mocks.requireModule.mockReturnValue(mocks.native);
  mocks.native.isRecognitionAvailable.mockReturnValue(true);
  mocks.native.supportsOnDeviceRecognition.mockReturnValue(true);
  mocks.native.supportsRecording.mockReturnValue(true);
  mocks.native.getPermissionsAsync.mockResolvedValue({ granted: true });
  mocks.native.requestPermissionsAsync.mockResolvedValue({ granted: true });
  mocks.native.getSupportedLocales.mockResolvedValue({
    locales: ["en-US"],
    installedLocales: ["en-US"],
  });
});
afterEach(() => vi.restoreAllMocks());

describe("Android recorded-file voice adapter", () => {
  it("is unavailable on pre-13 devices, missing native clients, or absent on-device recognition", () => {
    mocks.platform.Version = 32;
    expect(getLocalVoiceTranscriber()).toBeNull();
    mocks.platform.Version = 35;
    mocks.requireModule.mockReturnValueOnce(null);
    expect(getLocalVoiceTranscriber()).toBeNull();
    mocks.native.supportsOnDeviceRecognition.mockReturnValue(false);
    expect(getLocalVoiceTranscriber()).toBeNull();
  });
  it("transcribes the recorded URI locally, retains newlines, and settles only at native end", async () => {
    const options = { signal: new AbortController().signal };
    const prepared = await getLocalVoiceTranscriber()!.prepare(options);
    const settled = vi.fn();
    const pending = prepared.transcribe("file:///voice.m4a", options).then((text) => {
      settled(text);
      return text;
    });
    expect(mocks.native.start).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: "en-US",
        requiresOnDeviceRecognition: true,
        audioSource: expect.objectContaining({ uri: "file:///voice.m4a" }),
      }),
    );
    mocks.emit("result", { isFinal: true, results: [{ transcript: "raw\ntranscript" }] });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    mocks.emit("end");
    await expect(pending).resolves.toBe("raw\ntranscript");
    expect(mocks.listeners.size).toBe(0);
  });
  it("cancels native work but waits for end before settling cancellation", async () => {
    const controller = new AbortController(),
      options = { signal: controller.signal };
    const prepared = await getLocalVoiceTranscriber()!.prepare(options);
    const settled = vi.fn((error: unknown) => error);
    const pending = prepared.transcribe("file:///voice.m4a", options).catch(settled);
    controller.abort();
    expect(mocks.native.abort).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    mocks.emit("result", { isFinal: true, results: [{ transcript: "must not commit" }] });
    mocks.emit("end");
    expect(await pending).toMatchObject({ code: "cancelled" });
    expect(mocks.listeners.size).toBe(0);
  });
  it("refuses a second native job until the first ends", async () => {
    const options = { signal: new AbortController().signal };
    const prepared = await getLocalVoiceTranscriber()!.prepare(options);
    const first = prepared.transcribe("file:///one.m4a", options);
    await expect(prepared.transcribe("file:///two.m4a", options)).rejects.toThrow(
      "finishing another recording",
    );
    expect(mocks.native.start).toHaveBeenCalledOnce();
    mocks.emit("result", { isFinal: true, results: [{ transcript: "first" }] });
    mocks.emit("end");
    await expect(first).resolves.toBe("first");
  });
  it("does not send audio to a cloud service when the offline locale is absent", async () => {
    mocks.native.getSupportedLocales.mockResolvedValue({
      locales: ["en-US"],
      installedLocales: [],
    });
    await expect(
      getLocalVoiceTranscriber()!.prepare({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "unsupported-locale" });
    expect(mocks.native.start).not.toHaveBeenCalled();
  });
  it("reports permission denial without starting recognition", async () => {
    mocks.native.getPermissionsAsync.mockResolvedValue({ granted: false });
    mocks.native.requestPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(
      getLocalVoiceTranscriber()!.prepare({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "preparation-failed" });
    expect(mocks.native.start).not.toHaveBeenCalled();
  });
  it("keeps native failures explicit and removes listeners at end", async () => {
    const options = { signal: new AbortController().signal };
    const prepared = await getLocalVoiceTranscriber()!.prepare(options);
    const pending = prepared
      .transcribe("file:///voice.m4a", options)
      .catch((error: unknown) => error);
    mocks.emit("error", { error: "audio-capture", message: "Decoder failed" });
    mocks.emit("end");
    expect(await pending).toBeInstanceOf(VoiceTranscriptionError);
    expect(await pending).toMatchObject({ code: "transcription-failed" });
    expect(mocks.listeners.size).toBe(0);
  });
});

import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type VoiceTranscriber,
  type VoiceTranscriptionOptions,
} from "@t3tools/client-runtime/voice-input";

type SpeechModule = typeof import("expo-speech-recognition").ExpoSpeechRecognitionModule;
let recognizing = false;

export function getLocalVoiceTranscriber(): VoiceTranscriber | null {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return null;
  // A previously installed native client must remain loadable until rebuilt.
  const speech = requireOptionalNativeModule<SpeechModule>("ExpoSpeechRecognition");
  if (
    !speech ||
    !speech.isRecognitionAvailable() ||
    !speech.supportsOnDeviceRecognition() ||
    !speech.supportsRecording()
  )
    return null;
  const deviceLocale = Intl.DateTimeFormat().resolvedOptions().locale;
  return {
    prepare: async (options) => {
      const { signal } = options;
      throwIfVoiceTranscriptionAborted(signal);
      try {
        let permission = await speech.getPermissionsAsync();
        throwIfVoiceTranscriptionAborted(signal);
        if (!permission.granted) {
          permission = await speech.requestPermissionsAsync();
          throwIfVoiceTranscriptionAborted(signal);
        }
        if (!permission.granted)
          throw new VoiceTranscriptionError(
            "preparation-failed",
            "Microphone permission was denied.",
          );
        const supported = await speech.getSupportedLocales({
          androidRecognitionServicePackage: "com.google.android.as",
        });
        throwIfVoiceTranscriptionAborted(signal);
        const wanted = deviceLocale.replaceAll("_", "-").toLowerCase();
        const locale =
          supported.installedLocales.find((locale) => locale.toLowerCase() === wanted) ??
          supported.installedLocales.find(
            (locale) => locale.toLowerCase().split("-")[0] === wanted.split("-")[0],
          );
        if (!locale)
          throw new VoiceTranscriptionError(
            "unsupported-locale",
            `Install an offline Android speech model for ${deviceLocale} before dictating.`,
          );
        return {
          locale,
          transcribe: (uri, options) => transcribeRecording(speech, locale, uri, options),
        };
      } catch (cause) {
        throwIfVoiceTranscriptionAborted(signal);
        if (cause instanceof VoiceTranscriptionError) throw cause;
        throw new VoiceTranscriptionError(
          "preparation-failed",
          "Android speech recognition could not prepare this language.",
          { cause },
        );
      }
    },
  };
}

function transcribeRecording(
  speech: SpeechModule,
  locale: string,
  uri: string,
  { signal }: VoiceTranscriptionOptions,
): Promise<string> {
  throwIfVoiceTranscriptionAborted(signal);
  if (recognizing)
    return Promise.reject(
      new VoiceTranscriptionError(
        "transcription-failed",
        "Android speech recognition is finishing another recording.",
      ),
    );
  recognizing = true;
  return new Promise((resolve, reject) => {
    let settled = false;
    let failure: VoiceTranscriptionError | null = null;
    const fragments: string[] = [];
    const subscriptions: Array<{ remove: () => void }> = [];
    const finish = () => {
      if (settled) return;
      settled = true;
      for (const subscription of subscriptions) subscription.remove();
      signal.removeEventListener("abort", abort);
      recognizing = false;
      if (signal.aborted) {
        reject(new VoiceTranscriptionError("cancelled", "Voice transcription was cancelled."));
      } else if (failure) {
        reject(failure);
      } else {
        const text = fragments.join(" ").trim();
        if (text) resolve(text);
        else
          reject(
            new VoiceTranscriptionError(
              "transcription-failed",
              "No speech was recognized; the original draft was kept.",
            ),
          );
      }
    };
    const abort = () => {
      try {
        speech.abort();
      } catch (cause) {
        failure = new VoiceTranscriptionError(
          "cancelled",
          "Android speech cancellation failed; waiting for native end.",
          { cause },
        );
      }
      // Keep the native lease and listeners until end; a late result cannot
      // become another recording's transcript or release its file early.
    };
    try {
      subscriptions.push(
        speech.addListener("result", (event) => {
          if (!signal.aborted && event.isFinal && event.results[0]?.transcript)
            fragments.push(event.results[0].transcript);
        }),
      );
      subscriptions.push(
        speech.addListener("error", (event) => {
          failure = new VoiceTranscriptionError(
            event.error === "aborted" ? "cancelled" : "transcription-failed",
            event.message || "Android transcription failed.",
          );
        }),
      );
      subscriptions.push(speech.addListener("end", finish));
      signal.addEventListener("abort", abort, { once: true });
      throwIfVoiceTranscriptionAborted(signal);
      speech.start({
        lang: locale,
        interimResults: false,
        continuous: false,
        requiresOnDeviceRecognition: true,
        // Expo Audio HIGH_QUALITY records stereo, 44.1kHz M4A. The native
        // file decoder feeds PCM to the recognizer; no microphone/cloud fallback.
        audioSource: { uri, audioChannels: 2, sampleRate: 44100 },
      });
    } catch (cause) {
      failure =
        cause instanceof VoiceTranscriptionError
          ? cause
          : new VoiceTranscriptionError(
              "transcription-failed",
              "Android transcription could not start.",
              { cause },
            );
      finish();
    }
  });
}

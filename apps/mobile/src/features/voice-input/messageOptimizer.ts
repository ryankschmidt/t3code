import {
  throwIfVoiceTranscriptionAborted,
  VoiceTranscriptionError,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";

export type VoiceOptimizationProvider = "claude" | "codex" | "off";
export type OptimizerFetch = (url: string, options: RequestInit) => Promise<Response>;
export type VoiceOptimizationResult =
  | { readonly text: string; readonly outcome: "optimized"; readonly reason: null }
  | { readonly text: string; readonly outcome: "original-kept"; readonly reason: string };

const originalKept = (text: string, reason: string): VoiceOptimizationResult => ({
  text,
  outcome: "original-kept",
  reason,
});

export function withMessageOptimizer(
  transcriber: VoiceTranscriber,
  getProvider: () => VoiceOptimizationProvider,
  fetcher: OptimizerFetch = fetch,
  onOutcome?: (result: VoiceOptimizationResult) => void,
): VoiceTranscriber {
  return {
    prepare: async (options) => {
      const prepared = await transcriber.prepare(options);
      return {
        locale: prepared.locale,
        transcribe: async (uri, options) => {
          const raw = await prepared.transcribe(uri, options);
          throwIfVoiceTranscriptionAborted(options.signal);
          const provider = getProvider();
          const result = await optimizeTranscript(raw, provider, options.signal, fetcher);
          throwIfVoiceTranscriptionAborted(options.signal);
          onOutcome?.(result);
          // Preserve the shared VoiceTranscriber text contract; the mobile owner
          // receives the richer outcome separately and publishes it on draft commit.
          return result.text;
        },
      };
    },
  };
}

export async function optimizeTranscript(
  raw: string,
  provider: VoiceOptimizationProvider,
  signal: AbortSignal,
  fetcher: OptimizerFetch = fetch,
): Promise<VoiceOptimizationResult> {
  throwIfVoiceTranscriptionAborted(signal);
  if (provider === "off") return originalKept(raw, "Off");
  if (!raw.trim()) return originalKept(raw, "Empty transcript");
  const request = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  // Race explicitly: a stalled native fetch or response body must not keep the
  // composer frozen, even if the network implementation ignores abort().
  const interrupted = new Promise<VoiceOptimizationResult>((resolve, reject) => {
    onAbort = () => {
      request.abort();
      reject(new VoiceTranscriptionError("cancelled", "Voice transcription was cancelled."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      resolve(originalKept(raw, "Timeout"));
      request.abort();
    }, 20_000);
  });
  try {
    const optimized = (async () => {
      try {
        const response = await fetcher("https://twr.tailec334b.ts.net:8443/optimize", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-message-optimizer-client": "clipboard-v1",
          },
          body: JSON.stringify({ text: raw, provider }),
          credentials: "omit",
          signal: request.signal,
        });
        if (response.status !== 200) return originalKept(raw, `HTTP ${response.status}`);
        const result: unknown = await response.json();
        return typeof result === "object" &&
          result !== null &&
          "optimized" in result &&
          typeof result.optimized === "string" &&
          result.optimized.trim()
          ? { text: result.optimized, outcome: "optimized" as const, reason: null }
          : originalKept(raw, "Invalid response");
      } catch {
        return originalKept(raw, "Request failed");
      }
    })();
    const result = await Promise.race([optimized, interrupted]);
    throwIfVoiceTranscriptionAborted(signal);
    return result;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
    request.abort();
  }
}

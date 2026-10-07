import {
  throwIfVoiceTranscriptionAborted,
  VoiceTranscriptionError,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";

export type VoiceOptimizationProvider = "claude" | "codex" | "off";
export type OptimizerFetch = (url: string, options: RequestInit) => Promise<Response>;

export function withMessageOptimizer(
  transcriber: VoiceTranscriber,
  getProvider: () => VoiceOptimizationProvider,
  fetcher: OptimizerFetch = fetch,
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
          if (provider === "off" || !raw.trim()) return raw;
          return optimizeTranscript(raw, provider, options.signal, fetcher);
        },
      };
    },
  };
}

async function optimizeTranscript(
  raw: string,
  provider: Exclude<VoiceOptimizationProvider, "off">,
  signal: AbortSignal,
  fetcher: OptimizerFetch,
): Promise<string> {
  const request = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  // Race explicitly: a stalled native fetch or response body must not keep the
  // composer frozen, even if the network implementation ignores abort().
  const interrupted = new Promise<string>((resolve, reject) => {
    onAbort = () => {
      request.abort();
      reject(new VoiceTranscriptionError("cancelled", "Voice transcription was cancelled."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      request.abort();
      resolve(raw);
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
        if (response.status !== 200) return raw;
        const result: unknown = await response.json();
        return typeof result === "object" &&
          result !== null &&
          "optimized" in result &&
          typeof result.optimized === "string" &&
          result.optimized.trim()
          ? result.optimized
          : raw;
      } catch {
        return raw;
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

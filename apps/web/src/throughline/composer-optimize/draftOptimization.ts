export type DraftSnapshot = { owner: string; text: string; revision: number };
export type OptimizationProvider = "claude" | "codex" | "off";
export type OptimizationState = {
  phase: "idle" | "optimizing" | "optimized" | "original-kept" | "stale" | "cancelled" | "undone";
  raw: string;
  reason: string | null;
  canUndo: boolean;
};
type Ports = {
  read: () => DraftSnapshot;
  write: (text: string, cursor: number) => void;
  request?: (text: string, provider: "claude" | "codex", signal: AbortSignal) => Promise<string>;
  onState?: (state: OptimizationState) => void;
};

export class ComposerOptimization {
  state: OptimizationState = { phase: "idle", raw: "", reason: null, canUndo: false };
  private readonly listeners = new Set<() => void>();
  private activeOwner: string | null = null;
  private pending: AbortController | null = null;
  private generation = 0;
  private reversal: { original: DraftSnapshot; applied: DraftSnapshot } | null = null;
  constructor(private ports: Ports) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  rebind(ports: Ports): void {
    this.ports = ports;
    const owner = ports.read().owner;
    if (this.activeOwner !== null && this.activeOwner !== owner) {
      this.cancel();
      this.publish("idle", "");
    } else if (this.state.canUndo !== this.canUndo()) {
      this.publish("stale", this.state.raw, "Draft changed; original kept");
    }
    this.activeOwner = owner;
  }

  private publish(
    phase: OptimizationState["phase"],
    raw: string,
    reason: string | null = null,
  ): void {
    this.state = { phase, raw, reason, canUndo: this.canUndo() };
    this.ports.onState?.(this.state);
    for (const listener of this.listeners) listener();
  }

  async optimize(
    provider: OptimizationProvider,
    selection?: { start: number; end: number },
  ): Promise<void> {
    this.pending?.abort();
    const generation = ++this.generation;
    this.reversal = null;
    const original = { ...this.ports.read() };
    this.activeOwner = original.owner;
    const range =
      selection && selection.start !== selection.end
        ? selection
        : { start: 0, end: original.text.length };
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.end > original.text.length
    ) {
      this.publish("original-kept", original.text, "Invalid selection");
      return;
    }
    const raw = original.text.slice(range.start, range.end);
    if (provider === "off" || !raw.trim()) {
      this.publish("original-kept", raw, provider === "off" ? "Off" : "Empty draft");
      return;
    }
    const pending = new AbortController();
    this.pending = pending;
    this.publish("optimizing", raw);
    try {
      const optimized = await (this.ports.request ?? requestOptimization)(
        raw,
        provider,
        pending.signal,
      );
      if (generation !== this.generation || pending.signal.aborted) return;
      if (!sameDraft(original, this.ports.read())) {
        this.publish("stale", raw, "Draft changed; original kept");
        return;
      }
      if (!optimized.trim()) throw new Error("Invalid optimizer response");
      const text = original.text.slice(0, range.start) + optimized + original.text.slice(range.end);
      this.ports.write(text, range.start + optimized.length);
      this.reversal = { original, applied: { ...this.ports.read() } };
      this.publish("optimized", raw);
    } catch (error) {
      if (generation !== this.generation || pending.signal.aborted) return;
      this.publish("original-kept", raw, error instanceof Error ? error.message : "Request failed");
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  canUndo(): boolean {
    return this.reversal !== null && sameDraft(this.reversal.applied, this.ports.read());
  }

  undo(): boolean {
    if (!this.reversal || !this.canUndo()) return false;
    const { original } = this.reversal;
    this.reversal = null;
    this.ports.write(original.text, original.text.length);
    this.publish("undone", this.state.raw);
    return true;
  }

  cancel(): void {
    ++this.generation;
    this.pending?.abort();
    this.pending = null;
    this.reversal = null;
    this.publish("cancelled", this.state.raw);
  }
}

function sameDraft(a: DraftSnapshot, b: DraftSnapshot): boolean {
  return a.owner === b.owner && a.text === b.text && a.revision === b.revision;
}

export async function requestOptimization(
  text: string,
  provider: "claude" | "codex",
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  signal.throwIfAborted();
  const request = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => {
      request.abort();
      reject(new Error("Cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      request.abort();
      reject(new Error("Timeout; original kept"));
    }, 20_000);
  });
  try {
    const response = (async () => {
      const response = await fetcher("https://twr.tailec334b.ts.net:8443/optimize", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-message-optimizer-client": "clipboard-v1",
        },
        body: JSON.stringify({ text, provider }),
        credentials: "omit",
        signal: request.signal,
      });
      if (response.status !== 200) throw new Error(`HTTP ${response.status}; original kept`);
      const result: unknown = await response.json();
      if (
        typeof result !== "object" ||
        result === null ||
        !("optimized" in result) ||
        typeof result.optimized !== "string" ||
        !result.optimized.trim()
      ) {
        throw new Error("Invalid optimizer response");
      }
      return result.optimized;
    })();
    const optimizedText = await Promise.race([response, interrupted]);
    signal.throwIfAborted();
    return optimizedText;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    request.abort();
  }
}

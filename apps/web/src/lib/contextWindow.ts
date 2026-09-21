// ThroughLine: the context window readout is shared, not a web-only feature.
//
// This derivation used to live here, inside apps/web, which is why the phone had no context
// meter — the numbers it needs were on the desktop's side of the rail. It moved to
// @t3tools/client-runtime, the layer web and mobile already share, and this file stays as a
// re-export so the web call sites do not move.
export {
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
  type ContextWindowSnapshot,
} from "@t3tools/client-runtime/context-window";

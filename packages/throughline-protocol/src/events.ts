export type DecodedEvent =
  | { readonly kind: "known"; readonly event: unknown; readonly raw: unknown }
  | { readonly kind: "preserved-unknown"; readonly raw: unknown }
  | { readonly kind: "invalid-known"; readonly raw: unknown; readonly cause: unknown };

/** Only known, successfully decoded events can reach a reducer. Keep the wire
 * value too: a strict decoder may discard fields introduced by a newer server. */
export function decodeEvent(
  raw: unknown,
  decoders: Readonly<Record<string, (raw: unknown) => unknown>>,
): DecodedEvent {
  if (raw === null || typeof raw !== "object" || !("type" in raw) || typeof raw.type !== "string") {
    return { kind: "preserved-unknown", raw };
  }
  if (!Object.hasOwn(decoders, raw.type)) return { kind: "preserved-unknown", raw };
  const decoder = decoders[raw.type];
  if (decoder === undefined) return { kind: "preserved-unknown", raw };
  try {
    return { kind: "known", event: decoder(raw), raw };
  } catch (cause) {
    return { kind: "invalid-known", raw, cause };
  }
}

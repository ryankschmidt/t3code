export interface ComsNetTurnMessage {
  readonly turnId: string | null;
  readonly role: string;
  readonly text: string;
}

const REQUEST_MARKER = /<!-- comsnet-request:([0-9a-f-]{36}) -->/i;

/**
 * A turn is correlated only when exactly one user message in that turn carries
 * exactly one immutable ComsNet request marker. Ambiguity fails closed.
 */
export function requestIdForFinishedTurn(
  messages: ReadonlyArray<ComsNetTurnMessage>,
  turnId: string,
): string | undefined {
  const matches = requestIdsForTurn(messages, turnId);
  return matches.length === 1 ? matches[0] : undefined;
}

export function requestIdsForTurn(
  messages: ReadonlyArray<ComsNetTurnMessage>,
  turnId: string,
): ReadonlyArray<string> {
  return messages
    .filter((message) => message.turnId === turnId && message.role === "user")
    .flatMap((message) => [...message.text.matchAll(new RegExp(REQUEST_MARKER, "gi"))])
    .map((match) => match[1])
    .filter((requestId): requestId is string => requestId !== undefined);
}

import { expect, it } from "@effect/vitest";

import { requestIdForFinishedTurn, requestIdsForTurn } from "./ComsNetCorrelation.ts";

const requestId = "123e4567-e89b-12d3-a456-426614174000";

it("correlates one finished turn to exactly one immutable ComsNet request", () => {
  expect(
    requestIdForFinishedTurn(
      [
        {
          turnId: "turn-1",
          role: "user",
          text: `<!-- comsnet-request:${requestId} -->\nDo the work.`,
        },
        { turnId: "turn-1", role: "assistant", text: "Done." },
      ],
      "turn-1",
    ),
  ).toBe(requestId);
});

it("fails closed when a turn is unmarked, marked for another turn, or ambiguous", () => {
  expect(
    requestIdForFinishedTurn([{ turnId: "turn-1", role: "user", text: "ordinary" }], "turn-1"),
  ).toBeUndefined();
  expect(
    requestIdForFinishedTurn(
      [{ turnId: "turn-2", role: "user", text: `<!-- comsnet-request:${requestId} -->` }],
      "turn-1",
    ),
  ).toBeUndefined();
  expect(
    requestIdForFinishedTurn(
      [
        {
          turnId: "turn-1",
          role: "user",
          text: `<!-- comsnet-request:${requestId} --><!-- comsnet-request:${requestId} -->`,
        },
      ],
      "turn-1",
    ),
  ).toBeUndefined();
});

it("preserves every marker so an ambiguous turn can fail all correlated requests", () => {
  const secondRequestId = "223e4567-e89b-12d3-a456-426614174000";
  expect(
    requestIdsForTurn(
      [
        { turnId: "turn-1", role: "user", text: `<!-- comsnet-request:${requestId} -->` },
        { turnId: "turn-1", role: "user", text: `<!-- comsnet-request:${secondRequestId} -->` },
      ],
      "turn-1",
    ),
  ).toEqual([requestId, secondRequestId]);
});

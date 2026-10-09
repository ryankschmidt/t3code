import * as NodeAssert from "node:assert";
import * as NodeTest from "node:test";
import { decodeEvent } from "./events.ts";

NodeTest.test("an unknown future event is retained, never dispatched as a known event", () => {
  const raw = { type: "future.voice", payload: { text: "keep voice text" }, future: 8 };
  const result = decodeEvent(raw, {});
  NodeAssert.strict.equal(result.kind, "preserved-unknown");
  NodeAssert.strict.equal(result.raw, raw);
});

NodeTest.test(
  "a known decoder may strip fields but the full original event remains available",
  () => {
    const raw = { type: "known", payload: { text: "keep" }, future: { enabled: true } };
    const result = decodeEvent(raw, { known: () => ({ type: "known" }) });
    NodeAssert.strict.equal(result.kind, "known");
    NodeAssert.strict.equal(result.raw, raw);
    if (result.kind === "known") NodeAssert.strict.deepEqual(result.event, { type: "known" });
  },
);

NodeTest.test("a malformed known event remains invalid, not silently accepted as unknown", () => {
  const raw = { type: "known", payload: null };
  const result = decodeEvent(raw, {
    known: () => {
      throw new Error("invalid known payload");
    },
  });
  NodeAssert.strict.equal(result.kind, "invalid-known");
  NodeAssert.strict.equal(result.raw, raw);
});

NodeTest.test("prototype property names cannot select a decoder", () => {
  for (const type of ["constructor", "toString", "__proto__"]) {
    NodeAssert.strict.equal(decodeEvent({ type }, {}).kind, "preserved-unknown");
  }
});

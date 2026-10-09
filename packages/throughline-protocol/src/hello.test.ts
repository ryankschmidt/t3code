import * as NodeAssert from "node:assert";
import * as NodeTest from "node:test";
import { existingTransportPolicy, negotiateHello } from "./hello.ts";

const client = {
  protocol_version: 1,
  release: "0.0.50",
  commit: "fixture",
  platform: "ios",
  capabilities: ["environmentThemes"],
  last_cursor: 4,
};

NodeTest.test("a client below an explicit supported release floor must update", () => {
  const policy = { ...existingTransportPolicy("0.0.52"), min_supported_client: "0.0.51" };
  NodeAssert.strict.equal(negotiateHello(client, policy).outcome, "update-required");
});

NodeTest.test("a numeric release comparison does not confuse 0.0.9 with 0.0.10", () => {
  const policy = { ...existingTransportPolicy("0.0.52"), min_supported_client: "0.0.10" };
  NodeAssert.strict.equal(
    negotiateHello({ ...client, release: "0.0.9" }, policy).outcome,
    "update-required",
  );
});

NodeTest.test("a prerelease is below the stable release, build metadata is not", () => {
  const policy = { ...existingTransportPolicy("0.0.52"), min_supported_client: "0.0.51" };
  NodeAssert.strict.equal(
    negotiateHello({ ...client, release: "0.0.51-rc.1" }, policy).outcome,
    "update-required",
  );
  NodeAssert.strict.equal(
    negotiateHello({ ...client, release: "0.0.51+build.1" }, policy).outcome,
    "compatible",
  );
});

NodeTest.test(
  "the legacy floor stays permissive and duplicate capabilities do not cause degradation",
  () => {
    NodeAssert.strict.equal(
      negotiateHello(
        { ...client, capabilities: ["environmentThemes", "environmentThemes"] },
        existingTransportPolicy("0.0.52"),
      ).outcome,
      "compatible",
    );
  },
);

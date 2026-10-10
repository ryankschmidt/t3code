import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  WsSubscribeServerConfigRpc,
  WsThroughlineHelloRpc,
  WS_METHODS,
  WsRpcGroup,
} from "./rpc.ts";

/**
 * The client always sends `environmentThemes`, including to servers built
 * before the field existed, whose payload schema was an empty struct. What
 * makes that safe is that such a schema accepts the request rather than
 * rejecting it -- an error here would take down the config subscription.
 */
describe("subscribeServerConfig payload compatibility", () => {
  it("is accepted by a server whose schema predates the field", () => {
    const oldServerPayload = Schema.Struct({});
    const decoded = Schema.decodeExit(oldServerPayload)({ environmentThemes: true });
    expect(Exit.isSuccess(decoded)).toBe(true);
  });

  it("is carried by a server that declares it", () => {
    const decoded = Schema.decodeSync(WsSubscribeServerConfigRpc.payloadSchema)({
      environmentThemes: true,
    });
    expect(decoded).toEqual({ environmentThemes: true });
  });

  it("stays optional, so a client that never sends it still subscribes", () => {
    const decoded = Schema.decodeSync(WsSubscribeServerConfigRpc.payloadSchema)({});
    expect(decoded).toEqual({});
  });
});

describe("ThroughLine hello registry", () => {
  it("registers the optional negotiation without replacing legacy config", () => {
    expect(WsRpcGroup.requests.has(WS_METHODS.throughlineHello)).toBe(true);
    expect(WsRpcGroup.requests.has(WS_METHODS.subscribeServerConfig)).toBe(true);
    expect(Schema.decodeSync(WsSubscribeServerConfigRpc.payloadSchema)({})).toEqual({});
  });

  it("accepts future request fields but rejects invalid cursor and protocol values", () => {
    const client = {
      protocol_version: 1,
      release: "0.0.50",
      commit: "fixture",
      platform: "ios",
      capabilities: ["environmentThemes"],
      last_cursor: 9,
    };
    expect(
      Exit.isSuccess(
        Schema.decodeUnknownExit(WsThroughlineHelloRpc.payloadSchema)({
          ...client,
          future_field: "ignored by this server",
        }),
      ),
    ).toBe(true);
    for (const invalid of [{ last_cursor: -1 }, { protocol_version: 1.5 }]) {
      expect(
        Exit.isFailure(
          Schema.decodeUnknownExit(WsThroughlineHelloRpc.payloadSchema)({
            ...client,
            ...invalid,
          }),
        ),
      ).toBe(true);
    }
  });
});

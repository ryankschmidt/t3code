import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/unstable/ai";

import {
  ComsNetPeersTool,
  ComsNetResultTool,
  ComsNetSendTool,
  ComsNetStatusTool,
  ComsNetSubscribeTool,
} from "./tools.ts";

it("exposes the first-class ComsNet contract and no shared credential input", () => {
  const tools = [
    ComsNetPeersTool,
    ComsNetSendTool,
    ComsNetSubscribeTool,
    ComsNetStatusTool,
    ComsNetResultTool,
  ];
  expect(tools.map((tool) => tool.name)).toEqual([
    "comsnet_peers",
    "comsnet_send",
    "comsnet_subscribe",
    "comsnet_status",
    "comsnet_result",
  ]);
  const schemas = tools.map((tool) => JSON.stringify(Tool.getJsonSchema(tool)).toLowerCase());
  for (const schema of schemas) {
    expect(schema).not.toContain("senderpeerid");
    expect(schema).not.toContain("bearer");
    expect(schema).not.toContain("token");
    expect(schema).not.toContain("secret");
  }
});

it("marks only genuine reads as read-only and exposes send/subscribe side effects", () => {
  expect(Context.get(ComsNetPeersTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(ComsNetSubscribeTool.annotations, Tool.Readonly)).toBe(false);
  expect(Context.get(ComsNetSubscribeTool.annotations, Tool.Idempotent)).toBe(false);
  expect(Context.get(ComsNetStatusTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(ComsNetSendTool.annotations, Tool.Readonly)).toBe(false);
  expect(Context.get(ComsNetSendTool.annotations, Tool.Destructive)).toBe(true);
  expect(Context.get(ComsNetSendTool.annotations, Tool.Idempotent)).toBe(false);
  expect(Context.get(ComsNetResultTool.annotations, Tool.Readonly)).toBe(false);
});

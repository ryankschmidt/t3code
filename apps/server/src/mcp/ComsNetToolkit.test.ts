import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer, Tool } from "effect/unstable/ai";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as Transport from "./ComsNetTransport.ts";
import { ComsNetToolkitRegistrationLive } from "./McpHttpServer.ts";
import * as Invocation from "./McpInvocationContext.ts";
import * as ProviderSession from "./McpProviderSession.ts";
import { ComsNetToolkit } from "./toolkits/comsnet/tools.ts";

const environmentId = EnvironmentId.make("comsnet-response-test");
const providerInstanceId = ProviderInstanceId.make("codex");
const scope = (name: string): Invocation.McpInvocationScope => ({
  environmentId,
  providerInstanceId,
  threadId: ThreadId.make(`thread-${name}`),
  providerSessionId: `mcp-${name}`,
  capabilities: new Set(["comsnet"]),
  issuedAt: 1,
});
const sender = scope("a");
const receiver = scope("b");
const snapshot = {
  projects: [{ id: ProjectId.make("project"), workspaceRoot: "/workspace" }],
  threads: [sender, receiver].map((seat) => ({
    id: seat.threadId,
    projectId: ProjectId.make("project"),
    worktreePath: null,
    runtimeMode: "full-access",
    interactionMode: "default",
    session: {
      providerName: "codex",
      providerInstanceId,
      status: "running",
      activeTurnId: TurnId.make("turn-b"),
    },
  })),
} as unknown as OrchestrationShellSnapshot;
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "comsnet-regression", version: "1" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "comsnet-regression", version: "1" },
  },
  getClient: Effect.die("unused"),
});
const projection = Layer.mock(ProjectionSnapshotQuery)({
  getShellSnapshot: () => Effect.succeed(snapshot),
  getThreadShellById: (id) =>
    Effect.succeed(Option.fromUndefinedOr(snapshot.threads.find((thread) => thread.id === id))),
});
const makeTestLayer = (transportLayer = Transport.layer) =>
  ComsNetToolkitRegistrationLive.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provideMerge(transportLayer),
    Layer.provideMerge(projection),
    Layer.provide(
      Layer.mock(OrchestrationEngineService)({ dispatch: () => Effect.succeed({ sequence: 1 }) }),
    ),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "comsnet-response-test-" })),
    Layer.provide(NodeServices.layer),
  );
const TestLayer = makeTestLayer();
const sessions = Effect.acquireRelease(
  Effect.sync(() => {
    for (const seat of [sender, receiver])
      ProviderSession.setMcpProviderSession({
        ...seat,
        endpoint: "http://localhost/mcp",
        authorizationHeader: "Bearer fixture-only",
      });
  }),
  () =>
    Effect.sync(() => {
      for (const seat of [sender, receiver]) ProviderSession.clearMcpProviderSession(seat.threadId);
    }),
);
const sendInput = { targetPeerId: "codex:mcp-b", kind: "question", payload: { text: "one fact" } };
const toolNames = [
  "comsnet_peers",
  "comsnet_send",
  "comsnet_subscribe",
  "comsnet_status",
  "comsnet_result",
] as const;
const isObject = (value: unknown) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const outputChecks = Object.values(ComsNetToolkit.tools).map((tool) => ({
  tool,
  accepts: Schema.is(tool.successSchema),
}));

it("covers every registered tool and declares object output schemas", () => {
  expect(Object.keys(ComsNetToolkit.tools).sort()).toEqual([...toolNames].sort());
  for (const { tool, accepts } of outputChecks) {
    expect(Tool.getJsonSchemaFromSchema(tool.successSchema).type, tool.name).toBe("object");
    for (const invalid of [[], null, "answer", 1, true]) {
      expect(accepts(invalid), tool.name).toBe(false);
    }
  }
});

// Local regression only: real toolkit + durable transport, fixture seats and dispatcher.
// This is not the independent live-seat acceptance round trip.
it.effect.each(toolNames)(
  "%s returns object structured content with unchanged request data",
  (name) =>
    Effect.gen(function* () {
      yield* sessions;
      const server = yield* McpServer.McpServer;
      const transport = yield* Transport.ComsNetTransport;
      const request = yield* transport.send(sender, sendInput);
      const args =
        name === "comsnet_send"
          ? sendInput
          : name === "comsnet_status"
            ? { requestId: request.requestId }
            : name === "comsnet_result"
              ? { requestId: request.requestId, result: ["answer"] }
              : {};
      const result = yield* server
        .callTool({ name, arguments: args })
        .pipe(
          Effect.provideService(
            Invocation.McpInvocationContext,
            name === "comsnet_subscribe" || name === "comsnet_result" ? receiver : sender,
          ),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(result.isError).toBe(false);
      expect(isObject(result.structuredContent)).toBe(true);
      if (name === "comsnet_peers")
        expect(result.structuredContent).toMatchObject({
          peers: [
            { peerId: "codex:mcp-a", isSelf: true },
            { peerId: "codex:mcp-b", isSelf: false },
          ],
        });
      if (name === "comsnet_subscribe")
        expect(result.structuredContent).toMatchObject({
          requests: [{ requestId: request.requestId, receiverTurnId: "turn-b" }],
        });
      if (name === "comsnet_send" || name === "comsnet_status") {
        expect(result.structuredContent).toMatchObject({
          senderPeerId: "codex:mcp-a",
          receiverPeerId: "codex:mcp-b",
          kind: "question",
          payload: { text: "one fact" },
        });
      }
      if (name === "comsnet_result") {
        expect(result.structuredContent).toMatchObject({
          requestId: request.requestId,
          status: "completed",
          result: ["answer"],
        });
        const waited = yield* server
          .callTool({ name, arguments: { requestId: request.requestId } })
          .pipe(
            Effect.provideService(Invocation.McpInvocationContext, sender),
            Effect.provideService(McpSchema.McpServerClient, client),
          );
        expect(waited.structuredContent).toEqual(result.structuredContent);
      }
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

it.effect.each(toolNames)("%s keeps capability failures protocol-valid and unsuccessful", (name) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({ name, arguments: { ...sendInput, requestId: "missing" } })
      .pipe(
        Effect.provideService(Invocation.McpInvocationContext, {
          ...sender,
          capabilities: new Set<Invocation.McpCapability>(),
        }),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).toBe(true);
    expect(result.structuredContent === undefined || isObject(result.structuredContent)).toBe(true);
    expect(result.content[0]?.type).toBe("text");
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

it.effect("does not expose unexpected transport failure details", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({ name: "comsnet_send", arguments: sendInput })
      .pipe(
        Effect.provideService(Invocation.McpInvocationContext, sender),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "Tool execution failed due to an internal server error." },
    ]);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      makeTestLayer(
        Layer.mock(Transport.ComsNetTransport)({
          send: () =>
            Effect.fail(new Transport.ComsNetTransportError({ message: "private storage detail" })),
        }),
      ),
    ),
  ),
);

it.effect("wraps empty peer and subscription lists too", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const call = (name: string) =>
      server
        .callTool({ name, arguments: {} })
        .pipe(
          Effect.provideService(Invocation.McpInvocationContext, sender),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
    expect((yield* call("comsnet_peers")).structuredContent).toEqual({ peers: [] });
    yield* sessions;
    expect((yield* call("comsnet_subscribe")).structuredContent).toEqual({ requests: [] });
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

it.effect("reports an unknown send peer rather than masking it as an internal server error", () =>
  Effect.gen(function* () {
    yield* sessions;
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({
        name: "comsnet_send",
        arguments: { ...sendInput, targetPeerId: "claude:native-id-not-a-roster-peer" },
      })
      .pipe(
        Effect.provideService(Invocation.McpInvocationContext, sender),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "target peer claude:native-id-not-a-roster-peer is not current" },
    ]);
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

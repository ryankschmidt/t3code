import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpProviderSession from "./McpProviderSession.ts";
import { ComsNetTransport, layer as ComsNetTransportLive } from "./ComsNetTransport.ts";

const providerInstanceId = ProviderInstanceId.make("codex-instance");
const threadA = ThreadId.make("thread-a");
const threadB = ThreadId.make("thread-b");

const snapshot = {
  projects: [
    {
      id: ProjectId.make("project-a"),
      workspaceRoot: "/workspace/project-a",
    },
  ],
  threads: [
    {
      id: threadA,
      projectId: ProjectId.make("project-a"),
      worktreePath: null,
      session: {
        status: "running",
        providerName: "codex",
        providerInstanceId,
        // The native provider thread id and transcript are not the MCP
        // credential identity. A newly-started real Codex turn can project
        // neither while its MCP credential is already live.
        providerSessionId: null,
        nativeTranscriptPath: null,
      },
    },
    {
      id: threadB,
      projectId: ProjectId.make("project-a"),
      worktreePath: null,
      session: {
        status: "running",
        providerName: "codex",
        providerInstanceId,
        providerSessionId: "native-codex-thread-b",
        nativeTranscriptPath: "/native/codex-thread-b.jsonl",
      },
    },
  ],
} as unknown as OrchestrationShellSnapshot;

const snapshotQuery = {
  getShellSnapshot: () => Effect.succeed(snapshot),
} as unknown as ProjectionSnapshotQueryShape;

const TestLayer = ComsNetTransportLive.pipe(
  Layer.provideMerge(Layer.succeed(ProjectionSnapshotQuery, snapshotQuery)),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-comsnet-live-peer-test-" }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("ComsNetTransport real provider lifecycle join", (it) => {
  it.effect(
    "uses active server-issued MCP sessions for roster identity and caller resolution",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          McpProviderSession.setMcpProviderSession({
            environmentId: EnvironmentId.make("environment-a"),
            threadId: threadA,
            providerSessionId: "mcp-session-a",
            providerInstanceId,
            endpoint: "http://127.0.0.1:3773/mcp",
            authorizationHeader: "Bearer token-a",
          });
          McpProviderSession.setMcpProviderSession({
            environmentId: EnvironmentId.make("environment-a"),
            threadId: threadB,
            providerSessionId: "mcp-session-b",
            providerInstanceId,
            endpoint: "http://127.0.0.1:3773/mcp",
            authorizationHeader: "Bearer token-b",
          });
        }),
        () =>
          Effect.gen(function* () {
            const transport = yield* ComsNetTransport;
            const peers = yield* transport.listPeers();

            assert.deepEqual(
              peers.map((peer) => ({
                peerId: peer.peerId,
                threadId: peer.threadId,
                providerSessionId: peer.providerSessionId,
                transcriptPath: peer.transcriptPath,
              })),
              [
                {
                  peerId: "codex:mcp-session-a",
                  threadId: "thread-a",
                  providerSessionId: "mcp-session-a",
                  transcriptPath: undefined,
                },
                {
                  peerId: "codex:mcp-session-b",
                  threadId: "thread-b",
                  providerSessionId: "mcp-session-b",
                  transcriptPath: "/native/codex-thread-b.jsonl",
                },
              ],
            );

            const requests = yield* transport.subscribe(
              {
                environmentId: EnvironmentId.make("environment-a"),
                threadId: threadA,
                providerSessionId: "mcp-session-a",
                providerInstanceId,
                capabilities: new Set(["comsnet"]),
                issuedAt: 0,
              },
              { timeoutMs: 1 },
            );
            assert.deepEqual(requests, []);
          }),
        () => Effect.sync(() => McpProviderSession.clearAllMcpProviderSessions()),
      ),
  );
});

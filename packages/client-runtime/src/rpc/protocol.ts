import {
  ServerConfigStreamEvent,
  WsRpcGroup,
  WsThroughlineHelloRpc,
  WsSubscribeServerConfigRpc,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type * as Cause from "effect/Cause";
import type * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcClientError from "effect/unstable/rpc/RpcClientError";
import { RpcClient } from "effect/unstable/rpc";
import { decodeEvent, type DecodedEvent } from "../../../throughline-protocol/src/events.ts";

export const makeWsRpcProtocolClient = RpcClient.make(WsRpcGroup);
type RpcClientFactory = typeof makeWsRpcProtocolClient;
export type WsRpcProtocolClient =
  RpcClientFactory extends Effect.Effect<infer Client, any, any> ? Client : never;

const decodeConfigEvent = Schema.decodeUnknownSync(ServerConfigStreamEvent);
const configEventDecoders = {
  snapshot: decodeConfigEvent,
  keybindingsUpdated: decodeConfigEvent,
  providerStatuses: decodeConfigEvent,
  settingsUpdated: decodeConfigEvent,
  environmentThemesUpdated: decodeConfigEvent,
  usageLimitSourcesUpdated: decodeConfigEvent,
} satisfies Record<ServerConfigStreamEvent["type"], typeof decodeConfigEvent>;

// Only the negotiating session's config subscription uses this raw wire
// decoder. Existing RPC methods and their queue/stream contracts stay intact.
const preservingConfigGroup = WsRpcGroup.omit(WS_METHODS.subscribeServerConfig).add(
  Rpc.make(WS_METHODS.subscribeServerConfig, {
    payload: WsSubscribeServerConfigRpc.payloadSchema,
    success: Schema.Unknown,
    error: WsSubscribeServerConfigRpc.errorSchema,
    stream: true,
  }),
);

export const makePreservingWsRpcProtocolClient = (
  preserve: (event: DecodedEvent) => Effect.Effect<void>,
) =>
  RpcClient.make(preservingConfigGroup).pipe(
    Effect.map((client) => {
      type Input = typeof WsSubscribeServerConfigRpc.payloadSchema.Type;
      type Options = NonNullable<
        Parameters<WsRpcProtocolClient[typeof WS_METHODS.subscribeServerConfig]>[1]
      >;
      type Error = Rpc.ErrorExit<typeof WsSubscribeServerConfigRpc> | RpcClientError.RpcClientError;
      function subscribe<const AsQueue extends boolean = false, const _Discard = false>(
        input: Input,
        options?: Omit<Options, "asQueue"> & { readonly asQueue?: AsQueue | undefined },
      ): AsQueue extends true
        ? Effect.Effect<
            Queue.Dequeue<ServerConfigStreamEvent, Error | Cause.Done>,
            never,
            Scope.Scope
          >
        : Stream.Stream<ServerConfigStreamEvent, Error>;
      function subscribe(input: Input, options?: Options) {
        const stream = client[WS_METHODS.subscribeServerConfig](input, {
          ...options,
          asQueue: false,
        }).pipe(
          Stream.mapEffect(
            Effect.fnUntraced(function* (raw): Effect.fn.Return<
              Result.Result<ServerConfigStreamEvent, void>,
              RpcClientError.RpcClientError
            > {
              const decoded = decodeEvent(raw, configEventDecoders);
              yield* preserve(decoded);
              if (decoded.kind === "known")
                return Result.succeed(decoded.event as ServerConfigStreamEvent);
              if (decoded.kind === "preserved-unknown") return Result.fail(undefined);
              return yield* new RpcClientError.RpcClientError({
                reason: new RpcClientError.RpcClientDefect({
                  message: "Malformed known server config event",
                  cause: decoded.cause,
                }),
              });
            }),
          ),
          Stream.filterMap((event) => event),
        );
        return options?.asQueue === true
          ? Stream.toQueue(stream, { capacity: options.streamBufferSize ?? 16 })
          : stream;
      }
      return {
        ...client,
        [WS_METHODS.subscribeServerConfig]: subscribe,
      } satisfies WsRpcProtocolClient;
    }),
  );

export function clientHelloFromMetadata(
  metadata: {
    readonly release?: string | undefined;
    readonly platform?: string | undefined;
    readonly commit?: string | null | undefined;
  },
  capabilities: ReadonlyArray<string>,
): typeof WsThroughlineHelloRpc.payloadSchema.Type | undefined {
  if (!metadata.release?.trim() || !metadata.platform?.trim()) return undefined;
  return {
    protocol_version: 1,
    release: metadata.release,
    platform: metadata.platform,
    commit: metadata.commit ?? null,
    capabilities,
    // Hello does not take ownership of existing per-subscription replay cursors.
    last_cursor: null,
  };
}

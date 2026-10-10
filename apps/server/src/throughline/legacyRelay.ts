// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAsyncHooks from "node:async_hooks";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
  ComsNet,
  type ComsNetRequest,
  type PeerIdentity,
  type SendInput,
  type SubscribeOptions,
} from "@ryan/agent-mcp-relay";

export interface ReceiverTurnRequest extends ComsNetRequest {
  readonly receiverTurnId?: string;
}

export interface ReceiverTurnSubscribeOptions extends SubscribeOptions {
  readonly receiverTurnId?: string;
}

interface TurnWaiter {
  readonly receiverTurnId?: string;
  readonly resolve: (requests: ReadonlyArray<ReceiverTurnRequest>) => void;
}

/**
 * Preserve the installed 0.0.56 relay's turn binding without modifying the frozen
 * dependency. The public store still owns persistence, leases and terminal state.
 * This adapter retires with the legacy MCP tools in T7.03; it is not an outcome ledger.
 */
export class ReceiverTurnRelay extends ComsNet {
  private readonly deliveryContext: NodeAsyncHooks.AsyncLocalStorage<string | undefined>;
  private readonly turnWaiters = new Map<string, Set<TurnWaiter>>();

  constructor(options: ConstructorParameters<typeof ComsNet>[0]) {
    const deliveryContext = new NodeAsyncHooks.AsyncLocalStorage<string | undefined>();
    const store = options.store;
    super({
      ...options,
      store: {
        get: (id) => store.get(id),
        list: () => store.list(),
        listForReceiver: (id) => store.listForReceiver(id),
        insert: (request) => store.insert(request),
        replace: (request) => {
          const receiverTurnId = deliveryContext.getStore();
          const bound: ReceiverTurnRequest = {
            ...request,
            ...(receiverTurnId === undefined || request.status !== "delivered"
              ? {}
              : { receiverTurnId }),
          };
          // Bind in the relay's existing write, not a second write that could
          // overwrite a concurrently completed request with an old delivered row.
          return store.replace(bound);
        },
      },
    });
    this.deliveryContext = deliveryContext;
  }

  override async send(principal: PeerIdentity, input: SendInput): Promise<ReceiverTurnRequest> {
    const request = await super.send(principal, input);
    const waiting = this.turnWaiters.get(request.receiverPeerId);
    if (waiting === undefined) return request;
    this.turnWaiters.delete(request.receiverPeerId);
    const deliveredAt = DateTime.formatIso(
      DateTime.makeUnsafe(this.options.now?.() ?? Effect.runSync(Clock.currentTimeMillis)),
    );
    let delivered: ReceiverTurnRequest = request;
    for (const waiter of waiting) {
      delivered = {
        ...request,
        status: "delivered",
        deliveredAt,
        lastClaimedAt: deliveredAt,
        ...(waiter.receiverTurnId === undefined ? {} : { receiverTurnId: waiter.receiverTurnId }),
      };
      await this.options.store.replace(delivered);
      waiter.resolve([delivered]);
    }
    return delivered;
  }

  override async subscribe(
    principal: PeerIdentity,
    options: ReceiverTurnSubscribeOptions = {},
  ): Promise<ReadonlyArray<ReceiverTurnRequest>> {
    const claim = () =>
      this.deliveryContext.run(options.receiverTurnId, async () => {
        const requests = await super.subscribe(principal);
        return requests.map((request): ReceiverTurnRequest => ({
          ...request,
          ...(options.receiverTurnId === undefined
            ? {}
            : { receiverTurnId: options.receiverTurnId }),
        }));
      });
    const delivered = await claim();
    if (delivered.length > 0 || (options.timeoutMs === undefined && options.signal === undefined)) {
      return delivered;
    }
    return new Promise((resolve, reject) => {
      let timeout: AbortController | undefined;
      const cleanup = () => {
        timeout?.abort();
        options.signal?.removeEventListener("abort", abort);
        const waiting = this.turnWaiters.get(principal.peerId);
        waiting?.delete(waiter);
        if (waiting?.size === 0) this.turnWaiters.delete(principal.peerId);
      };
      const waiter: TurnWaiter = {
        ...(options.receiverTurnId === undefined ? {} : { receiverTurnId: options.receiverTurnId }),
        resolve: (requests) => {
          cleanup();
          resolve(requests);
        },
      };
      const abort = () => {
        cleanup();
        reject(new Error(`subscription for ${principal.peerId} aborted`));
      };
      const waiting = this.turnWaiters.get(principal.peerId) ?? new Set<TurnWaiter>();
      waiting.add(waiter);
      this.turnWaiters.set(principal.peerId, waiting);
      if (options.signal?.aborted) return abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.timeoutMs !== undefined) {
        timeout = new AbortController();
        void Effect.runPromiseExit(Effect.sleep(options.timeoutMs), {
          signal: timeout.signal,
        }).then((exit) => {
          if (Exit.isSuccess(exit)) waiter.resolve([]);
        });
      }
      // Match the installed relay's re-read after registration: a send between
      // the first read and registration must not disappear into a missed wake.
      void claim().then(
        (requests) => {
          if (requests.length > 0) waiter.resolve(requests);
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  override status(principal: PeerIdentity, requestId: string): Promise<ReceiverTurnRequest> {
    return super.status(principal, requestId);
  }

  async listTrustedReceiverTurn(receiverThreadId: string, receiverTurnId: string) {
    const requests: ReadonlyArray<ReceiverTurnRequest> = await this.options.store.list();
    return requests.filter(
      (request) =>
        request.receiverThreadId === receiverThreadId && request.receiverTurnId === receiverTurnId,
    );
  }
}

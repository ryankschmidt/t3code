// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  InMemoryComsNetStore,
  JsonFileComsNetStore,
  StaticPeerDirectory,
  type PeerIdentity,
} from "@ryan/agent-mcp-relay";
import { describe, expect, it } from "vite-plus/test";
import { ReceiverTurnRelay } from "./legacyRelay.ts";

const sender: PeerIdentity = {
  peerId: "codex:sender",
  threadId: "sender",
  providerName: "codex",
  providerInstanceId: "codex",
  providerSessionId: "sender-session",
  cwd: "/fixture",
};
const receiver = { ...sender, peerId: "codex:receiver", threadId: "receiver" };
const peers = new StaticPeerDirectory([sender, receiver]);
const input = { targetPeerId: receiver.peerId, kind: "question", payload: { text: "unchanged" } };

class ObservedStore extends InMemoryComsNetStore {
  readonly waiting = Promise.withResolvers<void>();
  reads = 0;
  override async listForReceiver(peerId: string) {
    const requests = await super.listForReceiver(peerId);
    // The second read follows long-poll registration, including the race-closing read.
    if (++this.reads === 2) this.waiting.resolve();
    return requests;
  }
}

describe("installed 0.0.56 legacy relay receiver-turn behavior", () => {
  it("binds queued delivery and filters by both receiver and finished turn", async () => {
    const relay = new ReceiverTurnRelay({ store: new InMemoryComsNetStore(), peers });
    const request = await relay.send(sender, input);
    const delivered = await relay.subscribe(receiver, { receiverTurnId: "turn-b" });
    expect(delivered).toMatchObject([{ requestId: request.requestId, receiverTurnId: "turn-b" }]);
    expect(await relay.listTrustedReceiverTurn(receiver.threadId, "turn-b")).toEqual(delivered);
    expect(await relay.listTrustedReceiverTurn(sender.threadId, "turn-b")).toEqual([]);
    expect(await relay.listTrustedReceiverTurn(receiver.threadId, "other-turn")).toEqual([]);
    await expect(
      relay.completeTrustedReceiverThread(sender.threadId, request.requestId, {}),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await relay.completeTrustedReceiverThread(receiver.threadId, request.requestId, {
      text: "answer",
    });
    await expect(
      relay.completeTrustedReceiverThread(receiver.threadId, request.requestId, {}),
    ).rejects.toMatchObject({ code: "ALREADY_TERMINAL" });
  });

  it("returns a bound delivered send when a receiver already waits, preventing another dispatch", async () => {
    const store = new ObservedStore();
    const relay = new ReceiverTurnRelay({ store, peers });
    const waiting = relay.subscribe(receiver, { receiverTurnId: "turn-b", timeoutMs: 5000 });
    await store.waiting.promise;
    const sent = await relay.send(sender, input);
    expect(await waiting).toEqual([sent]);
    expect(sent).toMatchObject({
      status: "delivered",
      receiverTurnId: "turn-b",
      payload: input.payload,
    });
    expect(await relay.status(sender, sent.requestId)).toEqual(sent);
    expect(await relay.subscribe(receiver, { receiverTurnId: "turn-b" })).toEqual([]);
  });

  it("persists the binding in the public store across a cold relay instance", async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-legacy-relay-"));
    try {
      const file = NodePath.join(directory, "requests.json");
      const relay = new ReceiverTurnRelay({ store: new JsonFileComsNetStore(file), peers });
      const request = await relay.send(sender, input);
      await relay.subscribe(receiver, { receiverTurnId: "durable-turn" });
      const cold = new ReceiverTurnRelay({ store: new JsonFileComsNetStore(file), peers });
      expect(await cold.listTrustedReceiverTurn(receiver.threadId, "durable-turn")).toMatchObject([
        { requestId: request.requestId, receiverTurnId: "durable-turn" },
      ]);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps lease redelivery and rebinds only to the receiving turn", async () => {
    let now = 0;
    const relay = new ReceiverTurnRelay({
      store: new InMemoryComsNetStore(),
      peers,
      now: () => now,
      deliveryLeaseMs: 10,
    });
    const request = await relay.send(sender, input);
    await relay.subscribe(receiver, { receiverTurnId: "first" });
    expect(await relay.subscribe(receiver, { receiverTurnId: "second" })).toEqual([]);
    now = 11;
    expect(await relay.subscribe(receiver, { receiverTurnId: "second" })).toMatchObject([
      { requestId: request.requestId, receiverTurnId: "second" },
    ]);
    expect(await relay.listTrustedReceiverTurn(receiver.threadId, "first")).toEqual([]);
  });

  it("removes a cancelled waiter rather than delivering a later send to its old turn", async () => {
    const store = new ObservedStore();
    const relay = new ReceiverTurnRelay({ store, peers });
    const controller = new AbortController();
    const waiting = relay.subscribe(receiver, {
      receiverTurnId: "cancelled",
      signal: controller.signal,
    });
    const rejected = expect(waiting).rejects.toThrow("aborted");
    await store.waiting.promise;
    controller.abort();
    await rejected;
    expect(await relay.send(sender, input)).toMatchObject({ status: "queued" });
    expect(await relay.listTrustedReceiverTurn(receiver.threadId, "cancelled")).toEqual([]);
  });

  it("keeps ordinary unbound subscriptions and timeout cleanup", async () => {
    const relay = new ReceiverTurnRelay({ store: new InMemoryComsNetStore(), peers });
    expect(await relay.subscribe(receiver, { receiverTurnId: "timed-out", timeoutMs: 1 })).toEqual(
      [],
    );
    const sent = await relay.send(sender, input);
    expect(sent.status).toBe("queued");
    expect(await relay.subscribe(receiver)).toMatchObject([
      { requestId: sent.requestId, status: "delivered" },
    ]);
    expect(await relay.listTrustedReceiverTurn(receiver.threadId, "timed-out")).toEqual([]);
  });
});

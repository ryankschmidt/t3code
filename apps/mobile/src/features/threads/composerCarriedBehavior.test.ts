import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { resolveThreadAnsweringModel } from "../../lib/modelOptions";
import {
  composerReturnBehavior,
  resolveCarriedComposerSubmission,
  sendWithComposerGuard,
  formatComposerAnswerObservation,
  withThreadModelActivities,
} from "./composerCarriedBehavior";

const base = {
  platform: "ios",
  source: "send-arrow" as const,
  draftMessage: "prompt",
  attachmentCount: 0,
  driver: "claudeAgent",
  blocked: false,
};

describe("carried composer submission behavior", () => {
  it("makes iOS Return a newline and refuses every keyboard-submit path", () => {
    expect(composerReturnBehavior("ios")).toBe("newline");
    expect(resolveCarriedComposerSubmission({ ...base, source: "keyboard-submit" })).toEqual({
      kind: "blocked",
    });
    expect(resolveCarriedComposerSubmission(base)).toEqual({ kind: "send" });
  });

  it("does not override the existing Android keyboard policy", () => {
    expect(composerReturnBehavior("android")).toBeUndefined();
    expect(
      resolveCarriedComposerSubmission({ ...base, platform: "android", source: "keyboard-submit" }),
    ).toEqual({ kind: "send" });
  });

  it.each(["/rewind", "/config"])(
    "keeps attached %s as a prompt instead of consuming it locally",
    (draftMessage) => {
      expect(
        resolveCarriedComposerSubmission({ ...base, draftMessage, attachmentCount: 1 }),
      ).toEqual({ kind: "send" });
      expect(resolveCarriedComposerSubmission({ ...base, draftMessage })).toEqual({
        kind: "local-menu",
        menu: draftMessage.slice(1),
      });
    },
  );

  it("does not reinterpret another provider or a multiline raw body", () => {
    expect(
      resolveCarriedComposerSubmission({ ...base, driver: "codex", draftMessage: "/rewind" }),
    ).toEqual({ kind: "send" });
    expect(
      resolveCarriedComposerSubmission({ ...base, draftMessage: " /rewind\r\n raw body  " }),
    ).toEqual({ kind: "send" });
  });

  it("does not consume even a local command when voice or an attachment import blocks sending", () => {
    expect(
      resolveCarriedComposerSubmission({ ...base, draftMessage: "/rewind", blocked: true }),
    ).toEqual({ kind: "blocked" });
  });

  it("preserves raw/newline text and attachment state when the send is refused, then permits retry", async () => {
    const draft = { text: "  first\r\nsecond\n🙂  ", attachments: [{ id: "original-file" }] };
    const initial = structuredClone(draft);
    const inFlight = new Set<string>();
    const refusal = await sendWithComposerGuard(inFlight, "host:thread", async () => null);
    expect(refusal).toBeNull();
    expect(draft).toEqual(initial);
    expect(inFlight.size).toBe(0);
    const sent: (typeof draft)[] = [];
    const id = await sendWithComposerGuard(inFlight, "host:thread", async () => {
      sent.push(structuredClone(draft));
      return "message-id";
    });
    expect(id).toBe("message-id");
    expect(sent).toEqual([initial]);
  });

  it("allows only one in-flight send per thread without blocking another thread", async () => {
    const inFlight = new Set<string>();
    let release!: (id: string) => void;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const first = sendWithComposerGuard(inFlight, "host:first", () => pending);
    let duplicateCalls = 0;
    expect(
      await sendWithComposerGuard(inFlight, "host:first", async () => {
        duplicateCalls++;
        return "duplicate";
      }),
    ).toBeNull();
    expect(duplicateCalls).toBe(0);
    expect(await sendWithComposerGuard(inFlight, "host:second", async () => "second")).toBe(
      "second",
    );
    release("first");
    expect(await first).toBe("first");
    expect(inFlight.size).toBe(0);
  });

  it("releases the send guard after rejection without clearing the next draft", async () => {
    const inFlight = new Set<string>();
    const draft = "  keep this\nraw  ";
    await expect(
      sendWithComposerGuard(inFlight, "thread", async () => {
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    expect(inFlight.size).toBe(0);
    expect(await sendWithComposerGuard(inFlight, "thread", async () => draft)).toBe(draft);
  });
});

describe("answer observation beside requested model control", () => {
  it("preserves the owning environment/thread brands through the readonly carrier", () => {
    const environmentId = EnvironmentId.make("environment-mac");
    const threadId = ThreadId.make("thread-1");
    const shell = { environmentId, id: threadId, session: { activeTurnId: "turn-1" } };
    const carried = withThreadModelActivities(shell, { id: threadId, activities: [] });
    const scoped: { environmentId: EnvironmentId; threadId: ThreadId } = {
      environmentId: carried.environmentId,
      threadId: carried.id,
    };
    expect(scoped).toEqual({ environmentId, threadId });
    expect(formatComposerAnswerObservation(resolveThreadAnsweringModel(carried))).toBe(
      "Answered: unknown",
    );
  });
  it("carries actual detail activities through a shell prop while preserving next-dispatch intent", () => {
    const shell = {
      id: "thread-1",
      modelSelection: { model: "C" },
      session: { activeTurnId: "turn-1" },
    };
    const detail = {
      id: "thread-1",
      activities: [
        {
          kind: "turn.model.observed",
          turnId: "turn-1",
          payload: {
            source: "claude.assistant.message.model",
            scope: "main-turn",
            requestedModel: "A",
            answeringModel: "B",
          },
        },
      ],
    };
    const carried = withThreadModelActivities(shell, detail);
    expect(formatComposerAnswerObservation(resolveThreadAnsweringModel(carried))).toBe(
      "Answered: B · Substituted: A → B",
    );
    expect(carried.modelSelection).toBe(shell.modelSelection);
    expect(carried.activities).toBe(detail.activities);
    expect(shell).not.toHaveProperty("activities");
  });

  it.each([
    null,
    {
      id: "another-thread",
      activities: [
        {
          kind: "turn.model.observed",
          turnId: "turn-1",
          payload: {
            source: "claude.assistant.message.model",
            scope: "main-turn",
            requestedModel: "A",
            answeringModel: "B",
          },
        },
      ],
    },
  ])("does not borrow missing or another-thread detail (%j)", (detail) => {
    const shell = {
      id: "thread-1",
      modelSelection: { model: "known-request" },
      session: { activeTurnId: "turn-1" },
    };
    const carried = withThreadModelActivities(shell, detail);
    expect(formatComposerAnswerObservation(resolveThreadAnsweringModel(carried))).toBe(
      "Answered: unknown",
    );
    expect(carried.modelSelection.model).toBe("known-request");
  });

  it("consumes the pinned reader's main-turn A-to-B evidence without changing future selection C", () => {
    const thread = {
      modelSelection: { model: "C" },
      session: { activeTurnId: "turn-1" },
      activities: [
        {
          kind: "turn.model.observed",
          turnId: "turn-1",
          payload: {
            source: "claude.assistant.message.model",
            scope: "main-turn",
            requestedModel: "A",
            answeringModel: "B",
          },
        },
      ],
    };
    expect(formatComposerAnswerObservation(resolveThreadAnsweringModel(thread))).toBe(
      "Answered: B · Substituted: A → B",
    );
    expect(
      formatComposerAnswerObservation(
        resolveThreadAnsweringModel(JSON.parse(JSON.stringify(thread))),
      ),
    ).toBe("Answered: B · Substituted: A → B");
    expect(thread.modelSelection.model).toBe("C");
  });

  it.each([
    { turnId: "another-turn", source: "claude.assistant.message.model", scope: "main-turn" },
    { turnId: "turn-1", source: "claude.assistant.message.model", scope: "subagent" },
    { turnId: "turn-1", source: "codex.initial-model", scope: "main-turn" },
  ])("reader ignores non-attributable evidence (%j) despite a known request", (evidence) => {
    const thread = {
      modelSelection: { model: "known-request" },
      session: { activeTurnId: "turn-1" },
      activities: [
        {
          kind: "turn.model.observed",
          turnId: evidence.turnId,
          payload: {
            source: evidence.source,
            scope: evidence.scope,
            requestedModel: "A",
            answeringModel: "B",
          },
        },
      ],
    };
    expect(formatComposerAnswerObservation(resolveThreadAnsweringModel(thread))).toBe(
      "Answered: unknown",
    );
    expect(thread.modelSelection.model).toBe("known-request");
  });

  it("displays the observed answer and the recorded substitution, not the next requested model", () => {
    const observation = {
      requestedModel: "requested-A",
      answeringModel: "answered-B",
      verdict: "mismatch" as const,
      currentModelSelection: { model: "next-C" },
    };
    expect(formatComposerAnswerObservation(observation)).toBe(
      "Answered: answered-B · Substituted: requested-A → answered-B",
    );
    expect(observation.currentModelSelection.model).toBe("next-C");
  });

  it("shows a matching observed answer without claiming substitution", () => {
    expect(
      formatComposerAnswerObservation({
        requestedModel: "A",
        answeringModel: "A",
        verdict: "match",
      }),
    ).toBe("Answered: A");
  });

  it("does not fill an unknown answer from a known requested model", () => {
    expect(
      formatComposerAnswerObservation({
        requestedModel: "known-request",
        answeringModel: null,
        verdict: "unknown",
      }),
    ).toBe("Answered: unknown");
  });

  it("preserves response evidence when the original request is unknown", () => {
    expect(
      formatComposerAnswerObservation({
        requestedModel: null,
        answeringModel: "B",
        verdict: "unknown",
      }),
    ).toBe("Answered: B");
  });

  it("keeps the exact observed identity after JSON snapshot reload", () => {
    const observation = JSON.parse(
      JSON.stringify({ requestedModel: "A", answeringModel: "B", verdict: "mismatch" }),
    );
    expect(formatComposerAnswerObservation(observation)).toBe("Answered: B · Substituted: A → B");
  });
});

import React from "react";
import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from "react-test-renderer";
import { describe, expect, it } from "vite-plus/test";
import { resolveThreadAnsweringModel } from "../../modelSelection";
import { ChatComposerAnsweringModelNotice, resolveChatComposerLocalMenu } from "./ChatComposer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function renderedText(
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null,
): string {
  if (node === null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(renderedText).join("");
  return node.children?.map(renderedText).join("") ?? "";
}
const thread = {
  session: { activeTurnId: "turn-1" },
  latestTurn: { turnId: "turn-1" },
  modelSelection: { model: "claude-fable-5-1" },
  activities: [
    {
      kind: "turn.model.observed",
      turnId: "turn-1",
      payload: {
        source: "claude.assistant.message.model",
        scope: "main-turn",
        requestedModel: "claude-fable-5-1",
        answeringModel: "claude-opus-5-5",
      },
    },
  ],
};
async function notice(input: Parameters<typeof resolveThreadAnsweringModel>[0]) {
  expect(typeof ChatComposerAnsweringModelNotice).toBe("function");
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <ChatComposerAnsweringModelNotice observation={resolveThreadAnsweringModel(input)} />,
    );
  });
  const text = renderedText(renderer.toJSON());
  await act(async () => renderer.unmount());
  return text;
}
describe("composer's answering-model display", () => {
  it("renders an attributed substitution after snapshot reload without changing next selection", async () => {
    const next = JSON.parse(JSON.stringify(thread)) as typeof thread;
    next.modelSelection.model = "claude-sonnet-5-5";
    expect(await notice(next)).toContain("Answered: claude-opus-5-5");
    expect(await notice(next)).toContain("Substitution: claude-fable-5-1 → claude-opus-5-5");
    expect(next.modelSelection.model).toBe("claude-sonnet-5-5");
  });
  it("shows unknown despite a known selection when no response observation exists", async () => {
    expect(await notice({ ...thread, activities: [] })).toBe("Answered: unknown");
    expect(await notice({ ...thread, session: { activeTurnId: "new-turn" } })).toBe(
      "Answered: unknown",
    );
    const subagent = {
      ...thread,
      activities: [
        {
          ...thread.activities[0]!,
          payload: { ...thread.activities[0]!.payload, scope: "subagent" },
        },
      ],
    };
    expect(await notice(subagent)).toBe("Answered: unknown");
  });
  it("renders a matching answer without a substitution warning", async () => {
    const matching = {
      ...thread,
      activities: [
        {
          ...thread.activities[0]!,
          payload: { ...thread.activities[0]!.payload, answeringModel: "claude-fable-5-1" },
        },
      ],
    };
    expect(await notice(matching)).toBe("Answered: claude-fable-5-1");
  });
});
describe("composer carried-menu preflight", () => {
  const base = {
    driver: "claudeAgent",
    routeKind: "server",
    hasPendingProgress: false,
    text: "/rewind",
    attachmentCount: 0,
    hasPendingAttachments: false,
  };
  it("opens bare menus but sends neither attached nor importing commands down the clear-draft menu path", () => {
    expect(typeof resolveChatComposerLocalMenu).toBe("function");
    expect(resolveChatComposerLocalMenu(base)).toBe("rewind");
    expect(resolveChatComposerLocalMenu({ ...base, text: "/config" })).toBe("config");
    expect(resolveChatComposerLocalMenu({ ...base, attachmentCount: 1 })).toBeNull();
    expect(resolveChatComposerLocalMenu({ ...base, hasPendingAttachments: true })).toBeNull();
  });
  it("keeps newline-bearing raw text and existing provider/route/pending gates", () => {
    const raw = { ...base, text: "/config\nkeep this exact text", attachmentCount: 1 };
    const before = JSON.stringify(raw);
    expect(resolveChatComposerLocalMenu(raw)).toBeNull();
    expect(JSON.stringify(raw)).toBe(before);
    expect(resolveChatComposerLocalMenu({ ...base, driver: "codex" })).toBeNull();
    expect(resolveChatComposerLocalMenu({ ...base, routeKind: "draft" })).toBeNull();
    expect(resolveChatComposerLocalMenu({ ...base, hasPendingProgress: true })).toBeNull();
  });
});

import { describe, expect, it } from "vite-plus/test";
import {
  absolutePathForOperatorLink,
  operatorLinkRouterUrl,
  renderOperatorDeliveryLinks,
} from "./operatorDeliveryLinks";

describe("operator delivery links", () => {
  it("maps every governed root", () => {
    expect(operatorLinkRouterUrl("/Users/Admin/core-root/vault/a/b.md")).toContain(
      "/v/vault/r/a/b.md",
    );
    expect(operatorLinkRouterUrl("/Users/Admin/core-root/AGENTS.md")).toContain(
      "/v/vault/r/_repo/AGENTS.md",
    );
    expect(operatorLinkRouterUrl("/Users/Admin/.claude/rules/a.md")).toContain(
      "/v/vault/r/__/claude/rules/a.md",
    );
    expect(operatorLinkRouterUrl("/Users/Admin/.codex/rules/a.md")).toContain(
      "/v/vault/r/__/codex/rules/a.md",
    );
    expect(operatorLinkRouterUrl("/Users/Admin/.cowork/rules/a.md")).toContain(
      "/v/vault/r/__/cowork/rules/a.md",
    );
  });

  it("adds a companion without changing prose or persistence input", () => {
    const source = "Evidence: /Users/Admin/core-root/vault/a/b.md\nMeaning unchanged.";
    const rendered = renderOperatorDeliveryLinks(source, { enabled: true });
    expect(source).toBe("Evidence: /Users/Admin/core-root/vault/a/b.md\nMeaning unchanged.");
    expect(rendered).toBe(
      "Evidence: /Users/Admin/core-root/vault/a/b.md\n📄 [b.md](http://mbp21.tailec334b.ts.net:8129/v/vault/r/a/b.md)\nMeaning unchanged.",
    );
  });

  it("is idempotent when a companion already exists", () => {
    const source =
      "/Users/Admin/core-root/vault/a.md\n📄 [a.md](http://mbp21.tailec334b.ts.net:8129/v/vault/r/a.md)";
    expect(renderOperatorDeliveryLinks(source, { enabled: true })).toBe(source);
  });

  it("adds the inverse path and replaces the retired host", () => {
    const current = "📄 [a.md](http://mbp21.tailec334b.ts.net:8129/v/vault/r/a.md)";
    expect(absolutePathForOperatorLink("http://mbp21.tailec334b.ts.net:8129/v/vault/r/a.md")).toBe(
      "/Users/Admin/core-root/vault/a.md",
    );
    expect(renderOperatorDeliveryLinks(current, { enabled: true })).toBe(
      `/Users/Admin/core-root/vault/a.md\n${current}`,
    );
    expect(
      renderOperatorDeliveryLinks("https://obsidian-links.kennethchristensen.me/v/vault/r/a.md", {
        enabled: true,
      }),
    ).toContain("http://mbp21.tailec334b.ts.net:8129/v/vault/r/a.md");
  });

  it("leaves code fences, folders, worktrees, and disabled rendering byte-identical", () => {
    const cases = [
      "```\n/Users/Admin/core-root/vault/a.md\n```",
      "/Users/Admin/core-root/vault/folder/",
      "/Users/Admin/.codex/worktrees/x/core-root/a.md",
    ];
    for (const source of cases)
      expect(renderOperatorDeliveryLinks(source, { enabled: true })).toBe(source);
    expect(renderOperatorDeliveryLinks("/Users/Admin/core-root/a.md", { enabled: false })).toBe(
      "/Users/Admin/core-root/a.md",
    );
  });

  it("handles ten report-shaped path lines without touching surrounding text", () => {
    const paths = Array.from(
      { length: 10 },
      (_, index) => `/Users/Admin/core-root/vault/reports/r${index + 1}.md`,
    );
    const source = paths.map((path, index) => `Finding ${index + 1}: ${path}`).join("\n");
    const rendered = renderOperatorDeliveryLinks(source, { enabled: true });
    expect((rendered.match(/📄/g) ?? []).length).toBe(10);
    for (let index = 0; index < 10; index += 1)
      expect(rendered).toContain(`Finding ${index + 1}: ${paths[index]}`);
  });
});

// @effect-diagnostics nodeBuiltinImport:off - Confined native transcript fixtures for the standalone reader.
// ThroughLine-owned identity contract: provenance, never matching bodies or turn positions.
import { describe, it, expect } from "@effect/vitest";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeDisplayedMessageUuid,
  readClaudeSessionLineage,
  resolveClaudeRewindMessage,
  type ClaudeSessionLineage,
} from "./native-lineage.ts";

const first = "550e8400-e29b-41d4-a716-446655440001";
const second = "550e8400-e29b-41d4-a716-446655440002";
const third = "550e8400-e29b-41d4-a716-446655440003";
const edge = (sessionId: string, messageUuid: string) => ({ sessionId, messageUuid });

describe("ThroughLine native rewind identity", () => {
  it("assigns stable per-thread native IDs before submitting arbitrary displayed IDs", () => {
    const a = claudeDisplayedMessageUuid("thread-a", "a non-UUID displayed message");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(claudeDisplayedMessageUuid("thread-a", "a non-UUID displayed message")).toBe(a);
    expect(claudeDisplayedMessageUuid("thread-b", "a non-UUID displayed message")).not.toBe(a);
  });

  it("uses exact identities over two native forks without reading prompt bodies", async () => {
    const histories = new Map<string, ClaudeSessionLineage>([
      [
        first,
        new Map([
          ["original-a", null],
          ["original-b", null],
        ]),
      ],
      [
        second,
        new Map([
          ["middle-a", edge(first, "original-a")],
          ["middle-b", edge(first, "original-b")],
        ]),
      ],
      [
        third,
        new Map([
          ["current-a", edge(second, "middle-a")],
          ["current-b", edge(second, "middle-b")],
        ]),
      ],
    ]);
    const reads: string[] = [];
    const readLineage = async (id: string) => {
      reads.push(id);
      return histories.get(id);
    };
    expect(
      await resolveClaudeRewindMessage({
        sessionId: third,
        currentMessageIds: ["current-a", "current-b"],
        requestedIds: ["original-b"],
        readLineage,
      }),
    ).toBe("current-b");
    expect(reads).toHaveLength(3);
  });

  it("never selects a raw-only compacted message outside effective SDK history", async () => {
    const readLineage = async () =>
      new Map([
        ["raw-hidden", edge(first, "old-hidden")],
        ["visible", null],
      ]);
    expect(
      await resolveClaudeRewindMessage({
        sessionId: second,
        currentMessageIds: ["visible"],
        requestedIds: ["old-hidden"],
        readLineage,
      }),
    ).toBeUndefined();
  });

  it("prefers a directly present prompt without reading ancestry", async () => {
    const readLineage = async () => {
      throw new Error("must not read");
    };
    expect(
      await resolveClaudeRewindMessage({
        sessionId: third,
        currentMessageIds: ["present"],
        requestedIds: ["present"],
        readLineage,
      }),
    ).toBe("present");
  });

  it("refuses cycles and conflicting native descendants", async () => {
    await expect(
      resolveClaudeRewindMessage({
        sessionId: first,
        currentMessageIds: ["a"],
        requestedIds: ["old"],
        readLineage: async () => new Map([["a", edge(first, "a")]]),
      }),
    ).rejects.toThrow(/Cycle/);
    await expect(
      resolveClaudeRewindMessage({
        sessionId: second,
        currentMessageIds: ["a", "b"],
        requestedIds: ["old"],
        readLineage: async (id) =>
          id === second
            ? new Map([
                ["a", edge(first, "old")],
                ["b", edge(first, "old")],
              ])
            : undefined,
      }),
    ).rejects.toThrow(/conflicting native descendants/);
  });

  it("reads exact session basenames under an explicit provider home across project encodings", async () => {
    const home = await mkdtemp(join(tmpdir(), "throughline-rewind-lineage-"));
    const a = join(home, "projects", "a-worktree");
    const b = join(home, "projects", "unrelated-cwd-encoding");
    await mkdir(a, { recursive: true });
    await mkdir(b);
    await writeFile(
      join(a, `${first}.jsonl`),
      JSON.stringify({ uuid: "old", type: "user" }) + "\n",
    );
    await writeFile(
      join(b, `${second}.jsonl`),
      JSON.stringify({ uuid: "new", type: "user", forkedFrom: edge(first, "old") }) + "\n",
    );
    expect(
      await resolveClaudeRewindMessage({
        sessionId: second,
        configDir: home,
        currentMessageIds: ["new"],
        requestedIds: ["old"],
      }),
    ).toBe("new");
    await writeFile(join(a, `${second}.jsonl`), JSON.stringify({ uuid: "another" }) + "\n");
    await expect(readClaudeSessionLineage(second, home)).rejects.toThrow(/ambiguous transcript/);
  });

  it("refuses malformed and contradictory recorded fork origins", async () => {
    const home = await mkdtemp(join(tmpdir(), "throughline-rewind-bad-lineage-"));
    const directory = join(home, "projects", "project");
    await mkdir(directory, { recursive: true });
    const file = join(directory, `${first}.jsonl`);
    await writeFile(
      file,
      JSON.stringify({ uuid: "a", forkedFrom: { sessionId: "invalid", messageUuid: "old" } }) +
        "\n",
    );
    await expect(readClaudeSessionLineage(first, home)).rejects.toThrow(/Malformed/);
    await writeFile(
      file,
      [
        { uuid: "a", forkedFrom: edge(second, "old") },
        { uuid: "a", forkedFrom: edge(second, "other") },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
    await expect(readClaudeSessionLineage(first, home)).rejects.toThrow(/Conflicting/);
  });

  it("refuses transcript symlinks escaping the provider's projects root", async () => {
    const home = await mkdtemp(join(tmpdir(), "throughline-rewind-confined-"));
    const directory = join(home, "projects", "project");
    await mkdir(directory, { recursive: true });
    const outside = join(home, "outside.jsonl");
    await writeFile(outside, JSON.stringify({ uuid: "a" }) + "\n");
    await symlink(outside, join(directory, `${first}.jsonl`));
    await expect(readClaudeSessionLineage(first, home)).rejects.toThrow(/outside its provider/);
  });

  it("keeps admitted lineage when an unrelated JSON append is incomplete, never admits the tail", async () => {
    const home = await mkdtemp(join(tmpdir(), "throughline-rewind-partial-tail-"));
    const directory = join(home, "projects", "project");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, `${second}.jsonl`),
      JSON.stringify({ uuid: "current", forkedFrom: edge(first, "old") }) +
        '\n{"uuid":"unfinished",',
    );
    expect(
      await resolveClaudeRewindMessage({
        sessionId: second,
        configDir: home,
        currentMessageIds: ["current"],
        requestedIds: ["old"],
      }),
    ).toBe("current");
    expect(
      await resolveClaudeRewindMessage({
        sessionId: second,
        configDir: home,
        currentMessageIds: ["current"],
        requestedIds: ["unfinished"],
      }),
    ).toBeUndefined();
  });
});

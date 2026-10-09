import { describe, expect, it } from "vite-plus/test";
import { copyThreadValue, type ThreadCopyIdentity, type ThreadCopyRef } from "./copy/threadCopy";
import { launcherFamilyRows, validateLauncherFamilyRead } from "./copy/launcherFamily";

describe("copy sheet's route-scoped operation", () => {
  it("consumes recorded launcher lineage only for the owning public route", () => {
    const family = validateLauncherFamilyRead(
      { threadId: "thread" },
      {
        threadId: "thread",
        source: "agent-instruments.thread-lineage.v1",
        status: "recorded",
        parentThreadId: "parent",
        creatorResolution: "provided-parent",
        launcherSeat: "source-seat",
        purpose: "bounded child task",
        handle: "visible-child",
        host: "twr",
        family: { status: "recorded", rootThreadId: "root", ancestorThreadIds: ["parent", "root"] },
      },
    );
    const rows = launcherFamilyRows(
      { environmentId: "environment-twr", threadId: "thread" },
      { environmentId: "environment-twr", family },
    );
    expect(rows.find((row) => row.label === "Family root")?.value).toBe("root");
    expect(rows.find((row) => row.label === "Parent thread")?.value).toBe("parent");
  });

  it("refuses lineage returned for another owning environment or public thread", () => {
    const family = {
      threadId: "thread",
      source: "agent-instruments.thread-lineage.v1" as const,
      status: "unknown" as const,
      reason: "no recorded creation",
    };
    expect(() =>
      launcherFamilyRows(
        { environmentId: "mac", threadId: "thread" },
        { environmentId: "twr", family },
      ),
    ).toThrow("owning environment");
    expect(() => validateLauncherFamilyRead({ threadId: "another-thread" }, family)).toThrow(
      "another public thread",
    );
  });

  it("keeps an unknown root unknown without substituting a native or requested identity", () => {
    const family = {
      threadId: "thread",
      source: "agent-instruments.thread-lineage.v1" as const,
      status: "unknown" as const,
      reason: "no recorded creation",
    };
    const rows = launcherFamilyRows(
      { environmentId: "twr", threadId: "thread" },
      { environmentId: "twr", family },
    );
    expect(rows.find((row) => row.label === "Family root")?.value).toBe(
      "Unknown · no recorded creation",
    );
  });

  it("copies identity from the current owning route, not another host with the same thread id", async () => {
    const routes = new Map<string, ThreadCopyIdentity>([
      [
        "mac:thread",
        {
          environmentId: "mac",
          threadId: "thread",
          session: { providerSessionId: "mac-provider", nativeSessionId: "mac-native" },
        },
      ],
      [
        "twr:thread",
        {
          environmentId: "twr",
          threadId: "thread",
          session: { providerSessionId: "twr-provider", nativeSessionId: "twr-native" },
        },
      ],
    ]);
    let clipboard = "untouched";
    const read = (ref: ThreadCopyRef) => routes.get(`${ref.environmentId}:${ref.threadId}`) ?? null;
    const write = async (value: string) => {
      clipboard = value;
    };
    await copyThreadValue({
      ref: { environmentId: "mac", threadId: "thread" },
      field: "native-session",
      read,
      write,
    });
    expect(clipboard).toBe("mac-native");
    await copyThreadValue({
      ref: { environmentId: "twr", threadId: "thread" },
      field: "provider-session",
      read,
      write,
    });
    expect(clipboard).toBe("twr-provider");
  });

  it("rejects stale route identity without replacing clipboard contents", async () => {
    let clipboard = "keep-existing-clipboard";
    await expect(
      copyThreadValue({
        ref: { environmentId: "twr", threadId: "new-thread" },
        field: "thread",
        read: () => ({ environmentId: "twr", threadId: "old-thread", session: null }),
        write: async (value) => {
          clipboard = value;
        },
      }),
    ).rejects.toThrow("owning environment and thread");
    expect(clipboard).toBe("keep-existing-clipboard");
  });

  it("preserves unavailable native identity instead of copying a provider id as its substitute", async () => {
    let clipboard = "unchanged";
    const ref = { environmentId: "twr", threadId: "thread" };
    expect(
      await copyThreadValue({
        ref,
        field: "native-session",
        read: () => ({
          ...ref,
          session: { providerSessionId: "provider-only", nativeSessionId: undefined },
        }),
        write: async (value) => {
          clipboard = value;
        },
      }),
    ).toBe("unavailable");
    expect(clipboard).toBe("unchanged");
  });
});

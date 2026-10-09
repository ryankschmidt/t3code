import { describe, expect, it } from "vite-plus/test";
import { copyThreadValue, type ThreadCopyIdentity, type ThreadCopyRef } from "./copy/threadCopy";

describe("copy sheet's route-scoped operation", () => {
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

import { describe, expect, it } from "vite-plus/test";
import { readWebReleaseIdentity, readExpoReleaseIdentity } from "./index.ts";

const fullCommit = "79aa410c4656683ac3f15df7e65f520f00666a31";
const identity = { release: "0.0.52", fullCommit };
const unknown = { release: null, fullCommit: null };

describe("compiled client identity readers", () => {
  it("reads web identity only from the compiler's two explicit constants", () => {
    expect(
      readWebReleaseIdentity({ APP_VERSION: identity.release, APP_COMMIT: fullCommit }),
    ).toEqual(identity);
    expect(readWebReleaseIdentity({ APP_VERSION: identity.release, APP_COMMIT: "HEAD" })).toEqual({
      release: identity.release,
      fullCommit: null,
    });
  });

  it("reads the embedded Expo identity without substituting native or manifest IDs", () => {
    expect(readExpoReleaseIdentity({ extra: { throughlineReleaseIdentity: identity } })).toEqual(
      identity,
    );
    expect(
      readExpoReleaseIdentity({
        version: identity.release,
        runtimeVersion: fullCommit,
        nativeBuildVersion: "123",
        updateId: fullCommit,
        extra: { throughlineVersion: identity.release },
      }),
    ).toEqual(unknown);
  });

  it("never falls back to server/request metadata or a later checkout identity", () => {
    const misleading = {
      release: identity.release,
      fullCommit,
      serverVersion: identity.release,
      serverCommit: fullCommit,
      requestedRelease: identity.release,
      requestedCommit: fullCommit,
      HEAD: fullCommit,
      nativeBuildVersion: "123",
      updateId: fullCommit,
    };
    expect(readWebReleaseIdentity(misleading)).toEqual(unknown);
    expect(readExpoReleaseIdentity(misleading)).toEqual(unknown);
  });

  it("keeps missing, malformed, short and placeholder embedded commits null", () => {
    for (const bad of [undefined, null, "", "unknown", fullCommit.slice(0, 12), "0".repeat(40)]) {
      expect(
        readWebReleaseIdentity({ APP_VERSION: identity.release, APP_COMMIT: bad }).fullCommit,
      ).toBeNull();
      expect(
        readExpoReleaseIdentity({
          extra: {
            throughlineReleaseIdentity: {
              release: identity.release,
              fullCommit: bad,
            },
          },
        }).fullCommit,
      ).toBeNull();
    }
    for (const input of [undefined, null, [], {}, "value", 123, { extra: [] }]) {
      expect(readWebReleaseIdentity(input)).toEqual(unknown);
      expect(readExpoReleaseIdentity(input)).toEqual(unknown);
    }
  });

  it("does not relabel the embedded build when runtime requested metadata changes", () => {
    const web = { APP_VERSION: identity.release, APP_COMMIT: fullCommit, requestedCommit: "old" };
    const expo = { extra: { throughlineReleaseIdentity: identity }, requestedCommit: "old" };
    const beforeWeb = readWebReleaseIdentity(web);
    const beforeExpo = readExpoReleaseIdentity(expo);
    web.requestedCommit = "new";
    expo.requestedCommit = "new";
    expect(readWebReleaseIdentity(web)).toEqual(beforeWeb);
    expect(readExpoReleaseIdentity(expo)).toEqual(beforeExpo);
    expect(readExpoReleaseIdentity(JSON.parse(JSON.stringify(expo)))).toEqual(identity);
  });
});

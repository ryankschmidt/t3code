import { describe, expect, it } from "@effect/vitest";
import * as Protocol from "./protocol.ts";

describe("app metadata hello binding", () => {
  it("binds supplied release and platform, never substitutes a version or platform", () => {
    expect(
      Protocol.clientHelloFromMetadata({ release: "0.0.52", platform: "iOS", commit: null }, [
        "environmentThemes",
      ]),
    ).toEqual({
      protocol_version: 1,
      release: "0.0.52",
      platform: "iOS",
      commit: null,
      capabilities: ["environmentThemes"],
      last_cursor: null,
    });
  });
  it("omits hello when actual release or platform metadata is absent", () => {
    expect(Protocol.clientHelloFromMetadata({ platform: "Android" }, [])).toBeUndefined();
    expect(Protocol.clientHelloFromMetadata({ release: "0.0.52" }, [])).toBeUndefined();
    expect(Protocol.clientHelloFromMetadata({ release: " ", platform: "web" }, [])).toBeUndefined();
  });
  it("keeps a supplied build-commit witness rather than inferring one", () => {
    expect(
      Protocol.clientHelloFromMetadata(
        { release: "0.0.52", platform: "macOS", commit: "real-build-fixture" },
        [],
      )?.commit,
    ).toBe("real-build-fixture");
  });
});

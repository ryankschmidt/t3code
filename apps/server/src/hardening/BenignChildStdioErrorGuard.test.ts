import { describe, expect, it } from "vite-plus/test";

import {
  installBenignChildStdioErrorGuard,
  isBenignChildStdioError,
} from "./BenignChildStdioErrorGuard.ts";

function errnoError(code: string, syscall?: string): NodeJS.ErrnoException {
  const error = new Error(`${syscall ?? "op"} ${code}`) as NodeJS.ErrnoException;
  error.code = code;
  if (syscall !== undefined) error.syscall = syscall;
  return error;
}

describe("isBenignChildStdioError", () => {
  it("classifies the live crash shape as benign (read ECONNRESET)", () => {
    // The 2026-07-05 server kill: unhandled 'error' on a child stdio Socket
    // after its Effect teardown — Error: read ECONNRESET.
    expect(isBenignChildStdioError(errnoError("ECONNRESET", "read"))).toBe(true);
  });

  it("classifies write-side teardown noise as benign (EPIPE, premature close)", () => {
    expect(isBenignChildStdioError(errnoError("EPIPE", "write"))).toBe(true);
    expect(isBenignChildStdioError(errnoError("ERR_STREAM_PREMATURE_CLOSE"))).toBe(true);
  });

  it("keeps everything else fatal", () => {
    expect(isBenignChildStdioError(errnoError("ECONNRESET", "connect"))).toBe(false);
    expect(isBenignChildStdioError(errnoError("ECONNREFUSED", "connect"))).toBe(false);
    expect(isBenignChildStdioError(new Error("plain failure"))).toBe(false);
    expect(isBenignChildStdioError(new TypeError("undefined is not a function"))).toBe(false);
    expect(isBenignChildStdioError("not an error")).toBe(false);
    expect(isBenignChildStdioError(undefined)).toBe(false);
  });
});

describe("installBenignChildStdioErrorGuard", () => {
  it("absorbs benign errors via log and routes everything else to fatal", () => {
    const logged: string[] = [];
    const fatalSeen: unknown[] = [];
    const before = process.listeners("uncaughtException");
    installBenignChildStdioErrorGuard({
      log: (message) => logged.push(message),
      fatal: (error) => {
        fatalSeen.push(error);
        throw new Error("fatal-called");
      },
    });
    const added = process
      .listeners("uncaughtException")
      .filter((listener) => !before.includes(listener));
    expect(added).toHaveLength(1);
    const handler = added[0] as (error: unknown) => void;
    try {
      handler(errnoError("ECONNRESET", "read"));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain("ECONNRESET");
      expect(fatalSeen).toHaveLength(0);

      expect(() => handler(new Error("real bug"))).toThrow("fatal-called");
      expect(fatalSeen).toHaveLength(1);
    } finally {
      process.removeListener("uncaughtException", handler as NodeJS.UncaughtExceptionListener);
    }
  });
});

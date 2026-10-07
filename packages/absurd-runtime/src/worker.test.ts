import { describe, expect, it, vi } from "vite-plus/test";

import { prepareAbsurdQueue } from "./worker.ts";

describe("prepareAbsurdQueue", () => {
  it("creates a new queue before its worker starts", async () => {
    const createQueue = vi.fn(async () => undefined);

    await prepareAbsurdQueue({ createQueue }, "t3-interactive-turns");

    expect(createQueue).toHaveBeenCalledExactlyOnceWith("t3-interactive-turns");
  });

  it("accepts an already-existing queue on warm boot", async () => {
    const createQueue = vi.fn(async () => {
      throw new Error("relation already exists");
    });

    await expect(
      prepareAbsurdQueue({ createQueue }, "t3-interactive-turns"),
    ).resolves.toBeUndefined();
  });
});

import { AsyncLocalStorage } from "node:async_hooks";
import { spawn, type StdioOptions } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";

const owner = new AsyncLocalStorage<number>();

/** Mutating descendants retain the same open-file-description lock if their Node owner dies. */
export function publicationChildStdio(): StdioOptions {
  const fd = owner.getStore();
  return fd === undefined ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "pipe", fd];
}

/** Linux flock ownership belongs to open descriptors, not a PID file or an unlinkable claim. */
export async function withPublicationLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  if (process.platform !== "linux")
    throw new Error("PUBLICATION_LOCK_UNSUPPORTED_PLATFORM: Linux required");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const handle = await open(
    join(root, "publication.lock"),
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("PUBLICATION_LOCK_INVALID_FILE");
    // Prior releases stored PID JSON. Never bypass a potentially running old publisher.
    if (stat.size !== 0) throw new Error("PUBLICATION_LOCK_LEGACY_REQUIRES_OFFLINE_MIGRATION");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "/usr/bin/flock",
        ["--exclusive", "--timeout", "5", "--conflict-exit-code", "75", "3"],
        {
          env: { PATH: "/usr/bin:/bin", LANG: "C" },
          stdio: ["ignore", "ignore", "pipe", handle.fd],
          timeout: 6500,
          killSignal: "SIGKILL",
        },
      );
      let diagnostic = "";
      child.stderr?.on("data", (data: Buffer) => {
        diagnostic = (diagnostic + data.toString()).slice(0, 2048);
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              code === 75
                ? "PUBLICATION_LOCK_TIMEOUT"
                : `PUBLICATION_LOCK_ACQUIRE_FAILED: ${code ?? signal} ${diagnostic}`,
            ),
          );
      });
    });
    return await owner.run(handle.fd, fn);
  } finally {
    // Closing this descriptor cannot unlock a surviving descendant's descriptor. Never unlink
    // the inode or issue LOCK_UN: either would permit a second writer during descendant cleanup.
    await handle.close();
  }
}

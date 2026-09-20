import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, normalize } from "node:path";

/** Only a trusted service supplies authorityUid. A request can never choose it. */
export async function assertProtectedPath(path: string, authorityUid: number): Promise<void> {
  if (
    !isAbsolute(path) ||
    normalize(path) !== path ||
    path.includes("\0") ||
    !Number.isSafeInteger(authorityUid) ||
    authorityUid < 0
  )
    throw Error("UNTRUSTED_PATH");
  let current = path;
  for (;;) {
    const stat = await lstat(current);
    if (
      stat.isSymbolicLink() ||
      (stat.uid !== 0 && stat.uid !== authorityUid) ||
      (stat.mode & 0o022) !== 0 ||
      (current !== path && !stat.isDirectory())
    ) {
      throw Error("UNTRUSTED_PATH");
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export async function readProtectedJson(
  path: string,
  authorityUid: number,
  maxBytes = 65536,
): Promise<unknown> {
  await assertProtectedPath(path, authorityUid);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      (stat.uid !== 0 && stat.uid !== authorityUid) ||
      (stat.mode & 0o022) !== 0 ||
      stat.size < 1 ||
      stat.size > maxBytes
    )
      throw Error("UNTRUSTED_PATH");
    // Bounded read even if a trusted writer grows the file after fstat.
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) throw Error("UNTRUSTED_PATH");
    return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
  } finally {
    await file.close();
  }
}

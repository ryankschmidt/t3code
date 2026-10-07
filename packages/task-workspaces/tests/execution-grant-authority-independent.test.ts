import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rename, rm, truncate } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ExecutionGrantAuthority } from "../src/execution-grant-authority.ts";

for (const damage of ["missing", "empty"] as const) {
  test(
    `writer reopen must not reset revoked authority after ${damage} database loss`,
    { skip: process.platform !== "linux" },
    async (t) => {
      const root = await mkdtemp(join(homedir(), ".grant-independent-loss-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      const options = { root, authorityUid: process.getuid!() };
      const authority = await ExecutionGrantAuthority.bootstrap(options);
      try {
        const execution = await authority.attest(process.pid);
        const issued = await authority.issue({
          requestId: "issue",
          grantId: "retired",
          principal: { id: "worker", kind: "worker", taskIds: ["task"] },
          execution,
          expiresAt: Date.now() + 60_000,
        });
        await authority.revoke({
          requestId: "revoke",
          grantId: "retired",
          expectedRevision: issued.revision,
          expectedDigest: issued.digest,
        });
        assert.equal((await authority.read("retired"))?.status, "revoked");
      } finally {
        authority.close();
      }
      const database = join(root, ".authority", "grants.sqlite");
      if (damage === "missing") await rename(database, `${database}.lost-fixture`);
      else await truncate(database, 0);
      // Ordinary reopen is not explicit bootstrap/recovery authorization.
      // If it silently recreates tables, revocation and request history vanish.
      await assert.rejects(
        async () => {
          const reopened = await ExecutionGrantAuthority.open(options);
          try {
            assert.notEqual(await reopened.read("retired"), null, "REVOCATION_HISTORY_LOST");
          } finally {
            reopened.close();
          }
        },
        (error) => !(error instanceof assert.AssertionError),
      );
    },
  );
}

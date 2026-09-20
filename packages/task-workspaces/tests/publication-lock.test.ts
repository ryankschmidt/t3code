import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withPublicationLock } from "../src/publication-lock.ts";
import { PublicationStore } from "../src/index.ts";

const linux = { skip: process.platform !== "linux", timeout: 30000 };
const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
const lockUrl = new URL(`../src/publication-lock.${extension}`, import.meta.url).href;
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "publication-lock-proof-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function holder(t: test.TestContext, root: string, descendant = false) {
  const code = `
    import { withPublicationLock, publicationChildStdio } from ${JSON.stringify(lockUrl)};
    import { spawn } from 'node:child_process';
    await withPublicationLock(${JSON.stringify(root)}, async () => {
      ${
        descendant
          ? `
        const child = spawn(process.execPath, ['-e', ${JSON.stringify("process.stdout.write('READY\\n');setInterval(()=>{},1000)")}], {stdio:publicationChildStdio()});
        child.stderr.pipe(process.stderr);
        child.once('exit',()=>process.exit(1));
        child.stdout.once('data',()=>process.stdout.write(JSON.stringify({held:true,descendant:child.pid})+'\\n'));
      `
          : `process.stdout.write(JSON.stringify({held:true})+'\\n');`
      }
      await new Promise(()=>setInterval(()=>{},1000));
    });`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostic = "";
  child.stderr!.on("data", (b: Buffer) => {
    diagnostic += b.toString();
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  const ready = await new Promise<{ held: true; descendant?: number }>((resolve, reject) => {
    let text = "";
    child.stdout!.on("data", (b: Buffer) => {
      text += b.toString();
      if (text.includes("\n")) resolve(JSON.parse(text.split("\n")[0]!));
    });
    child.once("exit", (code) => reject(new Error(`holder exited ${code}: ${diagnostic}`)));
  });
  if (ready.descendant)
    t.after(() => {
      try {
        process.kill(ready.descendant!, "SIGKILL");
      } catch {}
    });
  return { child, ...ready };
}
async function kill(child: ChildProcess) {
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  const [, signal] = await exited;
  assert.equal(signal, "SIGKILL");
}

test("live owner cannot be stolen and contention has a bounded timeout", linux, async (t) => {
  const root = await fixture(t);
  const { child } = await holder(t, root);
  const start = performance.now();
  await assert.rejects(
    withPublicationLock(root, async () => assert.fail("entered while live owner held lock")),
    /PUBLICATION_LOCK_TIMEOUT/,
  );
  assert.ok(performance.now() - start >= 4500);
  assert.ok(performance.now() - start < 10000);
  await kill(child);
  await withPublicationLock(root, async () => {});
});

test(
  "SIGKILL releases owner and fresh publication preserves state and replay",
  linux,
  async (t) => {
    const root = await fixture(t);
    const store = new PublicationStore({ root });
    await store.initialize({ "a.txt": "before", "b.txt": "preserved" });
    const task = await store.openTask({ taskId: "task", agentId: "worker", scope: ["a.txt"] });
    const { child } = await holder(t, root);
    await kill(child);
    const fresh = new PublicationStore({ root });
    const changes = [{ path: "a.txt", content: "after" }];
    const prepared = await fresh.preparePublication({ taskId: task.taskId, changes });
    const request = {
      taskId: task.taskId,
      requestId: "after-death",
      changes,
      check: { ...prepared, passed: true as const, reviewerId: "reviewer" },
    };
    const receipt = await fresh.publish(request);
    assert.deepEqual(await new PublicationStore({ root }).publish(request), receipt);
    assert.equal(await fresh.readAccepted("a.txt"), "after");
    assert.equal(await fresh.readAccepted("b.txt"), "preserved");
  },
);

test("surviving mutating child retains exclusion after Node owner SIGKILL", linux, async (t) => {
  const root = await fixture(t);
  const { child, descendant } = await holder(t, root, true);
  assert.ok(descendant);
  await kill(child);
  await assert.rejects(
    withPublicationLock(root, async () => assert.fail("surviving child lost exclusion")),
    /PUBLICATION_LOCK_TIMEOUT/,
  );
  process.kill(descendant, "SIGKILL");
  await withPublicationLock(root, async () => {});
});

test(
  "concurrent same-process owners serialize without blocking the event loop",
  linux,
  async (t) => {
    const root = await fixture(t);
    let active = 0,
      maximum = 0,
      completed = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        withPublicationLock(root, async () => {
          active++;
          maximum = Math.max(maximum, active);
          await new Promise<void>((resolve) => setImmediate(resolve));
          completed++;
          active--;
        }),
      ),
    );
    assert.equal(maximum, 1);
    assert.equal(completed, 8);
  },
);

test("real Git subprocess and its child inherit the publication inode", linux, async (t) => {
  const root = await fixture(t);
  const store = new PublicationStore({ root });
  await store.initialize({ "a.txt": "a" });
  const probe = store as unknown as {
    locked<T>(fn: () => Promise<T>): Promise<T>;
    git(args: string[]): string;
  };
  const inherited = await probe.locked(async () =>
    probe.git(["-c", "alias.lock-probe=!/usr/bin/readlink /proc/self/fd/3", "lock-probe"]),
  );
  assert.equal(inherited.trim(), join(root, "publication.lock"));
});

test(
  "concurrent processes after owner death have only one critical-section owner",
  linux,
  async (t) => {
    const root = await fixture(t);
    const { child } = await holder(t, root);
    await kill(child);
    const code = `
    import {withPublicationLock} from ${JSON.stringify(lockUrl)};
    import {open,unlink} from 'node:fs/promises';
    await withPublicationLock(${JSON.stringify(root)}, async()=>{
      const marker=${JSON.stringify(join(root, "critical-section"))};
      const fd=await open(marker,'wx');
      await new Promise(resolve=>setImmediate(resolve));
      await fd.close(); await unlink(marker);
    });`;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        const contender = spawn(process.execPath, ["--input-type=module", "-e", code], {
          stdio: ["ignore", "ignore", "pipe"],
        });
        let errors = "";
        contender.stderr!.on("data", (b: Buffer) => {
          errors += b.toString();
        });
        const [exitCode] = await once(contender, "exit");
        assert.equal(exitCode, 0, errors);
      }),
    );
  },
);

test(
  "legacy PID files and symlink lock paths refuse rather than being stolen",
  linux,
  async (t) => {
    const root = await fixture(t);
    const path = join(root, "publication.lock");
    await writeFile(path, JSON.stringify({ pid: 99999999 }));
    await assert.rejects(
      withPublicationLock(root, async () => {}),
      /LEGACY_REQUIRES_OFFLINE_MIGRATION/,
    );
    await rm(path);
    const other = join(root, "other");
    await writeFile(other, "");
    await symlink(other, path);
    await assert.rejects(withPublicationLock(root, async () => {}));
  },
);

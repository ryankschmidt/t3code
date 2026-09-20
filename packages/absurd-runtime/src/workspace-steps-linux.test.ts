import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { Absurd } from "absurd-sdk";
import { bindWorkspaceSteps } from "./workspace-steps.ts";

// Explicit fixture inputs. Never connects to the live ThroughLine database or
// consumes its environment/credentials. The private socket has no TCP listener.
test(
  "real Absurd retry recovers stable execution references after client replacement",
  {
    skip:
      process.platform !== "linux" ||
      !process.env.WORKSPACE_TEST_PG_BIN ||
      !process.env.WORKSPACE_TEST_ABSURD_SQL,
    timeout: 30000,
  },
  async (t) => {
    const root = await mkdtemp(join(homedir(), ".tlpg-"));
    const bin = process.env.WORKSPACE_TEST_PG_BIN!,
      data = join(root, "data");
    execFileSync(
      join(bin, "initdb"),
      ["-D", data, "--no-locale", "--encoding=UTF8", "--username=fixture", "--auth=trust"],
      { timeout: 15000, stdio: "pipe" },
    );
    const server = spawn(
      join(bin, "postgres"),
      ["-D", data, "-k", root, "-c", "listen_addresses=", "-c", "port=55483"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const serverExit = new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.once("close", () => resolve());
    });
    const pool = new pg.Pool({
      host: root,
      port: 55483,
      user: "fixture",
      database: "postgres",
      connectionTimeoutMillis: 1000,
    });
    let app: Absurd | undefined;
    t.after(async () => {
      await app?.close();
      await pool.end();
      if (server.exitCode === null && server.signalCode === null) server.kill("SIGINT");
      await serverExit;
      await rm(root, { recursive: true, force: true });
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("FIXTURE_POSTGRES_START_TIMEOUT")), 10000);
      let log = "";
      const observe = (chunk: Buffer) => {
        log = (log + chunk.toString()).slice(-8192);
        if (log.includes("database system is ready to accept connections")) {
          clearTimeout(timer);
          resolve();
        }
      };
      server.stderr.on("data", observe);
      server.stdout.resume();
      server.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      server.once("exit", () => {
        clearTimeout(timer);
        reject(Error("FIXTURE_POSTGRES_EXITED"));
      });
    });
    await pool.query(await readFile(process.env.WORKSPACE_TEST_ABSURD_SQL!, "utf8"));
    const queueName = "workspace-steps-proof";
    let admissions = 0,
      launches = 0,
      releases = 0,
      attempts = 0;
    const register = (instance: Absurd) =>
      instance.registerTask(
        { name: "execution-proof", defaultMaxAttempts: 1 },
        async (_params, ctx) => {
          attempts++;
          const step = bindWorkspaceSteps(ctx);
          const admitted = await step("execution:run:admission", async () => {
            admissions++;
            return { deadline: 1777777777000, run: "fixed-run" };
          });
          const launch = async () => {
            launches++;
            return { pid: 123, invocation: "fixed-invocation" };
          };
          const [a, b] = await Promise.all([
            step("execution:run:launch", launch),
            step("execution:run:launch", launch),
          ]);
          assert.deepEqual(a, b);
          await step("execution:run:release", async () => {
            releases++;
            return { released: true };
          });
          if (attempts === 1) throw Error("INTERRUPTED_AFTER_RELEASE_CHECKPOINT");
          assert.deepEqual(
            await bindWorkspaceSteps(ctx)("execution:run:admission", async () => {
              throw Error("REPEAT_ADMISSION");
            }),
            admitted,
          );
          return { state: "provider-released", admitted, launch: a };
        },
      );
    app = new Absurd({ db: pool, queueName });
    await app.createQueue();
    register(app);
    const first = await app.spawn("execution-proof", {}, { maxAttempts: 1 });
    await app.workBatch("proof-first", 10, 1);
    assert.equal((await app.fetchTaskResult(first.taskID))?.state, "failed");
    await app.close();
    app = new Absurd({ db: pool, queueName });
    register(app);
    const retry = await app.retryTask(first.taskID, { maxAttempts: 2 });
    assert.equal(retry.taskID, first.taskID);
    await app.workBatch("proof-resumed", 10, 1);
    const result = await app.fetchTaskResult(first.taskID);
    assert.equal(result?.state, "completed");
    assert.equal(
      result?.state === "completed" && (result.result as { state: string }).state,
      "provider-released",
    );
    assert.deepEqual(
      { admissions, launches, releases, attempts },
      { admissions: 1, launches: 1, releases: 1, attempts: 2 },
    );
    console.log(
      JSON.stringify({
        proof: "real-postgres-retry",
        taskId: first.taskID,
        attempts,
        admissions,
        launches,
        releases,
        productionDatabaseAccess: false,
      }),
    );
  },
);

/**
 * worker-supervisor — pg-pool recovery for Absurd workers (landing defect fix).
 *
 * THE DEFECT: the SDK's `startWorker` claim loop catches every claim error,
 * logs `Worker error:`, sleeps one poll interval, and retries INTO THE SAME
 * POOL OBJECT forever. Pool connections that die (e.g. created during a
 * starved cold-boot window, then terminated) are never evicted, so a broken
 * pool turns the worker into a permanent ~4 errors/sec loop. Observed live:
 * repeating `Worker error: Connection terminated unexpectedly` after the
 * server's `Listening` line.
 *
 * THE FIX at the seam this package controls: the pool is private to each
 * `Absurd` instance, so recovery = RECREATE THE APP (fresh pool), re-register
 * its tasks, and restart the worker — under bounded exponential backoff. All
 * durable state lives in Postgres and task registration is pure, so app
 * recreation is safe by construction; abandoned claims from a dead generation
 * are reclaimed by the engine's `$ClaimTimeout` lease machinery.
 *
 * Detection: only connection-class errors count (task-execution failures never
 * trigger recreation). A broken pool errors once per poll (~4/sec at the
 * 0.25s default), so `maxConsecutiveInfraErrors` consecutive infra errors with
 * no gap larger than `streakGapMs` is the dead-pool signature; a quiet gap
 * resets the streak because a recovered loop stops erroring entirely.
 *
 * Consumers must read `handle.app` at USE time (it is a live getter onto the
 * current generation) — capturing the app object across turns would pin a
 * possibly-dead generation.
 */

/** Structural surface of `Absurd` the supervisor needs (SDK d.ts shapes). */
export interface SupervisableApp {
  startWorker(options?: {
    concurrency?: number;
    onError?: (error: Error) => void;
  }): Promise<{ close(): Promise<void> }>;
  close(): Promise<void>;
}

export type WorkerSupervisorOptions<A extends SupervisableApp> = {
  /** Log prefix, e.g. "absurd-runtime:t3-absurd-runtime". */
  label: string;
  /** Construct a fresh app (fresh pg pool). Called once per generation. */
  createApp: () => A;
  /** Register the generation's tasks. Must be pure/idempotent per app. */
  registerTasks: (app: A) => void;
  /**
   * Optional per-generation queue preparation (e.g. idempotent createQueue).
   * Throwing marks the generation start as failed and re-enters backoff —
   * swallow "already exists" inside, throw infra errors out.
   */
  prepareQueue?: (app: A) => Promise<void>;
  /** Worker concurrency for every generation. */
  concurrency: number;
  /** Consecutive infra errors that declare the pool dead. Default 5. */
  maxConsecutiveInfraErrors?: number;
  /** A quiet gap longer than this resets the streak (ms). Default 10_000. */
  streakGapMs?: number;
  /** Backoff base before each recreation attempt (ms). Default 1_000. */
  backoffBaseMs?: number;
  /** Backoff cap (ms). Default 30_000. */
  backoffCapMs?: number;
  /** Bound on waiting for a dead generation's close() (ms). Default 5_000. */
  closeTimeoutMs?: number;
  /** Injectable clock/sleep/log for deterministic checks. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

export type SupervisedWorkerHandle<A extends SupervisableApp> = {
  /** LIVE getter onto the current generation's app — read at use time. */
  readonly app: A;
  /** 1-based generation counter (increments per recreation). */
  generation(): number;
  /** Stop supervision and close the current generation. */
  close(): Promise<void>;
};

const INFRA_ERROR_PATTERN =
  /connection terminated|connection ended|connection closed|terminating connection|econnrefused|econnreset|epipe|enotfound|etimedout|timeout exceeded when trying to connect|client has encountered a connection error|the database system is (?:starting|shutting) up/i;

/** Connection-class (infra) error vs task-execution error. Exported for checks. */
export function isInfraConnectionError(error: unknown): boolean {
  if (error instanceof Error) {
    if (INFRA_ERROR_PATTERN.test(error.message)) return true;
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && INFRA_ERROR_PATTERN.test(cause.message)) return true;
    return false;
  }
  return typeof error === "string" && INFRA_ERROR_PATTERN.test(error);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start an Absurd worker under pool-recovery supervision. Fire-and-forget like
 * the SDK's own start pattern: returns the handle synchronously; start/restart
 * failures are logged and retried, never thrown to the caller.
 */
export function startSupervisedWorker<A extends SupervisableApp>(
  options: WorkerSupervisorOptions<A>,
): SupervisedWorkerHandle<A> {
  const maxStreak = options.maxConsecutiveInfraErrors ?? 5;
  const streakGapMs = options.streakGapMs ?? 10_000;
  const backoffBaseMs = options.backoffBaseMs ?? 1_000;
  const backoffCapMs = options.backoffCapMs ?? 30_000;
  const closeTimeoutMs = options.closeTimeoutMs ?? 5_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? ((message: string) => console.error(message));

  let currentApp = options.createApp();
  options.registerTasks(currentApp);
  let generation = 1;
  let closed = false;
  let recreating = false;
  let streak = 0;
  let lastInfraErrorAt = 0;

  const onWorkerError = (error: Error): void => {
    log(`[${options.label}] worker error (generation ${generation}): ${error.message}`);
    if (closed || !isInfraConnectionError(error)) {
      streak = 0;
      return;
    }
    const at = now();
    if (at - lastInfraErrorAt > streakGapMs) streak = 0;
    lastInfraErrorAt = at;
    streak += 1;
    if (streak >= maxStreak && !recreating) {
      recreating = true;
      void recreate();
    }
  };

  const startGeneration = async (): Promise<void> => {
    if (options.prepareQueue) await options.prepareQueue(currentApp);
    await currentApp.startWorker({ concurrency: options.concurrency, onError: onWorkerError });
  };

  const closeBounded = (app: A): Promise<void> =>
    Promise.race([
      app.close().catch((error: unknown) => {
        log(
          `[${options.label}] close of dead generation failed (ignored): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }),
      sleep(closeTimeoutMs),
    ]);

  const recreate = async (): Promise<void> => {
    let attempt = 0;
    while (!closed) {
      attempt += 1;
      const delay = Math.min(backoffBaseMs * 2 ** (attempt - 1), backoffCapMs);
      log(
        `[${options.label}] pg pool presumed dead (${streak} consecutive connection errors); ` +
          `recreating app as generation ${generation + 1} in ${delay}ms (attempt ${attempt})`,
      );
      await sleep(delay);
      if (closed) return;
      await closeBounded(currentApp);
      try {
        const next = options.createApp();
        options.registerTasks(next);
        currentApp = next;
        generation += 1;
        streak = 0;
        lastInfraErrorAt = 0;
        await startGeneration();
        log(`[${options.label}] recovered: generation ${generation} worker started on a fresh pool`);
        recreating = false;
        return;
      } catch (error) {
        log(
          `[${options.label}] generation restart failed (attempt ${attempt}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  };

  void startGeneration().catch((error: unknown) => {
    log(
      `[${options.label}] initial worker start failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    if (!closed && !recreating && isInfraConnectionError(error)) {
      recreating = true;
      streak = maxStreak;
      void recreate();
    }
  });

  return {
    get app(): A {
      return currentApp;
    },
    generation: () => generation,
    close: async () => {
      closed = true;
      await closeBounded(currentApp);
    },
  };
}

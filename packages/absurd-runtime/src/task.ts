/**
 * Durable task definition for the absurd-runtime overlay capability module.
 *
 * This is the "capability module" core: a single durable task built from
 * checkpointed `ctx.step(...)` calls. Each step's result is persisted in
 * Postgres by Absurd, so a crash resumes from the last completed step
 * instead of re-running it.
 *
 * The task is defined here once and registered onto an `Absurd` app by
 * `registerHealthProbeTask`. Both the smoke entrypoint (src/smoke.ts) and the
 * reusable worker starter (src/worker.ts) import this so the durable contract
 * lives in exactly one place.
 *
 * Modeled on absurd-sandbox/src/demo.ts (the proven one-shot pattern).
 */
import type { Absurd } from "absurd-sdk";

/** Input params for the durable health-probe task. */
export type HealthProbeParams = {
  /** A caller-supplied correlation id, echoed back in the result. */
  probeId: string;
  /** Arbitrary component names this probe "checks" (kept simple for the smoke). */
  components: string[];
};

/** Shape of the durable result returned once all checkpoints complete. */
export type HealthProbeResult = {
  probeId: string;
  acquired: { token: string };
  checks: { component: string; ok: true }[];
  summary: { total: number; ok: number };
  status: "healthy";
};

/** The canonical task name used to register and spawn this durable task. */
export const HEALTH_PROBE_TASK = "absurd-runtime.health-probe" as const;

/**
 * Register the durable health-probe task onto an Absurd app.
 *
 * Uses TWO checkpointed steps (`acquire-lease` and `run-checks`) plus a final
 * `summarize` step — well over the required two `ctx.step` calls — so the
 * durability evidence shows multiple persisted checkpoints per task.
 */
export function registerHealthProbeTask(app: Absurd): void {
  app.registerTask<HealthProbeParams>(
    { name: HEALTH_PROBE_TASK, defaultMaxAttempts: 5 },
    async (params, ctx) => {
      // Checkpoint 1: acquire a (fake) lease. Persisted in Postgres.
      const acquired = await ctx.step("acquire-lease", async () => {
        console.log(`[${ctx.taskID}] acquiring lease for probe ${params.probeId}`);
        return { token: `lease-${ctx.taskID}` };
      });

      // Checkpoint 2: run the per-component checks. Persisted in Postgres.
      const checks = await ctx.step("run-checks", async () => {
        console.log(
          `[${ctx.taskID}] running ${params.components.length} check(s): ${params.components.join(", ")}`,
        );
        return params.components.map((component) => ({ component, ok: true as const }));
      });

      // Checkpoint 3: summarize. Persisted in Postgres.
      const summary = await ctx.step("summarize", async () => {
        console.log(`[${ctx.taskID}] summarizing results`);
        return { total: checks.length, ok: checks.filter((c) => c.ok).length };
      });

      const result: HealthProbeResult = {
        probeId: params.probeId,
        acquired,
        checks,
        summary,
        status: "healthy",
      };
      return result;
    },
  );
}

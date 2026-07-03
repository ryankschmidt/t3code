/**
 * Public API for the @t3tools/absurd-runtime overlay capability module.
 *
 * Vendor-and-overlay: this package adds Absurd durable execution to the T3 Code
 * fork without editing upstream files. Consumers (e.g. apps/server, via a single
 * named boot hook) import from here.
 */
export {
  HEALTH_PROBE_TASK,
  registerHealthProbeTask,
} from "./task.ts";
export type {
  HealthProbeParams,
  HealthProbeResult,
} from "./task.ts";
export {
  startAbsurdRuntime,
} from "./worker.ts";
export type {
  AbsurdRuntimeHandle,
  StartAbsurdRuntimeOptions,
} from "./worker.ts";

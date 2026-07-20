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
// TQ-039 slice 1: server-owned spawn seam + in-process turn rail.
export { AbsurdRuntime, AbsurdRuntimeLive } from "./layer.ts";
export {
  THREAD_RUN_TASK,
  makeLocalEchoTransport,
  registerThreadRunTask,
} from "./thread-driver.ts";
export type {
  ThreadRunParams,
  ThreadRunResult,
  ThreadTransport,
} from "./thread-driver.ts";
export { makeInProcessTransport } from "./in-process-transport.ts";
export type { InProcessTransportDeps, ReplayEvent } from "./in-process-transport.ts";
// Slice 1S (design: Slice-1S-Session-Boundary-Design.md,
// symphony-typescript-port) ruling #4 — dispatcher-authorized minimal barrel
// addition: apps/server needs the queue name to rebind the symphony spawn +
// taskStatus call sites (D4). Its sibling AGENT_QUEUE is intentionally NOT
// barrel-exported (agent-queue.ts is a same-package-only consumer today);
// SYMPHONY_QUEUE differs only because a different package (apps/server)
// genuinely needs it.
export { SYMPHONY_QUEUE } from "./symphony-queue.ts";

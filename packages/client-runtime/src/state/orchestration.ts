import { ORCHESTRATION_WS_METHODS, SYMPHONY_WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createOrchestrationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    runtimeReady: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:runtime-ready",
      tag: SYMPHONY_WS_METHODS.runtimeReady,
      staleTimeMs: 5_000,
      refreshIntervalMs: 5_000,
    }),
    turnDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:turn-diff",
      tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
    }),
    fullThreadDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:full-thread-diff",
      tag: ORCHESTRATION_WS_METHODS.getFullThreadDiff,
    }),
    archivedShellSnapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:archived-shell-snapshot",
      tag: ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
    }),
  };
}

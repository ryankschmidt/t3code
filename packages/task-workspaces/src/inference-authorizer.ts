import { readlinkSync } from "node:fs";
import { join } from "node:path";
import {
  createExecutionGrantMatcher,
  type GrantResolverOptions,
  type SnapshotGrantReader,
} from "./execution-grants.ts";
import type { InferencePermit, PeerCredentials } from "./inference-gateway.ts";

/** What the launch judge cleared for a grant: its task and the models and efforts it allowed. */
export type GrantClearance = { taskId: string; allowedModels: string[]; allowedEfforts: string[] };
export type GrantClearanceReader = {
  grantClearance(grantId: string): Promise<GrantClearance | null>;
};
export type InferenceAuthorizerOptions = GrantResolverOptions & {
  /** Required: the final registry read is its synchronous listNow(). There is no file mode. */
  store: SnapshotGrantReader;
  hostNetworkNamespace: string;
  clearances: GrantClearanceReader;
};
const namespace = (s: unknown): s is string => typeof s === "string" && /^net:\[\d+\]$/.test(s);

/**
 * The gateway's authorize(peer). The permit comes only from the kernel peer, the grant registry
 * and the launch clearance recorded with the grant; request headers and bodies never reach it.
 * Anything missing, ambiguous or mismatched returns null.
 */
export function createInferenceAuthorizer(
  options: InferenceAuthorizerOptions,
): (peer: PeerCredentials) => Promise<InferencePermit | null> {
  const store = options.store;
  const host = options.hostNetworkNamespace;
  const clearances = options.clearances;
  if (
    !store ||
    typeof store !== "object" ||
    typeof store.verify !== "function" ||
    typeof store.snapshot !== "function" ||
    !namespace(host) ||
    !clearances ||
    typeof clearances.grantClearance !== "function"
  )
    throw Error("INVALID_AUTHORIZER_CONFIGURATION");
  const matcher = createExecutionGrantMatcher(options);
  const procRoot = options.procRoot ?? "/proc";
  const now = options.now ?? Date.now;
  const verify = store.verify.bind(store);
  const snapshot = store.snapshot.bind(store);
  const clearanceFor = clearances.grantClearance.bind(clearances);
  return async (peer) => {
    try {
      const link = join(procRoot, String(peer.pid), "ns/net");
      // First pass: the peer's namespace, then the full kernel attestation and its grant.
      const firstNamespace = readlinkSync(link);
      const first = await matcher.attest(peer);
      // The awaits, in order: the clearance, then the registry reader's integrity check last.
      const clearance = await clearanceFor(first.grant.grantId);
      await verify();
      // The final checks run inside the registry snapshot: one read transaction that no other
      // connection can commit through until it ends, so the permit is correct for the registry
      // state that holds throughout them. The snapshot refuses a block that returns a promise.
      return snapshot((grants) => {
        if (grants.length > 1024) return null;
        const lastNamespace = readlinkSync(link);
        const last = matcher.matchNow(peer, grants);
        if (
          !namespace(firstNamespace) ||
          firstNamespace === host ||
          lastNamespace !== firstNamespace
        )
          return null;
        if (JSON.stringify(last) !== JSON.stringify(first)) return null;
        const grant = last.grant;
        if (grant.principal.kind !== "worker" || grant.principal.taskIds.length !== 1) return null;
        const taskId = grant.principal.taskIds[0]!;
        if (!clearance || clearance.taskId !== taskId) return null;
        // A fresh clock read after the final /proc reads: the grant has not expired meanwhile.
        if (now() >= grant.expiresAt) return null;
        return {
          taskId,
          grantId: grant.grantId,
          expiresAt: grant.expiresAt,
          allowedModels: [...clearance.allowedModels],
          allowedEfforts: [...clearance.allowedEfforts],
          networkNamespace: lastNamespace,
        };
      });
    } catch {
      return null;
    }
  };
}

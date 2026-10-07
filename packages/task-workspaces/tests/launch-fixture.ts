import type test from "node:test";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BudgetLedger } from "../src/budget-ledger.ts";
import { LaunchClearanceStore, type LaunchRequest } from "../src/launch-clearance.ts";
import type { Task } from "../src/index.ts";
import type { KernelPeer } from "../src/publisher-ipc.ts";
import type { Principal } from "../src/review-authority.ts";

/** The kernel peer of the seat that submits launch requests; its principal is "lead1". */
export const LEAD_SEAT: KernelPeer = Object.freeze({ uid: 3302, gid: 3302, pid: 502 });

/** Test helper: an operator target, a clearance store and a budget ledger under root. */
export async function launchJudge(
  t: test.TestContext,
  root: string,
  tasks: { getTask(taskId: string): Promise<Task | null> },
  resolvePrincipal: (peer: KernelPeer) => Promise<Principal>,
) {
  const authorityUid = process.getuid!();
  const targetsRoot = join(root, "operator-targets");
  const folders = [targetsRoot, join(root, "clearances"), join(root, "budget")];
  for (const folder of folders) await mkdir(folder, { mode: 0o700 });
  /** Writes a target file and sets its mode explicitly, so the umask cannot change it. */
  const writeTarget = async (targetId: string, value: unknown, mode = 0o600) => {
    await writeFile(join(targetsRoot, `${targetId}.json`), JSON.stringify(value));
    await chmod(join(targetsRoot, `${targetId}.json`), mode);
  };
  await writeTarget("target1", {
    schema: "throughline.operator-target.v1",
    targetId: "target1",
    statement: "The tower answers help questions correctly.",
  });
  const clearances = await LaunchClearanceStore.open({
    root: folders[1]!,
    authorityUid,
    targetsRoot,
    targetsOwnerUid: authorityUid,
    tasks,
    resolvePrincipal,
  });
  t.after(() => clearances.close());
  const ledger = await BudgetLedger.open({ root: folders[2]!, authorityUid });
  t.after(() => ledger.close());
  const request = (fields: Partial<LaunchRequest> = {}): LaunchRequest => ({
    requestId: "launch1",
    taskId: "task1",
    requesterId: "lead1",
    targetId: "target1",
    finishLine: "The help text says hello and nothing else changed.",
    tokenCeiling: 50000,
    allowedModels: ["gpt-test"],
    allowedEfforts: ["low"],
    ...fields,
  });
  /** Submits a request as the lead seat and, unless verdict is null, records the judge's ruling. */
  const admit = async (
    judge: KernelPeer,
    fields: Partial<LaunchRequest> = {},
    verdict: "serves" | "does-not-serve" | null = "serves",
  ) => {
    const { requestId, requestDigest } = await clearances.submitRequest(LEAD_SEAT, request(fields));
    if (verdict)
      await clearances.recordRuling(judge, {
        requestId,
        requestDigest,
        verdict,
        reason: "The finish line is the target's help behaviour.",
      });
    return requestId;
  };
  return {
    targetsRoot,
    clearanceDatabase: join(folders[1]!, "clearances.sqlite"),
    writeTarget,
    clearances,
    ledger,
    request,
    admit,
  };
}

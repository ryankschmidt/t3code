import type { KernelPeer } from "./publisher-ipc.ts";
import type { Principal } from "./review-authority.ts";
import { readFile, readdir } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { assertProtectedPath, readProtectedJson } from "./protected-files.ts";

export type ExecutionGrant = {
  schema: "throughline.execution-grant.v1";
  grantId: string;
  principal: Principal;
  uid: number;
  gid: number;
  bootId: string;
  cgroup: string;
  leaderPid: number;
  leaderStartTicks: string;
  expiresAt: number;
};
export type GrantResolverOptions = {
  grantRoot: string;
  authorityUid: number;
  procRoot?: string;
  now?: () => number;
  maxLeaseMs?: number;
  store?: ExecutionGrantReader;
};
export type ExecutionGrantReader = {
  list(): Promise<ExecutionGrant[]>;
  get(grantId: string): Promise<ExecutionGrant | null>;
};
export type ExecutionIdentity = Pick<
  ExecutionGrant,
  "uid" | "gid" | "bootId" | "cgroup" | "leaderPid" | "leaderStartTicks"
>;

const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const uint = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
const refuse = (): never => {
  throw Error("EXECUTION_GRANT_REFUSED");
};
type ProcessSnapshot = {
  pid: number;
  startTicks: string;
  uid: number;
  gid: number;
  cgroup: string;
};

function parseStat(text: string, pid: number) {
  const end = text.lastIndexOf(") ");
  if (end < 0 || !text.startsWith(`${pid} (`)) return refuse();
  const fields = text
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  const startTicks = fields[19];
  if (!startTicks || !/^\d+$/.test(startTicks) || !fields[0] || ["Z", "X", "x"].includes(fields[0]))
    return refuse();
  return startTicks;
}

async function processSnapshot(procRoot: string, pid: number): Promise<ProcessSnapshot> {
  const dir = join(procRoot, String(pid));
  const before = parseStat(await readFile(join(dir, "stat"), "utf8"), pid);
  const status = await readFile(join(dir, "status"), "utf8");
  const ids = (name: string) => {
    const row = status.match(
      new RegExp(`^${name}:\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*$`, "m"),
    );
    if (!row) return refuse();
    const values = row.slice(1).map(Number);
    if (values.some((value) => !uint(value) || value !== values[0])) return refuse();
    return values[0]!;
  };
  const cgroups = (await readFile(join(dir, "cgroup"), "utf8")).trim().split("\n");
  if (cgroups.length !== 1 || !cgroups[0]!.startsWith("0::/")) return refuse();
  const cgroup = cgroups[0]!.slice(3);
  if (
    cgroup === "/" ||
    cgroup
      .split("/")
      .slice(1)
      .some((p) => !p || p === "." || p === "..")
  )
    return refuse();
  const after = parseStat(await readFile(join(dir, "stat"), "utf8"), pid);
  if (before !== after) return refuse();
  return { pid, startTicks: before, uid: ids("Uid"), gid: ids("Gid"), cgroup };
}

/** Trusted supervisor captures this before issue; caller text is checked against a fresh kernel read. */
export async function attestExecution(
  leaderPid: number,
  procRoot = "/proc",
): Promise<ExecutionIdentity> {
  if (!uint(leaderPid) || !leaderPid || !isAbsolute(procRoot)) refuse();
  const bootPath = join(procRoot, "sys/kernel/random/boot_id");
  const bootId = (await readFile(bootPath, "utf8")).trim();
  if (!/^[a-f0-9-]{36}$/.test(bootId)) refuse();
  const snapshot = await processSnapshot(procRoot, leaderPid);
  if (!snapshot.uid || (await readFile(bootPath, "utf8")).trim() !== bootId) refuse();
  return {
    uid: snapshot.uid,
    gid: snapshot.gid,
    bootId,
    cgroup: snapshot.cgroup,
    leaderPid,
    leaderStartTicks: snapshot.startTicks,
  };
}

function parseGrant(value: unknown, file: string): ExecutionGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) return refuse();
  const g = value as ExecutionGrant;
  const allowed = [
    "schema",
    "grantId",
    "principal",
    "uid",
    "gid",
    "bootId",
    "cgroup",
    "leaderPid",
    "leaderStartTicks",
    "expiresAt",
  ];
  if (
    Object.keys(value).some((k) => !allowed.includes(k)) ||
    g.schema !== "throughline.execution-grant.v1" ||
    !identifier(g.grantId) ||
    `${g.grantId}.json` !== file ||
    !uint(g.uid) ||
    g.uid === 0 ||
    !uint(g.gid) ||
    !uint(g.leaderPid) ||
    g.leaderPid === 0 ||
    typeof g.leaderStartTicks !== "string" ||
    !/^\d+$/.test(g.leaderStartTicks) ||
    typeof g.bootId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(g.bootId) ||
    typeof g.cgroup !== "string" ||
    !g.cgroup.startsWith("/") ||
    g.cgroup === "/" ||
    !Number.isSafeInteger(g.expiresAt) ||
    !g.principal ||
    !identifier(g.principal.id) ||
    !["worker", "reviewer"].includes(g.principal.kind) ||
    Object.keys(g.principal).some((k) => !["id", "kind", "taskIds"].includes(k)) ||
    !Array.isArray(g.principal.taskIds) ||
    g.principal.taskIds.length < 1 ||
    g.principal.taskIds.length > 1024 ||
    g.principal.taskIds.some((id) => !identifier(id)) ||
    new Set(g.principal.taskIds).size !== g.principal.taskIds.length
  )
    return refuse();
  return g;
}

/** Reads a controller-owned registry; worker text and UID alone are never authorization. */
export function createExecutionGrantResolver(options: GrantResolverOptions) {
  const useStore = Object.hasOwn(options, "store");
  const store = options.store;
  if (
    useStore &&
    (!store ||
      typeof store !== "object" ||
      typeof store.list !== "function" ||
      typeof store.get !== "function")
  )
    refuse();
  const listFromStore = useStore ? store!.list.bind(store) : null;
  const getFromStore = useStore ? store!.get.bind(store) : null;
  const {
    grantRoot,
    authorityUid,
    procRoot = "/proc",
    now = Date.now,
    maxLeaseMs = 86_400_000,
  } = options;
  if (
    !uint(authorityUid) ||
    !isAbsolute(procRoot) ||
    !Number.isSafeInteger(maxLeaseMs) ||
    maxLeaseMs < 1 ||
    maxLeaseMs > 86_400_000
  )
    refuse();
  return async (peer: KernelPeer): Promise<Principal> => {
    if (!peer || !uint(peer.uid) || !uint(peer.gid) || !uint(peer.pid) || !peer.pid) refuse();
    await assertProtectedPath(grantRoot, authorityUid);
    const grants = useStore ? await listFromStore!() : null;
    if (useStore && !Array.isArray(grants)) refuse();
    const files = useStore ? grants!.map((g) => `${g.grantId}.json`) : await readdir(grantRoot);
    if (files.length > 1024) refuse();
    const instant = now();
    if (!Number.isSafeInteger(instant)) refuse();
    const bootId = (await readFile(join(procRoot, "sys/kernel/random/boot_id"), "utf8")).trim();
    const connector = await processSnapshot(procRoot, peer.pid);
    if (connector.uid !== peer.uid || connector.gid !== peer.gid) refuse();
    const matching: ExecutionGrant[] = [];
    for (const [index, file] of files.entries()) {
      if (file.startsWith(".")) continue; // Controller's atomic-write scratch files confer no grants.
      const grant = parseGrant(
        useStore ? grants![index] : await readProtectedJson(join(grantRoot, file), authorityUid),
        file,
      );
      if (
        grant.uid !== peer.uid ||
        grant.gid !== peer.gid ||
        grant.bootId !== bootId ||
        grant.cgroup !== connector.cgroup ||
        grant.expiresAt <= instant ||
        grant.expiresAt - instant > maxLeaseMs
      )
        continue;
      const leader = await processSnapshot(procRoot, grant.leaderPid);
      if (
        leader.uid !== grant.uid ||
        leader.gid !== grant.gid ||
        leader.cgroup !== grant.cgroup ||
        leader.startTicks !== grant.leaderStartTicks
      )
        refuse();
      matching.push(grant);
    }
    if (matching.length !== 1) refuse();
    const after = await processSnapshot(procRoot, peer.pid);
    if (JSON.stringify(after) !== JSON.stringify(connector)) refuse();
    const selected = matching[0]!;
    const current = parseGrant(
      useStore
        ? await getFromStore!(selected.grantId)
        : await readProtectedJson(join(grantRoot, `${selected.grantId}.json`), authorityUid),
      `${selected.grantId}.json`,
    );
    if (JSON.stringify(current) !== JSON.stringify(selected) || now() >= selected.expiresAt)
      refuse();
    return {
      id: selected.principal.id,
      kind: selected.principal.kind,
      taskIds: [...selected.principal.taskIds],
    };
  };
}

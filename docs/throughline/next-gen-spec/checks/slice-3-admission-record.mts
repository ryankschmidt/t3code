// Slice 3 checks: one turn-admission point and the Absurd record, read from the real repository and the installed Mac app.
// Proposed by worker-specprep-5656ab0a on Oct 9, 2026 for the delivery lead to place at <spec>/checks/slice-3-admission-record.mts.
// These are static checks on source and on the installed bundle. Runtime behavior (crash boundaries, replay, projection
// rebuild) is proved by the test files each task names as specified; this file never claims those ran.
// Run: node slice-3-admission-record.mts --repo <abs> [--spec <spec.json>] [--only S3-C01 …]
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export type CheckDef = {
  id: string;
  title: string;
  kind: "real-disk" | "unit" | "structural" | "guard";
  expected_today: "FAIL" | "PASS";
};
export const CHECK_DEFS: CheckDef[] = [
  {
    id: "S3-C01",
    kind: "structural",
    expected_today: "FAIL",
    title:
      "the turn-admission module exists in the fork namespace: CommandAdmission.ts names exactly thread.turn.start and thread.user-input.respond as turn-effect commands, the six admission routes, and the admission marker",
  },
  {
    id: "S3-C02",
    kind: "structural",
    expected_today: "FAIL",
    title:
      "no server source outside the decider, the admission module and tests builds a turn-effect command literal, the HTTP handler never calls the engine directly, and the in-process transport builds none",
  },
  {
    id: "S3-C03",
    kind: "structural",
    expected_today: "FAIL",
    title:
      "the engine admission guard is mounted in the orchestration layer composition, so an unadmitted turn-effect command is refused at the engine",
  },
  {
    id: "S3-C04",
    kind: "structural",
    expected_today: "FAIL",
    title:
      "the durable turn rail lives in the admission module with its readiness gate, and the WebSocket server no longer defines its own copy",
  },
  {
    id: "S3-C05",
    kind: "structural",
    expected_today: "FAIL",
    title:
      "comsnet turns go through admission with a stable message id, and a redrive sweep exists for a request marked delivered whose turn was never admitted",
  },
  {
    id: "S3-C06",
    kind: "real-disk",
    expected_today: "FAIL",
    title:
      "history import never manufactures a turn: the session importer writes thread.history.import, not thread.turn.start, and probes the configured server port; the outside resume tool writes no orchestration_events rows directly",
  },
  {
    id: "S3-C07",
    kind: "real-disk",
    expected_today: "FAIL",
    title:
      "Absurd is pinned exactly to 0.5.0 in every package that names it and the lockfile resolves only 0.5.0",
  },
  {
    id: "S3-C08",
    kind: "structural",
    expected_today: "FAIL",
    title:
      "Absurd step bodies derive command and thread ids from the task id and step name; the in-process transport generates none at random",
  },
  {
    id: "S3-C09",
    kind: "structural",
    expected_today: "FAIL",
    title:
      "the record package @throughline/record exists and its migration creates the throughline_record schema with admitted commands, events, effect attempts with an unknown outcome, the outbox, projection cursors, admission decisions and blobs",
  },
  {
    id: "S3-C10",
    kind: "structural",
    expected_today: "FAIL",
    title:
      "the record is mounted as the engine's event store with the record-first transaction client, and the per-message coverage script exists",
  },
  {
    id: "S3-C11",
    kind: "real-disk",
    expected_today: "FAIL",
    title:
      "the installed Mac app carries turn admission: the bundle under /Applications/ThroughLine.app contains the admission marker throughline.admission.v1",
  },
  {
    id: "S3-C12",
    kind: "structural",
    expected_today: "FAIL",
    title:
      "the check-first seam is in place without deciding policy: EffectAdmission.ts exports classifyEffect, admitEffect, TargetPolicySlot, ProtectedScopeSlot, EnforcementMatrix and NoTargetRecordPolicyLive, every decision carries prevented, preventable, violation, enforcement and safeAlternative, a post-tool path records observed-after-execution, and nothing in the admission module reads exploration, mode, skip_gate or a file name to classify an effect",
  },
  {
    id: "S3-G01",
    kind: "guard",
    expected_today: "PASS",
    title:
      "guard: the direct-dispatch arm still excludes thread.turn.start by type, in the WebSocket server or in the admission module after the move",
  },
  {
    id: "S3-G02",
    kind: "guard",
    expected_today: "PASS",
    title:
      "guard: the comsnet turn keeps its stable command id comsnet:<requestId>, so a retried send dedupes on the command receipt",
  },
  {
    id: "S3-G03",
    kind: "guard",
    expected_today: "PASS",
    title:
      "guard: the decider still refuses a thread.turn.start whose message id is in the imported-session namespace",
  },
  {
    id: "S3-G04",
    kind: "guard",
    expected_today: "PASS",
    title: "guard: the engine still deduplicates commands by their command receipt",
  },
  {
    id: "S3-G05",
    kind: "guard",
    expected_today: "PASS",
    title:
      "guard: the decider emits thread.turn-start-requested only from the thread.turn.start case and nests a turn start only under thread.user-input.respond, so the admission table is complete",
  },
];

type Fail = string;
const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const MARKER = "throughline.admission.v1";
const ADM = "apps/server/src/throughline/admission";
const TURN_EFFECT = /type:\s*"(thread\.turn\.start|thread\.user-input\.respond)"\s*,/;

function bindRepository(repoArg: string | undefined, spec: any): { repo: string; head: string } {
  if (!repoArg || !repoArg.startsWith("/"))
    throw new Error("--repo <absolute path> is required; no working-directory fallback");
  const real = realpathSync.native(repoArg);
  const git = (...a: string[]) =>
    execFileSync("git", ["-C", real, ...a], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (realpathSync.native(git("rev-parse", "--show-toplevel")) !== real)
    throw new Error(`${real} is not a repository top level`);
  if (git("remote", "get-url", "origin") !== spec.repository.origin)
    throw new Error(`origin of ${real} is not ${spec.repository.origin}`);
  try {
    git("merge-base", "--is-ancestor", spec.design_start_commit, "HEAD");
  } catch {
    throw new Error(`HEAD of ${real} does not descend from ${spec.design_start_commit}`);
  }
  return { repo: real, head: git("rev-parse", "HEAD") };
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir, { withFileTypes: true })) {
    if (n.name === "node_modules" || n.name.startsWith(".")) continue;
    const p = join(dir, n.name);
    if (n.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(n.name)) out.push(p);
  }
  return out;
}

function fileContains(path: string, needle: string): boolean {
  const buf = Buffer.from(needle);
  const size = statSync(path).size;
  const chunk = 8 * 1024 * 1024;
  const fd = openSync(path, "r");
  const b = Buffer.alloc(chunk + buf.length);
  try {
    for (let pos = 0; pos < size; pos += chunk) {
      const n = readSync(fd, b, 0, chunk + buf.length, pos);
      if (b.subarray(0, n).includes(buf)) return true;
    }
    return false;
  } finally {
    closeSync(fd);
  }
}

function main(): void {
  const spec = JSON.parse(readFileSync(arg("--spec") ?? join(HERE, "..", "spec.json"), "utf8"));
  const { repo, head } = bindRepository(arg("--repo"), spec);
  console.log(`bound repository ${repo} at ${head}`);
  const only = (() => {
    const i = process.argv.indexOf("--only");
    return i >= 0 ? new Set(process.argv.slice(i + 1).filter((x) => /^S3-/.test(x))) : null;
  })();
  const at = (p: string) => join(repo, p);
  const read = (p: string) => readFileSync(at(p), "utf8");
  const has = (p: string) => existsSync(at(p));
  const resumeTool = join(
    spec.repository.vault,
    "01_Projects/workbench/tools/throughline-session-resume/src",
  );
  const results: Array<{ id: string; title: string; fails: Fail[] }> = [];
  const check = (id: string, fn: () => Fail[]) => {
    if (only && !only.has(id)) return;
    let fails: Fail[];
    try {
      fails = fn();
    } catch (e) {
      fails = [`threw: ${(e as Error).message}`];
    }
    results.push({ id, title: CHECK_DEFS.find((d) => d.id === id)!.title, fails });
  };

  check("S3-C01", () => {
    const p = `${ADM}/CommandAdmission.ts`;
    if (!has(p)) return [`${p} missing`];
    const t = read(p);
    const f: Fail[] = [];
    const m = /TURN_EFFECT_COMMAND_TYPES\s*=\s*\[([^\]]*)\]/.exec(t);
    const types = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort() : [];
    if (
      JSON.stringify(types) !== JSON.stringify(["thread.turn.start", "thread.user-input.respond"])
    )
      f.push(`TURN_EFFECT_COMMAND_TYPES is ${JSON.stringify(types)}`);
    for (const r of [
      "client-ws",
      "client-http",
      "comsnet",
      "history-import",
      "absurd-worker",
      "server-reissue",
    ])
      if (!t.includes(`"${r}"`)) f.push(`route ${r} missing`);
    if (!t.includes(MARKER)) f.push("admission marker missing");
    return f;
  });
  check("S3-C02", () => {
    const f: Fail[] = [];
    for (const file of walk(at("apps/server/src"))) {
      const rel = relative(repo, file);
      if (
        /\.test\.tsx?$/.test(rel) ||
        rel.startsWith(ADM + "/") ||
        rel === "apps/server/src/orchestration/decider.ts"
      )
        continue;
      if (TURN_EFFECT.test(readFileSync(file, "utf8")))
        f.push(`${rel} builds a turn-effect command outside admission`);
    }
    if (/orchestrationEngine\.dispatch\(/.test(read("apps/server/src/orchestration/http.ts")))
      f.push("apps/server/src/orchestration/http.ts dispatches into the engine directly");
    if (TURN_EFFECT.test(read("packages/absurd-runtime/src/in-process-transport.ts")))
      f.push("packages/absurd-runtime/src/in-process-transport.ts builds a turn-effect command");
    return f;
  });
  check("S3-C03", () =>
    /OrchestrationEngineAdmissionGuardLive/.test(
      read("apps/server/src/orchestration/runtimeLayer.ts"),
    )
      ? []
      : ["runtimeLayer.ts does not mount OrchestrationEngineAdmissionGuardLive"],
  );
  check("S3-C04", () => {
    const f: Fail[] = [];
    if (/const spawnTurnOnAbsurdRail\s*=/.test(read("apps/server/src/ws.ts")))
      f.push("ws.ts still defines spawnTurnOnAbsurdRail");
    const p = `${ADM}/TurnRail.ts`;
    if (!has(p)) f.push(`${p} missing`);
    else if (!read(p).includes("turn rail not ready")) f.push(`${p} lacks the readiness gate`);
    return f;
  });
  check("S3-C05", () => {
    const t = read("apps/server/src/mcp/toolkits/comsnet/handlers.ts");
    const f: Fail[] = [];
    if (!/"comsnet"/.test(t) || !/admission|Admission/.test(t))
      f.push("comsnet handler does not dispatch through admission with route comsnet");
    if (
      /MessageId\.make\(`comsnet:\$\{request\.requestId\}:\$\{NodeCrypto\.randomUUID\(\)\}`\)/.test(
        t,
      )
    )
      f.push("comsnet message id still carries a random suffix");
    if (!has(`${ADM}/ComsNetRedrive.ts`)) f.push(`${ADM}/ComsNetRedrive.ts missing`);
    return f;
  });
  check("S3-C06", () => {
    const f: Fail[] = [];
    const p = "apps/server/src/cli/import-claude-sessions.ts";
    if (has(p)) {
      const t = read(p);
      if (/"thread\.turn\.start"/.test(t)) f.push(`${p} writes history as thread.turn.start`);
      if (/http:\/\/127\.0\.0\.1:13773\//.test(t))
        f.push(`${p} probes only the hard-coded port 13773`);
      if (!/"thread\.history\.import"/.test(t)) f.push(`${p} does not write thread.history.import`);
    }
    for (const file of walk(resumeTool))
      if (
        !/\.test\.ts$/.test(file) &&
        /insert\s+into\s+orchestration_events/i.test(readFileSync(file, "utf8"))
      )
        f.push(`${file} inserts orchestration_events rows directly`);
    return f;
  });
  check("S3-C07", () => {
    const f: Fail[] = [];
    const pkgs = execFileSync("git", ["-C", repo, "ls-files", "*package.json"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    for (const p of pkgs) {
      const j = JSON.parse(read(p));
      for (const k of ["dependencies", "devDependencies", "peerDependencies"]) {
        const v = j[k]?.["absurd-sdk"];
        if (v !== undefined && v !== "0.5.0") f.push(`${p} ${k} absurd-sdk ${v}`);
      }
    }
    const lock = has("pnpm-lock.yaml") ? read("pnpm-lock.yaml") : "";
    const versions = new Set([...lock.matchAll(/absurd-sdk@(\d+\.\d+\.\d+)/g)].map((m) => m[1]));
    if (!versions.has("0.5.0") || versions.size !== 1)
      f.push(`lockfile resolves absurd-sdk ${[...versions].join(", ") || "nothing"}`);
    return f;
  });
  check("S3-C08", () => {
    const t = read("packages/absurd-runtime/src/in-process-transport.ts");
    const f: Fail[] = [];
    if (/commandId:\s*randomUUID\(\)/.test(t))
      f.push("in-process-transport.ts generates command ids at random");
    if (/const threadId = randomUUID\(\)/.test(t))
      f.push("in-process-transport.ts generates the created thread id at random");
    return f;
  });
  check("S3-C09", () => {
    const f: Fail[] = [];
    if (!has("packages/throughline-record/package.json"))
      return ["packages/throughline-record/package.json missing"];
    if (JSON.parse(read("packages/throughline-record/package.json")).name !== "@throughline/record")
      f.push("package name is not @throughline/record");
    const sqlFiles = execFileSync(
      "git",
      ["-C", repo, "ls-files", "packages/throughline-record/*.sql"],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    const sql = sqlFiles
      .map((p) => read(p))
      .join("\n")
      .toLowerCase();
    if (!/create schema if not exists throughline_record/.test(sql))
      f.push("no throughline_record schema");
    for (const t of [
      "admitted_commands",
      "events",
      "effect_attempts",
      "outbox",
      "projection_cursors",
      "admission_decisions",
      "blobs",
    ])
      if (!new RegExp(`create table if not exists throughline_record\\.${t}\\b`).test(sql))
        f.push(`table ${t} missing`);
    if (!/'unknown'/.test(sql)) f.push("effect_attempts outcome lacks unknown");
    if (!/unique\s*\(\s*stream_id\s*,\s*stream_version\s*\)/.test(sql))
      f.push("events lacks unique(stream_id, stream_version)");
    return f;
  });
  check("S3-C10", () => {
    const t = read("apps/server/src/orchestration/runtimeLayer.ts");
    const f: Fail[] = [];
    if (!/RecordBackedEventStoreLive/.test(t))
      f.push("runtimeLayer.ts does not provide RecordBackedEventStoreLive");
    if (!/RecordFirstTransactionClientLive/.test(t))
      f.push("runtimeLayer.ts does not provide the record-first transaction client to the engine");
    if (!has("scripts/throughline/check-record-coverage.ts"))
      f.push("scripts/throughline/check-record-coverage.ts missing");
    return f;
  });
  check("S3-C11", () => {
    const asar = "/Applications/ThroughLine.app/Contents/Resources/app.asar";
    if (!existsSync(asar)) return [`${asar} missing`];
    return fileContains(asar, MARKER) ? [] : [`installed bundle lacks ${MARKER}`];
  });
  check("S3-C12", () => {
    const p = `${ADM}/EffectAdmission.ts`;
    if (!has(p)) return [`${p} missing`];
    const t = read(p);
    const f: Fail[] = [];
    for (const name of [
      "classifyEffect",
      "admitEffect",
      "TargetPolicySlot",
      "ProtectedScopeSlot",
      "EnforcementMatrix",
      "NoTargetRecordPolicyLive",
      "ignoredCallerFields",
      "check-first-pending",
      "observed-after-execution",
      "safeAlternative",
      "preventable",
      "prevented",
      "violation",
      "enforcement",
    ])
      if (!t.includes(name)) f.push(`${p} lacks ${name}`);
    for (const file of walk(at(ADM))) {
      const rel = relative(repo, file);
      if (/\.test\.tsx?$/.test(rel)) continue;
      const src = readFileSync(file, "utf8");
      if (
        /callerFields\??\.(exploration|mode|skip_gate|fileName|filename)\b|callerFields\[\s*["'](exploration|mode|skip_gate|fileName|filename)["']\s*\]/.test(
          src,
        )
      )
        f.push(`${rel} reads a caller field to classify an effect`);
    }
    return f;
  });
  check("S3-G01", () => {
    const files = [
      "apps/server/src/ws.ts",
      `${ADM}/TurnRail.ts`,
      `${ADM}/CommandAdmission.ts`,
    ].filter(has);
    return files.some((p) =>
      /Exclude<OrchestrationCommand,\s*\{\s*type:\s*"thread\.turn\.start"\s*\}>/.test(read(p)),
    )
      ? []
      : ["no direct-dispatch arm typed to exclude thread.turn.start"];
  });
  check("S3-G02", () => {
    const files = [
      "apps/server/src/mcp/toolkits/comsnet/handlers.ts",
      `${ADM}/ComsNetRedrive.ts`,
      `${ADM}/CommandAdmission.ts`,
    ].filter(has);
    return files.some((p) => read(p).includes("CommandId.make(`comsnet:${request.requestId}`)"))
      ? []
      : ["stable comsnet command id not found"];
  });
  check("S3-G03", () => {
    const t = read("apps/server/src/orchestration/decider.ts");
    const i = t.indexOf('case "thread.turn.start": {');
    return i >= 0 &&
      t.slice(i, i + 400).includes("isImportedAgentSessionMessageId(command.message.messageId)")
      ? []
      : ["thread.turn.start no longer refuses imported-session message ids"];
  });
  check("S3-G04", () =>
    read("apps/server/src/orchestration/Layers/OrchestrationEngine.ts").includes(
      "commandReceiptRepository.getByCommandId",
    )
      ? []
      : ["engine no longer reads command receipts before dispatch"],
  );
  check("S3-G05", () => {
    const t = read("apps/server/src/orchestration/decider.ts");
    const f: Fail[] = [];
    const cases = [...t.matchAll(/\n    case "([a-z.-]+)": \{/g)].map((m) => ({
      name: m[1],
      at: m.index!,
    }));
    const owner = (pos: number) => {
      const before = cases.filter((c) => c.at < pos);
      return before[before.length - 1]?.name;
    };
    for (const m of t.matchAll(/type: "thread\.turn-start-requested"/g))
      if (owner(m.index!) !== "thread.turn.start")
        f.push(`turn-start-requested emitted under ${owner(m.index!)}`);
    for (const m of t.matchAll(/type: "thread\.turn\.start",/g))
      if (owner(m.index!) !== "thread.user-input.respond")
        f.push(`nested thread.turn.start under ${owner(m.index!)}`);
    return f;
  });

  let green = 0;
  for (const r of results) {
    if (r.fails.length === 0) {
      green++;
      console.log(`PASS  ${r.id} ${r.title}`);
    } else {
      console.log(`FAIL  ${r.id} ${r.title}  (${r.fails.length})`);
      for (const x of r.fails.slice(0, 8)) console.log(`        - ${x}`);
      if (r.fails.length > 8) console.log(`        - … ${r.fails.length - 8} more`);
    }
  }
  console.log(`\n${green} of ${results.length} checks green  (${new Date().toISOString()})`);
  process.exit(green === results.length ? 0 : 1);
}

// Compare real paths: /tmp and other symlinked folders would otherwise skip main() and exit 0 with no checks run.
const invokedDirectly = (() => {
  try {
    return (
      realpathSync.native(fileURLToPath(import.meta.url)) ===
      realpathSync.native(process.argv[1] ?? "")
    );
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  try {
    main();
  } catch (e) {
    console.error(`BINDING REFUSED: ${(e as Error).message}`);
    process.exit(2);
  }
}

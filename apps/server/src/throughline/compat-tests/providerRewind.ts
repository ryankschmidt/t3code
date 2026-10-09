// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeURL from "node:url";
import { build, type Plugin } from "esbuild";

/** Public release custody only; reject missing fields before readers or execution. */
export function resolvePackagedProviderInputs(artifactRoot: string, value: unknown) {
  const root = NodePath.resolve(artifactRoot);
  if (!root.startsWith("/Users/Admin/throughline-worktrees/artifacts/"))
    throw new Error("Packaged consumers require the relocated artifact root.");
  if (!value || typeof value !== "object") throw new Error("Public custody must be an object.");
  const custody = value as Record<string, unknown>;
  const text = (key: string, pattern?: RegExp) => {
    const field = custody[key];
    if (typeof field !== "string" || !field || (pattern && !pattern.test(field)))
      throw new Error(`Missing or invalid public custody field: ${key}`);
    return field;
  };
  const release = text("release", /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
  const source_sha = text("source_sha", /^[a-f0-9]{40}$/);
  if (text("canonical_artifact_root") !== root)
    throw new Error("Public custody artifact root differs from the requested root.");
  if (custody.offline_import_authorized !== true)
    throw new Error("Public offline import is not explicitly authorized.");
  const member = (key: string) => {
    const file = text(key);
    if (
      !NodePath.isAbsolute(file) ||
      NodePath.resolve(file) !== file ||
      !file.startsWith(root + NodePath.sep)
    )
      throw new Error(`Public custody path escapes the artifact root: ${key}`);
    return file;
  };
  const executable = member("executable");
  const archive = member("asar");
  const entry = member("public_server_entry");
  if (entry !== NodePath.join(archive, "apps/server/dist/bin.mjs"))
    throw new Error("Public server entry is not the packaged bin.mjs entry.");
  return {
    root,
    release,
    source_sha,
    executable,
    archive,
    entry,
    zip: member("zip"),
    hashes: {
      zip: text("zip_sha256", /^[a-f0-9]{64}$/),
      archive: text("asar_sha256", /^[a-f0-9]{64}$/),
      executable: text("executable_sha256", /^[a-f0-9]{64}$/),
    },
  };
}

export function assertPackagedRelease(custody: { release: string }, packageVersion: string) {
  if (packageVersion !== custody.release)
    throw new Error("Packaged version differs from source custody release.");
}

/** Read/consume existing packaged bytes only. No bundler, GUI or backend startup. */
export async function inspectPackagedProviderContract(input: {
  artifactRoot: string;
  custodyManifest: string;
  asarReader: string;
  fuseReader: string;
  outputParent: string;
}) {
  const custody = resolvePackagedProviderInputs(
    input.artifactRoot,
    JSON.parse(NodeFS.readFileSync(input.custodyManifest, "utf8")),
  );
  const { root, archive, executable, zip, entry } = custody;
  for (const file of [archive, executable, zip]) {
    if (!NodeFS.existsSync(file))
      throw new Error(`Declared packaged member is not available: ${file}`);
    if (!NodeFS.realpathSync(file).startsWith(NodeFS.realpathSync(root) + NodePath.sep))
      throw new Error("Declared packaged member resolves outside artifact custody.");
  }
  const hashFile = (file: string) =>
    new Promise<string>((resolve, reject) => {
      const hash = NodeCrypto.createHash("sha256");
      const stream = NodeFS.createReadStream(file);
      stream.on("data", (bytes) => hash.update(bytes));
      stream.on("error", reject);
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  const hashZipMember = (member: string) =>
    new Promise<string>((resolve, reject) => {
      const hash = NodeCrypto.createHash("sha256");
      const child = NodeChildProcess.spawn("/usr/bin/unzip", ["-p", zip, member], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      child.stdout.on("data", (bytes) => hash.update(bytes));
      child.on("error", reject);
      child.on("close", (status) =>
        status === 0
          ? resolve(hash.digest("hex"))
          : reject(new Error(`ZIP member custody read failed: ${member}, exit ${status}`)),
      );
    });
  const zipSha256 = await hashFile(zip);
  const archiveSha256 = await hashFile(archive);
  const executableSha256 = await hashFile(executable);
  const zipArchiveSha256 = await hashZipMember("ThroughLine.app/Contents/Resources/app.asar");
  const zipExecutableSha256 = await hashZipMember("ThroughLine.app/Contents/MacOS/ThroughLine");
  if (archiveSha256 !== zipArchiveSha256 || executableSha256 !== zipExecutableSha256)
    throw new Error("Expanded packaged bytes do not match ZIP custody.");
  if (
    zipSha256 !== custody.hashes.zip ||
    archiveSha256 !== custody.hashes.archive ||
    executableSha256 !== custody.hashes.executable
  )
    throw new Error("Produced bytes do not match public custody hashes.");
  const archiveModule = await import(NodeURL.pathToFileURL(input.asarReader).href);
  const reader = (archiveModule.default ?? archiveModule) as {
    extractFile(archive: string, member: string): Buffer;
  };
  const fuseModule = await import(NodeURL.pathToFileURL(input.fuseReader).href);
  const fuses = (await fuseModule.getCurrentFuseWire(executable)) as Record<string, unknown>;
  if (fuses.version !== "1" || fuses["0"] !== 49)
    throw new Error("Produced executable has no proven RunAsNode fuse; GUI startup is forbidden.");
  const member = "apps/server/dist/bin.mjs";
  const serverBytes = reader.extractFile(archive, member);
  const source = serverBytes.toString("utf8");
  const pkg = JSON.parse(reader.extractFile(archive, "package.json").toString("utf8")) as {
    version: string;
  };
  assertPackagedRelease(custody, pkg.version);
  NodeFS.mkdirSync(input.outputParent, { recursive: true });
  const directory = NodeFS.mkdtempSync(NodePath.join(input.outputParent, "packaged-contract-"));
  const home = NodePath.join(directory, "home");
  const backendHome = NodePath.join(directory, "backend-home");
  NodeFS.mkdirSync(home);
  NodeFS.mkdirSync(backendHome);
  const env = {
    ELECTRON_RUN_AS_NODE: "1",
    HOME: home,
    XDG_CONFIG_HOME: home,
    T3CODE_HOME: backendHome,
    PATH: "/usr/bin:/bin",
    NO_COLOR: "1",
  };
  const run = (args: string[]) => {
    const result = NodeChildProcess.spawnSync(executable, args, {
      cwd: directory,
      env,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 128 * 1024,
    });
    return {
      args,
      status: result.status,
      signal: result.signal,
      error: result.error?.message,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };
  const interpreter = run([
    "-e",
    'process.stdout.write(JSON.stringify({node:process.version,executable:process.execPath,home:require("node:os").homedir()})+"\\n")',
  ]);
  if (interpreter.status !== 0)
    throw new Error("Packaged Node-mode interpreter did not run; no backend was launched.");
  const actualInterpreter = JSON.parse(interpreter.stdout.trim()) as {
    node: string;
    executable: string;
    home: string;
  };
  if (actualInterpreter.home !== home || actualInterpreter.executable !== executable)
    throw new Error("Packaged executable HOME isolation was not established.");
  const help = run([entry, "--help"]);
  if (
    help.status !== 0 ||
    !help.stdout.includes("--base-dir") ||
    !help.stdout.includes("--no-browser")
  )
    throw new Error("Packaged public CLI isolation contract is unavailable.");
  // Dynamic import executes the unmodified packaged module, not its main CLI.
  const exportsProbe = run([
    "-e",
    `import(${JSON.stringify(NodeURL.pathToFileURL(entry).href)}).then(m => process.stdout.write(JSON.stringify(Object.keys(m).sort())+"\\n"));`,
  ]);
  if (exportsProbe.status !== 0) throw new Error("Packaged export consumer did not run.");
  const publicExports = JSON.parse(exportsProbe.stdout.trim()) as string[];
  const privateFactories = ["makePiAdapter", "makePiSessionRuntime", "registerPiNativeNavigation"];
  const missingPublicFactories = privateFactories.filter((name) => !publicExports.includes(name));
  const refusal = "Thread rollback is not supported by the Pi provider";
  const refusalOffset = source.indexOf(refusal);
  const nativeBridgeMarkers = ["throughline_rewind", "tl-rewind-", "navigation.mjs"].map(
    (value) => ({ value, present: source.includes(value) }),
  );
  const receipt = {
    schema: "throughline.packaged-provider-contract.v1",
    sourceSha: custody.source_sha,
    snapshot: {
      release: custody.release,
      sourceSha: custody.source_sha,
      sourceBinding: "producer custody; full packaged source identity not independently exposed",
    },
    packageVersion: pkg.version,
    artifactRoot: root,
    zip,
    archive,
    executable,
    member,
    hashes: {
      zip: zipSha256,
      archive: archiveSha256,
      executable: executableSha256,
      serverEntry: NodeCrypto.createHash("sha256").update(serverBytes).digest("hex"),
    },
    zipCustodyMatched: true,
    directory,
    home,
    backendHome,
    interpreter,
    actualInterpreter,
    help,
    exportsProbe,
    publicExports,
    missingPublicFactories,
    nativePiRefusal: {
      present: refusalOffset >= 0,
      byteOffset: refusalOffset,
      owningSource: "apps/server/src/provider/Layers/PiAdapter.ts",
      excerpt:
        refusalOffset >= 0 ? source.slice(refusalOffset - 160, refusalOffset + 100) : undefined,
    },
    nativeBridgeMarkers,
    providerAcceptance:
      "not proven: static markers, interpreter and public CLI exports do not execute native provider rewind",
    backendStarted: false,
    guiStarted: false,
    modelRequests: false,
    credentialsRead: false,
    freshlyBundledFixtureUsed: false,
  };
  NodeFS.writeFileSync(
    NodePath.join(directory, "Packaged-Consumer-Receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  return receipt;
}

export interface CompiledRewindFixture {
  directory: string;
  artifacts: string[];
  config: string;
  nodeExecutable: string;
  vpCli: string;
  sourceCommit: string;
  sourceHashes: Record<string, string>;
  workspaceOverrides: Record<string, string>;
  externalTypeScriptImports: string[];
  variant: "accepted" | "broken-extension";
}

export interface ClaudeRewindSourceBinding {
  testSha256: string;
  callerSha256: string;
}

const claudeRewindPopulations = [
  {
    testSha256: "205d7d783ef9a7f471cff5e129e8661f4a502bf6fcff10db4ae97d02d9a500f6",
    callerSha256: "6e51bc40747b9526f99e80cf9068df3e9825d23a43f73d399fc5c7f74f25c63c",
    passed: 20,
    excluded: 144,
  },
  {
    testSha256: "a1d74dd682f2262ddab28a1d6c81c18406e4e839bbb22fe34ef6f69d54dee05a",
    callerSha256: "89627de401a33d9344187bc767a809c44c8fac68ecd7ffc144196fb5a78f9633",
    passed: 21,
    excluded: 145,
  },
] as const;

/** Exact source-and-machine-result binding, never text-presence acceptance. */
export function assertClaudeRewindPopulation(binding: ClaudeRewindSourceBinding, report: unknown) {
  const expected = claudeRewindPopulations.find(
    (pin) => pin.testSha256 === binding.testSha256 && pin.callerSha256 === binding.callerSha256,
  );
  if (!expected)
    throw new Error("Claude rewind caller/test source is not an admitted population pin.");
  if (!report || typeof report !== "object")
    throw new Error("Claude rewind machine report is missing.");
  const result = report as {
    success?: boolean;
    numTotalTests?: number;
    numPassedTests?: number;
    numFailedTests?: number;
    numPendingTests?: number;
    numTodoTests?: number;
    testResults?: Array<{ assertionResults?: Array<{ status?: string }> }>;
  };
  const rows = result.testResults?.flatMap((suite) => suite.assertionResults ?? []) ?? [];
  const passedRows = rows.filter((row) => row.status === "passed").length;
  const excludedRows = rows.filter(
    (row) => row.status === "pending" || row.status === "skipped",
  ).length;
  const total = expected.passed + expected.excluded;
  if (
    result.success !== true ||
    result.numTotalTests !== total ||
    result.numPassedTests !== expected.passed ||
    result.numPassedTests <= 0 ||
    result.numFailedTests !== 0 ||
    result.numPendingTests !== expected.excluded ||
    result.numTodoTests !== 0 ||
    rows.length !== total ||
    passedRows !== expected.passed ||
    excludedRows !== expected.excluded
  ) {
    throw new Error(
      `Claude rewind population mismatch: source requires ${expected.passed} executed/${expected.excluded} excluded/${total} total; got ${result.numPassedTests}/${result.numPendingTests}/${result.numTotalTests}, rows ${passedRows}/${excludedRows}/${rows.length}.`,
    );
  }
  return { ...binding, passed: expected.passed, excluded: expected.excluded, total };
}

function exportedPath(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return exportedPath(record.import ?? record.default);
  }
  return undefined;
}

/** Compile the reviewed provider code into isolated JS consumers, not TS imports. */
export async function compileProviderRewindFixture(input: {
  workspaceRoot: string;
  nodeExecutable: string;
  outputParent: string;
  variant?: "accepted" | "broken-extension";
}): Promise<CompiledRewindFixture> {
  const version = NodeChildProcess.execFileSync(input.nodeExecutable, ["--version"], {
    encoding: "utf8",
  }).trim();
  if (version !== "v24.13.1")
    throw new Error(`Compiled rewind proof requires verified Node v24.13.1; got ${version}.`);
  const root = NodePath.resolve(input.workspaceRoot);
  const variant = input.variant ?? "accepted";
  NodeFS.mkdirSync(input.outputParent, { recursive: true });
  const directory = NodeFS.mkdtempSync(
    NodePath.join(input.outputParent, `provider-rewind-${variant}-`),
  );
  const packages = new Map<string, { root: string; exports: Record<string, unknown> }>();
  for (const domain of ["packages", "infra", "apps"]) {
    for (const entry of NodeFS.readdirSync(NodePath.join(root, domain), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageRoot = NodePath.join(root, domain, entry.name);
      const file = NodePath.join(packageRoot, "package.json");
      if (!NodeFS.existsSync(file)) continue;
      const metadata = JSON.parse(NodeFS.readFileSync(file, "utf8")) as {
        name?: string;
        exports?: Record<string, unknown>;
      };
      if (metadata.name && metadata.exports)
        packages.set(metadata.name, { root: packageRoot, exports: metadata.exports });
    }
  }
  const workspaceOverrides: Record<string, string> = {};
  const plugin: Plugin = {
    name: "reviewed-workspace-source",
    setup(builder) {
      builder.onResolve({ filter: /^[^./]/ }, (args) => {
        const segments = args.path.split("/");
        const name = args.path.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0]!;
        const pkg = packages.get(name);
        if (!pkg) {
          if (name.startsWith("@t3tools/"))
            throw new Error(`Unreviewed workspace dependency: ${args.path}`);
          return { path: args.path, external: true };
        }
        const suffix = args.path.slice(name.length);
        const key = suffix ? `.${suffix}` : ".";
        let target = exportedPath(pkg.exports[key]);
        if (!target) {
          for (const [pattern, value] of Object.entries(pkg.exports)) {
            if (!pattern.endsWith("*") || !key.startsWith(pattern.slice(0, -1))) continue;
            target = exportedPath(value)?.replace("*", key.slice(pattern.length - 1));
          }
        }
        if (!target) throw new Error(`No reviewed runtime export for ${args.path}`);
        const path = NodePath.resolve(pkg.root, target);
        workspaceOverrides[args.path] = path;
        return { path };
      });
      if (variant === "broken-extension") {
        builder.onLoad({ filter: /[/\\]rewind[/\\]piNativeNavigation\.ts$/ }, (args) => ({
          contents:
            NodeFS.readFileSync(args.path, "utf8").replace(
              "export function piNativeNavigationSource(",
              "function originalNavigationSource(",
            ) +
            '\nexport function piNativeNavigationSource(_name: string) { return "export default () => {};\\n"; }\n',
          loader: "ts",
        }));
      }
    },
  };
  const providerDirectory = NodePath.join(root, "apps/server/src/provider/Layers");
  const runtimeEntry = NodePath.join(directory, "runtime-entry.ts");
  NodeFS.writeFileSync(
    runtimeEntry,
    `export { makePiSessionRuntime } from ${JSON.stringify(NodePath.join(providerDirectory, "PiSessionRuntime.ts"))}; export * as Effect from "effect/Effect"; export * as NodeServices from "@effect/platform-node/NodeServices";\n`,
  );
  const entries = {
    PiRuntime: runtimeEntry,
    PiAdapter: NodePath.join(providerDirectory, "PiAdapter.test.ts"),
    CodexAdapter: NodePath.join(providerDirectory, "CodexAdapter.test.ts"),
    ClaudeAdapter: NodePath.join(providerDirectory, "ClaudeAdapter.test.ts"),
    PiHarnessToolCompat: NodePath.join(providerDirectory, "PiHarnessToolCompat.test.ts"),
    PiHarnessToolGauntlet: NodePath.join(providerDirectory, "PiHarnessToolGauntlet.test.ts"),
    piNativeNavigation: NodePath.join(
      root,
      "apps/server/src/throughline/rewind/piNativeNavigation.test.ts",
    ),
    longTempDir: NodePath.join(root, "packages/shared/src/testing/longTempDir.ts"),
  };
  const compiled = await build({
    entryPoints: entries,
    outdir: directory,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    plugins: [plugin],
    metafile: true,
    write: true,
    logLevel: "silent",
  });
  const artifacts = Object.keys(entries).map((name) => NodePath.join(directory, `${name}.mjs`));
  const sourceHashes: Record<string, string> = {};
  for (const file of Object.keys(compiled.metafile!.inputs)) {
    const path = NodePath.resolve(file);
    if (path.startsWith(`${root}${NodePath.sep}`) && !path.includes("/node_modules/"))
      sourceHashes[path] = NodeCrypto.createHash("sha256")
        .update(NodeFS.readFileSync(path))
        .digest("hex");
  }
  // Relocated compiled tests must carry their declared data assets, not reach
  // back into the source tree through import.meta.url.
  for (const file of Object.values(entries)) {
    const source = NodeFS.readFileSync(file, "utf8");
    for (const match of source.matchAll(/new URL\("(\.\/[^"\n]+\.json)", import\.meta\.url\)/g)) {
      const from = NodePath.resolve(NodePath.dirname(file), match[1]!);
      const to = NodePath.resolve(directory, match[1]!);
      if (!from.startsWith(root + NodePath.sep) || !to.startsWith(directory + NodePath.sep))
        throw new Error("Fixture asset escapes its reviewed boundary.");
      NodeFS.mkdirSync(NodePath.dirname(to), { recursive: true });
      NodeFS.copyFileSync(from, to);
      sourceHashes[from] = NodeCrypto.createHash("sha256")
        .update(NodeFS.readFileSync(from))
        .digest("hex");
    }
  }
  const externalTypeScriptImports = Object.values(compiled.metafile!.outputs).flatMap((output) =>
    output.imports
      .filter((entry) => entry.external && /\.tsx?$/.test(entry.path))
      .map((entry) => entry.path),
  );
  if (externalTypeScriptImports.length > 0)
    throw new Error(
      `Compiled consumer retains raw TS imports: ${externalTypeScriptImports.join(", ")}`,
    );
  NodeFS.symlinkSync(
    NodePath.join(root, "apps/server/node_modules"),
    NodePath.join(directory, "node_modules"),
    "dir",
  );
  const config = NodePath.join(directory, "vite.config.mjs");
  NodeFS.writeFileSync(
    config,
    'export default { test: { include: ["*.mjs"], exclude: ["vite.config.mjs", "longTempDir.mjs"], setupFiles: ["./longTempDir.mjs"], hookTimeout: 60000, testTimeout: 60000, environment: "node" } };\n',
  );
  const metadata = JSON.parse(
    NodeFS.readFileSync(NodePath.join(root, "node_modules/vite-plus/package.json"), "utf8"),
  ) as { bin: Record<string, string> };
  const fixture: CompiledRewindFixture = {
    directory,
    artifacts,
    config,
    nodeExecutable: input.nodeExecutable,
    vpCli: NodePath.resolve(root, "node_modules/vite-plus", metadata.bin.vp!),
    sourceCommit: NodeChildProcess.execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    sourceHashes,
    workspaceOverrides,
    externalTypeScriptImports,
    variant,
  };
  NodeFS.writeFileSync(
    NodePath.join(directory, "Fixture.json"),
    JSON.stringify(fixture, null, 2) + "\n",
  );
  return fixture;
}

/** Run only compiled files in a fresh consumer cwd with an isolated home. */
export function consumeCompiledRewindFixture(
  fixture: CompiledRewindFixture,
  input: {
    nativePiBinary: string;
    selection: "pi-codex" | "claude" | "native-pi" | "unsupported";
    breakExtensionLookup?: boolean;
  },
) {
  const home = NodePath.join(fixture.directory, "home");
  NodeFS.mkdirSync(home, { recursive: true });
  const observations = NodePath.join(fixture.directory, "Native-Preservation.jsonl");
  const observer = NodePath.join(fixture.directory, "preservation-observer.mjs");
  NodeFS.writeFileSync(
    observer,
    `import fs from "node:fs"; import crypto from "node:crypto"; import path from "node:path";
export default pi => { const before = new Map(); const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const initial = new Map(); const capture = ctx => { const file = ctx.sessionManager.getSessionFile(); if (!file || !fs.existsSync(file) || initial.has(file)) return; const sentinel = path.join(path.dirname(file), "compiled-external-sentinel.txt"); if (!fs.existsSync(sentinel)) fs.writeFileSync(sentinel, "external state must remain unchanged\\n"); const value = { audit: hash(file), external: hash(sentinel), sentinel }; initial.set(file, value); fs.appendFileSync(${JSON.stringify(observations)}, JSON.stringify({ phase: "initial", file, sentinel, baselineAudit: value.audit, baselineExternal: value.external, auditUnchanged: true, externalUnchanged: true }) + "\\n"); }; pi.on("session_start", (_event, ctx) => capture(ctx));
pi.on("session_before_tree", (_event, ctx) => { capture(ctx); const file = ctx.sessionManager.getSessionFile(); if (!file) return; const sentinel = path.join(path.dirname(file), "compiled-external-sentinel.txt"); if (!fs.existsSync(sentinel)) fs.writeFileSync(sentinel, "external state must remain unchanged\\n"); before.set(file, { audit: hash(file), external: hash(sentinel), sentinel }); });
pi.on("session_tree", (_event, ctx) => { const file = ctx.sessionManager.getSessionFile(); const old = before.get(file); if (!old) return; fs.appendFileSync(${JSON.stringify(observations)}, JSON.stringify({ phase: "after", file, sessionId: ctx.sessionManager.getSessionId(), auditUnchanged: old.audit === hash(file), externalUnchanged: old.external === hash(old.sentinel) }) + "\\n"); }); };\n`,
  );
  const nativeWrapper = NodePath.join(fixture.directory, "observed-native-pi.mjs");
  NodeFS.writeFileSync(
    nativeWrapper,
    `#!/usr/bin/env node\nimport { spawn } from "node:child_process"; import fs from "node:fs"; const args = process.argv.slice(2); if (${JSON.stringify(input.breakExtensionLookup === true)}) { for (let i = 0; i < args.length - 1; i++) { if (args[i] === "--extension" && args[i + 1].endsWith("navigation.mjs")) args[i + 1] = ${JSON.stringify(NodePath.join(fixture.directory, "missing-native-navigation.mjs"))}; } } if (${JSON.stringify(input.breakExtensionLookup === true)}) fs.writeFileSync(${JSON.stringify(NodePath.join(fixture.directory, "Broken-Lookup-Arguments.json"))}, JSON.stringify({ args, requestedExtension: ${JSON.stringify(NodePath.join(fixture.directory, "missing-native-navigation.mjs"))} })); const child = spawn(process.execPath, [${JSON.stringify(input.nativePiBinary)}, ...args, "--extension", ${JSON.stringify(observer)}], { stdio: "inherit", env: process.env }); process.on("SIGTERM", () => child.kill("SIGTERM")); process.on("SIGINT", () => child.kill("SIGINT")); child.on("exit", code => process.exit(code ?? 1));\n`,
    { mode: 0o755 },
  );
  const files =
    input.selection === "claude"
      ? ["ClaudeAdapter.mjs"]
      : input.selection === "pi-codex"
        ? [
            "PiAdapter.mjs",
            "CodexAdapter.mjs",
            "PiHarnessToolCompat.mjs",
            "PiHarnessToolGauntlet.mjs",
            "piNativeNavigation.mjs",
          ]
        : ["PiAdapter.mjs"];
  const filter =
    input.selection === "claude"
      ? "rewind|rewinds"
      : input.selection === "native-pi"
        ? "consumes native Pi navigation through the production runtime"
        : input.selection === "unsupported"
          ? "fails closed when the native navigation command is absent|does not accept the prompt acknowledgement"
          : undefined;
  const claudeReportPath = NodePath.join(fixture.directory, "Claude-Rewind-Population.json");
  const args = [
    "--no-experimental-strip-types",
    fixture.vpCli,
    "test",
    "run",
    ...files,
    "--config",
    fixture.config,
    ...(filter ? ["-t", filter] : []),
    ...(input.selection === "claude"
      ? ["--reporter=default", "--reporter=json", `--outputFile=${claudeReportPath}`]
      : []),
  ];
  const environment = {
    PATH: `${NodePath.dirname(fixture.nodeExecutable)}:${process.env.PATH ?? ""}`,
    HOME: home,
    XDG_CONFIG_HOME: home,
    TMPDIR: fixture.directory,
    T3_PI_NATIVE_TEST_BINARY: nativeWrapper,
    NO_COLOR: "1",
  };
  const result = NodeChildProcess.spawnSync(fixture.nodeExecutable, args, {
    cwd: fixture.directory,
    env: environment,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const preservation: Array<{
    phase: "initial" | "after";
    file: string;
    sentinel?: string;
    baselineAudit?: string;
    baselineExternal?: string;
    auditUnchanged: boolean;
    externalUnchanged: boolean;
  }> = NodeFS.existsSync(observations)
    ? NodeFS.readFileSync(observations, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  const hashFile = (file: string) =>
    NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(file)).digest("hex");
  for (const row of preservation) {
    if (row.phase !== "initial") continue;
    row.auditUnchanged = NodeFS.existsSync(row.file) && hashFile(row.file) === row.baselineAudit;
    row.externalUnchanged =
      row.sentinel !== undefined &&
      NodeFS.existsSync(row.sentinel) &&
      hashFile(row.sentinel) === row.baselineExternal;
  }
  const receipt = {
    nodeVersion: NodeChildProcess.execFileSync(fixture.nodeExecutable, ["--version"], {
      encoding: "utf8",
    }).trim(),
    sourceCommit: fixture.sourceCommit,
    variant: fixture.variant,
    selection: input.selection,
    breakExtensionLookup: input.breakExtensionLookup === true,
    lookupNegative: input.breakExtensionLookup
      ? (JSON.parse(
          NodeFS.readFileSync(
            NodePath.join(fixture.directory, "Broken-Lookup-Arguments.json"),
            "utf8",
          ),
        ) as { args: string[]; requestedExtension: string })
      : undefined,
    cwd: fixture.directory,
    command: [fixture.nodeExecutable, ...args],
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    preservation,
    claudeSourceBinding:
      input.selection === "claude"
        ? {
            testSha256:
              Object.entries(fixture.sourceHashes).find(([file]) =>
                file.endsWith("/provider/Layers/ClaudeAdapter.test.ts"),
              )?.[1] ?? "",
            callerSha256:
              Object.entries(fixture.sourceHashes).find(([file]) =>
                file.endsWith("/provider/Layers/ClaudeAdapter.ts"),
              )?.[1] ?? "",
          }
        : undefined,
    claudePopulationReport:
      input.selection === "claude" && NodeFS.existsSync(claudeReportPath)
        ? (JSON.parse(NodeFS.readFileSync(claudeReportPath, "utf8")) as unknown)
        : undefined,
    output,
  };
  NodeFS.writeFileSync(
    NodePath.join(fixture.directory, `Consumer-${input.selection}.json`),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  return receipt;
}

/** Protocol-negative fixtures are labeled; they do not claim real old SDK proof. */
export function consumeUnsupportedVersionFixture(
  fixture: CompiledRewindFixture,
  kind: "old" | "unknown",
) {
  const directory = NodePath.join(fixture.directory, `version-${kind}`);
  NodeFS.mkdirSync(directory, { recursive: true });
  const version = kind === "old" ? "0.0.1" : "unknown";
  const audit = NodePath.join(directory, "audit.jsonl");
  const external = NodePath.join(directory, "external.txt");
  const marker = NodePath.join(directory, "unexpected-model-call");
  NodeFS.writeFileSync(audit, "audit bytes unchanged\n");
  NodeFS.writeFileSync(external, "external bytes unchanged\n");
  const binary = NodePath.join(directory, "provider.mjs");
  NodeFS.writeFileSync(
    binary,
    `#!/usr/bin/env node\nimport fs from "node:fs"; import readline from "node:readline";
if (process.argv.includes("--version")) { process.stdout.write(${JSON.stringify(version)} + "\\n"); process.exit(0); }
readline.createInterface({ input: process.stdin }).on("line", line => { const c = JSON.parse(line); let data; let error;
if (c.type === "get_state") data = { sessionId: "version-fixture", sessionFile: ${JSON.stringify(audit)}, isStreaming: false };
else if (c.type === "get_commands") { if (${JSON.stringify(kind)} === "old") error = "get_commands is unsupported by old protocol fixture"; else data = { commands: [] }; }
else { if (c.type === "prompt") fs.writeFileSync(${JSON.stringify(marker)}, "unexpected model prompt"); error = "unsupported fixture command " + c.type; }
process.stdout.write(JSON.stringify({ type: "response", id: c.id, command: c.type, success: !error, data, error }) + "\\n"); });\n`,
    { mode: 0o755 },
  );
  const advertisedVersion = NodeChildProcess.execFileSync(
    fixture.nodeExecutable,
    [binary, "--version"],
    { encoding: "utf8" },
  ).trim();
  const consumer = NodePath.join(directory, "consumer.mjs");
  NodeFS.writeFileSync(
    consumer,
    `import fs from "node:fs"; import { makePiSessionRuntime, Effect, NodeServices } from "../PiRuntime.mjs";
const auditBefore = fs.readFileSync(${JSON.stringify(audit)}); const externalBefore = fs.readFileSync(${JSON.stringify(external)});
await Effect.runPromise(Effect.gen(function* () { const runtime = yield* makePiSessionRuntime({ threadId: "version-fixture", binaryPath: ${JSON.stringify(binary)}, runtimeMode: "full-access", cwd: ${JSON.stringify(directory)}, environment: { PATH: process.env.PATH, HOME: ${JSON.stringify(directory)}, TMPDIR: ${JSON.stringify(directory)} } });
const before = yield* runtime.start(); const result = yield* runtime.rollbackThread(1).pipe(Effect.result); const after = yield* runtime.getSession;
if (result._tag !== "Failure") throw new Error("Unsupported version was falsely accepted");
if (JSON.stringify(before.resumeCursor) !== JSON.stringify(after.resumeCursor)) throw new Error("Failure replaced the native session");
if (fs.existsSync(${JSON.stringify(marker)}) || !fs.readFileSync(${JSON.stringify(audit)}).equals(auditBefore) || !fs.readFileSync(${JSON.stringify(external)}).equals(externalBefore)) throw new Error("Failure changed external/audit bytes or started a model turn");
yield* runtime.close; process.stdout.write(JSON.stringify({ fixtureKind: ${JSON.stringify(kind)}, status: result._tag, detail: result.failure.detail, sameSession: true, modelTurn: false, auditUnchanged: true, externalUnchanged: true }) + "\\n"); }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)));\n`,
  );
  const result = NodeChildProcess.spawnSync(
    fixture.nodeExecutable,
    ["--no-experimental-strip-types", consumer],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: {
        PATH: `${NodePath.dirname(fixture.nodeExecutable)}:${process.env.PATH ?? ""}`,
        HOME: directory,
        TMPDIR: directory,
      },
    },
  );
  const receipt = {
    kind: "protocol-negative-fixture",
    advertisedVersion,
    fixtureKind: kind,
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
  NodeFS.writeFileSync(
    NodePath.join(directory, "Consumer.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  return receipt;
}

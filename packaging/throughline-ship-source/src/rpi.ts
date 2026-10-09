/** The Raspberry Pi as a required target of every release (WCC-163): a native build of the ThroughLine server on the
 * Raspberry Pi itself from the frozen source commit (the web client and compiled server, not the desktop AppImage, whose
 * packaging needs system libraries only sudo can add), a gate on the built tree, a stage against a consistent copy of its live data, and an install that keeps the previous payload and
 * a state snapshot for rollback. Headless only: the Raspberry Pi runs the ThroughLine server, never the desktop app.
 * Everything here runs as the Raspberry Pi's agent account rpi with no sudo; its units are that account's user units. */
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

export interface RpiContract {
  host: string;
  remote_root: string;
  dependency_root: string;
  state_root: string;
  install_root: string;
  node: string;
  path: string;
  /** The live server address the Mac's Remote Environment dials; the install verifies the release answers here. */
  service_url: string;
  /** The git checkout the Raspberry Pi ran before its first shipped install (0.0.33); the rollback target once. */
  legacy_payload: string;
  /** Queue environment file carried from the legacy checkout on first install; copied, never read. */
  env_source: string;
  /** The rpi user unit that serves ThroughLine; default throughline-server. A rehearsal names its own loopback unit. */
  unit?: string;
}
export interface RpiOptions extends RpiContract {
  release: string;
}
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const SAFE = /^\/[A-Za-z0-9/_.,-]+$/;

function checked(o: RpiOptions) {
  if (o.host !== "rpi") throw new Error("RPI_IDENTITY");
  if (!/^\d+\.\d+\.\d+$/.test(o.release)) throw new Error("RPI_RELEASE");
  for (const p of [
    o.remote_root,
    o.state_root,
    o.install_root,
    o.node,
    o.legacy_payload,
    o.env_source,
  ])
    if (!SAFE.test(p) || p.split("/").includes("..")) throw new Error("RPI_PATH");
  if (
    !o.remote_root.startsWith("/home/rpi/build/workbench/infra/t3code/") ||
    !o.install_root.startsWith("/home/rpi/") ||
    !o.state_root.startsWith("/home/rpi/")
  )
    throw new Error("RPI_PATH");
  if (!/^[A-Za-z0-9/_.:-]+$/.test(o.path)) throw new Error("RPI_PATH");
  const url = /^http:\/\/(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(o.service_url);
  if (!url) throw new Error("RPI_SERVICE_URL");
  const unit = o.unit ?? "throughline-server";
  if (!/^throughline-server(-[a-z0-9]+)?$/.test(unit)) throw new Error("RPI_UNIT");
  return {
    host: url[1]!,
    port: url[2]!,
    stage: o.remote_root + "-stage",
    app: o.remote_root,
    iso: o.remote_root + "-stage/isolated",
    installed: o.install_root + "/app-" + o.release,
    link: o.install_root + "/app",
    rollback: o.install_root + "/rollback-" + o.release,
    launcher: o.install_root + "/throughline-server.sh",
    env: o.install_root + "/env/absurd-runtime.env",
    unit,
    dropin: "/home/rpi/.config/systemd/user/" + unit + ".service.d/zz-shipped-payload.conf",
  };
}
const header = (o: RpiOptions) => `set -eu
test "$(id -un)" = rpi
export PATH=${o.path}:$PATH`;
/** The payload the live service runs now: the shipped link when one exists, the legacy checkout before the first ship. */
const previousShell = (o: RpiOptions) => {
  const p = checked(o);
  return `if [ -L ${quote(p.link)} ]; then previous=$(readlink ${quote(p.link)}); previous_kind=link; else previous=${quote(o.legacy_payload)}; previous_kind=legacy; fi
test -f "$previous/apps/server/dist/bin.mjs"`;
};

/** What the rollback snapshot records for the Raspberry Pi before any install: which payload serves now, its version and
 * the fingerprint of its server. The payload itself stays on the Raspberry Pi; the install never deletes it. */
export function rpiPreviousScript(o: RpiOptions): string {
  const p = checked(o);
  return `${header(o)}
${previousShell(o)}
version=$(curl --fail --silent --max-time 10 ${quote(o.service_url + "/.well-known/t3/environment")} | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(JSON.parse(s).serverVersion)))")
sha=$(sha256sum "$previous/apps/server/dist/bin.mjs" | cut -d' ' -f1)
node -e 'process.stdout.write(JSON.stringify({schema:"throughline.rpi-previous.v1",previous:process.argv[1],previous_kind:process.argv[2],serving_version:process.argv[3],server_sha256:process.argv[4],link:process.argv[5],at:new Date().toISOString()})+String.fromCharCode(10))' "$previous" "$previous_kind" "$version" "$sha" ${quote(p.link)}
`;
}

/** Build on the Raspberry Pi from the frozen source commit: the same archive the tower builds, plus the coms-net
 * dependency the server's package.json names by relative path, copied from its Tier 1 build. */
export function rpiBuildCommands(
  o: RpiOptions & { checkout: string; commit: string; evidence: string },
): { command: string[]; cwd: string }[] {
  checked(o);
  if (!/^[a-f0-9]{40}$/.test(o.commit)) throw new Error("PINNED_COMMIT");
  for (const path of [o.checkout, o.evidence, o.dependency_root])
    if (!SAFE.test(path) || path.split("/").includes("..")) throw new Error("RPI_PATH");
  const archive = join(o.evidence, "rpi-source.tar"),
    deps = join(o.evidence, "rpi-coms-net.tar");
  const remoteArchive = o.remote_root + ".tar",
    remoteDeps = o.remote_root + ".coms-net.tar";
  const comsNet = "/home/rpi/build/workbench/tools/coms-net";
  const build = `${header(o)}
test ! -e ${quote(o.remote_root)}
rm -rf ${quote(comsNet + ".new")}; mkdir -p ${quote(comsNet + ".new")}; tar -xf ${quote(remoteDeps)} -C ${quote(comsNet + ".new")}
test -f ${quote(comsNet + ".new/package.json")}; test -d ${quote(comsNet + ".new/dist")}
rm -rf ${quote(comsNet)}; mv ${quote(comsNet + ".new")} ${quote(comsNet)}
mkdir -p ${quote(o.remote_root)}; tar -xf ${quote(remoteArchive)} -C ${quote(o.remote_root)}
cd ${quote(o.remote_root)}
export APP_COMMIT=${quote(o.commit)}
pnpm install --frozen-lockfile
pnpm exec vp run --filter t3 build
test -f apps/server/dist/bin.mjs
test -f apps/server/dist/client/index.html`;
  return [
    {
      command: [
        "/usr/bin/git",
        "-C",
        o.checkout,
        "archive",
        "--format=tar",
        "--output",
        archive,
        o.commit,
      ],
      cwd: o.checkout,
    },
    {
      command: ["/usr/bin/tar", "-cf", deps, "-C", o.dependency_root, "package.json", "dist"],
      cwd: o.checkout,
    },
    {
      command: [
        "ssh",
        "-o",
        "BatchMode=yes",
        o.host,
        `set -eu; test "$(id -un)" = rpi; mkdir -p ${quote(dirname(o.remote_root))} ${quote(dirname(comsNet))}`,
      ],
      cwd: o.checkout,
    },
    { command: ["scp", archive, `${o.host}:${remoteArchive}`], cwd: o.checkout },
    { command: ["scp", deps, `${o.host}:${remoteDeps}`], cwd: o.checkout },
    { command: ["ssh", "-o", "BatchMode=yes", o.host, build], cwd: o.checkout },
  ];
}

/** The built tree carries this release in its server package, the compiled server and web client, a
 * native terminal module that loads here, and no link that leaves the tree (the install copies it to another depth). */
export function rpiGateScript(o: RpiOptions): string {
  const p = checked(o);
  const version = `const v=require(${JSON.stringify(p.app + "/apps/server/package.json")}).version;if(v!==${JSON.stringify(o.release)}){console.error('RPI_GATE_VERSION '+v);process.exit(2);}`;
  return `${header(o)}
cd ${quote(p.app)}
node -e ${quote(version)}
test -f apps/server/dist/bin.mjs || { echo RPI_GATE_SERVER_MISSING; exit 2; }
test -f apps/server/dist/client/index.html || { echo RPI_GATE_CLIENT_MISSING; exit 2; }
(cd apps/server && node -e "require('node-pty')") || { echo RPI_GATE_NATIVE_MODULE_DOES_NOT_LOAD; exit 2; }
outside=$(find . -type l ! -path './.git/*' -print0 | while IFS= read -r -d '' l; do t=$(readlink -f "$l" || true); case "$t" in "$PWD"/*) ;; *) printf '%s\\n' "$l";; esac; done | head -5)
test -z "$outside" || { echo "RPI_GATE_LINK_LEAVES_TREE: $outside"; exit 2; }
echo RPI_GATE_PASS
`;
}

/** Boot the release on loopback against a consistent copy of the live data, then boot the previous payload against the
 * migrated copy. When the previous payload refuses the migrated data, prove it boots on the pre-release snapshot instead:
 * the rollback then restores the snapshot with the link, and stage-proof.json says so (rollback_mode). */
export function rpiStageScript(o: RpiOptions): string {
  const p = checked(o);
  const copy = (to: string) =>
    `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(o.state_root + "/userdata/state.sqlite")},{readOnly:true});db.exec("VACUUM INTO '"+${JSON.stringify(to)}+"'");db.close();`;
  const proof = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(j.serverVersion!==${JSON.stringify(o.release)})process.exit(2);require('node:fs').writeFileSync(${JSON.stringify(p.stage + "/stage-proof.json")},JSON.stringify({version:j.serverVersion,at:new Date().toISOString(),isolated:true})+'\\n');});`;
  const finish = `const fs=require('node:fs');const file=${JSON.stringify(p.stage + "/stage-proof.json")};const j=JSON.parse(fs.readFileSync(file,'utf8'));const old=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));if(typeof old.serverVersion!=='string')process.exit(2);j.rollback_compatible=true;j.rollback_mode=process.argv[2];j.rollback_version=old.serverVersion;j.previous_payload=process.argv[1];fs.writeFileSync(file,JSON.stringify(j)+String.fromCharCode(10));`;
  const boot = (
    server: string,
    base: string,
    log: string,
    envOut: string,
  ) => `${server} serve --mode web --host 127.0.0.1 --port 3799 --no-browser --base-dir ${quote(base)} >${quote(log)} 2>&1 &
pid=$!
ready=0
for i in $(seq 1 90); do
  if curl --fail --silent --max-time 2 http://127.0.0.1:3799/.well-known/t3/environment >${quote(envOut)}; then ready=1; break; fi
  kill -0 "$pid" 2>/dev/null || break; sleep 2
done
kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true`;
  const snap = p.stage + "/snapshot";
  const isolatedSettings = `const fs=require('node:fs');const s=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));s.continueThreadsAfterServerUpdate=false;for(const to of process.argv.slice(2))fs.writeFileSync(to,JSON.stringify(s,null,2)+'\\n',{mode:0o600});`;
  return `${header(o)}
test -f ${quote(p.app + "/apps/server/dist/bin.mjs")}
test ! -e ${quote(p.stage)}
${previousShell(o)}
rm -rf ${quote(p.stage)}; mkdir -p ${quote(p.iso + "/userdata")} ${quote(snap + "/userdata")}
node -e ${quote(copy(p.iso + "/userdata/state.sqlite"))}
node -e ${quote(copy(snap + "/userdata/state.sqlite"))}
node -e ${quote(isolatedSettings)} ${quote(o.state_root + "/userdata/settings.json")} ${quote(p.iso + "/userdata/settings.json")} ${quote(snap + "/userdata/settings.json")}
unset ABSURD_DATABASE_URL
${boot(`node ${quote(p.app + "/apps/server/dist/bin.mjs")}`, p.iso, p.iso + "/server.log", p.iso + "/environment.json")}
test "$ready" = 1 || { echo RPI_STAGE_RELEASE_DID_NOT_BOOT; tail -n 40 ${quote(p.iso + "/server.log")}; exit 3; }
node -e ${quote(proof)} <${quote(p.iso + "/environment.json")}
${boot(`node "$previous/apps/server/dist/bin.mjs"`, p.iso, p.iso + "/rollback-replay.log", p.iso + "/rollback-environment.json")}
mode=relink
if [ "$ready" != 1 ]; then
  ${boot(`node "$previous/apps/server/dist/bin.mjs"`, snap, snap + "/rollback-replay.log", snap + "/rollback-environment.json").replaceAll("\n", "\n  ")}
  test "$ready" = 1 || { echo RPI_STAGE_ROLLBACK_DID_NOT_BOOT; tail -n 40 ${quote(snap + "/rollback-replay.log")}; exit 3; }
  mode=relink-and-restore-state
  node -e ${quote(finish)} "$previous" "$mode" ${quote(snap + "/rollback-environment.json")}
else
  node -e ${quote(finish)} "$previous" "$mode" ${quote(p.iso + "/rollback-environment.json")}
fi
echo "RPI_STAGE_PASS rollback_mode=$mode previous=$previous ($previous_kind)"
`;
}

/** The launcher the live unit runs after the first shipped install. It replaces the legacy checkout launcher: same
 * Tailnet-only bind, same queue environment, node 24 from nvm, and the providers' binaries in ~/.local/bin. */
export function rpiLauncher(o: RpiOptions): string {
  const p = checked(o);
  return `#!/bin/bash
# Written by throughline-ship (WCC-163) on every Raspberry Pi install; do not edit here, edit src/rpi.ts in Tier 1.
set -euo pipefail
set -a
[ -f ${quote(p.env)} ] && . ${quote(p.env)}
set +a
export PATH=${o.path}:$PATH
cd ${quote(p.link + "/apps/server")}
exec env T3CODE_NO_BROWSER=1 ${quote(o.node)} ${quote(p.link + "/apps/server/dist/bin.mjs")} serve --mode web --host ${p.host} --port ${p.port} --no-browser --base-dir ${quote(o.state_root)}
`;
}
export function rpiDropIn(o: RpiOptions): string {
  const p = checked(o);
  return `# Written by throughline-ship (WCC-163): the shipped payload replaces the legacy checkout. Delete this file to fall back to it.
[Service]
WorkingDirectory=${o.install_root}
ExecStart=
ExecStart=${p.launcher}
`;
}

export function rpiInstallScript(o: RpiOptions): string {
  const p = checked(o);
  const proof = `const fs=require('node:fs');const j=require(${JSON.stringify(p.stage + "/stage-proof.json")});if(j.version!==${JSON.stringify(o.release)}||j.isolated!==true||j.rollback_compatible!==true||!['relink','relink-and-restore-state'].includes(j.rollback_mode)||j.previous_payload!==process.argv[1]){console.error('RPI_STAGE_PROOF_STALE');process.exit(2);}process.stdout.write(j.rollback_mode);`;
  const backup = `const fs=require('node:fs');const {DatabaseSync}=require('node:sqlite');const root=${JSON.stringify(p.rollback)};fs.mkdirSync(root);const db=new DatabaseSync(${JSON.stringify(o.state_root + "/userdata/state.sqlite")},{readOnly:true});db.exec("VACUUM INTO '"+root+"/state.sqlite'");db.close();fs.copyFileSync(${JSON.stringify(o.state_root + "/userdata/settings.json")},root+'/settings.json');for(const [f,n] of [[${JSON.stringify(p.dropin)},'dropin.conf'],[${JSON.stringify(p.launcher)},'launcher.sh']])if(fs.existsSync(f))fs.copyFileSync(f,root+'/'+n);fs.writeFileSync(root+'/rollback.json',JSON.stringify({previous:process.argv[1],previous_kind:process.argv[2],rollback_mode:process.argv[3],target:${JSON.stringify(p.installed)},state_snapshot:root+'/state.sqlite',at:new Date().toISOString()})+'\\n');`;
  const verify = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(!s.trim())process.exit(2);if(JSON.parse(s).serverVersion!==${JSON.stringify(o.release)})process.exit(2);});`;
  const write = (
    file: string,
    body: string,
    mode: string,
  ) => `tmp=$(mktemp ${quote(file + ".XXXXXX")})
printf '%s' ${quote(body)} >"$tmp"; chmod ${mode} "$tmp"; mv -f "$tmp" ${quote(file)}`;
  return `${header(o)}
${previousShell(o)}
mode=$(node -e ${quote(proof)} "$previous")
test ! -e ${quote(p.installed)}
test ! -e ${quote(p.rollback)}
mkdir -p ${quote(o.install_root)} ${quote(dirname(p.dropin))}
cp -a ${quote(p.app)} ${quote(p.installed)}
node -e ${quote(backup)} "$previous" "$previous_kind" "$mode"
if [ ! -f ${quote(p.env)} ]; then mkdir -p -m 700 ${quote(dirname(p.env))}; cp -p ${quote(o.env_source)} ${quote(p.env)}; chmod 600 ${quote(p.env)}; fi
restore_previous() {
  systemctl --user stop ${p.unit} || true
  if [ "$previous_kind" = legacy ]; then rm -f ${quote(p.dropin)} ${quote(p.link)}; else ln -sfn "$previous" ${quote(p.link)}; fi
  if [ "$mode" = relink-and-restore-state ]; then
    rm -f ${quote(o.state_root + "/userdata/state.sqlite-wal")} ${quote(o.state_root + "/userdata/state.sqlite-shm")}
    cp -p ${quote(p.rollback + "/state.sqlite")} ${quote(o.state_root + "/userdata/state.sqlite")}
  fi
  systemctl --user daemon-reload; systemctl --user start ${p.unit}
}
${write(p.launcher, rpiLauncher(o), "755")}
ln -sfn ${quote(p.installed)} ${quote(p.link)}
${write(p.dropin, rpiDropIn(o), "644")}
systemctl --user daemon-reload
if ! systemctl --user restart ${p.unit}; then restore_previous; echo RPI_INSTALL_FAILED_ROLLED_BACK; exit 4; fi
ready=0
for i in $(seq 1 90); do
  if curl --fail --silent --max-time 2 ${quote(o.service_url + "/.well-known/t3/environment")} | node -e ${quote(verify)}; then ready=1; break; fi
  sleep 2
done
if [ "$ready" != 1 ]; then restore_previous; echo RPI_INSTALL_FAILED_ROLLED_BACK; exit 4; fi
systemctl --user is-active ${p.unit}
echo RPI_INSTALL_PASS
`;
}

/** Undo one Raspberry Pi install from what it recorded in rollback-<release>/rollback.json: point the service back at
 * the previous payload (for the legacy checkout, delete the shipped drop-in), restore the state snapshot when the stage
 * proved the previous payload needs it, restart, and require the previous version to answer at the service address. */
export function rpiRollbackScript(o: RpiOptions): string {
  const p = checked(o);
  const read = `const j=require(${JSON.stringify(p.rollback + "/rollback.json")});if(j.target!==${JSON.stringify(p.installed)})process.exit(2);process.stdout.write([j.previous,j.previous_kind,j.rollback_mode].join(' '));`;
  const verify = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(!s.trim())process.exit(2);const v=JSON.parse(s).serverVersion;if(v===${JSON.stringify(o.release)})process.exit(2);process.stdout.write(v);});`;
  return `${header(o)}
set -- $(node -e ${quote(read)})
previous=$1; previous_kind=$2; mode=$3
test -f "$previous/apps/server/dist/bin.mjs"
systemctl --user stop ${p.unit} || true
if [ "$previous_kind" = legacy ]; then rm -f ${quote(p.dropin)} ${quote(p.link)}; else ln -sfn "$previous" ${quote(p.link)}; fi
if [ "$mode" = relink-and-restore-state ]; then
  rm -f ${quote(o.state_root + "/userdata/state.sqlite-wal")} ${quote(o.state_root + "/userdata/state.sqlite-shm")}
  cp -p ${quote(p.rollback + "/state.sqlite")} ${quote(o.state_root + "/userdata/state.sqlite")}
fi
systemctl --user daemon-reload; systemctl --user start ${p.unit}
for i in $(seq 1 90); do
  if v=$(curl --fail --silent --max-time 2 ${quote(o.service_url + "/.well-known/t3/environment")} | node -e ${quote(verify)}); then echo "RPI_ROLLBACK_PASS serving=$v mode=$mode previous=$previous"; exit 0; fi
  sleep 2
done
echo RPI_ROLLBACK_DID_NOT_ANSWER; exit 4
`;
}

/** Closed owner registration. These are BUILD INPUTS, never runtime packages.
 * This API has no SSH, transport, subprocess or filesystem implementation.
 * A separately admitted typed receiver supplies measured ports; it must not
 * accept a caller-uploaded recipe/script or translate arbitrary caller argv.
 * The legacy live-state helpers above are intentionally not called here. */
export const RPI_AF60_SOURCE = "af60be0f620fdb9441d233f6dcce1461f452b796";
export const RPI_AF60_RELEASE = "0.0.57";
export interface RpiAf60File {
  name: string;
  sha256: string;
  bytes: number;
}
const AF60_INPUTS: readonly RpiAf60File[] = [
  {
    name: "rpi-source-af60be0f620fdb9441d233f6dcce1461f452b796.tar",
    sha256: "954f988862b2d316f10ce3898456c3c1b1aa83e045260aaaec14eee39415890c",
    bytes: 289781760,
  },
  {
    name: "rpi-coms-net-input.tar",
    sha256: "4576d21f794c571e03616db79aa309e4a36a78103fd494bbc606b9c06f4744cd",
    bytes: 53248,
  },
  {
    name: "node-v24.19.0-linux-arm64.bin",
    sha256: "3e53e5ff5eaa922f1b4308312d50da9091db62d40b87716ad36c60b347e7f984",
    bytes: 122077656,
  },
  {
    name: "pnpm-11.10.0.tgz",
    sha256: "620b6605ea4f62fc56a6d0a98733f479071d0321e03e486b522c7e9a74617431",
    bytes: 4619264,
  },
];
const AF60_OUTPUTS = [
  "server-linux-arm64.tar",
  "package-manifest.json",
  "staged-unit.service",
  "staged-unit-readiness.json",
] as const;
const AF60_NATIVE = {
  "node-pty": "1.2.0-beta.15",
  "@ff-labs/fff-node": "0.9.4",
  "@napi-rs/keyring": "1.3.0",
} as const;
const AF60_PACKAGES: Readonly<Record<string, string>> = {
  scripts: "74f5fcc2d55c5f163f3764ea141bf093353ab3c59df1484c649f318bdeb68c83",
  "apps/server": "1a349f83ff63cafb77c344a465cedbd0c913ccf1d5cbd42969d1034025108a0f",
  "apps/web": "73986c6eb61ab2a777bb48a4fac306c8126893d90e323a3a9fe9211302969493",
  "packages/absurd-runtime": "dce2599bd768ab343593f31b5a7548a02d8141eeed06ab1be39e3cf47362fe58",
  "packages/client-runtime": "4a3da4815b104cb6422282367b26b3ce98b07030a47c5faeb852b8d70a19715c",
  "packages/contracts": "0d52430f1b67996aeba4b5d782f44d6d103b2eec506364e029d5ec47c378605f",
  "packages/shared": "8e712bb54dbe42fb238a7a37f7c23a65c1df0072257d6b6693eb9a70c3d9eb31",
  "packages/ssh": "90f0bc2eae26423bdc9ed379a908e9952456774aae88b54b0db6093d1dc35b51",
  "packages/tailscale": "4b2c8cd475e874fd44fba7369471d58c3ee45019371bacf1264b2b0d1a837ab7",
  "packages/effect-acp": "088f8bac0f59e8bb5cd9fdd9156cd54bb0f229c487a3a3e46a3cecb082c48455",
  "packages/effect-codex-app-server":
    "e784da0b6b877b4226437906c26f8418c3b7bbe8bb84cf4f5e3dee79b41b0e8a",
};
function af60Freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) af60Freeze(child);
    Object.freeze(value);
  }
  return value;
}
function af60Record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error("RPI_PACKAGE_RECORD");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value))
    if (
      typeof key !== "string" ||
      !keys.includes(key) ||
      !descriptors[key]?.enumerable ||
      !("value" in descriptors[key]!)
    )
      throw Error("RPI_PACKAGE_UNKNOWN_FIELD");
  if (keys.some((key) => !Object.hasOwn(value, key))) throw Error("RPI_PACKAGE_MISSING_FIELD");
  return value as Record<string, unknown>;
}
function af60Dense(value: unknown, count: number): unknown[] {
  if (!Array.isArray(value) || value.length !== count) throw Error("RPI_PACKAGE_INPUT_POPULATION");
  for (let i = 0; i < count; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !("value" in d) || !d.enumerable) throw Error("RPI_PACKAGE_DENSE_ENTRIES");
  }
  for (const key of Reflect.ownKeys(value))
    if (key !== "length" && (typeof key !== "string" || !/^\d+$/.test(key) || Number(key) >= count))
      throw Error("RPI_PACKAGE_DENSE_ENTRIES");
  return value;
}
function af60Workspace(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value))
    throw Error("RPI_PACKAGE_WORKSPACE");
  return value;
}
function af60Files(value: unknown, expected: readonly RpiAf60File[]): RpiAf60File[] {
  const rows = af60Dense(value, expected.length),
    seen = new Set<string>(),
    result: RpiAf60File[] = [];
  for (let i = 0; i < rows.length; i++) {
    const x = af60Record(rows[i], ["name", "sha256", "bytes"]);
    const pin = expected.find((e) => e.name === x.name);
    if (!pin || seen.has(pin.name) || x.sha256 !== pin.sha256 || x.bytes !== pin.bytes)
      throw Error("RPI_PACKAGE_INPUT_BINDING");
    seen.add(pin.name);
    result.push({ ...pin });
  }
  return result;
}
export function rpiAf60PackageInputs() {
  return af60Freeze({
    schema: "throughline.rpi-server-recipe.v1" as const,
    source_commit: RPI_AF60_SOURCE,
    release: RPI_AF60_RELEASE,
    inputs: AF60_INPUTS.map((x) => ({ ...x })),
  });
}
export interface RpiAf60Request {
  schema: "rpi-server-package-job.v1";
  operation: "server-package-unit-preflight";
  workspace: string;
  source_commit: string;
  release: string;
  inputs: RpiAf60File[];
}
export function parseRpiAf60PackageRequest(value: unknown): RpiAf60Request {
  const r = af60Record(value, [
    "schema",
    "operation",
    "workspace",
    "source_commit",
    "release",
    "inputs",
  ]);
  if (r.source_commit !== RPI_AF60_SOURCE || r.release !== RPI_AF60_RELEASE)
    throw Error("RPI_PACKAGE_SOURCE_BINDING");
  if (r.schema !== "rpi-server-package-job.v1" || r.operation !== "server-package-unit-preflight")
    throw Error("RPI_PACKAGE_OPERATION");
  return {
    schema: r.schema,
    operation: r.operation,
    workspace: af60Workspace(r.workspace),
    source_commit: RPI_AF60_SOURCE,
    release: RPI_AF60_RELEASE,
    inputs: af60Files(r.inputs, AF60_INPUTS),
  };
}
export function verifyRpiAf60InputBytes(name: string, bytes: Uint8Array): void {
  const pin = AF60_INPUTS.find((x) => x.name === name);
  if (
    !pin ||
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength !== pin.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== pin.sha256
  )
    throw Error("RPI_PACKAGE_INPUT_BYTES");
}
export interface RpiAf60Step {
  id: string;
  kind: "files" | "command" | "measure";
  cwd: string;
  program?: string;
  args?: readonly string[];
  actions?: readonly string[];
}
export function rpiAf60PackageRecipe(workspace = "server-af60-057") {
  const root = "/home/rpi/rpi-jobs/" + af60Workspace(workspace),
    build = root + "/build",
    src = build + "/workbench/infra/t3code/t3-0.0.57",
    payload = build + "/payload";
  const node = root + "/runtime/node/bin/node",
    pnpm = root + "/runtime/pnpm/package/bin/pnpm.cjs";
  const unit = `[Unit]\nDescription=ThroughLine af60 package CLI staged preflight only\n[Service]\nType=oneshot\nWorkingDirectory=${payload}\nEnvironment=HOME=${root}/isolated/home\nEnvironment=APP_COMMIT=${RPI_AF60_SOURCE}\nExecStart=${payload}/node/bin/node ${payload}/dist/bin.mjs --help\nRestart=no\n`;
  const steps: readonly RpiAf60Step[] = [
    {
      id: "materialize-pinned-inputs",
      kind: "files",
      cwd: root,
      actions: [
        "Require fresh build/output directories and no aliases; independently validate archive members before extraction",
        "Install pinned Node binary at runtime/node/bin/node with mode0755; check ELF Linux-arm64",
        "Extract source only to build/workbench/infra/t3code/t3-0.0.57",
        "Extract coms-net only to build/workbench/tools/coms-net",
        "Extract pnpm only to runtime/pnpm; no caller scripts, URLs, paths or interpreter options",
      ],
    },
    {
      id: "toolchain-versions",
      kind: "measure",
      cwd: root,
      actions: [
        "Measure rpi/linux/arm64 identity, Node v24.19.0, pnpm11.10.0, native compiler/Rust availability; zero measurements refuse",
      ],
    },
    {
      id: "frozen-dependency-install",
      kind: "command",
      cwd: src,
      program: node,
      args: [pnpm, "install", "--frozen-lockfile", "--ignore-scripts"],
    },
    {
      id: "native-pty-generation",
      kind: "command",
      cwd: src,
      program: node,
      args: [pnpm, "rebuild", "node-pty"],
    },
    {
      id: "web-build",
      kind: "command",
      cwd: src + "/apps/web",
      program: node,
      args: ["--run", "build"],
    },
    {
      id: "server-build",
      kind: "command",
      cwd: src + "/apps/server",
      program: node,
      args: ["scripts/cli.ts", "build", "--verbose"],
    },
    {
      id: "resource-monitor-build",
      kind: "command",
      cwd: src,
      program: "/home/rpi/.cargo/bin/cargo",
      args: [
        "build",
        "--locked",
        "--release",
        "--manifest-path",
        src + "/native/resource-monitor/Cargo.toml",
        "--target",
        "aarch64-unknown-linux-gnu",
        "--target-dir",
        build + "/native-target",
      ],
    },
    {
      id: "production-deploy",
      kind: "command",
      cwd: src,
      program: node,
      args: [pnpm, "--filter", "t3", "deploy", "--legacy", "--prod", payload],
    },
    {
      id: "complete-payload",
      kind: "files",
      cwd: root,
      actions: [
        "Copy pinned Node binary to payload/node/bin/node with mode0755",
        "Copy native-target/aarch64-unknown-linux-gnu/release/t3-resource-monitor to payload/dist/resource-monitor/t3-resource-monitor with mode0755",
        "Check all first-party package.json hashes against owner registration after generation; no older-source binding",
        "Require dist/bin.mjs, dist/client/index.html, native external runtime closure and no payload link leaving payload",
        "Write the fixed help-only staged unit; no enabling, starting, restarting or boot-policy claim",
      ],
    },
    {
      id: "native-load",
      kind: "command",
      cwd: payload,
      program: payload + "/node/bin/node",
      args: [
        "-e",
        "for(const n of ['node-pty','@ff-labs/fff-node','@napi-rs/keyring']){require(n);console.log('NATIVE_LOAD '+n)}",
      ],
    },
    {
      id: "help",
      kind: "command",
      cwd: payload,
      program: payload + "/node/bin/node",
      args: ["dist/bin.mjs", "--help"],
    },
    {
      id: "version",
      kind: "command",
      cwd: payload,
      program: payload + "/node/bin/node",
      args: ["dist/bin.mjs", "--version"],
    },
    {
      id: "staged-unit-syntax",
      kind: "command",
      cwd: root,
      program: "/usr/bin/systemd-analyze",
      args: ["--user", "verify", root + "/staged-unit.service"],
    },
    {
      id: "package-and-manifest",
      kind: "files",
      cwd: root,
      actions: [
        "Before archiving measure payload link confinement; archive regular files with native helper and verified interpreter, without deleting any file",
        "Produce server-linux-arm64.tar, package-manifest.json, staged-unit.service, staged-unit-readiness.json only",
        "Compute SHA256/size from actual output bytes; manifest binds source/release/interpreter/native observations; zero native/help/unit checks refuse",
      ],
    },
  ];
  return af60Freeze({
    schema: "throughline.rpi-server-package-plan.v1",
    source_commit: RPI_AF60_SOURCE,
    release: RPI_AF60_RELEASE,
    source_support_only: true,
    independent_typed_admission_required: true,
    inputs: AF60_INPUTS.map((x) => ({ ...x })),
    outputs: [...AF60_OUTPUTS],
    root,
    source_root: src,
    payload_root: payload,
    network_ports: [] as number[],
    native_externals: { ...AF60_NATIVE },
    interpreter: {
      name: AF60_INPUTS[2]!.name,
      version: "v24.19.0",
      platform: "linux-arm64",
      sha256: AF60_INPUTS[2]!.sha256,
      bytes: AF60_INPUTS[2]!.bytes,
    },
    first_party_manifest_sha256: { ...AF60_PACKAGES },
    pnpm_version: "11.10.0",
    lock_sha256: "2833ea8f21f9e467e32588a56fb3b2fc7499144133593cfa97b0d610a7a5e10a",
    runtime_manifest_contract: {
      schema: "throughline.rpi-server-package.v1",
      fields: [
        "schema",
        "source_commit",
        "release",
        "platform",
        "node_version",
        "inputs",
        "interpreter",
        "package",
        "checks",
      ],
      checks: ["native_load", "help_version", "staged_unit"],
    },
    environment: {
      APP_COMMIT: RPI_AF60_SOURCE,
      PATH: root + "/runtime/node/bin:/usr/bin:/bin",
      HOME: root + "/isolated/home",
      TMPDIR: root + "/isolated/tmp",
      XDG_CONFIG_HOME: root + "/isolated/config",
      XDG_DATA_HOME: root + "/isolated/data",
      XDG_STATE_HOME: root + "/isolated/state",
      CARGO_HOME: root + "/isolated/cargo",
      RUSTUP_HOME: "/home/rpi/.rustup",
      CI: "1",
    },
    unit,
    steps,
  });
}
function af60Positive(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
export function validateRpiAf60NativeEvidence(value: unknown): void {
  if (!value || typeof value !== "object") throw Error("RPI_PACKAGE_NATIVE_RECORD");
  const r = value as Record<string, unknown>;
  if (
    r.user !== "rpi" ||
    r.platform !== "linux" ||
    r.arch !== "arm64" ||
    r.node_version !== "v24.19.0"
  )
    throw Error("RPI_PACKAGE_NATIVE_IDENTITY");
  if (!Array.isArray(r.modules) || r.modules.length !== Object.keys(AF60_NATIVE).length)
    throw Error("RPI_PACKAGE_NATIVE_POPULATION");
  const modules = af60Dense(r.modules, Object.keys(AF60_NATIVE).length),
    seen = new Set<string>();
  for (let i = 0; i < modules.length; i++) {
    const x = af60Record(modules[i], ["name", "version", "loaded", "checks"]),
      name = x.name as keyof typeof AF60_NATIVE;
    if (
      !Object.hasOwn(AF60_NATIVE, name) ||
      seen.has(name) ||
      x.version !== AF60_NATIVE[name] ||
      x.loaded !== true ||
      !af60Positive(x.checks)
    )
      throw Error("RPI_PACKAGE_NATIVE_MODULE");
    seen.add(name);
  }
  const monitor = af60Record(r.resource_monitor, ["machine", "checks"]);
  const help = af60Record(r.help_version, ["exit_code", "checks", "version"]);
  const unit = af60Record(r.staged_unit, ["exit_code", "checks", "live_userdata"]);
  if (
    monitor.machine !== 183 ||
    !af60Positive(monitor.checks) ||
    help.exit_code !== 0 ||
    !af60Positive(help.checks) ||
    help.version !== RPI_AF60_RELEASE ||
    unit.exit_code !== 0 ||
    !af60Positive(unit.checks) ||
    unit.live_userdata !== false
  )
    throw Error("RPI_PACKAGE_NATIVE_ZERO_OR_FAILED_CHECK");
}
export interface RpiAf60Ports {
  /** Trusted observations, never request fields. Admission is independently owned. */
  observe(): Promise<{
    user: string;
    platform: string;
    arch: string;
    node_version: string;
    root_realpath: string;
    build_exists: boolean;
    outputs_exist: boolean;
    typed_support_admitted: boolean;
    app_commit_allowed: boolean;
  }>;
  readInput(name: string): Promise<Uint8Array>;
  perform(
    step: RpiAf60Step,
    environment: Readonly<Record<string, string>>,
  ): Promise<{ exit_code: number; checks: number }>;
  firstPartyBindings(): Promise<
    { owner: string; resolved_root: string; manifest_bytes: Uint8Array }[]
  >;
  nativeEvidence(): Promise<unknown>;
  outputNames(): Promise<unknown>;
  readOutput(name: string): Promise<Uint8Array>;
}
/** Source-owned protocol runner over trusted typed ports only. No process/file
 * or transport effects are implemented in this module. Tests of fake ports
 * establish source support, never independent host/package admission. */
export async function runRpiAf60PackageSupport(request: unknown, ports: RpiAf60Ports) {
  const r = parseRpiAf60PackageRequest(request),
    plan = rpiAf60PackageRecipe(r.workspace),
    ctx = await ports.observe();
  if (
    ctx.user !== "rpi" ||
    ctx.platform !== "linux" ||
    ctx.arch !== "arm64" ||
    ctx.node_version !== "v24.19.0"
  )
    throw Error("RPI_PACKAGE_IDENTITY");
  if (ctx.root_realpath !== plan.root) throw Error("RPI_PACKAGE_LOCATION");
  if (ctx.build_exists !== false || ctx.outputs_exist !== false) throw Error("RPI_PACKAGE_REUSE");
  if (ctx.typed_support_admitted !== true || ctx.app_commit_allowed !== true)
    throw Error("RPI_PACKAGE_ADMISSION_REQUIRED");
  for (const input of plan.inputs)
    verifyRpiAf60InputBytes(input.name, await ports.readInput(input.name));
  const checkBindings = async () => {
    const bindings = af60Dense(await ports.firstPartyBindings(), Object.keys(AF60_PACKAGES).length),
      seen = new Set<string>();
    for (let i = 0; i < bindings.length; i++) {
      const b = af60Record(bindings[i], ["owner", "resolved_root", "manifest_bytes"]),
        name = b.owner as string,
        bytes = b.manifest_bytes;
      if (
        !Object.hasOwn(AF60_PACKAGES, name) ||
        seen.has(name) ||
        b.resolved_root !== plan.source_root + "/" + name ||
        !(bytes instanceof Uint8Array) ||
        createHash("sha256").update(bytes).digest("hex") !== AF60_PACKAGES[name]
      )
        throw Error("RPI_PACKAGE_FIRST_PARTY_BINDING");
      seen.add(name);
    }
  };
  const measurements: { id: string; checks: number }[] = [];
  for (const step of plan.steps) {
    if (step.id === "web-build") await checkBindings();
    const result = await ports.perform(step, plan.environment);
    if (result.exit_code !== 0 || !af60Positive(result.checks))
      throw Error("RPI_PACKAGE_STEP_FAILED_OR_ZERO: " + step.id);
    measurements.push({ id: step.id, checks: result.checks });
  }
  await checkBindings();
  validateRpiAf60NativeEvidence(await ports.nativeEvidence());
  const names = af60Dense(await ports.outputNames(), AF60_OUTPUTS.length),
    seenOutputs = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (typeof name !== "string" || !AF60_OUTPUTS.some((x) => x === name) || seenOutputs.has(name))
      throw Error("RPI_PACKAGE_OUTPUT_POPULATION");
    seenOutputs.add(name);
  }
  const outputs: RpiAf60File[] = [],
    outputBytes = new Map<string, Uint8Array>();
  for (const name of plan.outputs) {
    const bytes = await ports.readOutput(name);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
      throw Error("RPI_PACKAGE_OUTPUT_EMPTY");
    const frozen = Uint8Array.from(bytes);
    outputBytes.set(name, frozen);
    outputs.push({
      name,
      bytes: frozen.byteLength,
      sha256: createHash("sha256").update(frozen).digest("hex"),
    });
  }
  const manifest = af60Record(
    JSON.parse(Buffer.from(outputBytes.get("package-manifest.json")!).toString("utf8")),
    plan.runtime_manifest_contract.fields,
  );
  if (
    manifest.schema !== plan.runtime_manifest_contract.schema ||
    manifest.source_commit !== RPI_AF60_SOURCE ||
    manifest.release !== RPI_AF60_RELEASE ||
    manifest.platform !== "linux-arm64" ||
    manifest.node_version !== "v24.19.0"
  )
    throw Error("RPI_PACKAGE_OUTPUT_BINDING");
  af60Files(manifest.inputs, AF60_INPUTS);
  af60Files([manifest.interpreter], [AF60_INPUTS[2]!]);
  const checks = af60Record(manifest.checks, plan.runtime_manifest_contract.checks);
  if (Object.values(checks).some((x) => !af60Positive(x)))
    throw Error("RPI_PACKAGE_OUTPUT_ZERO_CHECKS");
  const packageRow = outputs.find((x) => x.name === "server-linux-arm64.tar")!;
  af60Files([manifest.package], [packageRow]);
  return {
    schema: "throughline.rpi-source-support-result.v1",
    source_commit: RPI_AF60_SOURCE,
    release: RPI_AF60_RELEASE,
    source_support_only: true,
    independent_host_acceptance: false,
    outputs,
    measurements,
  };
}

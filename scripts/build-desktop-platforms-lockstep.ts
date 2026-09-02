// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off - Host-side release coordinator owns local and remote build processes before an Effect runtime exists.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertEveryPlatformTarget } from "./platform-lockstep-contract.ts";
import { installMacDmg } from "./desktop-platform-install.ts";

type PlatformTarget = {
  id: string;
  lane: "local-darwin" | "tower-login-shell";
  host?: string;
  build_script: string;
  artifact: string;
  install_path?: string;
  current_link?: string;
  backup_root?: string;
  display?: string;
};

type PlatformContract = {
  schema: "throughline-desktop-platform-targets.v1";
  version_source: string;
  targets: PlatformTarget[];
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(repoRoot, "apps/desktop/platform-targets.json");
const contract = JSON.parse(readFileSync(contractPath, "utf8")) as PlatformContract;
const desktopPackage = JSON.parse(
  readFileSync(join(repoRoot, contract.version_source), "utf8"),
) as { version?: string };
const version = desktopPackage.version;

function refuse(message: string): never {
  throw new Error(`LOCKSTEP_REFUSED: ${message}`);
}

function run(command: string, args: string[], cwd = repoRoot): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  }).trim();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function artifactPath(root: string, target: PlatformTarget): string {
  return join(root, target.artifact.replace("{version}", version!));
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

if (process.platform !== "darwin")
  refuse(`orchestrator must start on darwin, got ${process.platform}`);
if (!version || !/^\d+\.\d+\.\d+$/.test(version))
  refuse(`invalid desktop version from ${contract.version_source}`);
if (contract.targets.length < 2) refuse("contract must declare every platform target");
if (new Set(contract.targets.map((target) => target.id)).size !== contract.targets.length)
  refuse("duplicate target id");

const buildStateDir = join(repoRoot, ".platform-build", version);
mkdirSync(buildStateDir, { recursive: true });
const sourceArchive = join(buildStateDir, "source.tar");
process.env.COPYFILE_DISABLE = "1";
run("tar", [
  "-C",
  repoRoot,
  "--exclude=.git",
  "--exclude=.platform-build",
  "--exclude=node_modules",
  "--exclude=*/node_modules",
  "--exclude=release",
  "--exclude=*/release",
  "--exclude=.desktop-artifacts-*",
  "--exclude=*.AppImage",
  "--exclude=*.dmg",
  "-cf",
  sourceArchive,
  ".",
]);
const sourceSnapshotSha = sha256(sourceArchive);
const sourceId = sourceSnapshotSha.slice(0, 12);
const localBuildRoot = join(dirname(repoRoot), `t3-build-${version}-${sourceId}`);
if (existsSync(localBuildRoot)) refuse(`local build root already exists: ${localBuildRoot}`);
mkdirSync(localBuildRoot, { recursive: true });
run("tar", ["-C", localBuildRoot, "-xf", sourceArchive]);

const macTarget =
  contract.targets.find((target) => target.lane === "local-darwin") ??
  refuse("missing local-darwin target");
const linuxTarget =
  contract.targets.find((target) => target.lane === "tower-login-shell") ??
  refuse("missing tower-login-shell target");
const host = linuxTarget.host ?? refuse("linux target missing host");
const remoteArchive = `/srv/core-root/vault/01_Projects/workbench/infra/t3code/t3code-platform-${version}-${sourceId}.tar`;
const remoteBuildRoot = `/srv/core-root/vault/01_Projects/workbench/infra/t3code/t3-build-${version}-${sourceId}`;

run("scp", [sourceArchive, `${host}:${remoteArchive}`]);
const remoteBuild = [
  "set -e",
  "sh /srv/core-root/vault/01_Projects/workbench/infra/t3code/_reusable/linux-desktop-build-preflight.sh",
  `test ! -e ${shellQuote(remoteBuildRoot)} || { printf 'LOCKSTEP_REFUSED: remote build root already exists\\n' >&2; exit 12; }`,
  `mkdir -p ${shellQuote(remoteBuildRoot)}`,
  `cd ${shellQuote(remoteBuildRoot)}`,
  `tar -xf ${shellQuote(remoteArchive)}`,
  "pnpm install --frozen-lockfile",
  `export PATH=/home/twr/.cargo/bin:$PATH; pnpm run ${shellQuote(linuxTarget.build_script)}`,
].join(" && ");
run("ssh", [host, "bash", "-lc", shellQuote(remoteBuild)]);

run("pnpm", ["install", "--frozen-lockfile"], localBuildRoot);
run("pnpm", ["run", macTarget.build_script], localBuildRoot);

const stagedMacArtifact = artifactPath(localBuildRoot, macTarget);
const remoteLinuxArtifact = `${remoteBuildRoot}/${linuxTarget.artifact.replace("{version}", version)}`;
const macArtifact = artifactPath(repoRoot, macTarget);
const localLinuxArtifact = artifactPath(repoRoot, linuxTarget);
if (!existsSync(stagedMacArtifact))
  refuse(`missing ${macTarget.id} artifact: ${stagedMacArtifact}`);
run("scp", [
  `${host}:${remoteLinuxArtifact}`,
  join(buildStateDir, `ThroughLine-${version}-x86_64.AppImage`),
]);
const stagedLinuxArtifact = join(buildStateDir, `ThroughLine-${version}-x86_64.AppImage`);
assertEveryPlatformTarget(contract.targets, (target) => {
  if (target.id === macTarget.id) return existsSync(stagedMacArtifact);
  if (target.id === linuxTarget.id) return existsSync(stagedLinuxArtifact);
  return false;
});
mkdirSync(dirname(macArtifact), { recursive: true });
copyFileSync(stagedMacArtifact, macArtifact);
copyFileSync(stagedLinuxArtifact, localLinuxArtifact);

const installPath =
  linuxTarget.install_path?.replace("{version}", version) ??
  refuse("linux target missing install_path");
const currentLink = linuxTarget.current_link ?? refuse("linux target missing current_link");
const publishLinux = [
  "set -e",
  `cp ${shellQuote(remoteLinuxArtifact)} ${shellQuote(installPath)}`,
  `chmod 0755 ${shellQuote(installPath)}`,
  `ln -sfn ${shellQuote(installPath)} ${shellQuote(currentLink)}`,
  `test \"$(readlink ${shellQuote(currentLink)})\" = ${shellQuote(installPath)}`,
  `for pid in $(pgrep -f '^/srv/throughline/ThroughLine(-[^ ]+)?\\.AppImage( |$)' || true); do kill -TERM \"$pid\"; done`,
  "sleep 2",
  `nohup env DISPLAY=${shellQuote(linuxTarget.display ?? ":2")} ${shellQuote(currentLink)} >/srv/throughline/ThroughLine.log 2>&1 </dev/null &`,
  "pid=$!",
  "attempt=0",
  'while ! kill -0 "$pid" 2>/dev/null; do attempt=$((attempt + 1)); test "$attempt" -lt 20 || { printf \'LOCKSTEP_REFUSED: linux app did not remain running\\n\' >&2; exit 13; }; sleep 1; done',
  `actual=$(tr '\\0' '\\n' </proc/\"$pid\"/cmdline | sed -n '1p')`,
  `test \"$actual\" = ${shellQuote(currentLink)} || { printf 'LOCKSTEP_REFUSED: linux running path expected %s got %s\\n' ${shellQuote(currentLink)} \"$actual\" >&2; exit 14; }`,
  `printf 'LINUX_RUNNING_PATH=%s LINUX_RUNNING_VERSION=%s\\n' \"$actual\" ${shellQuote(version)}`,
].join(" && ");
const linuxRuntimeProof = run("ssh", [host, "bash", "-lc", shellQuote(publishLinux)]);

const macInstallPath = macTarget.install_path ?? refuse("mac target missing install_path");
if (macInstallPath !== "/Applications/ThroughLine.app") {
  refuse(`mac install path must preserve the stable identity: ${macInstallPath}`);
}
const macBackupRoot = macTarget.backup_root ?? refuse("mac target missing backup_root");
const macInstall = installMacDmg({ dmgPath: macArtifact, version, backupRoot: macBackupRoot });

const receiptPath = join(repoRoot, "release", `desktop-platforms-${version}.json`);
writeFileSync(
  receiptPath,
  `${JSON.stringify(
    {
      schema: "throughline-desktop-platform-build.v1",
      version,
      source_snapshot_sha256: sourceSnapshotSha,
      built_at: new Date().toISOString(),
      targets: [
        {
          id: macTarget.id,
          artifact: macArtifact,
          sha256: sha256(macArtifact),
          installed_at: macInstallPath,
          running_executable: macInstall.executable,
          backup_bundle: macInstall.backupBundle,
        },
        {
          id: linuxTarget.id,
          artifact: localLinuxArtifact,
          sha256: sha256(localLinuxArtifact),
          installed_at: installPath,
          current_link: currentLink,
          running_proof: linuxRuntimeProof,
        },
      ],
    },
    null,
    2,
  )}\n`,
);
console.log(
  `LOCKSTEP_SHIPPED version=${version} targets=${contract.targets.map((target) => target.id).join(",")} receipt=${receiptPath}`,
);

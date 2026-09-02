// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Release installation is a host-boundary adapter.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { assertRunningPlatform, macBackupBundlePath } from "./platform-lockstep-contract.ts";

export const MAC_APP_PATH = "/Applications/ThroughLine.app";
export const MAC_EXECUTABLE_PATH = `${MAC_APP_PATH}/Contents/MacOS/ThroughLine`;

function command(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function readBundleVersion(bundlePath: string): string {
  return command("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleShortVersionString",
    join(bundlePath, "Contents/Info.plist"),
  ]);
}

export function installMacBundleCopy(input: {
  candidateBundle: string;
  destinationBundle: string;
  backupRoot: string;
  version: string;
  at: string;
}): { backupBundle: string | null } {
  if (basename(input.candidateBundle) !== "ThroughLine.app") {
    throw new Error(
      `LOCKSTEP_REFUSED: candidate bundle must be named ThroughLine.app: ${input.candidateBundle}`,
    );
  }
  const backupBundle = existsSync(input.destinationBundle)
    ? macBackupBundlePath(input.backupRoot, readBundleVersion(input.destinationBundle), input.at)
    : null;
  if (backupBundle) {
    mkdirSync(dirname(backupBundle), { recursive: true });
    renameSync(input.destinationBundle, backupBundle);
  }
  try {
    cpSync(input.candidateBundle, input.destinationBundle, {
      recursive: true,
      preserveTimestamps: true,
    });
    const installedVersion = readBundleVersion(input.destinationBundle);
    if (installedVersion !== input.version) {
      throw new Error(
        `LOCKSTEP_REFUSED: installed Mac bundle version mismatch: expected ${input.version}, got ${installedVersion}`,
      );
    }
  } catch (error) {
    rmSync(input.destinationBundle, { recursive: true, force: true });
    if (backupBundle) renameSync(backupBundle, input.destinationBundle);
    throw error;
  }
  return { backupBundle };
}

function mountedVolumeFromAttach(output: string): string {
  const match = output.match(/\t(\/Volumes\/[^\n]+)$/m);
  if (!match?.[1]) throw new Error("LOCKSTEP_REFUSED: hdiutil did not return a mounted volume");
  return match[1];
}

function currentMacExecutable(): string | null {
  const pids = command("pgrep", ["-x", "ThroughLine"]).split("\n").filter(Boolean);
  for (const pid of pids) {
    const rows = command("lsof", ["-a", "-p", pid, "-d", "txt", "-Fn"]).split("\n");
    const executable = rows.find(
      (row) => row.startsWith("n/") && row.endsWith("/Contents/MacOS/ThroughLine"),
    );
    if (executable) return executable.slice(1);
  }
  return null;
}

export function installMacDmg(input: { dmgPath: string; version: string; backupRoot: string }): {
  backupBundle: string | null;
  executable: string;
} {
  const mounted = mountedVolumeFromAttach(
    command("hdiutil", ["attach", "-nobrowse", "-readonly", input.dmgPath]),
  );
  try {
    const candidateBundle = join(mounted, "ThroughLine.app");
    const installed = installMacBundleCopy({
      candidateBundle,
      destinationBundle: MAC_APP_PATH,
      backupRoot: input.backupRoot,
      version: input.version,
      at: new Date().toISOString(),
    });
    try {
      command("pkill", ["-TERM", "-x", "ThroughLine"]);
    } catch {
      // A stopped app has nothing to quit. The subsequent launch and proof remain mandatory.
    }
    command("open", [MAC_APP_PATH]);
    let actualExecutable: string | null = null;
    for (let attempt = 0; attempt < 20 && !actualExecutable; attempt += 1) {
      try {
        command("sleep", ["1"]);
        actualExecutable = currentMacExecutable();
      } catch {
        actualExecutable = null;
      }
    }
    assertRunningPlatform({
      platform: "mac-arm64",
      expectedExecutable: MAC_EXECUTABLE_PATH,
      actualExecutable,
      expectedVersion: input.version,
      actualVersion: readBundleVersion(MAC_APP_PATH),
    });
    return { ...installed, executable: actualExecutable! };
  } finally {
    command("hdiutil", ["detach", mounted]);
  }
}

export function verifyLinuxProcess(input: {
  platform: string;
  expectedCommand: string;
  expectedVersion: string;
  actualCommand: string | null;
  actualVersion: string | null;
}): void {
  assertRunningPlatform({
    platform: input.platform,
    expectedExecutable: input.expectedCommand,
    actualExecutable: input.actualCommand,
    expectedVersion: input.expectedVersion,
    actualVersion: input.actualVersion,
  });
}

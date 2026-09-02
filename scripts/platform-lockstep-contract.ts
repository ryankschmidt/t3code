export type DeclaredPlatformTarget = { id: string };

export function assertEveryPlatformTarget(
  targets: DeclaredPlatformTarget[],
  artifactExists: (target: DeclaredPlatformTarget) => boolean,
): void {
  const missing = targets.filter((target) => !artifactExists(target)).map((target) => target.id);
  if (missing.length > 0)
    throw new Error(`LOCKSTEP_REFUSED: missing platform artifacts: ${missing.join(",")}`);
}

export function macBackupBundlePath(
  backupRoot: string,
  replacedVersion: string,
  at: string,
): string {
  const safeTimestamp = at.replaceAll(":", "-").replaceAll(".", "-");
  return `${backupRoot}/ThroughLine-${replacedVersion}-replaced-${safeTimestamp}/ThroughLine.app`;
}

export function assertRunningPlatform(input: {
  platform: string;
  expectedExecutable: string;
  actualExecutable: string | null;
  expectedVersion: string;
  actualVersion: string | null;
}): void {
  const failures: string[] = [];
  if (input.actualExecutable !== input.expectedExecutable) {
    failures.push(
      `${input.platform} running executable mismatch: expected ${input.expectedExecutable}, got ${input.actualExecutable ?? "none"}`,
    );
  }
  if (input.actualVersion !== input.expectedVersion) {
    failures.push(
      `${input.platform} running version mismatch: expected ${input.expectedVersion}, got ${input.actualVersion ?? "none"}`,
    );
  }
  if (failures.length > 0) throw new Error(`LOCKSTEP_REFUSED: ${failures.join("; ")}`);
}

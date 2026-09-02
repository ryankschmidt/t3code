export type DeclaredPlatformTarget = { id: string };

export function assertEveryPlatformTarget(
  targets: DeclaredPlatformTarget[],
  artifactExists: (target: DeclaredPlatformTarget) => boolean,
): void {
  const missing = targets.filter((target) => !artifactExists(target)).map((target) => target.id);
  if (missing.length > 0)
    throw new Error(`LOCKSTEP_REFUSED: missing platform artifacts: ${missing.join(",")}`);
}

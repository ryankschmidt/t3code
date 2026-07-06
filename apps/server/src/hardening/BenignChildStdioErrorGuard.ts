/**
 * BenignChildStdioErrorGuard — fork-added hardening (T3×Absurd D-ledger).
 *
 * WHY (live crash, 2026-07-05): `VcsStatusBroadcaster.refreshRemoteStatus` →
 * `GitVcsDriver.fetchRemoteForStatus` runs `git fetch` through
 * `effect/unstable/process`. When the Effect side tears down first (timeout
 * interrupt, fiber interruption, process reap), the child's stdio Socket can
 * emit a late `read ECONNRESET` with no listener attached — an UNHANDLED
 * 'error' event that killed the whole supervised server (node --watch parked
 * on "Failed running 'src/bin.ts'"). The race lives inside the library's
 * teardown, so the local fix is a targeted process-level guard.
 *
 * CONTRACT: absorb ONLY the benign post-teardown stdio class — ECONNRESET /
 * EPIPE / premature-close on a read or write syscall — log it loudly, and
 * preserve fail-fast for every other uncaught exception by replicating
 * Node's fatal behavior (print + exit 1; launchd owns the relaunch).
 */

const BENIGN_CODES = new Set(["ECONNRESET", "EPIPE", "ERR_STREAM_PREMATURE_CLOSE"]);
const BENIGN_SYSCALLS = new Set(["read", "write"]);

export function isBenignChildStdioError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const errno = error as NodeJS.ErrnoException;
  if (!BENIGN_CODES.has(errno.code ?? "")) return false;
  // ErrnoExceptions from socket teardown carry the syscall; the stream
  // premature-close variant carries none. Anything with a foreign syscall
  // (e.g. "connect", "bind") is NOT teardown noise and must stay fatal.
  return errno.syscall === undefined || BENIGN_SYSCALLS.has(errno.syscall);
}

export function installBenignChildStdioErrorGuard(
  options: {
    readonly log?: (message: string) => void;
    readonly fatal?: (error: unknown) => never;
  } = {},
): void {
  // Raw stderr writes: this guard runs at the process level, outside the
  // Effect runtime (an uncaughtException handler has no fiber to log from).
  const log = options.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const fatal =
    options.fatal ??
    ((error: unknown): never => {
      const rendered = error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stderr.write(`${rendered}\n`);
      return process.exit(1) as never;
    });
  process.on("uncaughtException", (error) => {
    if (isBenignChildStdioError(error)) {
      const errno = error as NodeJS.ErrnoException;
      log(
        `[benign-child-stdio-error-guard] absorbed post-teardown ${errno.code} (syscall=${errno.syscall ?? "n/a"}) — child stdio raced its Effect teardown; server stays up`,
      );
      return;
    }
    fatal(error);
  });
}

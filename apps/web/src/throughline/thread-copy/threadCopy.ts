export type ThreadCopyRef = { readonly environmentId: string; readonly threadId: string };
export type ThreadCopyIdentity = ThreadCopyRef & {
  readonly session?: {
    readonly providerSessionId?: string | null;
    readonly nativeSessionId?: string | null;
    readonly nativeTranscriptPath?: string | null;
  } | null;
};
export type ThreadCopyField = "thread" | "provider-session" | "native-session" | "transcript";

function available(value: string | null | undefined): string | null {
  return value && value.trim().length > 0 ? value : null;
}

/** Values are supplied by the owning environment, never inferred from titles or paths. */
export function threadCopyItems(identity: ThreadCopyIdentity) {
  return [
    { field: "thread", label: "Copy thread ID", value: identity.threadId },
    { field: "provider-session", label: "Copy provider session ID", value: available(identity.session?.providerSessionId) },
    { field: "native-session", label: "Copy native session ID", value: available(identity.session?.nativeSessionId) },
    { field: "transcript", label: "Copy transcript path", value: available(identity.session?.nativeTranscriptPath) },
  ] as const;
}

export async function copyThreadValue(input: {
  readonly ref: ThreadCopyRef;
  readonly field: ThreadCopyField;
  readonly read: (ref: ThreadCopyRef) => ThreadCopyIdentity | null;
  readonly write: (value: string) => Promise<unknown>;
}): Promise<"copied" | "unavailable"> {
  const identity = input.read(input.ref);
  if (!identity) return "unavailable";
  if (identity.environmentId !== input.ref.environmentId || identity.threadId !== input.ref.threadId) {
    throw new Error("Thread identity does not match its owning environment and thread.");
  }
  const value = threadCopyItems(identity).find((item) => item.field === input.field)?.value;
  if (!value) return "unavailable";
  // Some platform adapters report an unsuccessful clipboard write as false.
  if (await input.write(value) === false) throw new Error("Clipboard did not accept the value.");
  return "copied";
}

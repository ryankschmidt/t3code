/** Browser view input, structurally matching readLauncherThreadFamily. No filesystem ownership. */
export type LauncherFamilyViewInput = {
  readonly threadId: string;
  readonly source: "agent-instruments.thread-lineage.v1";
} & (
  | { readonly status: "unknown"; readonly reason: string }
  | {
      readonly status: "recorded";
      readonly parentThreadId: string | null;
      readonly creatorResolution: string;
      readonly launcherSeat: string | null;
      readonly purpose: string;
      readonly handle: string | null;
      readonly host: string;
      readonly family:
        | {
            readonly status: "recorded";
            readonly rootThreadId: string;
            readonly ancestorThreadIds: readonly string[];
          }
        | {
            readonly status: "unknown";
            readonly reason: string;
            readonly ancestorThreadIds: readonly string[];
          };
    }
);

export type ScopedLauncherFamily = {
  readonly environmentId: string;
  readonly family: LauncherFamilyViewInput;
};

/** The requested host/thread is part of the result context, not a native-session alias. */
export function launcherFamilyRows(
  ref: { readonly environmentId: string; readonly threadId: string },
  result: ScopedLauncherFamily,
) {
  if (result.environmentId !== ref.environmentId || result.family.threadId !== ref.threadId) {
    throw new Error("Lineage does not match the requested owning environment and public thread.");
  }
  const value = result.family;
  if (value.status === "unknown") {
    return [
      { label: "Parent thread", value: `Unknown · ${value.reason}` },
      { label: "Family root", value: `Unknown · ${value.reason}` },
      { label: "Record source", value: value.source },
    ];
  }
  return [
    { label: "Parent thread", value: value.parentThreadId ?? "No parent recorded" },
    {
      label: "Family root",
      value:
        value.family.status === "recorded"
          ? value.family.rootThreadId
          : `Unknown · ${value.family.reason}`,
    },
    { label: "Visible handle", value: value.handle || "Unavailable" },
    { label: "Launcher seat", value: value.launcherSeat || "Unavailable" },
    { label: "Launch purpose", value: value.purpose || "Unavailable" },
    { label: "Owning host", value: value.host || "Unavailable" },
    { label: "Creator resolution", value: value.creatorResolution },
    {
      label: "Recorded ancestors",
      value: value.family.ancestorThreadIds.join(" → ") || "None recorded",
    },
    { label: "Record source", value: value.source },
  ];
}

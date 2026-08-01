import { type ServerProvider, type SymphonyRuntimeReadyOutput } from "@t3tools/contracts";
import { memo } from "react";
import { InfoIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { formatProviderDriverKindLabel } from "../../providerModels";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const ProviderStatusBanner = memo(function ProviderStatusBanner({
  status,
  runtimeReadiness,
}: {
  status: ServerProvider | null;
  runtimeReadiness?: SymphonyRuntimeReadyOutput | null;
}) {
  const turnRailBlockingChecks =
    status?.status === "disabled"
      ? []
      : (runtimeReadiness?.checks
          .filter(
            (check) =>
              (check.name === "absurd-worker-layer" || check.name === "queue-reachability") &&
              check.state !== "ready",
          )
          .map((check) => check.name) ?? []);
  const runtimeNotReady = turnRailBlockingChecks.length > 0;

  if ((!status || status.status === "ready" || status.status === "disabled") && !runtimeNotReady) {
    return null;
  }

  const providerName = status
    ? status.displayName?.trim() || formatProviderDriverKindLabel(status.driver)
    : "Selected provider";
  const isUnauthenticated = status?.status === "error" && status.auth.status === "unauthenticated";
  const title = runtimeNotReady
    ? "Message execution unavailable"
    : isUnauthenticated
      ? `${providerName} is unauthenticated`
      : `${providerName} provider status`;
  const providerIssueMessage = isUnauthenticated
    ? "Sign in via the CLI to authenticate again."
    : (status?.message ??
      (status?.status === "error"
        ? `${providerName} provider is unavailable.`
        : `${providerName} provider has limited availability.`));
  const message = runtimeNotReady
    ? status?.status === "ready"
      ? `${providerName} is reachable, but the durable task runtime is not ready: ${turnRailBlockingChecks.join(", ")}.`
      : `${providerIssueMessage} The durable task runtime is also not ready: ${turnRailBlockingChecks.join(", ")}.`
    : providerIssueMessage;

  return (
    <div className="mx-auto w-fit max-w-[calc(100%-2rem)] pt-3">
      <div
        data-runtime-readiness={runtimeNotReady ? "not-ready" : "ready"}
        className={cn(
          "inline-flex items-center gap-3 rounded-xl border px-3.5 py-3 text-card-foreground text-sm",
          !runtimeNotReady && status?.status === "warning"
            ? "border-warning/32 bg-warning/4 [&_svg]:text-warning"
            : "border-destructive/32 bg-destructive/4 text-destructive-foreground [&_svg]:text-destructive",
        )}
        role="alert"
      >
        <InfoIcon className="size-4 shrink-0" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="font-medium">{title}</div>
          <Tooltip>
            <TooltipTrigger
              render={<div className="line-clamp-3 text-muted-foreground">{message}</div>}
            />
            <TooltipPopup side="top" className="max-w-96 whitespace-pre-wrap">
              {message}
            </TooltipPopup>
          </Tooltip>
        </div>
      </div>
    </div>
  );
});

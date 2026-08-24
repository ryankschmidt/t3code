// ThroughLine: operator-owned brand lockup. This file is Ryan-side by construction (an added
// module, not an upstream edit). It replaces upstream's <T3Wordmark /> vector plus the "Code"
// span in SidebarChrome with the ThroughLine wordmark rendered as real text — crisp at every
// scale, colored by the live theme via the header's own classes, no bitmap overlays. The prior
// approach (operator.css hiding the T3 svg and painting a scaled image behind it) produced the
// blurry mis-scaled lockup the operator rejected on sight; this component is its replacement.
import { cn } from "../lib/utils";

export function OperatorWordmark({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <span aria-label="ThroughLine" className="flex min-w-0 items-baseline">
      <span className="truncate text-sm font-semibold tracking-tight">Through</span>
      <span
        className={cn(
          "truncate text-sm font-semibold tracking-tight",
          onBackdrop ? "text-white/70" : "text-muted-foreground",
        )}
      >
        Line
      </span>
    </span>
  );
}

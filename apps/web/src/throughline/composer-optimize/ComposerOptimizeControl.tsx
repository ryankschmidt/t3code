import * as React from "react";
import { Button } from "../../components/ui/button";
import {
  ComposerOptimization,
  type DraftSnapshot,
  type OptimizationProvider,
} from "./draftOptimization";

type Props = {
  ownerKey: string;
  readDraft: () => DraftSnapshot;
  readSelection: () => { start: number; end: number };
  writeDraft: (text: string, cursor: number) => void;
  disabled?: boolean;
};

export function ComposerOptimizeControl(props: Props) {
  const [provider, setProvider] = React.useState<OptimizationProvider>("claude");
  const [controller] = React.useState(
    () =>
      new ComposerOptimization({
        read: props.readDraft,
        write: props.writeDraft,
      }),
  );
  const state = React.useSyncExternalStore(
    controller.subscribe,
    () => controller.state,
    () => controller.state,
  );
  React.useLayoutEffect(() => {
    controller.rebind({ read: props.readDraft, write: props.writeDraft });
  }, [controller, props]);
  React.useEffect(() => {
    return () => controller.cancel();
  }, [controller]);
  const busy = state.phase === "optimizing";
  const status =
    state.phase === "idle"
      ? ""
      : state.phase === "optimizing"
        ? "Optimizing…"
        : state.phase === "optimized"
          ? "Optimized"
          : state.phase === "undone"
            ? "Original restored"
            : state.phase === "cancelled"
              ? "Cancelled; original kept"
              : state.reason
                ? `Original kept: ${state.reason}`
                : "Original kept";

  return (
    <div className="flex flex-wrap items-center gap-1">
      <select
        aria-label="Optimization provider"
        value={provider}
        disabled={busy}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "claude" || value === "codex" || value === "off") setProvider(value);
        }}
      >
        <option value="claude">Claude</option>
        <option value="codex">Codex</option>
        <option value="off">Off</option>
      </select>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-label="Optimize draft or selection"
        disabled={props.disabled || busy}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => controller.optimize(provider, props.readSelection())}
      >
        Optimize
      </Button>
      {busy ? (
        <Button type="button" variant="ghost" size="xs" onClick={() => controller.cancel()}>
          Cancel
        </Button>
      ) : null}
      {state.canUndo ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label="Undo optimization"
          onClick={() => controller.undo()}
        >
          Undo
        </Button>
      ) : null}
      <span role="status" aria-live="polite">
        {status}
      </span>
      {state.raw ? (
        <details>
          <summary>Original</summary>
          <pre className="whitespace-pre-wrap">{state.raw}</pre>
        </details>
      ) : null}
    </div>
  );
}

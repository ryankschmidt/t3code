import { Fragment } from "react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Button } from "../../components/ui/button";
import { Menu, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import { launcherFamilyRows, type ScopedLauncherFamily } from "./launcherFamily";

export function LauncherFamilyMenu(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  result: ScopedLauncherFamily | null;
  pending: boolean;
  error: string | null;
}) {
  let error = props.error;
  let rows: ReturnType<typeof launcherFamilyRows> = [];
  if (props.result !== null) {
    try {
      rows = launcherFamilyRows(props, props.result);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  return (
    <Menu>
      <MenuTrigger render={<Button size="sm" variant="ghost" />}>Lineage</MenuTrigger>
      <MenuPopup align="end" aria-label="Launcher-recorded thread lineage">
        {error ? (
          <p role="alert" className="px-3 py-2 text-sm text-foreground">
            {error}
          </p>
        ) : props.pending || rows.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            {props.pending
              ? "Loading launcher lineage…"
              : "Lineage read API unavailable from this environment"}
          </p>
        ) : (
          <dl className="grid max-w-lg grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-3 py-2 text-sm">
            {rows.map((row) => (
              <Fragment key={row.label}>
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="select-text break-words text-foreground">{row.value}</dd>
              </Fragment>
            ))}
          </dl>
        )}
      </MenuPopup>
    </Menu>
  );
}

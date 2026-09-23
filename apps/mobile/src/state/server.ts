import { createServerEnvironmentAtoms } from "@t3tools/client-runtime/state/server";
import { createEnvironmentServerConfigsAtom } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentTheme } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSession } from "./session";

export const serverEnvironment = createServerEnvironmentAtoms(connectionAtomRuntime, {
  initialConfigValueAtom: environmentSession.initialConfigValueAtom,
  // ThroughLine: the phone follows the palettes its machines publish, so it
  // asks for the stream. Without this the server never sends the payload and a
  // machine's theme reaches the desktop web layer and stops there.
  environmentThemes: true,
  usageLimitSources: true,
  usageLimitsCommand: true,
});
export const environmentServerConfigsAtom = createEnvironmentServerConfigsAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});

const EMPTY_ENVIRONMENT_THEMES: ReadonlyArray<EnvironmentTheme> = [];

/**
 * ThroughLine: palettes published by every environment this phone is connected
 * to, first publisher winning on a shared id. The phone has no primary
 * environment the way the desktop does — it moves between machines — so the
 * theme it is set to keeps rendering as long as any connected machine still
 * publishes it.
 */
export const environmentPublishedThemesAtom = Atom.make(
  (get): ReadonlyArray<EnvironmentTheme> => {
    const configs = get(environmentServerConfigsAtom);
    const byId = new Map<string, EnvironmentTheme>();
    for (const config of configs.values()) {
      for (const theme of config?.environmentThemes ?? EMPTY_ENVIRONMENT_THEMES) {
        if (!byId.has(theme.id)) byId.set(theme.id, theme);
      }
    }
    return byId.size === 0 ? EMPTY_ENVIRONMENT_THEMES : [...byId.values()];
  },
).pipe(Atom.withLabel("mobile-environment-published-themes"));

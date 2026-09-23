import defaultThemeVariables from "../../generated-uniwind-default-theme-variables.json";

import type { BuiltInThemeId } from "@t3tools/shared/themePalettes";

import {
  DEFAULT_MOBILE_THEME_ID,
  getMobileThemeVariables,
  isBundledMobileThemeId,
  type MobileThemeAppearance,
  type MobileThemeId,
  type MobileThemeVariables,
} from "./mobileTheme";

const defaults = defaultThemeVariables as Readonly<
  Record<MobileThemeAppearance, MobileThemeVariables>
>;

/**
 * Complete palette for native and third-party APIs that cannot consume a
 * Uniwind className. The standard palette is generated from global.css; custom
 * palettes share the same source that generates their registered CSS themes.
 */
export function getMobileThemeRuntimeVariables(
  themeId: MobileThemeId,
  appearance: MobileThemeAppearance,
): MobileThemeVariables {
  // ThroughLine: an id this build does not ship is one the environment
  // published. Its base is the stock palette; the published role colours are
  // laid over it by the appearance provider, which owns the published set.
  return themeId === DEFAULT_MOBILE_THEME_ID ||
    themeId === "material-you" ||
    !isBundledMobileThemeId(themeId)
    ? defaults[appearance]
    : // Narrowed by the guard above: the remaining ids are the built-ins this
      // build ships, which are the only ones with a generated palette.
      getMobileThemeVariables(themeId as BuiltInThemeId, appearance);
}

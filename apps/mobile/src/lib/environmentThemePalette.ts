// ThroughLine: the phone renders the palettes its environment publishes.
//
// Upstream mobile deliberately kept its own appearance settings and never asked
// for the environment's theme stream, so a machine's published palette reached
// the desktop web layer and stopped there. This module closes that gap without
// a second palette: a published theme arrives as role colours, the shared
// package supplies any role the file omits, and the existing mobile converter
// turns the finished role set into the same token variables every other mobile
// theme already uses. No colour value is written here.
import type { EnvironmentTheme } from "@t3tools/contracts";
import {
  T3_CHAT_THEME,
  THEME_COLOR_ROLES,
  getThemeColorsForAppearance,
  type ThemeColors,
} from "@t3tools/shared/themePalettes";

import {
  createMobileThemeVariables,
  type MobileThemeAppearance,
  type MobileThemeVariables,
} from "./mobileTheme";

const THEME_COLOR_ROLE_SET: ReadonlySet<string> = new Set(THEME_COLOR_ROLES);

/**
 * Role overrides a published file may carry, filtered to roles this build
 * knows. An unknown key in a file published by a newer machine is dropped
 * rather than failing the whole palette.
 */
function knownRoleOverrides(
  colors: Readonly<Record<string, string>> | undefined,
): Partial<ThemeColors> {
  if (colors === undefined) return {};
  const overrides: Record<string, string> = {};
  for (const [role, value] of Object.entries(colors)) {
    if (THEME_COLOR_ROLE_SET.has(role) && typeof value === "string" && value.length > 0) {
      overrides[role] = value;
    }
  }
  return overrides as Partial<ThemeColors>;
}

/**
 * The complete role set for one appearance of a published theme. The base is
 * the stock palette for that appearance, so a file that describes only its own
 * appearance still yields a readable opposite half rather than an undefined
 * token.
 */
export function environmentThemeColors(
  theme: EnvironmentTheme,
  appearance: MobileThemeAppearance,
): ThemeColors {
  const base = getThemeColorsForAppearance(T3_CHAT_THEME, appearance) ?? T3_CHAT_THEME.colors;
  const overrides =
    appearance === theme.appearance
      ? knownRoleOverrides(theme.colors)
      : knownRoleOverrides(theme.variants?.[appearance]);
  return { ...base, ...overrides };
}

/** The published palette expressed as the mobile token variables. */
export function environmentThemeMobileVariables(
  theme: EnvironmentTheme,
  appearance: MobileThemeAppearance,
): MobileThemeVariables {
  return createMobileThemeVariables(environmentThemeColors(theme, appearance), appearance);
}

/** The published theme with this id, or null when the environment no longer publishes it. */
export function findEnvironmentTheme(
  themes: ReadonlyArray<EnvironmentTheme>,
  themeId: string,
): EnvironmentTheme | null {
  return themes.find((theme) => theme.id === themeId) ?? null;
}

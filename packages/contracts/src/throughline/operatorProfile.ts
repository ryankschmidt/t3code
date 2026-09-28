/**
 * ThroughLine operator profile: the settings Ryan has decided, declared once in code so a new
 * install, a new host or a cut from upstream starts with them instead of with upstream's
 * defaults. The server layers these entries over upstream defaults and over settings.json every
 * time settings load, and writes `<stateDir>/operator-profile-receipt.json` saying what applied,
 * what a deliberate local override kept, and what was rejected and why
 * (apps/server/src/throughline/operatorProfile/).
 *
 * Rules for entries:
 * - `key` is a server settings key, so a key upstream renames or removes fails the build.
 * - `value` is the settings-file form. `{home}` stands for the host's home folder.
 * - `merge: "deep"` sets only the fields named in `value` and keeps the rest of the stored value
 *   (used for provider instances, whose credentials and model lists this profile does not own).
 * - No model ids and no secret values. Keys owned elsewhere are named in
 *   OPERATOR_PROFILE_NOT_OWNED, with their owner.
 * - `protected` entries are also checked by the ship pipeline against
 *   vault/01_Projects/workbench/infra/throughline/contracts/Protected-Settings.json.
 *
 * Keep this file free of runtime imports: the ship pipeline's protected-settings checker loads
 * it directly with node.
 */
import type { ServerSettings } from "../settings.ts";

type EncodedServerSettings = typeof ServerSettings.Encoded;

export type OperatorProfileKey = keyof EncodedServerSettings;

type ProfileValue<T> =
  T extends ReadonlyArray<unknown>
    ? T
    : T extends object
      ? { readonly [P in keyof T]?: ProfileValue<T[P]> }
      : T;

export type OperatorProfileHostScope = "all" | "mac" | "linux";

export type OperatorProfileRyanSource =
  | {
      readonly kind: "ryan-quote";
      readonly quote: string;
      readonly said_at: string;
      readonly session: string;
    }
  | { readonly kind: "shape-statement"; readonly shape_id: string }
  | { readonly kind: "none-on-file"; readonly note: string };

interface OperatorProfileEntryFor<K extends OperatorProfileKey> {
  readonly key: K;
  /** Names one item of a record-shaped key, such as one provider instance. */
  readonly item?: string;
  readonly value: ProfileValue<Exclude<EncodedServerSettings[K], undefined>>;
  readonly merge: "replace" | "deep";
  readonly scope: OperatorProfileHostScope;
  /** A program that must exist on the host (`{home}` resolved) before the entry applies. */
  readonly requires_launcher?: string;
  /** Also held by the ship pipeline's protected-settings check. */
  readonly protected?: true;
  readonly reason: string;
  /** Date decided, YYYY-MM-DD. */
  readonly decided: string;
  readonly source: OperatorProfileRyanSource;
}

export type OperatorProfileEntry = {
  [K in OperatorProfileKey]: OperatorProfileEntryFor<K>;
}[OperatorProfileKey];

export interface OperatorProfileNotOwned {
  readonly name: string;
  readonly setting?: OperatorProfileKey;
  readonly owner: string;
  readonly why: string;
}

export const OPERATOR_PROFILE_VERSION = "1.0.0";

export const operatorProfileEntryId = (entry: OperatorProfileEntry): string =>
  entry.item === undefined ? entry.key : `${entry.key}.${entry.item}`;

const SEEDED_FROM_MAC =
  "Seeded from the Mac settings file on 2026-09-28; set through the settings screen. No Ryan statement on file.";

export const OPERATOR_PROFILE: ReadonlyArray<OperatorProfileEntry> = [
  {
    key: "continueThreadsAfterServerUpdate",
    value: true,
    merge: "replace",
    scope: "all",
    protected: true,
    reason:
      "Resume every thread that was mid-turn when ThroughLine restarts (install, crash, machine restart, import, repair) instead of leaving it failed.",
    decided: "2026-09-28",
    source: {
      kind: "ryan-quote",
      quote:
        "turn the setting on now do not defer to some future later build like you already did and failed to land the correct setting. Ship 0.0.51 yourself and make sure the setting is on, version controlled/changeloged and protected from code overwritting it in future shipments or it getting dropped in agent churn.",
      said_at: "Sep 28, 2026 PDT",
      session: "1343fd26-83fc-444b-ad4e-5f76dafd0420",
    },
  },
  {
    key: "enableAgentDeviceAccess",
    value: true,
    merge: "replace",
    scope: "all",
    protected: true,
    reason:
      "Agents drive the iOS simulator through the cursor-free agent-device command line; off by default means every fresh install silently loses it.",
    decided: "2026-09-22",
    source: {
      kind: "none-on-file",
      note: "Fork default since commit fcffd650aa (Sep 22, 2026). No Ryan statement on file.",
    },
  },
  {
    key: "enableDeviceSupport",
    value: true,
    merge: "replace",
    scope: "mac",
    reason: "The Mac runs the device helper processes for the iOS simulator.",
    decided: "2026-09-28",
    source: { kind: "none-on-file", note: SEEDED_FROM_MAC },
  },
  {
    key: "sidebarAutoSettleAfterDays",
    value: 7,
    merge: "replace",
    scope: "all",
    reason: "Settle idle threads out of the sidebar after a week.",
    decided: "2026-09-28",
    source: { kind: "none-on-file", note: SEEDED_FROM_MAC },
  },
  {
    key: "backgroundActivity",
    value: { schemaVersion: 1, profile: "performance", overrides: {} },
    merge: "replace",
    scope: "all",
    reason: "Background work runs on the performance profile.",
    decided: "2026-09-28",
    source: { kind: "none-on-file", note: SEEDED_FROM_MAC },
  },
  {
    key: "backgroundActivityProfile",
    value: "performance",
    merge: "replace",
    scope: "all",
    reason: "Legacy twin of backgroundActivity.profile, kept equal to it.",
    decided: "2026-09-28",
    source: { kind: "none-on-file", note: SEEDED_FROM_MAC },
  },
  {
    key: "automaticGitFetchInterval",
    value: 15000,
    merge: "replace",
    scope: "all",
    reason: "Fetch git remotes every 15 seconds.",
    decided: "2026-09-28",
    source: { kind: "none-on-file", note: SEEDED_FROM_MAC },
  },
  {
    key: "providerHealthRefreshInterval",
    value: 60000,
    merge: "replace",
    scope: "all",
    reason: "Refresh provider health once a minute.",
    decided: "2026-09-28",
    source: { kind: "none-on-file", note: SEEDED_FROM_MAC },
  },
  {
    key: "providers",
    value: {
      cursor: { enabled: false },
      grok: { enabled: false },
      opencode: { enabled: false },
    },
    merge: "deep",
    scope: "all",
    reason: "Cursor, Grok and OpenCode stay off; agents run through the governed launchers.",
    decided: "2026-09-28",
    source: { kind: "none-on-file", note: SEEDED_FROM_MAC },
  },
  {
    key: "providerInstances",
    item: "claudeAgent",
    value: {
      claudeAgent: {
        driver: "claudeAgent",
        displayName: "ryan-claude",
        enabled: true,
        config: { binaryPath: "{home}/.local/bin/ryan-claude", homePath: "", launchArgs: "" },
      },
    },
    merge: "deep",
    scope: "all",
    requires_launcher: "{home}/.local/bin/ryan-claude",
    reason:
      "Claude runs through the governed launcher, which the command layer owns; the app only points at it.",
    decided: "2026-09-28",
    source: { kind: "none-on-file", note: SEEDED_FROM_MAC },
  },
  {
    key: "providerInstances",
    item: "codex",
    value: {
      codex: {
        driver: "codex",
        displayName: "ryan-codex",
        enabled: true,
        config: {
          binaryPath: "{home}/.local/bin/ryan-codex",
          homePath: "",
          shadowHomePath: "",
          launchArgs: "",
        },
      },
    },
    merge: "deep",
    scope: "all",
    requires_launcher: "{home}/.local/bin/ryan-codex",
    reason:
      "Codex runs through the governed launcher. The Mac file named it bare (found on PATH); the profile names the same file by its home-folder path.",
    decided: "2026-09-28",
    source: { kind: "none-on-file", note: SEEDED_FROM_MAC },
  },
  {
    key: "providerInstances",
    item: "pi",
    value: {
      pi: {
        driver: "pi",
        displayName: "ryan-pi",
        enabled: true,
        config: { binaryPath: "{home}/.local/bin/ryan-pi" },
      },
    },
    merge: "deep",
    scope: "all",
    requires_launcher: "{home}/.local/bin/ryan-pi",
    reason: "Pi runs through the governed launcher.",
    decided: "2026-09-28",
    source: { kind: "none-on-file", note: SEEDED_FROM_MAC },
  },
  {
    key: "providerInstances",
    item: "cursor",
    value: { cursor: { driver: "cursor", enabled: false } },
    merge: "deep",
    scope: "all",
    reason: "Cursor instance present and off.",
    decided: "2026-09-28",
    source: { kind: "none-on-file", note: SEEDED_FROM_MAC },
  },
  {
    key: "providerInstances",
    item: "grok",
    value: { grok: { driver: "grok", enabled: false } },
    merge: "deep",
    scope: "all",
    reason: "Grok instance present and off.",
    decided: "2026-09-28",
    source: { kind: "none-on-file", note: SEEDED_FROM_MAC },
  },
  {
    key: "providerInstances",
    item: "opencode",
    value: { opencode: { driver: "opencode", enabled: false } },
    merge: "deep",
    scope: "all",
    reason: "OpenCode instance present and off.",
    decided: "2026-09-28",
    source: { kind: "none-on-file", note: SEEDED_FROM_MAC },
  },
];

export const OPERATOR_PROFILE_NOT_OWNED: ReadonlyArray<OperatorProfileNotOwned> = [
  {
    name: "defaultModelSelection",
    setting: "defaultModelSelection",
    owner: "ryan model roll, from /Users/Admin/.config/ryan/fccl/models.json",
    why: "Model ids move at every model release.",
  },
  {
    name: "modelOffering",
    setting: "modelOffering",
    owner: "ryan model roll, from /Users/Admin/.config/ryan/fccl/models.json",
    why: "Model ids move at every model release.",
  },
  {
    name: "textGenerationModelSelection",
    setting: "textGenerationModelSelection",
    owner: "the settings screen",
    why: "Carries a model id.",
  },
  {
    name: "sourceControlWriterModelSelection",
    setting: "sourceControlWriterModelSelection",
    owner: "the settings screen",
    why: "Carries a model id.",
  },
  {
    name: "providerInstances.*.config.customModels",
    setting: "providerInstances",
    owner: "the settings screen",
    why: "Carries model ids.",
  },
  {
    name: "providerInstances.*.environment",
    setting: "providerInstances",
    owner:
      "the provider broker (ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY) and Ryan through the command layer (RYAN_ALLOW_FABLE_SEAT)",
    why: "Credentials and per-launch permissions; never declared in code.",
  },
  {
    name: "providerInstances.opencode.config.serverPassword",
    setting: "providerInstances",
    owner: "the settings screen",
    why: "A secret.",
  },
  {
    name: "usageLimitSources",
    setting: "usageLimitSources",
    owner: "the settings screen",
    why: "Holds a management key, a secret.",
  },
  {
    name: "projectSettingsOverrides",
    setting: "projectSettingsOverrides",
    owner: "the server and the settings screen, per machine",
    why: "Keyed by this machine's own project ids.",
  },
  {
    name: "projectSettingsFolded",
    setting: "projectSettingsFolded",
    owner: "the server",
    why: "A one-time migration marker.",
  },
  {
    name: "deviceOnboardingCompleted",
    setting: "deviceOnboardingCompleted",
    owner: "the Device panel, per machine",
    why: "Records that this machine's device setup ran.",
  },
  {
    name: "Absurd database address",
    owner: "the server's environment (ABSURD_DATABASE_URL)",
    why: "A credential-bearing address; not a settings key.",
  },
  {
    name: "ComsNet per-session credentials",
    owner: "ComsNet",
    why: "Minted per session; not a settings key.",
  },
];

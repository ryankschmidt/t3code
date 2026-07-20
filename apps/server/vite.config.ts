import "vite-plus/test/config";

// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";
import { loadRepoEnv } from "../../scripts/lib/public-config.ts";

const bundledPackagePrefixes = [
  "@pierre/diffs",
  "@t3tools/",
  "effect-acp",
  "effect-codex-app-server",
];

export function shouldBundleCliDependency(id: string): boolean {
  return bundledPackagePrefixes.some((prefix) => id.startsWith(prefix));
}

// ThroughLine: directories that may host a locally-installed command shim ahead of
// git on PATH (e.g. an agent-governance wrapper some contributor machines run in
// front of git). Filtering them out of the test harness's spawned PATH is a no-op
// anywhere these paths don't exist — upstream-safe on any machine.
const HERMETIC_TEST_PATH_EXCLUSIONS = ["/Users/Admin/.local/bin"];

function computeHermeticTestPath(): string {
  const entries = (process.env.PATH ?? "").split(NodePath.delimiter);
  return entries
    .filter((entry) => !HERMETIC_TEST_PATH_EXCLUSIONS.includes(entry))
    .join(NodePath.delimiter);
}

const repoEnv = loadRepoEnv();

export default mergeConfig(
  baseConfig,
  defineConfig({
    run: {
      tasks: {
        build: {
          command: "node scripts/cli.ts build",
          dependsOn: ["@t3tools/web#build"],
          cache: false,
        },
      },
    },
    pack: {
      entry: ["src/bin.ts"],
      outDir: "dist",
      sourcemap: true,
      clean: true,
      deps: {
        alwaysBundle: shouldBundleCliDependency,
        onlyBundle: false,
      },
      banner: {
        js: "#!/usr/bin/env node\n",
      },
      define: {
        __T3CODE_BUILD_RELAY_URL__: JSON.stringify(repoEnv.T3CODE_RELAY_URL?.trim() ?? ""),
        __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__: JSON.stringify(
          repoEnv.T3CODE_CLERK_PUBLISHABLE_KEY?.trim() ?? "",
        ),
        __T3CODE_BUILD_CLERK_CLI_OAUTH_CLIENT_ID__: JSON.stringify(
          repoEnv.T3CODE_CLERK_CLI_OAUTH_CLIENT_ID?.trim() ?? "",
        ),
        __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_URL__: JSON.stringify(
          repoEnv.T3CODE_RELAY_CLIENT_OTLP_TRACES_URL?.trim() ?? "",
        ),
        __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_DATASET__: JSON.stringify(
          repoEnv.T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET?.trim() ?? "",
        ),
        __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_TOKEN__: JSON.stringify(
          repoEnv.T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN?.trim() ?? "",
        ),
      },
    },
    test: {
      // The server suite exercises sqlite, git, temp worktrees, and orchestration
      // runtimes heavily. Running files in parallel introduces load-sensitive flakes.
      fileParallelism: false,
      // Server integration tests exercise sqlite, git, and orchestration together.
      // Under package-wide runs they can exceed the default budget on loaded CI hosts.
      hookTimeout: 120_000,
      testTimeout: 120_000,
      // ThroughLine: harden spawned git subprocesses against host-machine drift the
      // vendor suite never accounted for. PATH hermeticity (below) strips any locally
      // installed command shim ahead of git on PATH, so tests always spawn the real
      // git binary — agent-governance wrappers are out of scope for this suite. Config
      // hermeticity blanks the host's global/system git config so tests assert on
      // git's own behavior, not a contributor's local config. Both layers are inert
      // (no-ops) on any machine without the paths/config they target.
      env: {
        PATH: computeHermeticTestPath(),
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    },
  }),
);

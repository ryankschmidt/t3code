import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPinnedReports, type Pin, type Report } from "./reports.ts";

interface RegressionFile extends Pin {
  package: string;
}

const retained: RegressionFile[] = [
  {
    file: "apps/mobile/src/features/threads/thread-settings-options.test.ts",
    package: "apps/mobile",
    cases: ["hides prompt-injected and workflow-trigger choices, keeping declared order"],
  },
  {
    file: "apps/mobile/src/features/voice-input/voiceInputPresentation.test.ts",
    package: "apps/mobile",
    cases: [
      "distinguishes optimized, Off, timeout, and HTTP failure",
      "maps voice states to stable composer actions and editor read-only state",
    ],
  },
  {
    file: "apps/mobile/src/features/voice-input/messageOptimizer.test.ts",
    package: "apps/mobile",
    cases: [
      "Off commits the raw transcript without a network call",
      "an offline device keeps the raw transcript byte-for-byte",
      "cancellation during optimization settles and does not commit into another thread",
    ],
  },
  {
    file: "packages/client-runtime/src/voice-input/controller.test.ts",
    package: "packages/client-runtime",
    cases: ["does not replace text after the owner, text, or revision changes"],
  },
];

function repositoryPath(path: string): boolean {
  return (
    !isAbsolute(path) &&
    !path.includes("\\") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export function regressionFiles(checkout: string): RegressionFile[] {
  const manifest = JSON.parse(
    readFileSync(resolve(checkout, "docs/throughline/capabilities/rewind/Capability.json"), "utf8"),
  );
  if (
    manifest.schema !== "throughline.capability.v1" ||
    manifest.name !== "rewind" ||
    !Array.isArray(manifest.regression) ||
    manifest.regression.length === 0
  ) {
    throw new Error("REWIND_REGRESSION_MISSING");
  }
  const files: RegressionFile[] = [...manifest.regression, ...retained];
  for (const entry of files) {
    if (
      typeof entry.file !== "string" ||
      typeof entry.package !== "string" ||
      !repositoryPath(entry.file) ||
      !repositoryPath(entry.package) ||
      !entry.file.startsWith(`${entry.package}/`) ||
      !Array.isArray(entry.cases) ||
      entry.cases.length === 0 ||
      entry.cases.some((title: unknown) => typeof title !== "string" || title.length === 0)
    ) {
      throw new Error("REGRESSION_PIN_INVALID");
    }
  }
  return files;
}

export function runRegression(checkout: string, evidence: string): number {
  const files = regressionFiles(checkout);
  // A fresh directory makes stale green reports from an earlier invocation unusable.
  mkdirSync(dirname(evidence), { recursive: true });
  mkdirSync(evidence);
  const reports: Report[] = [];
  const errors: string[] = [];
  for (const pkg of new Set(files.map((entry) => entry.package))) {
    const reportFile = resolve(evidence, `${pkg.replaceAll("/", "__")}.json`);
    const args = [
      "exec",
      "vp",
      "test",
      "run",
      ...files.filter((entry) => entry.package === pkg).map((entry) => relative(pkg, entry.file)),
      "--reporter=json",
      `--outputFile=${reportFile}`,
    ];
    const result = spawnSync("pnpm", args, {
      cwd: resolve(checkout, pkg),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    writeFileSync(
      resolve(evidence, `${pkg.replaceAll("/", "__")}.log`),
      `${JSON.stringify({ cwd: resolve(checkout, pkg), command: ["pnpm", ...args], exit: result.status })}\n${result.stdout ?? ""}${result.stderr ?? ""}${result.error ?? ""}`,
    );
    if (result.status !== 0) errors.push(`TEST_PROCESS_FAILED: ${pkg} (${result.status})`);
    try {
      const report: Report = JSON.parse(readFileSync(reportFile, "utf8"));
      if (
        !Array.isArray(report.testResults) ||
        report.testResults.some(
          (file) => typeof file.name !== "string" || !Array.isArray(file.assertionResults),
        )
      )
        throw new Error("invalid report");
      reports.push(report);
    } catch (error) {
      errors.push(`TEST_REPORT_UNREADABLE: ${pkg} (${String(error)})`);
    }
  }
  errors.push(...checkPinnedReports(files, checkout, reports));
  writeFileSync(
    resolve(evidence, "Result.json"),
    JSON.stringify(
      {
        schema: "throughline.retained-regression-result.v1",
        checkout,
        pin_count: files.reduce((count, entry) => count + entry.cases.length, 0),
        proof_level: "executed-shared-code-tests",
        physical_devices_tested: [],
        limits: [
          "React Native shared logic is not physical iOS or Android device proof",
          "Mocked transcription/optimizer responses do not prove microphone or network operation",
          "Non-iOS native voice is unavailable; no Android transcription success is claimed",
        ],
        errors,
        passed: errors.length === 0,
      },
      null,
      2,
    ) + "\n",
  );
  return errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [checkout, evidence] = process.argv.slice(2);
  if (!checkout || !evidence || !isAbsolute(checkout) || !isAbsolute(evidence)) {
    throw new Error("supply absolute checkout and evidence directories");
  }
  process.exitCode = runRegression(checkout, evidence);
}

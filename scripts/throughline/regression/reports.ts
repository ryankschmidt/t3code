import { resolve } from "node:path";

export interface Pin {
  file: string;
  cases: string[];
}
export interface Report {
  testResults: Array<{ name: string; assertionResults: Array<{ title: string; status: string }> }>;
}

/** Check actual runner assertions by exact file and title, never by aggregate totals. */
export function checkPinnedReports(pins: Pin[], checkout: string, reports: Report[]): string[] {
  const byFile = new Map<string, Report["testResults"][number]["assertionResults"]>();
  for (const report of reports) {
    for (const file of report.testResults) {
      byFile.set(file.name, [...(byFile.get(file.name) ?? []), ...file.assertionResults]);
    }
  }
  const refusals: string[] = [];
  for (const pin of pins) {
    const assertions = byFile.get(resolve(checkout, pin.file));
    if (!assertions) {
      refusals.push(`FILE_NOT_RUN: ${pin.file}`);
      continue;
    }
    for (const title of pin.cases) {
      const matches = assertions.filter((assertion) => assertion.title === title);
      if (matches.length === 0) refusals.push(`CASE_MISSING: ${pin.file} :: ${title}`);
      else if (matches.length !== 1) refusals.push(`CASE_AMBIGUOUS: ${pin.file} :: ${title}`);
      else if (matches[0]!.status !== "passed") {
        refusals.push(`CASE_NOT_PASSED: ${pin.file} :: ${title} (${matches[0]!.status})`);
      }
    }
  }
  return refusals;
}

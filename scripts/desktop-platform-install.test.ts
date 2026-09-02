import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installMacBundleCopy } from "./desktop-platform-install.ts";

function bundle(root: string, version: string): string {
  const path = join(root, "ThroughLine.app");
  mkdirSync(join(path, "Contents"), { recursive: true });
  writeFileSync(
    join(path, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`,
  );
  writeFileSync(join(path, "Contents/version.txt"), `${version}\n`);
  return path;
}

test("copy proof replaces in place and preserves the old stable bundle name in a dated folder", () => {
  const root = mkdtempSync(join(tmpdir(), "throughline-install-proof-"));
  const applications = join(root, "Applications");
  const candidateRoot = join(root, "candidate");
  const backupRoot = join(root, "backups");
  mkdirSync(applications);
  bundle(applications, "0.0.36");
  const candidate = bundle(candidateRoot, "0.0.37");
  const destination = join(applications, "ThroughLine.app");

  const result = installMacBundleCopy({
    candidateBundle: candidate,
    destinationBundle: destination,
    backupRoot,
    version: "0.0.37",
    at: "2026-09-01T23:14:15.000Z",
  });

  assert.equal(readFileSync(join(destination, "Contents/version.txt"), "utf8"), "0.0.37\n");
  assert.equal(
    readFileSync(join(result.backupBundle!, "Contents/version.txt"), "utf8"),
    "0.0.36\n",
  );
  assert.equal(result.backupBundle!.split("/").at(-1), "ThroughLine.app");
});

test("copy proof refuses a candidate whose receipt version does not match", () => {
  const root = mkdtempSync(join(tmpdir(), "throughline-install-proof-negative-"));
  const applications = join(root, "Applications");
  const candidateRoot = join(root, "candidate");
  mkdirSync(applications);
  bundle(applications, "0.0.36");
  const candidate = bundle(candidateRoot, "0.0.38");

  assert.throws(
    () =>
      installMacBundleCopy({
        candidateBundle: candidate,
        destinationBundle: join(applications, "ThroughLine.app"),
        backupRoot: join(root, "backups"),
        version: "0.0.37",
        at: "2026-09-01T23:14:15.000Z",
      }),
    /installed Mac bundle version mismatch/,
  );
});

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const installer = fileURLToPath(new URL("./install-mac.sh", import.meta.url));

function check(scenario: string, extra: string[] = []) {
  const root = mkdtempSync(path.join(tmpdir(), "throughline-install-test-"));
  const app = path.join(root, "ThroughLine.app");
  const bin = path.join(root, "bin");
  mkdirSync(path.join(app, "Contents"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(
    path.join(app, "Contents/Info.plist"),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>0.0.42</string></dict></plist>`,
  );
  // OS/process/UI instruments are controlled here; real-app proof is a separate rehearsal.
  const programs: Record<string, string> = {
    codesign: "exit 0",
    lsof: '[ "$SCENARIO" = noowner ] || echo 12345',
    ps: 'echo "$TEST_APP/Contents/MacOS/ThroughLine"',
    curl: `case "$SCENARIO" in
      timeout) printf '\\n000'; exit 28;;
      malformed) printf 'not-json\\n200';;
      mismatch) printf '{"serverVersion":"0.0.40"}\\n200';;
      *) printf '{"serverVersion":"0.0.42"}\\n200';;
    esac`,
    osascript: `cat >/dev/null
      [ "$SCENARIO" = permission ] && { echo 'ALLOW_CLICKED'; exit 0; }
      [ "$SCENARIO" = nowindow ] && { echo 0; exit 0; }
      echo 1`,
    date: `case "$*" in
      *%s*) n=0; [ ! -f "$TEST_ROOT/clock" ] || n=$(cat "$TEST_ROOT/clock"); n=$((n+10)); echo "$n" > "$TEST_ROOT/clock"; echo "$n";;
      *) echo '2026-09-15T00:00:00Z';;
    esac`,
    sleep: "exit 0",
  };
  for (const command of ["open", "launchctl", "ditto", "hdiutil", "mv", "rm", "kill"]) {
    programs[command] = 'echo "$0 $*" >> "$TEST_ROOT/destructive"; exit 99';
  }
  for (const [command, body] of Object.entries(programs)) {
    writeFileSync(path.join(bin, command), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  try {
    const result = spawnSync(
      "/bin/sh",
      [installer, "--post-install-check-only", "--app", app, "--port", "3791", ...extra],
      {
        env: {
          ...process.env,
          PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
          SCENARIO: scenario,
          TEST_ROOT: root,
          TEST_APP: app,
        },
        encoding: "utf8",
        timeout: 15000,
      },
    );
    assert.ifError(result.error);
    let mutations = "";
    try {
      mutations = readFileSync(path.join(root, "destructive"), "utf8");
    } catch {
      /* absent is expected */
    }
    assert.equal(mutations, "", "check-only must not invoke installation/reopening");
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("matching signed app and owned readiness endpoint pass", () => {
  const r = check("pass");
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /\[8\] running app\s+PASS/);
  assert.match(r.output, /POST-INSTALL VERDICT: PASS/);
});

for (const scenario of ["mismatch", "timeout", "malformed", "noowner"]) {
  test(`${scenario} refuses post-install success`, () => {
    const r = check(scenario);
    assert.equal(r.status, 3, r.output);
    assert.match(r.output, /\[8\] running app\s+FAIL/);
    assert.match(r.output, /POST-INSTALL VERDICT: FAIL/);
    assert.match(r.output, /matching store backup/);
  });
}

test("zero visible windows is diagnostic, not a false readiness failure", () => {
  const r = check("nowindow");
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /\[9\] window\s+FAIL/);
});

test("permission handling is recorded", () => {
  const r = check("permission");
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /ALLOW_CLICKED/);
});

for (const flags of [
  ["--detach"],
  ["--verify-only"],
  ["unexpected.dmg"],
  ["--port", "0"],
  ["--port", "65536"],
]) {
  test(`check-only rejects invalid combination ${flags.join(" ")}`, () => {
    const r = check("pass", flags);
    assert.equal(r.status, 2, r.output);
    assert.doesNotMatch(r.output, /POST-INSTALL VERDICT: PASS/);
  });
}

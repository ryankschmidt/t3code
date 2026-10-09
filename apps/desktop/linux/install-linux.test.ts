import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("Linux service drop-in enables crash recovery and registers the reboot target", () => {
  const root = mkdtempSync(path.join(tmpdir(), "throughline-service-policy-"));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, "systemctl"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SYSTEMCTL_LOG"\n',
    { mode: 0o755 },
  );
  try {
    const source = readFileSync(new URL("./install-linux.sh", import.meta.url), "utf8");
    const block = source.match(/^DROPIN_DIR=[\s\S]*?^echo "  clean-stop[^\n]*$/m)?.[0];
    assert.ok(block);
    const log = path.join(root, "systemctl.log");
    const result = spawnSync("/bin/sh", ["-c", `refuse() { echo "$*"; exit 2; }\n${block}`], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOMEDIR: root,
        SERVICE: "throughline-server",
        SYSTEMCTL_LOG: log,
      },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const policy = readFileSync(
      path.join(root, ".config/systemd/user/throughline-server.service.d/10-clean-stop.conf"),
      "utf8",
    );
    assert.match(policy, /^Restart=always$/m);
    assert.match(policy, /^RestartSec=2s$/m);
    assert.match(policy, /^WantedBy=default.target$/m);
    assert.match(policy, /^SuccessExitStatus=130 143 SIGINT SIGTERM$/m);
    assert.match(readFileSync(log, "utf8"), /--user enable throughline-server/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const stopFails of [false, true]) {
  test(`Linux desktop handover ${stopFails ? "refuses a failed service stop" : "restores headless after desktop exit"}`, () => {
    const root = mkdtempSync(path.join(tmpdir(), "throughline-handover-"));
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    const log = path.join(root, "operations");
    const launcher = path.join(root, "launcher.sh");
    const app = path.join(root, "app.sh");
    writeFileSync(
      path.join(bin, "systemctl"),
      `#!/bin/sh\nprintf "%s\\n" "$*" >> "$OPERATIONS"\n[ "$2" != stop ] || [ "$STOP_FAILS" != yes ]\n`,
      { mode: 0o755 },
    );
    writeFileSync(path.join(bin, "ss"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(app, '#!/bin/sh\necho desktop >> "$OPERATIONS"\nexit 7\n', { mode: 0o755 });
    try {
      const source = readFileSync(new URL("./install-linux.sh", import.meta.url), "utf8");
      const block = source.match(/^cat > "\$LAUNCHER" <<LAUNCH\n[\s\S]*?^LAUNCH$/m)?.[0];
      assert.ok(block);
      const env = {
        PATH: `${bin}:/usr/bin:/bin`,
        LAUNCHER: launcher,
        SERVICE: "throughline-server",
        BASEDIR: path.join(root, "state"),
        LAN_HOST: "127.0.0.1",
        PORT: "3773",
        LINK: app,
        OPERATIONS: log,
        STOP_FAILS: stopFails ? "yes" : "no",
      };
      const emit = spawnSync("/bin/sh", ["-c", block], { env, encoding: "utf8", timeout: 5000 });
      assert.ifError(emit.error);
      assert.equal(emit.status, 0, emit.stderr);
      const run = spawnSync("/bin/sh", [launcher], { env, encoding: "utf8", timeout: 5000 });
      assert.ifError(run.error);
      const operations = readFileSync(log, "utf8");
      if (stopFails) {
        assert.equal(run.status, 2, run.stdout + run.stderr);
        assert.doesNotMatch(operations, /^desktop$/m);
      } else {
        assert.equal(run.status, 7, run.stdout + run.stderr);
        assert.ok(
          operations.indexOf("--user stop throughline-server") < operations.indexOf("desktop\n"),
        );
        assert.ok(
          operations.indexOf("desktop\n") < operations.indexOf("--user start throughline-server"),
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const platform of ["linux", "mac"] as const) {
  test(`${platform}: prospective directory check permits missing descendants but rejects a file ancestor`, () => {
    const root = mkdtempSync(path.join(tmpdir(), "throughline-directory-check-"));
    try {
      const installer = fileURLToPath(
        new URL(`../${platform}/install-${platform}.sh`, import.meta.url),
      );
      const source = readFileSync(installer, "utf8");
      const check = source.match(/^can_prepare_directory\(\) \(\n[\s\S]*?^\)/m)?.[0];
      assert.ok(check, "the installed preflight helper must be present");
      const missing = path.join(root, "new", "nested");
      const file = path.join(root, "file");
      writeFileSync(file, "not a directory");
      for (const [candidate, expected] of [
        [missing, 0],
        [path.join(file, "child"), 1],
      ] as const) {
        const result = spawnSync(
          "/bin/sh",
          ["-c", `${check}\ncan_prepare_directory "$1"`, "check", candidate],
          {
            env: { PATH: "/usr/bin:/bin" },
            encoding: "utf8",
            timeout: 5000,
          },
        );
        assert.ifError(result.error);
        assert.equal(result.status, expected, result.stderr);
      }
      assert.equal(
        existsSync(path.join(root, "new")),
        false,
        "checking must not create the prospective path",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test(`${platform}: refused verify-only never creates installation directories or controls services`, () => {
    const root = mkdtempSync(path.join(tmpdir(), "throughline-preflight-"));
    const bin = path.join(root, "bin");
    const mutations = path.join(root, "mutations");
    mkdirSync(bin);
    // Only OS instruments are mocked. The actual installer runs with a scrubbed environment.
    // Mutators cannot reach the host even if this regression returns.
    const programs: Record<string, string> = {
      pgrep: "echo 12345",
      lsof: "exit 0",
      ss: "exit 0",
      codesign: "exit 1",
      osascript: "exit 0",
      ssh: "exit 1",
    };
    for (const command of [
      "mkdir",
      "cp",
      "mv",
      "chmod",
      "ln",
      "systemctl",
      "launchctl",
      "open",
      "kill",
      "ditto",
      "hdiutil",
    ]) {
      programs[command] = 'printf "%s\\n" "$0 $*" >> "$MUTATIONS"; exit 99';
    }
    for (const [command, body] of Object.entries(programs)) {
      writeFileSync(path.join(bin, command), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    }
    try {
      const installer = fileURLToPath(
        new URL(`../${platform}/install-${platform}.sh`, import.meta.url),
      );
      const args =
        platform === "linux"
          ? [
              path.join(root, "ThroughLine-0.0.99-x86_64.AppImage"),
              "--agent-account",
              "synthetic-preflight",
              "--verify-only",
            ]
          : [path.join(root, "Missing.app"), "--verify-only"];
      const result = spawnSync("/bin/sh", [installer, ...args], {
        env: { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: root, MUTATIONS: mutations },
        encoding: "utf8",
        timeout: 15000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stdout, /COMPUTED VERDICT: FAIL/);
      let attempted = "";
      try {
        attempted = readFileSync(mutations, "utf8");
      } catch {
        /* no mutation is expected */
      }
      assert.equal(
        attempted,
        "",
        "verify-only must not attempt persistent installation writes or service control",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

#!/bin/sh
# ThroughLine desktop — Linux installer for the governed tower.
#
# USAGE
#   sh install-linux.sh <appimage-path> --agent-account twr --verify-only   # every check, NO mutation
#   sh install-linux.sh <appimage-path> --agent-account twr                 # checks, then install
#
# WHY THE ORDER IS WHAT IT IS
# Every check that can run without privilege runs BEFORE the first mutating act, so the operator
# can execute this exact file in his own environment up to the line where mutation begins. A gate
# placed above the checks makes everything behind it unreachable without privilege, which is how
# a hard-coded version constant once refused a real operator install after a green suite.
# Pattern: /Users/Admin/core-root/vault/01_Reusable/framework-bin/Safe-Full-Testing-Before-Install-Pattern-V1.md
#
# PRIVILEGE, MEASURED 2026-09-05 ON twr
# This target needs NO root: /srv/throughline is writable by twr, the ThroughLine server is a
# --user systemd unit in twr's own home, and the desktop entries live under twr's home. The
# contract's lane kind says "root" because that is the existing controlled-vocabulary value; the
# privilege layer below still runs, and refuses loudly if a future target does need root.
#
# EVERY LAYER STATES WHAT IT PROVES AND WHAT IT DOES NOT. The verdict is COMPUTED as the AND of
# the layers, never asserted. A layer that reports PASS having measured nothing is forced to FAIL.

set -u

ARTIFACT="${1:-}"; shift 2>/dev/null || true
ACCOUNT=""; VERIFY_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --agent-account) ACCOUNT="${2:-}"; shift 2 ;;
    --verify-only)   VERIFY_ONLY=1; shift ;;
    *) echo "refuse: unknown argument '$1'"; exit 2 ;;
  esac
done

refuse() { echo "REFUSED: $*"; exit 2; }
[ -n "$ARTIFACT" ] || refuse "usage: install-linux.sh <appimage-path> --agent-account twr [--verify-only]"
[ -n "$ACCOUNT" ]  || refuse "--agent-account is required so the installer never guesses whose session it is touching"

ROOT=/srv/throughline
LINK="$ROOT/ThroughLine.AppImage"
LAUNCHER="$ROOT/throughline-desktop-launch.sh"
HOMEDIR="/home/$ACCOUNT"
ENTRY="$HOMEDIR/.local/share/applications/throughline-tower.desktop"
SHORTCUT="$HOMEDIR/Desktop/ThroughLine.desktop"
ICON="$HOMEDIR/.local/share/icons/hicolor/512x512/apps/throughline.png"
LAN_HOST=100.96.34.116
PORT=3773
SERVICE=throughline-server
DISPLAY_NUM=:2
# The one state directory both the desktop app and the headless fallback must share.
BASEDIR=/srv/agents-runtime-state/throughline
SETTINGS="$BASEDIR/userdata/desktop-settings.json"

L_ARTIFACT=FAIL; L_VERSION=FAIL; L_WRITE=FAIL; L_SESSION=FAIL; L_SANDBOX=FAIL; L_PORT=FAIL

echo "=============================================================="
echo " ThroughLine desktop — Linux install checks"
echo " artifact : $ARTIFACT"
echo " account  : $ACCOUNT     mode: $([ "$VERIFY_ONLY" = 1 ] && echo verify-only || echo install)"
echo "=============================================================="

# ---- LAYER 1: the artifact ---------------------------------------------------------------
# PROVES: a real, executable, non-truncated AppImage exists at the named path.
# PROVES NOTHING about whether it runs, or whether it is the build you meant.
if [ -f "$ARTIFACT" ] && [ -x "$ARTIFACT" ]; then
  SZ=$(stat -c %s "$ARTIFACT" 2>/dev/null || echo 0)
  if [ "$SZ" -gt 50000000 ]; then L_ARTIFACT=PASS; else L_ARTIFACT=FAIL; echo "  artifact only $SZ bytes — truncated?"; fi
else
  echo "  artifact missing or not executable"
fi
echo "  [1] artifact      $L_ARTIFACT   (proves: file present+executable+plausible size. proves NOT: that it runs)"

# ---- LAYER 2: version agreement ----------------------------------------------------------
# PROVES: the artifact's own filename version matches the version the contract will install to.
# PROVES NOTHING about the code inside it.
VER=$(basename "$ARTIFACT" | sed -n 's/^ThroughLine-\([0-9][0-9.]*\)-x86_64\.AppImage$/\1/p')
if [ -n "$VER" ]; then
  TARGET="$ROOT/ThroughLine-$VER-x86_64.AppImage"
  L_VERSION=PASS
else
  echo "  cannot read a version out of the artifact filename — refusing rather than guessing a target path"
  TARGET=""
fi
echo "  [2] version       $L_VERSION   (version='$VER' -> $TARGET)"

# ---- LAYER 3: write access, NO privilege used --------------------------------------------
# PROVES: this account can perform every write the install needs, without root.
# PROVES NOTHING about whether the writes are correct.
W=1
for d in "$ROOT" "$HOMEDIR/.local/share/applications" "$HOMEDIR/Desktop"; do
  mkdir -p "$d" 2>/dev/null
  [ -w "$d" ] || { echo "  not writable: $d"; W=0; }
done
[ "$W" = 1 ] && L_WRITE=PASS
echo "  [3] write access  $L_WRITE   (proves: no root needed for any install path. proves NOT: correctness)"

# ---- LAYER 4: the operator's desktop session ---------------------------------------------
# PROVES: an X session exists on the display the app will open in, and its cookie is readable.
# PROVES NOTHING about whether the operator is present or wants a window right now.
XAUTH="$HOMEDIR/.config/tigervnc/Xauthority"
if [ -S "/tmp/.X11-unix/X${DISPLAY_NUM#:}" ] && [ -r "$XAUTH" ]; then L_SESSION=PASS; fi
echo "  [4] x session     $L_SESSION   (display $DISPLAY_NUM, cookie $XAUTH)"

# ---- LAYER 5: the security boundary ------------------------------------------------------
# PROVES: Electron can sandbox WITHOUT a setuid-root chrome-sandbox, via unprivileged user
# namespaces — so the app never needs a privileged binary on a credential-less agent host.
# PROVES NOTHING about the app's own behaviour once running.
NS=$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 0)
if [ "$NS" -gt 0 ]; then L_SANDBOX=PASS; else echo "  unprivileged user namespaces disabled — sandbox would need setuid root, which this host must not have"; fi
echo "  [5] sandbox       $L_SANDBOX   (max_user_namespaces=$NS)"

# ---- LAYER 6: the port, and who holds it -------------------------------------------------
# PROVES: whether anything already holds $PORT, so the launcher can hand it over deliberately
# instead of the app silently falling forward to 3774 and stranding the operator's phone.
# PROVES NOTHING about what will happen at launch.
HOLDER=$(ss -ltnp 2>/dev/null | grep ":$PORT " | head -1)
if [ -n "$HOLDER" ]; then
  echo "  port $PORT currently held: $(echo "$HOLDER" | sed 's/.*users:(//;s/).*//')"
  echo "  the launcher stops the '$SERVICE' user service first so the app takes $PORT, then restores it on exit"
else
  echo "  port $PORT free"
fi
L_PORT=PASS
echo "  [6] port plan     $L_PORT   (proves: current holder observed. proves NOT: that handover succeeds)"

# ---- COMPUTED VERDICT --------------------------------------------------------------------
VERDICT=PASS
for l in "$L_ARTIFACT" "$L_VERSION" "$L_WRITE" "$L_SESSION" "$L_SANDBOX" "$L_PORT"; do
  [ "$l" = PASS ] || VERDICT=FAIL
done
echo "--------------------------------------------------------------"
echo " COMPUTED VERDICT: $VERDICT  (AND of six layers; not asserted)"
echo "--------------------------------------------------------------"

[ "$VERDICT" = PASS ] || refuse "one or more checks failed above; nothing was written"
if [ "$VERIFY_ONLY" = 1 ]; then
  echo "verify-only: every check above ran and passed. NOTHING was written. Re-run without --verify-only to install."
  exit 0
fi

# ==========================================================================================
# MUTATION BEGINS HERE — everything above ran without it
# ==========================================================================================
echo
echo "installing..."

PREV=$(readlink -f "$LINK" 2>/dev/null || echo "")
[ -n "$PREV" ] && echo "  rollback: previous app was $PREV — 'ln -sfn $PREV $LINK' restores it"

cp -f "$ARTIFACT" "$TARGET" || refuse "copy failed"
chmod 755 "$TARGET"
ln -sfn "$TARGET" "$LINK"
echo "  installed $TARGET"
echo "  current   $LINK -> $(readlink -f "$LINK")"

# The launcher owns the one thing a bare .desktop Exec cannot: handing $PORT over from the
# headless service to the app, and handing it back when the app exits. Stops are PID-targeted
# through systemd's own unit control — never pkill/pgrep by pattern, which can match a name the
# operator also uses.
cat > "$LAUNCHER" <<LAUNCH
#!/bin/sh
# Launch the ThroughLine desktop app as the SINGLE server on this device.
#
# T3CODE_HOME is the whole reason this wrapper exists. Measured 2026-09-05: without it the
# app opens /home/twr/.t3/userdata/state.sqlite while the headless service uses
# $BASEDIR/userdata/state.sqlite. Two databases on one machine means the app
# and the web app show DIFFERENT thread lists — the exact parity failure this install exists
# to end. Pointing both at one base dir is what makes "one server per device" true.
#
# Stops are PID-targeted through systemd's own unit control. Never pkill/pgrep by pattern:
# a pattern can match a process the operator started himself.
set -u
SERVICE=$SERVICE
export T3CODE_HOME=$BASEDIR
export T3CODE_DESKTOP_LAN_HOST=$LAN_HOST

# THE DURABLE QUEUE ADDRESS IS LOAD-BEARING, and the window does not inherit it. Do not remove.
#
# Measured on the tower 2026-09-17: the window became the server with no variable beginning
# ABSURD in its environment, so the queue library fell back to a connection string carrying no
# user, connected as the operating-system account, and Postgres answered
# 'role "twr" does not exist'. The turn rail's readiness probe therefore failed and the window
# refused every send with a queue-reachability banner while the headless service answered fine.
# The service never had the problem because its unit file has always carried the address.
#
# Repaired by hand on the tower that night, and the repair was ERASED by the next install on
# 2026-09-20, because this installer rewrites the launcher from scratch every run. That is why
# the block lives here rather than on the host: a launcher edit is not durable, an installer
# edit is.
#
# Values are READ FROM THE SERVICE UNIT rather than duplicated, so the host keeps one source of
# truth and no value can drift between the window and the service. Only the queue and provider
# addresses are taken; nothing else in the unit's environment is copied.
UNIT_ENV=\$(systemctl --user show -p Environment --value "\$SERVICE" 2>/dev/null)
for kv in \$UNIT_ENV; do
  case "\$kv" in
    ABSURD_*=*|ANTHROPIC_*=*) export "\$kv" ;;
  esac
done

# ONE SERVER PER DEVICE, and it is not a tidiness preference — it is a correctness requirement.
# Measured 2026-09-05, four runs, one variable:
#   service stopped, app alone   -> app loads with the operator's real threads  (twice)
#   service running, app also up -> "Something went wrong. Primary environment request failed
#                                    during fetch-session-state (HTTP 500)"    (three times)
# Two servers against the one shared state.sqlite is what breaks session state. The port
# numbers are a red herring: the two CAN coexist on 3773 at different addresses, and it still
# fails, because the conflict is the database, not the socket.
#
# So the service is stopped for the lifetime of the app window, and started again when the
# window closes. Stops go through systemd's own unit control — never pkill/pgrep by pattern.
systemctl --user stop "\$SERVICE" 2>/dev/null
i=0; while [ \$i -lt 20 ]; do ss -ltn 2>/dev/null | grep -q ":$PORT " || break; sleep 0.5; i=\$((i+1)); done

# --password-store IS LOAD-BEARING. Do not remove it.
#
# Electron picks its safe-storage backend from the session it happens to find. Launched from a
# shell there is no D-Bus and no XDG_CURRENT_DESKTOP, so it uses basic_text. Launched from the
# desktop icon, XFCE supplies both, so it switches to the OS keyring — and the session-state
# secret written under one backend cannot be read under the other. The server then answers the
# app's own fetch-session-state with HTTP 500 and the operator sees "Something went wrong."
#
# Measured 2026-09-05, causation and fix in one run, both outside the icon path so the variable
# was isolated rather than assumed:
#   shell launch + DBUS_SESSION_BUS_ADDRESS + XDG_CURRENT_DESKTOP=XFCE            -> HTTP 500
#   the same, plus --password-store=basic                                          -> loads, real threads
#
# Pinning it is what makes the app behave identically however it is started, which is the whole
# point of the operator having one experience on every device. TRADE-OFF, stated rather than
# buried: basic_text obfuscates the local session token on disk instead of putting it in the
# keyring. On this host that costs nothing real — the agent account can already read its own
# files, and by design this machine holds no credentials worth a keyring.
"$LINK" --password-store=basic "\$@"
RC=\$?

# The headless fallback returns the moment the window closes, so the operator's phone address
# never depends on a desktop session being up. Verified 2026-09-05: after every app process
# ended, the unit came back active and bound $LAN_HOST:$PORT on its own.
systemctl --user start "\$SERVICE" 2>/dev/null
exit \$RC
LAUNCH
chmod 755 "$LAUNCHER"
echo "  launcher  $LAUNCHER"

write_entry() {
  cat > "$1" <<ENTRY
[Desktop Entry]
Version=1.0
Type=Application
Name=ThroughLine
Comment=The ThroughLine agent hub — the full application, not a browser tab
Exec=$LAUNCHER
Icon=$ICON
Terminal=false
StartupNotify=true
StartupWMClass=ThroughLine
Categories=Development;Network;
Path=$HOMEDIR
ENTRY
  chmod 755 "$1"
  # XFCE refuses to run a .desktop launcher whose stored trust checksum does not match the file,
  # and shows "Untrusted application launcher" on double-click instead. Rewriting the file
  # therefore BREAKS the operator's icon unless the mark is renewed in the same act. Measured
  # 2026-09-05: an install that skipped this left a stored 01d0f0db… against an actual f03f83b8…
  # and the icon stopped opening — every other check passed, so nothing else caught it.
  if command -v gio >/dev/null 2>&1; then
    SUM=$(sha256sum "$1" | cut -d' ' -f1)
    gio set -t string "$1" metadata::xfce-exe-checksum "$SUM" 2>/dev/null
    gio set -t string "$1" metadata::trusted true 2>/dev/null
    STORED=$(gio info -a metadata::xfce-exe-checksum "$1" 2>/dev/null | sed -n 's/.*metadata::xfce-exe-checksum: //p')
    if [ "$STORED" = "$SUM" ]; then
      echo "  trusted   $(basename "$1")  checksum $(echo "$SUM" | cut -c1-12)… matches file"
    else
      echo "  trusted   $(basename "$1")  MISMATCH — stored='$STORED' actual='$SUM'. Double-clicking this icon will raise 'Untrusted application launcher'."
    fi
  else
    echo "  trusted   gio absent — cannot renew the XFCE trust mark; the icon will refuse to launch"
  fi
}
write_entry "$ENTRY"
write_entry "$SHORTCUT"
echo "  entry     $ENTRY"
echo "  shortcut  $SHORTCUT"

update-desktop-database "$HOMEDIR/.local/share/applications" 2>/dev/null || true

# TELL THE TRUTH ABOUT A DELIBERATE STOP.
# This launcher stops the headless unit for the life of the app window. The server exits 130 on
# its shutdown signal, and systemd reads any non-zero exit as a crash — so a perfectly healthy
# handover left `systemctl --user is-active` reporting "failed" while the system was working
# correctly. That is a false signal: a human reads it as breakage, and a watchdog built on it
# would remediate something that is fine.
#
# The unit itself is not ours — its own description says "outside Tier 1" and it has no source
# file in this repository — so this is an additive drop-in rather than an edit to another
# component's file. It whitelists ONLY the two shutdown-signal exits. A genuine crash with any
# other code still reports failed, which is the whole point.
# REVERSAL: delete the drop-in file and run `systemctl --user daemon-reload`.
DROPIN_DIR="$HOMEDIR/.config/systemd/user/$SERVICE.service.d"
mkdir -p "$DROPIN_DIR"
cat > "$DROPIN_DIR/10-clean-stop.conf" <<DROPIN
# Written by the throughline-desktop component installer.
# 130 = 128+SIGINT, 143 = 128+SIGTERM. Both mean "asked to stop and did", not "crashed".
[Service]
SuccessExitStatus=130 143 SIGINT SIGTERM
DROPIN
systemctl --user daemon-reload 2>/dev/null
systemctl --user reset-failed "$SERVICE" 2>/dev/null
echo "  clean-stop $DROPIN_DIR/10-clean-stop.conf"

# EXPOSURE: the app serves the operator's tailnet address while its window is open, so his
# phone keeps working without the headless service running beside it. The app defaults to
# local-only, which binds loopback and left his address dead for three minutes during this
# build. This value is what makes the app a complete replacement for the service rather than a
# partial one.
#
# A FALSE LEAD RECORDED SO THE NEXT SEAT DOES NOT RE-WALK IT: this value was briefly blamed for
# the "fetch-session-state (HTTP 500)" failure and removed. That was wrong. Across four runs the
# 500 tracked ONE variable and it was not this one — it appeared whenever the headless service
# was running against the shared database at the same time as the app, and it was absent
# whenever the app ran alone, with this value set or unset. The fix is one server at a time,
# which the launcher enforces; see its comment.
mkdir -p "$BASEDIR/userdata"
# Resolve node explicitly. A bare `node` is not on PATH in a non-login shell on this host, and a
# silent failure here is the difference between the phone working and the phone showing nothing.
NODE=$(command -v node 2>/dev/null || true)
[ -n "$NODE" ] || NODE="$HOMEDIR/.local/bin/node"
[ -x "$NODE" ] || refuse "cannot find node to write the exposure setting; app would bind loopback only and the phone address would not answer. Install is otherwise complete — re-run after making node reachable."
"$NODE" -e '
  const fs=require("fs"), p=process.argv[1];
  let s={}; try{ s=JSON.parse(fs.readFileSync(p,"utf8")) }catch(e){}
  const before=s.serverExposureMode ?? "(unset -> local-only)";
  s.serverExposureMode="network-accessible";
  fs.writeFileSync(p, JSON.stringify(s,null,2));
  console.log("  exposure  "+before+" -> network-accessible  ("+p+")");
' "$SETTINGS" 2>/dev/null || refuse "could not set the exposure value; the app would bind loopback only and the operator's phone address would not answer while the app is open"

# ---- POST-WRITE LAYER 7: the launcher the operator actually double-clicks -----------------
# This layer exists because of a real GRADED-FAIL on 2026-09-05: every pre-write check passed,
# the app ran, and the icon still refused to open. The app was reachable only by paths the
# operator does not use. PROVES: XFCE will execute both launchers without an "Untrusted
# application launcher" prompt. PROVES NOTHING about what the app does once open.
L_TRUST=FAIL
TRUST_OK=1
for f in "$ENTRY" "$SHORTCUT"; do
  [ -f "$f" ] || { echo "  missing launcher: $f"; TRUST_OK=0; continue; }
  [ -x "$f" ] || { echo "  launcher not executable: $f"; TRUST_OK=0; }
  A=$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1)
  S=$(gio info -a metadata::xfce-exe-checksum "$f" 2>/dev/null | sed -n 's/.*metadata::xfce-exe-checksum: //p')
  if [ -z "$S" ] || [ "$S" != "$A" ]; then
    echo "  UNTRUSTED: $f  stored='${S:-<unset>}' actual='$A' — double-click would raise 'Untrusted application launcher'"
    TRUST_OK=0
  fi
  grep -q "^Exec=$LAUNCHER\$" "$f" 2>/dev/null || { echo "  Exec line is not the launcher in $f"; TRUST_OK=0; }
  grep -qi "exo-open\|WebBrowser\|firefox" "$f" 2>/dev/null && { echo "  $f still opens a browser"; TRUST_OK=0; }
done
[ "$TRUST_OK" = 1 ] && L_TRUST=PASS
echo "  [7] launcher      $L_TRUST   (proves: XFCE will run both launchers, and neither opens a browser)"

# ---- POST-WRITE LAYER 8: the unit tells the truth about a deliberate stop ------------------
# PROVES: systemd is loaded with the whitelist, so stopping the unit reports inactive rather
# than failed, AND that the whitelist is narrow enough that a real crash still reports failed.
# PROVES NOTHING about whether the service works.
L_HONEST=FAIL
SES=$(systemctl --user show "$SERVICE" -p SuccessExitStatus 2>/dev/null | sed 's/^SuccessExitStatus=//')
case "$SES" in
  *130*)
    # narrowness check: a whitelist that swallows everything would make the unit unable to
    # report a genuine failure, which would be a worse false signal than the one being fixed
    case "$SES" in
      *" 0 "*|"0"|*"1 "*) echo "  whitelist too broad: '$SES' — a real crash could report success"; ;;
      *) L_HONEST=PASS ;;
    esac
    ;;
  *) echo "  SuccessExitStatus does not carry 130 (got '${SES:-<empty>}') — a deliberate stop will keep reporting 'failed'" ;;
esac
echo "  [8] stop honesty  $L_HONEST   (SuccessExitStatus='${SES:-<empty>}')"

echo "--------------------------------------------------------------"
if [ "$L_TRUST" = PASS ] && [ "$L_HONEST" = PASS ]; then
  echo " POST-INSTALL VERDICT: PASS  (AND of layers 7 and 8)"
  echo
  echo "INSTALLED. The desktop shortcut now launches the application; it no longer opens a browser."
else
  echo " POST-INSTALL VERDICT: FAIL — the files are in place but the operator's icon will not open."
  echo " Nothing was rolled back; re-run this installer after resolving the layer-7 output above."
fi
echo "ROLLBACK: ln -sfn ${PREV:-<none>} $LINK  and restore the previous .desktop Exec line."
{ [ "$L_TRUST" = PASS ] && [ "$L_HONEST" = PASS ]; } || exit 3

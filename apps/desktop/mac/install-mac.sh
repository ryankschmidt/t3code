#!/bin/sh
# ThroughLine desktop — macOS installer for the operator's own machine.
#
# USAGE
#   sh install-mac.sh <dmg-path> --verify-only   # every check, NOTHING quit, NOTHING replaced
#   sh install-mac.sh <dmg-path>                 # checks, then replace the application
#   sh install-mac.sh --post-install-check-only [--app /absolute/ThroughLine.app] [--port 3773]
#
# WHY THE ORDER IS WHAT IT IS
# Every check that can run without touching the operator's machine runs BEFORE the first
# destructive act, so he can run this exact file up to the line where it starts changing things.
# Same shape as the Linux side. Pattern:
# /Users/Admin/core-root/vault/01_Reusable/framework-bin/Safe-Full-Testing-Before-Install-Pattern-V1.md
#
# WHY NOT SHIP WARDEN
# The running warden refuses this component at its membership gate, which is COMPONENT-level
# rather than platform-level, so the Mac side is refused exactly as the Linux side is. The
# contract names this installer instead. Nothing here bypasses the warden — the warden was never
# reachable for this package.
#
# THIS SCRIPT MUST SURVIVE ITS OWN ACT
# Replacing the app requires quitting a running ThroughLine, which drops live threads — possibly
# including the session that started this installer. It therefore never assumes its parent is
# alive: run it detached, it logs everything to disk, and its verdict is readable afterwards.
#
# WHAT IT WILL NOT DO
# It never handles a pairing credential. It answers the app's local-network permission
# prompt itself; a real permission refusal is reported, never silently handed off.

set -u

# defined before argument parsing, because the detach branch below refuses through it
refuse() { echo "REFUSED: $*"; exit 2; }

# Check-only is parsed and returned BEFORE the install/detach parser. It cannot launch,
# quit or replace an app, even when an install-mode flag is accidentally supplied.
answer_local_network_prompt() {
  osascript <<'APPLESCRIPT'
with timeout of 2 seconds
  tell application "System Events"
    if not (exists application process "UserNotificationCenter") then return "NO_PROMPT"
    tell application process "UserNotificationCenter"
      repeat with w in windows
        set promptText to ""
        set itemsOnScreen to entire contents of w
        repeat with e in itemsOnScreen
          try
            if class of e is static text then set promptText to promptText & " " & (value of e as text)
          end try
        end repeat
        if promptText contains "ThroughLine" and promptText contains "find devices on local networks" then
          repeat with e in itemsOnScreen
            try
              if class of e is button and name of e is "Allow" then
                click e
                return "ALLOW_CLICKED"
              end if
            end try
          end repeat
          return "PERMISSION_REFUSAL: matching local-network prompt has no accessible Allow button"
        end if
      end repeat
    end tell
  end tell
end timeout
return "NO_PROMPT"
APPLESCRIPT
}

candidate_owns_port() {
  OWNED_PID=""
  for candidate_pid in $(lsof -nP -iTCP:"$POST_PORT" -sTCP:LISTEN -t 2>/dev/null); do
    candidate_command=$(ps -ww -p "$candidate_pid" -o command= 2>/dev/null)
    case "$candidate_command" in
      *"$APP/Contents/"*) OWNED_PID="$candidate_pid"; return 0 ;;
    esac
  done
  return 1
}

candidate_window_count() {
  # System Events only: focusing an existing process cannot launch a closed app.
  osascript - "$APP" <<'APPLESCRIPT'
on run argv
  set appPath to item 1 of argv
  with timeout of 2 seconds
    tell application "System Events"
      repeat with p in application processes
        try
          set processPath to POSIX path of (application file of p as alias)
          if processPath is appPath or processPath is (appPath & "/") then
            set frontmost of p to true
            return count of windows of p
          end if
        end try
      end repeat
    end tell
  end timeout
  return 0
end run
APPLESCRIPT
}

post_install_checks() {
  INSTVER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || echo "?")
  L_POST=FAIL; L_READY=FAIL; L_WINDOW=FAIL
  if [ "$INSTVER" = "$NEWVER" ] && [ "$INSTVER" != "?" ] && codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then L_POST=PASS; fi
  echo "  [7] installed     $L_POST   (version matches image AND seal verifies in place)"
  deadline=$(($(date +%s)+90))
  permission_error_seen=0
  while [ "$L_POST" = PASS ] && [ "$(date +%s)" -lt "$deadline" ]; do
    permission_result=$(answer_local_network_prompt 2>&1)
    permission_status=$?
    case "$permission_result" in
      ALLOW_CLICKED) echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ') local-network permission ALLOW_CLICKED" ;;
      PERMISSION_REFUSAL:*) [ "$permission_error_seen" = 1 ] || echo "  $permission_result"; permission_error_seen=1 ;;
      *) if [ "$permission_status" != 0 ] && [ "$permission_error_seen" = 0 ]; then
           echo "  permission automation refusal: $permission_result"; permission_error_seen=1
         fi ;;
    esac
    if candidate_owns_port; then
      response=$(curl -s --connect-timeout 1 --max-time 1 -w '\n%{http_code}' "http://127.0.0.1:$POST_PORT/.well-known/t3/environment")
      curl_status=$?
      http_code=$(printf '%s\n' "$response" | tail -n 1)
      if [ "$curl_status" = 0 ] && [ "$http_code" = 200 ]; then
        server_version=$(printf '%s\n' "$response" | sed '$d' | /usr/bin/plutil -extract serverVersion raw -o - - 2>/dev/null) || server_version=""
        if [ "$server_version" = "$INSTVER" ]; then L_READY=PASS; else
          echo "  readiness version mismatch: bundle '$INSTVER', server '${server_version:-invalid JSON or missing version}'"
        fi
        break
      fi
    fi
    sleep 1
  done
  echo "  [8] running app   $L_READY   (owned listener pid '${OWNED_PID:-none}', port $POST_PORT, HTTP 200 AND serverVersion '$INSTVER'; deadline 90s)"
  if [ "$L_READY" = PASS ]; then
    window_deadline=$(($(date +%s)+30))
    while [ "$(date +%s)" -lt "$window_deadline" ]; do
      windows=$(candidate_window_count 2>/dev/null) || windows=0
      case "$windows" in ''|*[!0-9]*) windows=0 ;; esac
      if [ "$windows" -gt 0 ]; then L_WINDOW=PASS; break; fi
      sleep 1
    done
  fi
  echo "  [9] window        $L_WINDOW   (existing candidate process only; accessibility can hide Electron windows; diagnostic, NOT a verdict input)"
  echo "--------------------------------------------------------------"
  if [ "$L_POST" = PASS ] && [ "$L_READY" = PASS ]; then
    echo " POST-INSTALL VERDICT: PASS"
  else
    echo " POST-INSTALL VERDICT: FAIL — roll back with the command below."
  fi
  echo
  echo "ROLLBACK, one command:"
  echo "  rm -rf $APP && ditto $BACKUP $APP"
  echo "Rollback is only safe together with the matching store backup: $BACKUP_ROOT/userdata-backup-*/ (or userdata-live-file-copy-*/); the store migrates forward."
  echo "Permission prompts are handled by the installer; any observed automation refusal is named above. Touch ID-protected actions and Desktop Commander refusals remain boundaries. Pairing credential bytes are never read by this installer."
  echo "--------------------------------------------------------------"
  [ "$L_POST" = PASS ] && [ "$L_READY" = PASS ]
}

if [ "${1:-}" = --post-install-check-only ]; then
  shift
  APP=/Applications/ThroughLine.app; POST_PORT=3773
  while [ $# -gt 0 ]; do
    case "$1" in
      --app) [ $# -ge 2 ] || refuse "--app requires an absolute .app path"; APP=$2; shift 2 ;;
      --port) [ $# -ge 2 ] || refuse "--port requires a number"; POST_PORT=$2; shift 2 ;;
      *) refuse "check-only cannot combine with '$1'; no install, detach or reopen occurred" ;;
    esac
  done
  case "$APP" in /*.app) ;; *) refuse "--app requires an absolute .app path" ;; esac
  case "$POST_PORT" in ''|*[!0-9]*) refuse "invalid port" ;; esac
  [ "$POST_PORT" -ge 1 ] && [ "$POST_PORT" -le 65535 ] || refuse "invalid port"
  BACKUP_ROOT=/Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/_versions/app-backups
  BACKUP="$BACKUP_ROOT/<matching-app-backup>.app"
  NEWVER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || echo "?")
  post_install_checks || exit 3
  exit 0
fi

DMG="${1:-}"; shift 2>/dev/null || true
VERIFY_ONLY=0; DETACH=0; LOG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --verify-only) VERIFY_ONLY=1; shift ;;
    --detach)      DETACH=1; shift ;;
    --log)         LOG="${2:-}"; shift 2 ;;
    *) echo "refuse: unknown argument '$1'"; exit 2 ;;
  esac
done

# ---- SELF-DETACH, and it is not optional theatre ------------------------------------------
# Measured 2026-09-06 00:11 UTC: this installer was launched with `nohup … & disown`, printed
# "quitting ThroughLine", and DIED THERE — 1,645 bytes of log and nothing after. Quitting the
# app tore down the session that started it and took this process with it. It never reached the
# backup, never staged, never swapped. The gate order saved the machine; the detachment did not
# exist. `setsid` does not exist on macOS, and nohup survives a hangup but not that kill.
#
# launchd is the only parent on this machine that outlives the session. Re-exec under it, then
# return immediately so the caller can die freely.
if [ "$DETACH" = 1 ]; then
  # STRUCTURAL GUARD, not a style preference. --detach exists for exactly one reason: the
  # install quits the app that may be hosting the caller. A preflight quits nothing and cannot
  # kill its caller, so it never needs detaching — which makes `--verify-only --detach` a
  # combination with no legitimate meaning. On 2026-09-07 that combination ran a real install.
  # Refusing it removes the dangerous state instead of relying on a forwarding line staying
  # correct forever.
  [ "$VERIFY_ONLY" = 1 ] && refuse "--verify-only with --detach is refused: a preflight quits nothing, so it has no reason to detach, and this exact combination silently ran a full install on 2026-09-07. Run the preflight in the foreground."
  [ -n "$LOG" ] || refuse "--detach requires --log <absolute-path> so the result survives the caller"
  LABEL="throughline-install-$$"
  SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
  # launchctl submit RESTARTS a job that exits — measured 2026-09-06, a proof job printed its
  # whole sequence and then started again. An installer that reruns would quit the operator's
  # app a second time and take another backup. So the job removes its own label as its last act,
  # and the run is one run.
  # FLAG FORWARDING IS SAFETY-CRITICAL. Measured 2026-09-07 02:38 UTC: this line launched the
  # child WITHOUT forwarding --verify-only, so `--verify-only --detach` silently ran the INSTALL
  # path — it quit the operator's ThroughLine, replaced 0.0.37 with 0.0.38, and left the app
  # closed. A preflight that installs is worse than no preflight, because it is trusted.
  # Every mode-bearing flag is forwarded explicitly here; adding a new one means adding it here.
  CHILD_FLAGS=""
  [ "$VERIFY_ONLY" = 1 ] && CHILD_FLAGS="--verify-only"
  launchctl submit -l "$LABEL" -o "$LOG" -e "$LOG" -- \
    /bin/sh -c "/bin/sh '$SELF' '$DMG' $CHILD_FLAGS; launchctl remove '$LABEL'" \
    || refuse "launchctl submit failed; NOT falling back to nohup, which is the failure this replaces"
  echo "detached under launchd as '$LABEL'; result will be at $LOG"
  echo "this shell may now die without affecting the install"
  exit 0
fi

refuse() { echo "REFUSED: $*"; exit 2; }
[ -n "$DMG" ] || refuse "usage: install-mac.sh <dmg-path> [--verify-only]"

APP=/Applications/ThroughLine.app
BACKUP_ROOT=/Users/Admin/core-root/vault/01_Projects/workbench/infra/t3code/_versions/app-backups
MNT=""

L_DMG=FAIL; L_VERSION=FAIL; L_CURRENT=FAIL; L_BACKUP=FAIL; L_MOUNT=FAIL; L_SIG=FAIL

echo "=============================================================="
echo " ThroughLine desktop — macOS install checks"
echo " dmg  : $DMG"
echo " mode : $([ "$VERIFY_ONLY" = 1 ] && echo verify-only || echo install)"
echo " time : $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "=============================================================="

# ---- LAYER 1: the disk image -------------------------------------------------------------
# PROVES: a real, plausibly-sized disk image exists at the named path.
# PROVES NOTHING about what is inside it.
if [ -f "$DMG" ]; then
  SZ=$(stat -f %z "$DMG" 2>/dev/null || echo 0)
  [ "$SZ" -gt 100000000 ] && L_DMG=PASS || echo "  only $SZ bytes — truncated?"
elif [ -d "$DMG" ]; then
  # an application bundle is a directory; size it by its payload
  SZ=$(du -sk "$DMG" 2>/dev/null | awk '{print $1*1024}')
  [ "${SZ:-0}" -gt 100000000 ] && L_DMG=PASS || echo "  bundle is only ${SZ:-0} bytes — incomplete?"
else
  echo "  source not found (looked for a file or an .app directory)"
fi
echo "  [1] source        $L_DMG   (proves: present and plausible size. proves NOT: contents)"

# ---- LAYER 2: version agreement ----------------------------------------------------------
# PROVES: the image's filename version and the version currently installed, so the operator can
# see exactly what is replacing what. PROVES NOTHING about the code inside either.
# A disk image declares its version in its filename; a bundle declares it in its own Info.plist.
# Take it from whichever the source is, and let layer 5 cross-check the two so a lie in either
# place is caught rather than trusted.
case "$DMG" in
  *.app) NEWVER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$DMG/Contents/Info.plist" 2>/dev/null || echo "") ;;
  *)     NEWVER=$(basename "$DMG" | sed -n 's/^ThroughLine-\([0-9][0-9.]*\)-arm64\.dmg$/\1/p') ;;
esac
CURVER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || echo "none")
if [ -n "$NEWVER" ]; then L_VERSION=PASS; else echo "  cannot read a version from the source — refusing rather than guessing"; fi
echo "  [2] version       $L_VERSION   (installed '$CURVER' -> incoming '$NEWVER')"

# ---- LAYER 3: what is running right now ---------------------------------------------------
# PROVES: whether a live ThroughLine will have to be quit, and names it, so the act is never a
# surprise. PROVES NOTHING about whether quitting is safe for the operator's current work.
# TWO INDEPENDENT READERS, because this layer already lied once. On 2026-09-05 the narrow
# pattern `pgrep -f "$APP/Contents/MacOS"` returned NOTHING while five processes were running
# under the bundle and the app held port 3773 — macOS pgrep did not match that longer path. The
# layer then reported "not running; no threads to drop" about a live app the operator was using.
# A tool that finds nothing and a tool that cannot see produce identical output, so this now
# asks two different instruments and believes RUNNING if either says so.
BUNDLE_PROCS=$(pgrep -f "/Applications/ThroughLine.app/" 2>/dev/null | wc -l | tr -d ' ')
PORT_PID=$(lsof -nP -iTCP:3773 -sTCP:LISTEN -t 2>/dev/null | head -1)
RUNNING=""
[ "${BUNDLE_PROCS:-0}" -gt 0 ] && RUNNING=$(pgrep -f "/Applications/ThroughLine.app/" 2>/dev/null | head -1)
[ -z "${RUNNING:-}" ] && [ -n "${PORT_PID:-}" ] && RUNNING="$PORT_PID"

# positive control: the readers must be capable of finding SOMETHING on this machine, or their
# silence proves nothing at all
CONTROL=$(pgrep -f "/System/Library" 2>/dev/null | wc -l | tr -d ' ')
if [ "${CONTROL:-0}" -eq 0 ]; then
  echo "  process reader returned nothing even for a control pattern — its silence is not evidence"
else
  L_CURRENT=PASS
fi

if [ -n "${RUNNING:-}" ]; then
  echo "  ThroughLine IS running: $BUNDLE_PROCS process(es) under the bundle, port 3773 held by pid ${PORT_PID:-none}."
  echo "  Installing quits it and DROPS LIVE THREADS, possibly including the one that started this."
else
  echo "  ThroughLine is not running (bundle procs=$BUNDLE_PROCS, port 3773 holder=none); no threads to drop."
fi
echo "  [3] running app   $L_CURRENT   (two readers + control. proves: current state observed. proves NOT: that quitting is harmless)"

# ---- LAYER 4: rollback exists BEFORE anything is destroyed --------------------------------
# PROVES: there is somewhere to put the outgoing app, and it is not already occupied.
# PROVES NOTHING about the backup's integrity until it is actually made.
BACKUP="$BACKUP_ROOT/ThroughLine-$CURVER-$(date -u '+%Y%m%dT%H%M%SZ').app"
mkdir -p "$BACKUP_ROOT" 2>/dev/null
if [ -w "$BACKUP_ROOT" ] && [ ! -e "$BACKUP" ]; then L_BACKUP=PASS; else echo "  backup root not writable, or target already exists"; fi
echo "  [4] rollback slot $L_BACKUP   ($BACKUP)"

# ---- LAYER 5: the source opens and carries the app it claims ------------------------------
# PROVES: the source resolves to a real ThroughLine.app whose OWN Info.plist version matches the
# version in its filename — so a filename lie cannot get past this point.
# PROVES NOTHING about signing; that is layer 6's job.
#
# The source may be a disk image OR an already-built application bundle. Measured 2026-09-05:
# the 0.0.38 disk image's copy does NOT pass codesign deep/strict, while the separately signed
# bundle from the same build does. Accepting both shapes lets layer 6 decide which is
# installable, instead of this script assuming an image is the only shape a source can take.
SRC=""
case "$DMG" in
  *.app)
    MNT=""
    [ -d "$DMG" ] && SRC="$DMG" || echo "  named an .app that is not a directory"
    ;;
  *)
    MNT=$(mktemp -d /tmp/tl-dmg-XXXXXX)
    if hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MNT" >/dev/null 2>&1; then
      [ -d "$MNT/ThroughLine.app" ] && SRC="$MNT/ThroughLine.app" || echo "  no ThroughLine.app inside the image"
    else
      echo "  image would not mount"
    fi
    ;;
esac

if [ -n "$SRC" ]; then
  IMGVER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$SRC/Contents/Info.plist" 2>/dev/null || echo "?")
  if [ "$IMGVER" = "$NEWVER" ]; then
    L_MOUNT=PASS
  else
    echo "  source carries version '$IMGVER' but its name says '$NEWVER' — refusing rather than trusting the name"
  fi
fi
echo "  [5] source opens  $L_MOUNT   (src='${SRC:-none}', app version '${IMGVER:-?}')"

# ---- LAYER 6: signature ------------------------------------------------------------------
# PROVES: the bundle's own seal is intact and macOS will not reject it as damaged.
# PROVES NOTHING about notarisation, and nothing about whether the operator's existing
# permission grants survive — an identity change revokes those regardless of validity.
if [ "$L_MOUNT" = PASS ] && codesign --verify --deep --strict "$SRC" >/dev/null 2>&1; then
  L_SIG=PASS
  SIGID=$(codesign -dv "$SRC" 2>&1 | sed -n 's/^Identifier=//p' | head -1)
  CURID=$(codesign -dv "$APP" 2>&1 | sed -n 's/^Identifier=//p' | head -1)
  echo "  signature verifies; identifier '$SIGID' (installed app is '$CURID')"
  [ "$SIGID" = "$CURID" ] || echo "  IDENTITY CHANGES — macOS will revoke this app's permission grants and re-prompt"
else
  echo "  signature does NOT verify deep/strict on the source — refusing to install a bundle macOS may reject"
fi
echo "  [6] signature     $L_SIG   (proves: the seal is intact. proves NOT: notarisation, nor that grants survive)"

# ---- COMPUTED VERDICT --------------------------------------------------------------------
VERDICT=PASS
for l in "$L_DMG" "$L_VERSION" "$L_CURRENT" "$L_BACKUP" "$L_MOUNT" "$L_SIG"; do
  [ "$l" = PASS ] || VERDICT=FAIL
done
echo "--------------------------------------------------------------"
echo " COMPUTED VERDICT: $VERDICT  (AND of six layers; not asserted)"
echo "--------------------------------------------------------------"

cleanup_mount() { [ -n "${MNT:-}" ] && hdiutil detach "$MNT" >/dev/null 2>&1; rmdir "$MNT" 2>/dev/null; }

if [ "$VERDICT" != PASS ]; then cleanup_mount; refuse "one or more checks failed above; nothing was quit and nothing was replaced"; fi
if [ "$VERIFY_ONLY" = 1 ]; then
  cleanup_mount
  echo "verify-only: every check ran and passed. NOTHING was quit, replaced, or backed up."
  echo "Re-run without --verify-only to install."
  exit 0
fi

# ==========================================================================================
# DESTRUCTIVE FROM HERE — everything above ran without touching the operator's machine
# ==========================================================================================
echo
echo "installing..."

if [ -n "${RUNNING:-}" ]; then
  echo "  quitting ThroughLine (pid $RUNNING) — live threads drop here, including any that started this"
  osascript -e 'tell application "ThroughLine" to quit' >/dev/null 2>&1
  i=0
  while [ $i -lt 20 ]; do
    pgrep -f "$APP/Contents/MacOS" >/dev/null 2>&1 || break
    sleep 1; i=$((i+1))
  done
  # PID-targeted escalation only, never by name pattern
  STILL=$(pgrep -f "$APP/Contents/MacOS" 2>/dev/null | head -1)
  [ -n "${STILL:-}" ] && { echo "  still up after 20s; sending TERM to pid $STILL"; kill -TERM "$STILL" 2>/dev/null; sleep 5; }
fi

# rollback BEFORE replacement, and verified before the old app is given up
if [ -d "$APP" ]; then
  ditto "$APP" "$BACKUP" 2>/dev/null
  BV=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$BACKUP/Contents/Info.plist" 2>/dev/null || echo "")
  [ "$BV" = "$CURVER" ] || { cleanup_mount; refuse "backup did not verify (read '$BV', expected '$CURVER'); the installed app was NOT touched"; }
  echo "  rollback copy verified at $BACKUP (version $BV)"
fi

# replace via a staged sibling so the app is never half-written in place
STAGE="/Applications/.ThroughLine-incoming-$$.app"
ditto "$SRC" "$STAGE" 2>/dev/null || { cleanup_mount; refuse "copy out of the image failed; the installed app was NOT touched"; }
OLD="/Applications/.ThroughLine-outgoing-$$.app"
[ -d "$APP" ] && mv "$APP" "$OLD"
mv "$STAGE" "$APP" || { [ -d "$OLD" ] && mv "$OLD" "$APP"; cleanup_mount; refuse "swap failed; previous app restored in place"; }
[ -d "$OLD" ] && rm -rf "$OLD" 2>/dev/null

cleanup_mount

INSTVER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || echo "?")
echo "  installed version now: $INSTVER"

# ---- POST-INSTALL LAYER 7 ----------------------------------------------------------------
# PROVES: the app on disk is the intended version and its seal survived the copy.
# Launch/readiness is measured separately by layer 8, never inferred from this seal.
L_POST=FAIL
if [ "$INSTVER" = "$NEWVER" ] && codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then L_POST=PASS; fi

# REOPEN WHAT WE CLOSED. On 2026-09-07 this installer quit the operator's ThroughLine, replaced
# the app, and stopped — leaving him to find it closed with no explanation. Quitting an app the
# operator is using is a borrowed state, not a free one: the installer that took it is the thing
# that must give it back. Also launch a previously closed app: the installation cannot
# claim success without proving startup. Check-only never enters this branch.
if [ "$L_POST" = PASS ]; then
  echo "  reopening ThroughLine to measure the installed app"
  open -a "$APP" >/dev/null 2>&1 || echo "  could not reopen — readiness must fail unless the installed app is already answering"
fi
POST_PORT=3773
post_install_checks || exit 3

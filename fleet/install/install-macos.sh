#!/usr/bin/env bash
# Install FleetView as an always-on, low-resource local service (macOS launchd).
# v2: runs node through a wrapper that resolves PATH at RUN time (nvm/homebrew safe),
# uses `launchctl bootstrap` (modern, with legacy fallback), never half-dies under set -e,
# and waits properly for first boot.
#
#   bash install-macos.sh            # always-on, dry-run scheduler every 15 min
#   bash install-macos.sh --live     # always-on, LIVE loops
#   bash install-macos.sh --interval 30 --live --hours 48
set -u

LIVE=""; INTERVAL="15"; HOURS=""
while [ $# -gt 0 ]; do case "$1" in
  --live) LIVE="--live";; --interval) INTERVAL="$2"; shift;; --hours) HOURS="$2"; shift;; *) ;;
esac; shift; done

RUNNER_DIR="$(cd "$(dirname "$0")/../runner" && pwd)"
LABEL="com.fleet.bridge"
OLD_LABEL="com.gideon.fleet"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

# Wrapper: resolve node + tool paths at run time, so nvm upgrades / Homebrew never break the
# service (v1 froze the node path into the plist).
WRAP="$RUNNER_DIR/run-bridge.sh"
cat > "$WRAP" <<'WRAPEOF'
#!/bin/bash
P="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$HOME/.local/bin"
for d in "$HOME/.nvm/versions/node"/*/bin; do [ -d "$d" ] && P="$P:$d"; done
export PATH="$P:$PATH"
NODE="$(command -v node)"
[ -z "$NODE" ] && { echo "node not found on PATH"; exit 1; }
cd "$(dirname "$0")"
exec "$NODE" bridge-server.mjs "$@"
WRAPEOF
chmod +x "$WRAP"
xattr -d com.apple.quarantine "$WRAP" 2>/dev/null || true

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$WRAP</string>
    <string>--watch</string>
    <string>--interval</string><string>$INTERVAL</string>
    $( [ -n "$LIVE" ] && echo "<string>--live</string>" )
    $( [ -n "$HOURS" ] && echo "<string>--hours</string><string>$HOURS</string>" )
  </array>
  <key>WorkingDirectory</key><string>$RUNNER_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ProcessType</key><string>Background</string>
  <key>Nice</key><integer>5</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/fleet.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/fleet.err.log</string>
</dict>
</plist>
PLIST

UID_N="$(id -u)"
# retire any old-label service, then (re)bootstrap — every step tolerant of "already loaded"
launchctl bootout "gui/$UID_N/$OLD_LABEL" 2>/dev/null || launchctl unload "$HOME/Library/LaunchAgents/$OLD_LABEL.plist" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$OLD_LABEL.plist" "$HOME/Library/LaunchAgents/$OLD_LABEL.plist.disabled" 2>/dev/null || true
launchctl bootout "gui/$UID_N/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$UID_N" "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null || true
launchctl kickstart -k "gui/$UID_N/$LABEL" 2>/dev/null || true

# health check: the bridge writes its real port to state/bridge.port (it falls forward if busy)
sleep 1
PORT_FILE="$RUNNER_DIR/../state/bridge.port"
ok=""
for i in $(seq 1 30); do
  PORT="$(cat "$PORT_FILE" 2>/dev/null || echo "${FLEET_PORT:-7777}")"
  if curl -fs "http://localhost:$PORT/api/state" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
PORT="$(cat "$PORT_FILE" 2>/dev/null || echo "${FLEET_PORT:-7777}")"
URL="http://localhost:$PORT"

if [ -n "$ok" ]; then
  echo "✓ FleetView is running (${LIVE:-dry-run} scheduler, every ${INTERVAL} min)."
else
  echo "⚠ Service installed but not answering after 30s."
  echo "  Likely cause on macOS: the install lives in ~/Downloads and the system blocks background"
  echo "  access to it. Easiest fix: move the install to ~/.fleet/app (then re-run this), or grant"
  echo "  access when macOS asks. Details: tail -20 \"$LOG_DIR/fleet.err.log\""
fi
echo "  Dashboard:  $URL   ← bookmark this"
echo "  Logs:       $LOG_DIR/fleet.log  +  fleet.err.log"
echo "  Health:     node \"$RUNNER_DIR/fleet.mjs\" doctor"
echo "  Stop:       bash \"$(cd "$(dirname "$0")" && pwd)/uninstall-macos.sh\""
command -v open >/dev/null && [ -n "$ok" ] && open "$URL" || true

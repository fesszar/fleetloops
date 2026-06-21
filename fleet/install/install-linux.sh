#!/usr/bin/env bash
# Install FleetView as an always-on user service on Linux (systemd --user).
#   bash install-linux.sh [--live] [--interval 15] [--hours 48]
set -u

LIVE=""; INTERVAL="15"; HOURS=""
while [ $# -gt 0 ]; do case "$1" in
  --live) LIVE="--live";; --interval) INTERVAL="$2"; shift;; --hours) HOURS="$2"; shift;; *) ;;
esac; shift; done

RUNNER_DIR="$(cd "$(dirname "$0")/../runner" && pwd)"
command -v systemctl >/dev/null 2>&1 || { echo "systemd not found — run manually: node \"$RUNNER_DIR/bridge-server.mjs\" --watch"; exit 1; }
NODE_BIN="$(command -v node || true)"
[ -z "$NODE_BIN" ] && { echo "Node.js 18+ not found."; exit 1; }

UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/fleet-bridge.service" <<UNIT
[Unit]
Description=FleetView bridge (dashboard + loop scheduler)
After=network.target

[Service]
WorkingDirectory=$RUNNER_DIR
ExecStart=$NODE_BIN $RUNNER_DIR/bridge-server.mjs --watch --interval $INTERVAL $LIVE ${HOURS:+--hours $HOURS}
Restart=on-failure
RestartSec=15
Nice=5

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now fleet-bridge.service
sleep 2
PORT="$(cat "$RUNNER_DIR/../state/bridge.port" 2>/dev/null || echo "${FLEET_PORT:-7777}")"
if curl -fs "http://localhost:$PORT/api/state" >/dev/null 2>&1; then
  echo "✓ FleetView running → http://localhost:$PORT"
else
  echo "⚠ Not answering yet — check: journalctl --user -u fleet-bridge -n 30"
fi
echo "  Stop: systemctl --user disable --now fleet-bridge.service"

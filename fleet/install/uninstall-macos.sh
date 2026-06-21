#!/usr/bin/env bash
# Stop and remove the FleetView always-on service (both v1 and v2 labels) + Desktop buttons.
set -u
UID_N="$(id -u)"
for LABEL in com.fleet.bridge com.gideon.fleet; do
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  launchctl bootout "gui/$UID_N/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST" "$PLIST.disabled"
done
for B in "Fleet.command" "Fleet Doctor.command" "Fleet Status.command" "First Win.command"; do
  rm -f "$HOME/Desktop/$B"
done
echo "✓ FleetView service stopped and removed (Desktop buttons cleaned up)."
echo "  Your install folder, config, state, and repos are untouched."

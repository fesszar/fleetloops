#!/usr/bin/env bash
# build-app.sh — assemble, sign, notarize and package Fleet.app.
#
# Run on a Mac with Xcode command-line tools. Produces build/Fleet.app and build/Fleet.dmg.
# The engine is zero-dependency (no node_modules to sign), so the bundle is just:
#   Fleet.app/Contents/MacOS/Fleet        ← the Swift menu-bar shell (universal2)
#   Fleet.app/Contents/Resources/app/     ← the engine (runner/, prompts/, web/, config/, skills/)
#   Fleet.app/Contents/Resources/app/node ← bundled universal2 Node
#
# Signing is INSIDE-OUT: nested binaries first (node), then the main executable, then the app.
#
# Required env for a SHIPPABLE (signed+notarized) build:
#   DEVELOPER_ID="Developer ID Application: Your Name (TEAMID)"
#   NOTARY_PROFILE="fleet-notary"   # a stored notarytool keychain profile
# Without them, the script still assembles an ad-hoc-signed .app you can run locally.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
FLEET_ROOT="$(cd "$HERE/../.." && pwd)"          # the fleet/ directory (holds runner/, prompts/, web/)
BUILD="$HERE/build"
APP="$BUILD/Fleet.app"
NODE_VERSION="${NODE_VERSION:-20.18.1}"          # pin the bundled runtime
DEVELOPER_ID="${DEVELOPER_ID:-}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"

echo "▸ Clean"
rm -rf "$BUILD"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app"

echo "▸ Build the Swift shell (universal2, release)"
swift build -c release --arch arm64 --arch x86_64 --package-path "$HERE"
cp "$HERE/.build/apple/Products/Release/Fleet" "$APP/Contents/MacOS/Fleet"

echo "▸ Info.plist + entitlements"
cp "$HERE/Resources/Info.plist" "$APP/Contents/Info.plist"

echo "▸ Stage the engine"
# Copy only what the engine needs at runtime. Tests and dev files are left out.
for d in runner prompts web config skills; do
  if [ -d "$FLEET_ROOT/$d" ]; then
    rsync -a --exclude 'test-*.mjs' --exclude 'node_modules' "$FLEET_ROOT/$d" "$APP/Contents/Resources/app/"
  fi
done
# The de-personalized default config (apps: []) ships so a stranger starts clean.
[ -f "$FLEET_ROOT/config/fleet.default.json" ] && cp "$FLEET_ROOT/config/fleet.default.json" "$APP/Contents/Resources/app/config/" || true

echo "▸ Bundle a universal2 Node ${NODE_VERSION}"
fetch_node () {  # $1 = arch (arm64|x64)
  local arch="$1" tarball="node-v${NODE_VERSION}-darwin-${arch}.tar.gz"
  local url="https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"
  curl -fsSL "$url" -o "$BUILD/$tarball"
  tar -xzf "$BUILD/$tarball" -C "$BUILD"
  echo "$BUILD/node-v${NODE_VERSION}-darwin-${arch}/bin/node"
}
NODE_ARM="$(fetch_node arm64)"
NODE_X64="$(fetch_node x64)"
lipo -create "$NODE_ARM" "$NODE_X64" -output "$APP/Contents/Resources/app/node"
chmod +x "$APP/Contents/Resources/app/node"
"$APP/Contents/Resources/app/node" --version >/dev/null && echo "  bundled node OK"

# ---- signing -------------------------------------------------------------------
if [ -n "$DEVELOPER_ID" ]; then
  echo "▸ Codesign (inside-out, hardened runtime)"
  SIGN=(codesign --force --options runtime --timestamp --sign "$DEVELOPER_ID")
  # 1) nested binaries first
  "${SIGN[@]}" "$APP/Contents/Resources/app/node"
  # 2) the main executable
  "${SIGN[@]}" "$APP/Contents/MacOS/Fleet"
  # 3) the app itself, with entitlements
  "${SIGN[@]}" --entitlements "$HERE/Resources/Fleet.entitlements" "$APP"
  codesign --verify --deep --strict --verbose=2 "$APP"
else
  echo "▸ Ad-hoc sign (local run only — no Developer ID set)"
  codesign --force --deep --sign - "$APP"
fi

# ---- notarize ------------------------------------------------------------------
if [ -n "$DEVELOPER_ID" ] && [ -n "$NOTARY_PROFILE" ]; then
  echo "▸ Notarize the app"
  ZIP="$BUILD/Fleet.zip"
  ditto -c -k --keepParent "$APP" "$ZIP"
  xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$APP"
fi

# ---- dmg -----------------------------------------------------------------------
echo "▸ Build dmg"
DMG="$BUILD/Fleet.dmg"
hdiutil create -volname "Fleet" -srcfolder "$APP" -ov -format UDZO "$DMG" >/dev/null
if [ -n "$DEVELOPER_ID" ]; then
  codesign --force --sign "$DEVELOPER_ID" "$DMG"
  if [ -n "$NOTARY_PROFILE" ]; then
    xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$DMG"
  fi
fi

echo "▸ Gatekeeper assessment"
spctl -a -t exec -vv "$APP" || echo "  (spctl will only pass once notarized with a Developer ID)"

echo "✓ Done → $APP"
[ -f "$DMG" ] && echo "✓ Installer → $DMG"

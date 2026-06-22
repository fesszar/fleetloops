# Production Release Notes

Fleet currently ships as a direct macOS DMG. The release artifact is produced at
`fleet/apps/macos/build/Fleet.dmg`.

## Build

```bash
bash fleet/web/build.sh

cd fleet/apps/macos
export DEVELOPER_ID="Developer ID Application: Your Name (TEAMID)"
export NOTARY_PROFILE="fleet-notary"
./build-app.sh
```

The build script signs nested runtime content, signs the app with hardened
runtime, notarizes and staples the app, builds the DMG, then notarizes and
staples the DMG.

## Verify

```bash
cd fleet/apps/macos
codesign --verify --deep --strict --verbose=2 build/Fleet.app
spctl -a -t exec -vv build/Fleet.app
stapler validate build/Fleet.app
stapler validate build/Fleet.dmg
hdiutil verify build/Fleet.dmg
```

The app should report Gatekeeper acceptance from a Notarized Developer ID
source, and both stapler validations should pass.

## Publish

Use GitHub Releases for the DMG binary and keep source control focused on
source, docs, tests, and build scripts. Do not commit generated app bundles,
DMGs, certificates, certificate signing requests, provisioning profiles,
notary credentials, Keychain exports, local state, screenshots, or handover
notes.

## Current Non-Blocking Follow-Ups

- Sparkle auto-update can be wired after a public appcast URL and EdDSA key are
  chosen.
- A final human click pass through the packaged WKWebView is useful before a
  broad launch, especially for destructive task actions and native folder
  picker flows.

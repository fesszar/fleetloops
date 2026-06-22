# Fleet for macOS — the native shell

This is the menu-bar app that wraps the zero-dependency Node engine (`fleet/runner`) into something a stranger can install. It adds only the OS chrome a browser can't provide; it reimplements none of the engine.

## What's here

```
apps/macos/
├── Package.swift                 SwiftPM executable, macOS 13+
├── Resources/
│   ├── Info.plist                LSUIElement (menu-bar agent), loopback ATS, Sparkle keys
│   └── Fleet.entitlements        hardened runtime (not App Sandbox — must spawn the user's CLIs)
├── Sources/Fleet/
│   ├── main.swift                entry point (.accessory = no Dock icon)
│   ├── AppDelegate.swift         the conductor — wires everything, no engine logic
│   ├── MenuBarController.swift   status glyph (green/amber+count/grey/red) + menu
│   ├── StatusPoller.swift        polls /api/state with the token → drives the glyph
│   ├── WebViewController.swift   WKWebView dashboard, off-origin nav blocked
│   ├── EngineProcess.swift       supervises bundled node, restart-with-backoff, reads port+token
│   ├── BridgeClient.swift        tiny authenticated POST helper (pause/resume from the menu)
│   ├── KeychainBridge.swift      API keys in the Keychain, injected as FLEET_KEY_* into the engine
│   ├── RepoAccess.swift          NSOpenPanel + security-scoped bookmarks (TCC), resumed at launch
│   ├── Notifications.swift       native banners on the rising edge of "needs you"
│   ├── LoginItem.swift           SMAppService start-at-login
│   └── Paths.swift               every on-disk location in one place
└── build-app.sh                  assemble + sign + notarize + dmg
```

## How it fits together

1. **Launch** → `AppDelegate` requests notification permission, resumes folder grants, registers the login item, then starts `EngineProcess`.
2. **EngineProcess** seeds the bundled engine to `~/.fleet/app/<version>`, spawns `node runner/bridge-server.mjs --watch --live` with `FLEET_STATE_DIR`, `FLEET_CONFIG`, a restored `PATH`, `FLEET_REQUIRE_SETUP_CONSENT=1`, and any `FLEET_KEY_<PROVIDER>` pulled from the Keychain. It then waits for the engine to write `bridge.port` + `bridge.token` into the state dir.
3. **On ready** → the dashboard `WKWebView` loads `http://127.0.0.1:<port>/` (the token is injected into the page server-side, so the web app authenticates automatically), and `StatusPoller` begins driving the menu-bar glyph.
4. **If the engine ever exits**, `EngineProcess` restarts it with exponential backoff — the fleet is meant to always be up.

State lives under `~/Library/Application Support/Fleet/` (state dir, config, engine log). Keys live only in the Keychain. Nothing sensitive is written to a config file.

## Build (on a Mac)

Dev run:

```bash
cd fleet/apps/macos
swift run        # runs the shell; it spawns a system `node` against ../../runner if no bundled node
```

Shippable, signed, notarized app + dmg:

```bash
export DEVELOPER_ID="Developer ID Application: Your Name (TEAMID)"
export NOTARY_PROFILE="fleet-notary"   # created once via: xcrun notarytool store-credentials
./build-app.sh
# → build/FleetLoops.app and build/FleetLoops.dmg
```

Without `DEVELOPER_ID` the script still assembles an ad-hoc-signed `FleetLoops.app` you can run locally (Gatekeeper will warn until it's notarized).

## Status

- **Dashboard is production-wired.** `fleet/web/` builds to a self-contained `app.js` (esbuild + tailwind via `web/build.sh`), and the bridge serves it with the token injected. The WKWebView loads the full dashboard — Overview, Approvals, Trust, **Providers & keys**, **Cost**, Settings, and the project cockpit — with no extra build step. Rebuild the bundle after editing `FleetView.jsx` with `bash fleet/web/build.sh`.
- **Providers/Keys/Cost screens are live** and call the engine's `/api/providers`, `/api/provider-key`, `/api/cost`, and `/api/setup-consent` endpoints. The native shell already grants folder access (`RepoAccess`) and can inject Keychain keys (`KeychainBridge`).
- **Add Project is native.** The dashboard calls into Swift, opens the macOS folder picker, then posts the selected repo to `POST /api/project` so newly added projects are persisted through the same config path as the CLI.
- **Direct distribution is supported.** `build-app.sh` produces `build/FleetLoops.app` and `build/FleetLoops.dmg`; the app and DMG have been signed, notarized, stapled, and accepted by Gatekeeper with a Developer ID identity.

## Remaining release operations

- **Sparkle auto-update**: `Info.plist` carries `SUFeedURL` + `SUPublicEDKey` placeholders; wiring the Sparkle framework + hosting the appcast needs a release URL and EdDSA key. Direct DMG distribution works without Sparkle.
- **Native WKWebView click pass**: browser automation covered the live dashboard, but a final human click pass through the packaged window is still useful before a broad launch.

## Why hardened runtime, not App Sandbox

Fleet must spawn the user's own coding agents (`codex`, `claude`) and run each project's real test command. App Sandbox forbids spawning arbitrary executables and reaching user files outside a container. So we ship the hardened runtime with the narrowest exceptions (`allow-jit`, `disable-library-validation` for the unsigned child CLIs, `network.client`, user-selected files) and confine file access to folders the user explicitly granted via security-scoped bookmarks.

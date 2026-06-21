// swift-tools-version:5.9
// Fleet for macOS — the native menu-bar shell around the zero-dependency Node engine.
//
// This is a thin AppKit executable: a status-bar item, a WKWebView window that loads the
// loopback dashboard, a supervisor that runs the bundled Node engine, plus the OS integration a
// browser can't do (folder access via security-scoped bookmarks, Keychain for API keys, login
// item, notifications). It reimplements NONE of the engine — that all lives in fleet/runner.
//
// Build during development:   swift build
// Assemble the shippable .app: ./build-app.sh   (bundles node + engine, signs, notarizes)
import PackageDescription

let package = Package(
    name: "Fleet",
    platforms: [.macOS(.v13)], // SMAppService (login item) + modern UNUserNotifications require 13+
    targets: [
        .executableTarget(
            name: "Fleet",
            path: "Sources/Fleet"
        )
    ]
)

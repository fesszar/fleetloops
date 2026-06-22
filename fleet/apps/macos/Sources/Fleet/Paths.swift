import Foundation

// Paths — every on-disk location the app uses, in one place.
//
// The engine runs from a SEEDED copy at ~/.fleet/app (not from inside the .app bundle): the
// bundle is read-only and code-signed, but the engine writes worktrees, logs and state, and on
// some macOS configurations spawning a node that lives inside a translocated/quarantined bundle
// is unreliable. So on launch we copy the bundled engine to ~/.fleet/app/<version> and run it
// from there. All mutable state lives under Application Support/FleetLoops.
enum Paths {
    static let fm = FileManager.default

    /// ~/Library/Application Support/FleetLoops
    static var appSupport: URL {
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("FleetLoops", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// ~/Library/Application Support/FleetLoops/state  (FLEET_STATE_DIR — bridge.port, bridge.token, *.json)
    static var stateDir: URL {
        let d = appSupport.appendingPathComponent("state", isDirectory: true)
        try? fm.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    /// ~/Library/Application Support/FleetLoops/fleet.config.json  (FLEET_CONFIG — the user's apps)
    static var configFile: URL {
        appSupport.appendingPathComponent("fleet.config.json")
    }

    /// ~/.fleetloops/app — where the engine is seeded so it can run read-write outside the bundle.
    static var seedRoot: URL {
        let home = fm.homeDirectoryForCurrentUser
        let d = home.appendingPathComponent(".fleetloops/app", isDirectory: true)
        try? fm.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    /// Old public-beta Fleet config. Read-only migration source; never opened silently.
    static var oldFleetConfigFile: URL {
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("Fleet", isDirectory: true).appendingPathComponent("fleet.config.json")
    }

    /// The engine sources bundled inside the app: FleetLoops.app/Contents/Resources/app
    static var bundledEngine: URL? {
        Bundle.main.url(forResource: "app", withExtension: nil)
    }

    /// Source checkout engine root used by `swift run`, which has no bundled resources.
    static var devEngineRoot: URL? {
        let src = URL(fileURLWithPath: #filePath)
        let root = src
            .deletingLastPathComponent() // Fleet
            .deletingLastPathComponent() // Sources
            .deletingLastPathComponent() // macos
            .deletingLastPathComponent() // apps
            .deletingLastPathComponent() // fleet
        let server = root.appendingPathComponent("runner/bridge-server.mjs")
        return fm.fileExists(atPath: server.path) ? root : nil
    }

    static var bridgePortFile: URL { stateDir.appendingPathComponent("bridge.port") }
    static var bridgeTokenFile: URL { stateDir.appendingPathComponent("bridge.token") }
}

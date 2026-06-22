import Foundation

// EngineProcess — supervises the bundled Node engine (bridge-server.mjs --watch).
//
// Responsibilities:
//   1. Seed the engine to ~/.fleetloops/app/<version> on first launch / version change.
//   2. Spawn `node bridge-server.mjs --watch` with the right env (state dir, config, PATH, the
//      stranger-safe FLEET_REQUIRE_SETUP_CONSENT flag, and any API keys pulled from the Keychain).
//   3. Restart it with exponential backoff if it ever exits (the engine should always be up).
//   4. Expose the bound port + token (read from the state dir once the engine writes them) so the
//      web view and status poller can talk to it.
final class EngineProcess {
    static let shared = EngineProcess()

    private var process: Process?
    private var restartDelay: TimeInterval = 1
    private let maxDelay: TimeInterval = 30
    private var intentionalStop = false

    private(set) var port: Int?
    private(set) var token: String?

    /// Called whenever we (re)connect and have a fresh port+token.
    var onReady: ((Int, String) -> Void)?

    // MARK: lifecycle

    func start() {
        intentionalStop = false
        do {
            let engineDir = try seedEngine()
            clearBridgeDiscoveryFiles()
            try launch(engineDir: engineDir)
            waitForBridge()
        } catch {
            NSLog("FleetLoops: engine start failed: \(error)")
            scheduleRestart()
        }
    }

    func stop() {
        intentionalStop = true
        process?.terminate()
        process = nil
    }

    func restart() {
        process?.terminate()
        process = nil
        start()
    }

    var isRunning: Bool { process?.isRunning ?? false }

    // MARK: seeding

    /// Copy the bundled engine to ~/.fleet/app/<shortVersion> if it isn't already there, and
    /// return that directory. Versioned so an app update lands a fresh engine without clobbering a
    /// running one.
    private func seedEngine() throws -> URL {
        guard let bundled = Paths.bundledEngine else {
            if let dev = Paths.devEngineRoot {
                NSLog("FleetLoops: using checkout engine at \(dev.path)")
                return dev
            }
            throw NSError(domain: "FleetLoops", code: 1, userInfo: [NSLocalizedDescriptionKey: "bundled engine not found in app"])
        }
        let version = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "dev"
        let dest = Paths.seedRoot.appendingPathComponent(version, isDirectory: true)
        let marker = dest.appendingPathComponent(".seeded")
        let signature = seedSignature(for: bundled, version: version)
        let existingSignature = (try? String(contentsOf: marker, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)) ?? ""
        if existingSignature != signature {
            try? Paths.fm.removeItem(at: dest)
            try Paths.fm.copyItem(at: bundled, to: dest)
            try? signature.data(using: .utf8)?.write(to: marker)
        }
        return dest
    }

    private func seedSignature(for bundled: URL, version: String) -> String {
        let bundleVersion = (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "0"
        let importantFiles = [
            "node",
            "runner/bridge-server.mjs",
            "runner/onboarding.mjs",
            "web/app.js",
            "web/app.css",
            "config/fleet.default.json"
        ]
        let facts = importantFiles.map { relative -> String in
            let url = bundled.appendingPathComponent(relative)
            guard let attrs = try? Paths.fm.attributesOfItem(atPath: url.path) else { return "\(relative):missing" }
            let size = attrs[.size] as? NSNumber
            let modified = attrs[.modificationDate] as? Date
            return "\(relative):\(size?.int64Value ?? 0):\(modified?.timeIntervalSince1970 ?? 0)"
        }
        return ([version, bundleVersion] + facts).joined(separator: "|")
    }

    // MARK: spawning

    private func launch(engineDir: URL) throws {
        let nodeBin = engineDir.appendingPathComponent("node")          // universal2 node we bundle
        let server  = engineDir.appendingPathComponent("runner/bridge-server.mjs")

        let p = Process()
        // Prefer the bundled node; fall back to a system node on PATH if (dev) it isn't bundled.
        if Paths.fm.isExecutableFile(atPath: nodeBin.path) {
            p.executableURL = nodeBin
            p.arguments = [server.path, "--watch", "--live"]
        } else {
            p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            p.arguments = ["node", server.path, "--watch", "--live"]
        }
        p.currentDirectoryURL = engineDir
        p.environment = engineEnvironment()

        // Tee engine stdout/stderr into a log file for diagnostics.
        let logURL = Paths.appSupport.appendingPathComponent("engine.log")
        if !Paths.fm.fileExists(atPath: logURL.path) { Paths.fm.createFile(atPath: logURL.path, contents: nil) }
        if let handle = try? FileHandle(forWritingTo: logURL) {
            handle.seekToEndOfFile()
            p.standardOutput = handle
            p.standardError = handle
        }

        p.terminationHandler = { [weak self] _ in
            guard let self = self, !self.intentionalStop else { return }
            NSLog("FleetLoops: engine exited — scheduling restart")
            self.scheduleRestart()
        }

        try p.run()
        process = p
        restartDelay = 1 // reset backoff after a clean start
    }

    private func clearBridgeDiscoveryFiles() {
        try? Paths.fm.removeItem(at: Paths.bridgePortFile)
        try? Paths.fm.removeItem(at: Paths.bridgeTokenFile)
    }

    /// Environment for the engine: state/config locations, a usable PATH for background launch,
    /// the stranger-safe setup-consent flag, and API keys injected from the Keychain as
    /// FLEET_KEY_<PROVIDER> (so keys never live in a config file — only in the process env).
    private func engineEnvironment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["FLEET_STATE_DIR"] = Paths.stateDir.path
        env["FLEET_CONFIG"] = Paths.configFile.path
        env["FLEET_OLD_CONFIG"] = Paths.oldFleetConfigFile.path
        env["FLEET_REQUIRE_SETUP_CONSENT"] = "1"  // productized default: setup.sh needs user approval

        // launchd/login gives a minimal PATH; restore the dirs where node/codex/claude/git live.
        let home = Paths.fm.homeDirectoryForCurrentUser.path
        var pathDirs = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/bin", "/bin", "\(home)/.local/bin"]
        if let existing = env["PATH"] { pathDirs.append(existing) }
        env["PATH"] = pathDirs.joined(separator: ":")

        for (providerId, key) in KeychainBridge.allProviderKeys() {
            env["FLEET_KEY_\(providerId.uppercased())"] = key
        }
        return env
    }

    // MARK: backoff restart

    private func scheduleRestart() {
        guard !intentionalStop else { return }
        let delay = restartDelay
        restartDelay = min(maxDelay, restartDelay * 2)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self, !self.intentionalStop else { return }
            self.start()
        }
    }

    // MARK: bridge discovery

    /// Poll the state dir for bridge.port + bridge.token, which the engine writes once it binds.
    private func waitForBridge(attempt: Int = 0) {
        if let port = readInt(Paths.bridgePortFile), let token = readString(Paths.bridgeTokenFile) {
            self.port = port
            self.token = token
            onReady?(port, token)
            return
        }
        guard attempt < 60 else { return } // ~30s
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.waitForBridge(attempt: attempt + 1)
        }
    }

    private func readInt(_ url: URL) -> Int? {
        guard let s = readString(url) else { return nil }
        return Int(s.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    private func readString(_ url: URL) -> String? {
        guard let d = try? Data(contentsOf: url), let s = String(data: d, encoding: .utf8) else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}

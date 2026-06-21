import AppKit

// AppDelegate — the conductor. Owns the menu bar, the engine supervisor, the status poller and the
// dashboard window, and wires them together. Holds NO engine logic.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let menuBar = MenuBarController()
    private let dashboard = WebViewController()
    private var bridge: BridgeClient?
    private var lastApprovals = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        seedDefaultConfigIfNeeded()

        Notifications.shared.onOpenDashboard = { [weak self] in self?.openDashboard() }
        Notifications.shared.requestAuthorization()
        RepoAccess.resumeAllGrants()
        LoginItem.enableOnFirstRunIfNeeded()

        wireMenu()

        EngineProcess.shared.onReady = { [weak self] port, token in
            guard let self = self else { return }
            self.bridge = BridgeClient(port: port, token: token)
            self.dashboard.load(port: port, token: token)
            StatusPoller.shared.configure(port: port, token: token)
            StatusPoller.shared.start()
        }
        StatusPoller.shared.onUpdate = { [weak self] status in self?.handleStatus(status) }

        EngineProcess.shared.start()

        // First launch with no projects yet → bring the dashboard up so onboarding can begin.
        if RepoAccess.grantedPaths.isEmpty {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.openDashboard() }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        EngineProcess.shared.stop()
    }

    // MARK: menu wiring

    private func wireMenu() {
        menuBar.onOpenDashboard = { [weak self] in self?.openDashboard() }
        menuBar.onAddProject = { [weak self] in self?.addProject() }
        menuBar.onOpenProviders = { [weak self] in self?.openDashboard() }
        menuBar.onTogglePause = { [weak self] in self?.togglePause() }
        menuBar.onQuit = { NSApp.terminate(nil) }
    }

    private func openDashboard() { dashboard.show() }

    private func addProject() {
        RepoAccess.promptForFolder { [weak self] url in
            guard url != nil else { return }
            // The web wizard takes it from here (detect stack, comprehension, autonomy).
            self?.openDashboard()
        }
    }

    private var isPaused = false
    private func togglePause() {
        guard let bridge = bridge else { return }
        let action = isPaused ? "resume" : "pause"
        bridge.post("/api/loop", body: ["slug": "*", "action": action]) { [weak self] ok in
            if ok { self?.isPaused.toggle() }
        }
    }

    // MARK: status → glyph + notifications

    private func handleStatus(_ status: FleetStatus) {
        menuBar.update(status)
        // Notify only on the RISING EDGE of "needs you" (don't nag every poll).
        if status.approvals > lastApprovals && status.reachable {
            let n = status.approvals
            Notifications.shared.post(title: "Fleet", body: n == 1 ? "1 item is ready for your review." : "\(n) items are ready for your review.")
        }
        lastApprovals = status.approvals
    }

    // MARK: seed a de-personalized default config on first run

    private func seedDefaultConfigIfNeeded() {
        guard !Paths.fm.fileExists(atPath: Paths.configFile.path) else { return }
        // Ship an empty fleet (no apps) so a stranger starts clean. The bundled engine includes a
        // config/fleet.default.json; copy it if present, else write a minimal one.
        if let def = Bundle.main.url(forResource: "app/config/fleet.default", withExtension: "json"),
           let data = try? Data(contentsOf: def) {
            try? data.write(to: Paths.configFile)
        } else {
            let minimal = """
            { "fleet": { "intervalMinutes": 5, "maxConcurrentLoops": 3, "defaultAutonomy": "merge-main" }, "apps": [] }
            """
            try? minimal.data(using: .utf8)?.write(to: Paths.configFile)
        }
    }
}

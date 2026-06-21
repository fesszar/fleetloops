import Foundation

// StatusPoller — periodically reads /api/state so the menu-bar glyph reflects what the fleet is
// doing without the dashboard window being open. Pure read; no side effects.
struct FleetStatus {
    var working: Int      // apps running right now
    var approvals: Int    // items needing the user
    var paused: Bool      // fleet-level pause flag set
    var reachable: Bool   // engine answered at all
}

final class StatusPoller {
    static let shared = StatusPoller()

    var onUpdate: ((FleetStatus) -> Void)?
    private var timer: Timer?
    private var port: Int?
    private var token: String?

    func configure(port: Int, token: String) {
        self.port = port
        self.token = token
        poll()
    }

    func start(interval: TimeInterval = 5) {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in self?.poll() }
        RunLoop.main.add(timer!, forMode: .common)
    }

    func stop() { timer?.invalidate(); timer = nil }

    private func poll() {
        guard let port = port, let token = token,
              let url = URL(string: "http://127.0.0.1:\(port)/api/state") else { return }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.timeoutInterval = 4
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let self = self else { return }
            guard let data = data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                DispatchQueue.main.async { self.onUpdate?(FleetStatus(working: 0, approvals: 0, paused: false, reachable: false)) }
                return
            }
            let apps = (obj["apps"] as? [[String: Any]]) ?? []
            let working = apps.filter { ($0["loop"] as? String) == "running" }.count
            let approvals = (obj["approvals"] as? [[String: Any]])?.count ?? 0
            let paused = obj["fleetPause"] != nil && !(obj["fleetPause"] is NSNull)
            let status = FleetStatus(working: working, approvals: approvals, paused: paused, reachable: true)
            DispatchQueue.main.async { self.onUpdate?(status) }
        }.resume()
    }
}

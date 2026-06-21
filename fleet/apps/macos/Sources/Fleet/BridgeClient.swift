import Foundation

// BridgeClient — minimal authenticated POST helper for the few actions the native menu performs
// directly (pause/resume). Everything richer happens in the dashboard web app.
struct BridgeClient {
    let port: Int
    let token: String

    func post(_ path: String, body: [String: Any], completion: ((Bool) -> Void)? = nil) {
        guard let url = URL(string: "http://127.0.0.1:\(port)\(path)") else { completion?(false); return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        req.timeoutInterval = 5
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            let ok = (resp as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
            DispatchQueue.main.async { completion?(ok) }
        }.resume()
    }
}

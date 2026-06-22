import Foundation

// BridgeClient — minimal authenticated POST helper for the few actions the native menu performs
// directly (pause/resume). Everything richer happens in the dashboard web app.
struct BridgeResponse {
    let ok: Bool
    let statusCode: Int
    let message: String?
}

struct BridgeClient {
    let port: Int
    let token: String

    func post(_ path: String, body: [String: Any], completion: ((Bool) -> Void)? = nil) {
        postResult(path, body: body) { result in completion?(result.ok) }
    }

    func postResult(_ path: String, body: [String: Any], completion: @escaping (BridgeResponse) -> Void) {
        guard let url = URL(string: "http://127.0.0.1:\(port)\(path)") else {
            completion(BridgeResponse(ok: false, statusCode: 0, message: "Invalid bridge URL."))
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        req.timeoutInterval = 5
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let ok = (200..<300).contains(status)
            var message: String?
            if let data,
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                message = (obj["error"] as? String) ?? (obj["note"] as? String)
            }
            DispatchQueue.main.async { completion(BridgeResponse(ok: ok, statusCode: status, message: message)) }
        }.resume()
    }
}

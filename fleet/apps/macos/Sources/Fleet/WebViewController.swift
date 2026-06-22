import AppKit
import WebKit

// WebViewController — the dashboard window. A WKWebView that loads the loopback dashboard the
// engine serves. The per-install token is injected into the page server-side (security.mjs
// injectToken), so this view doesn't handle auth at all — it just loads the URL.
//
// Off-origin navigation is blocked: the only thing that should ever load here is our own
// 127.0.0.1 dashboard. External links (provider key pages, docs) open in the user's real browser.
final class WebViewController: NSWindowController, WKNavigationDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private var origin: String = ""
    var onAddProject: (() -> Void)?

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        window.title = "FleetLoops"
        window.center()
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("FleetLoopsDashboard")
        self.init(window: window)

        let config = WKWebViewConfiguration()
        let userContent = WKUserContentController()
        userContent.add(self, name: "fleetAddProject")
        userContent.add(self, name: "fleetPickProject")
        userContent.add(self, name: "fleetPickDocuments")
        config.userContentController = userContent
        let wv = WKWebView(frame: window.contentView!.bounds, configuration: config)
        wv.autoresizingMask = [.width, .height]
        wv.navigationDelegate = self
        window.contentView?.addSubview(wv)
        self.webView = wv
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "fleetAddProject")
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "fleetPickProject")
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "fleetPickDocuments")
    }

    /// Load (or reload) the dashboard for the currently bound bridge.
    func load(port: Int, token: String) {
        origin = "http://127.0.0.1:\(port)"
        guard let url = URL(string: origin + "/") else { return }
        webView.load(URLRequest(url: url))
    }

    func show() {
        NSApp.activate(ignoringOtherApps: true)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
    }

    func reload() {
        webView.reload()
    }

    // MARK: WKScriptMessageHandler — native affordances requested by the dashboard.

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "fleetAddProject" {
            onAddProject?()
        } else if message.name == "fleetPickProject" {
            pickProjectFolder()
        } else if message.name == "fleetPickDocuments" {
            pickSourceDocuments()
        }
    }

    private func pickProjectFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose Project"
        panel.beginSheetModal(for: window!) { [weak self] response in
            guard response == .OK, let path = panel.url?.path else { return }
            self?.callJS("window.fleetNativeProjectPicked", argument: path)
        }
    }

    private func pickSourceDocuments() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = true
        panel.prompt = "Attach"
        panel.beginSheetModal(for: window!) { [weak self] response in
            guard response == .OK else { return }
            self?.callJS("window.fleetNativeDocumentsPicked", argument: panel.urls.map { $0.path })
        }
    }

    private func callJS(_ functionName: String, argument: Any) {
        guard JSONSerialization.isValidJSONObject([argument]),
              let data = try? JSONSerialization.data(withJSONObject: [argument]),
              let json = String(data: data, encoding: .utf8) else { return }
        let arg = String(json.dropFirst().dropLast())
        webView.evaluateJavaScript("if (\(functionName)) { \(functionName)(\(arg)); }", completionHandler: nil)
    }

    // MARK: WKNavigationDelegate — confine navigation to our loopback origin.

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.allow) }
        let s = url.absoluteString
        // Our own dashboard (and its assets) load in-window.
        if s.hasPrefix(origin) || url.scheme == "about" || url.scheme == "data" {
            return decisionHandler(.allow)
        }
        // Anything else (a provider's key page, docs, an http(s) link) opens in the real browser.
        if url.scheme == "http" || url.scheme == "https" {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }
}

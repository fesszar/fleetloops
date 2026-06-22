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
        window.title = "Fleet"
        window.center()
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("FleetDashboard")
        self.init(window: window)

        let config = WKWebViewConfiguration()
        let userContent = WKUserContentController()
        userContent.add(self, name: "fleetAddProject")
        config.userContentController = userContent
        let wv = WKWebView(frame: window.contentView!.bounds, configuration: config)
        wv.autoresizingMask = [.width, .height]
        wv.navigationDelegate = self
        window.contentView?.addSubview(wv)
        self.webView = wv
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "fleetAddProject")
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
        }
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

import AppKit

// MenuBarController — the always-present status item: a glyph that encodes fleet state at a
// glance, and a menu of quick actions. The glyph IS the product's ambient presence:
//   • emerald square        — working
//   • amber square + count  — N items need you
//   • grey square           — paused / idle
//   • red square            — engine unreachable
final class MenuBarController: NSObject, NSMenuDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private var lastStatus = FleetStatus(working: 0, approvals: 0, paused: false, reachable: false)

    var onOpenDashboard: (() -> Void)?
    var onAddProject: (() -> Void)?
    var onTogglePause: (() -> Void)?
    var onOpenProviders: (() -> Void)?
    var onRestartService: (() -> Void)?
    var onRestartOnboarding: (() -> Void)?
    var onQuit: (() -> Void)?

    override init() {
        super.init()
        if let button = statusItem.button {
            button.image = glyph(color: .systemGray, badge: nil)
            button.imagePosition = .imageLeft
        }
        menu.delegate = self
        statusItem.menu = menu
        rebuildMenu()
    }

    func update(_ status: FleetStatus) {
        lastStatus = status
        guard let button = statusItem.button else { return }
        if !status.reachable {
            button.image = glyph(color: .systemRed, badge: nil)
            button.title = ""
        } else if status.approvals > 0 {
            button.image = glyph(color: .systemOrange, badge: status.approvals)
            button.title = ""
        } else if status.paused {
            button.image = glyph(color: .systemGray, badge: nil)
        } else if status.working > 0 {
            button.image = glyph(color: .systemGreen, badge: nil)
        } else {
            button.image = glyph(color: .systemGray, badge: nil)
        }
        rebuildMenu()
    }

    // MARK: menu

    private func rebuildMenu() {
        menu.removeAllItems()

        let summary: String
        if !lastStatus.reachable { summary = "Engine not running" }
        else if lastStatus.approvals > 0 { summary = "\(lastStatus.working) working · \(lastStatus.approvals) need you" }
        else if lastStatus.paused { summary = "Paused" }
        else if lastStatus.working > 0 { summary = "\(lastStatus.working) project\(lastStatus.working == 1 ? "" : "s") working" }
        else { summary = "Idle — nothing needs you" }
        let header = NSMenuItem(title: summary, action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        menu.addItem(.separator())

        add("Open Dashboard", #selector(openDashboard), key: "o")
        add(lastStatus.paused ? "Resume FleetLoops" : "Pause FleetLoops", #selector(togglePause), key: "")
        menu.addItem(.separator())
        add("Add Project…", #selector(addProject), key: "n")
        add("Providers & Keys…", #selector(openProviders), key: "")
        add("Restart Fleet Service", #selector(restartService), key: "")
        add("Restart Onboarding…", #selector(restartOnboarding), key: "")
        menu.addItem(.separator())
        add("Quit FleetLoops", #selector(quit), key: "q")
    }

    private func add(_ title: String, _ sel: Selector, key: String) {
        let item = NSMenuItem(title: title, action: sel, keyEquivalent: key)
        item.target = self
        menu.addItem(item)
    }

    @objc private func openDashboard() { onOpenDashboard?() }
    @objc private func addProject() { onAddProject?() }
    @objc private func togglePause() { onTogglePause?() }
    @objc private func openProviders() { onOpenProviders?() }
    @objc private func restartService() { onRestartService?() }
    @objc private func restartOnboarding() { onRestartOnboarding?() }
    @objc private func quit() { onQuit?() }

    // MARK: glyph drawing

    /// A rounded square in the state color, with an optional small count badge.
    private func glyph(color: NSColor, badge: Int?) -> NSImage {
        let size = NSSize(width: badge != nil ? 22 : 16, height: 16)
        let image = NSImage(size: size)
        image.lockFocus()
        let rect = NSRect(x: 0, y: 2, width: 12, height: 12)
        let path = NSBezierPath(roundedRect: rect, xRadius: 3, yRadius: 3)
        color.setFill()
        path.fill()
        if let badge = badge {
            let text = "\(badge)" as NSString
            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 9, weight: .bold),
                .foregroundColor: NSColor.labelColor
            ]
            text.draw(at: NSPoint(x: 14, y: 3), withAttributes: attrs)
        }
        image.unlockFocus()
        image.isTemplate = false
        return image
    }
}

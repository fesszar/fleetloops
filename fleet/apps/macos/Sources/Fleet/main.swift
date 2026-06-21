import AppKit

// Entry point. A menu-bar-only agent: .accessory activation policy = no Dock icon, no app menu
// (the Info.plist LSUIElement does the same for the bundled app; this covers `swift run` in dev).
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

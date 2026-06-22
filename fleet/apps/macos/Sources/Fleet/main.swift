import AppKit
import Darwin

// Entry point. A menu-bar-only agent: .accessory activation policy = no Dock icon, no app menu
// (the Info.plist LSUIElement does the same for the bundled app; this covers `swift run` in dev).
let app = NSApplication.shared
let delegate = AppDelegate()
signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)
let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigint.setEventHandler { NSApp.terminate(nil) }
sigterm.setEventHandler { NSApp.terminate(nil) }
sigint.resume()
sigterm.resume()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

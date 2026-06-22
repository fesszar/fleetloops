import Foundation
import ServiceManagement

// LoginItem — start Fleet automatically at login so the fleet keeps working in the background
// across reboots. Uses SMAppService (macOS 13+); the user can toggle it from the dashboard's
// settings, and macOS exposes it under System Settings → General → Login Items.
enum LoginItem {
    private static var canRegister: Bool {
        Bundle.main.bundleURL.pathExtension == "app"
    }

    static var isEnabled: Bool {
        guard canRegister else { return false }
        return SMAppService.mainApp.status == .enabled
    }

    @discardableResult
    static func enable() -> Bool {
        guard canRegister else {
            NSLog("Fleet: login item disabled outside an app bundle")
            return false
        }
        do { try SMAppService.mainApp.register(); return true }
        catch { NSLog("Fleet: login item register failed: \(error)"); return false }
    }

    @discardableResult
    static func disable() -> Bool {
        guard canRegister else { return false }
        do { try SMAppService.mainApp.unregister(); return true }
        catch { NSLog("Fleet: login item unregister failed: \(error)"); return false }
    }

    /// Enable on first run unless the user already made a choice.
    static func enableOnFirstRunIfNeeded() {
        let key = "fleet.loginItemConfigured"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        enable()
    }
}

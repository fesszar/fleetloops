import Foundation
import UserNotifications

// Notifications — native banners for the moments that matter: work ready for review, the fleet
// pausing (e.g. an agent needs re-auth), and "all done for now". Replaces the engine's osascript
// notifier when running inside the app. Tapping a banner opens the dashboard.
final class Notifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifications()

    var onOpenDashboard: (() -> Void)?
    private let center: UNUserNotificationCenter?

    override init() {
        // SwiftPM runs the debug executable outside a real .app bundle. On current macOS builds,
        // UserNotifications asserts in that mode before the dashboard can open.
        if Bundle.main.bundleURL.pathExtension == "app" {
            center = UNUserNotificationCenter.current()
        } else {
            center = nil
            NSLog("Fleet: notifications disabled outside an app bundle")
        }
        super.init()
    }

    func requestAuthorization() {
        guard let center = center else { return }
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    func post(title: String, body: String, id: String = UUID().uuidString) {
        guard let center = center else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let req = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        center.add(req)
    }

    // Tapping a banner brings up the dashboard.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { self.onOpenDashboard?() }
        completionHandler()
    }

    // Show banners even when Fleet is frontmost.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}

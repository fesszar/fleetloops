import Foundation
import UserNotifications

// Notifications — native banners for the moments that matter: work ready for review, the fleet
// pausing (e.g. an agent needs re-auth), and "all done for now". Replaces the engine's osascript
// notifier when running inside the app. Tapping a banner opens the dashboard.
final class Notifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifications()

    var onOpenDashboard: (() -> Void)?
    private let center = UNUserNotificationCenter.current()

    func requestAuthorization() {
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    func post(title: String, body: String, id: String = UUID().uuidString) {
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

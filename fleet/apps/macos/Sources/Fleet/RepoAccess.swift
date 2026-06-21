import AppKit

// RepoAccess — granting and persisting access to the folders that hold the user's code.
//
// macOS TCC requires the user to explicitly pick folders; the grant is then persisted as a
// SECURITY-SCOPED BOOKMARK so access survives relaunch without re-prompting. Before the engine
// touches a project we must startAccessingSecurityScopedResource() on its bookmark, and stop when
// done. Bookmarks are stored in UserDefaults keyed by path.
enum RepoAccess {
    private static let defaultsKey = "fleet.repoBookmarks"

    /// Show the folder picker. On success, persist a security-scoped bookmark and return the URL.
    static func promptForFolder(completion: @escaping (URL?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Grant Access"
        panel.message = "Choose the folder that holds your projects. Fleet only touches projects you add."
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return completion(nil) }
            saveBookmark(for: url)
            completion(url)
        }
    }

    /// Run `body` with the folder's security scope active (and release it afterward).
    @discardableResult
    static func withAccess<T>(to url: URL, _ body: () throws -> T) rethrows -> T? {
        let started = url.startAccessingSecurityScopedResource()
        defer { if started { url.stopAccessingSecurityScopedResource() } }
        return try body()
    }

    /// Re-activate all saved bookmarks at launch so the engine can read granted folders. Stale
    /// bookmarks are refreshed; ones that can't resolve are dropped.
    static func resumeAllGrants() {
        var store = bookmarkStore()
        var changed = false
        for (path, data) in store {
            var stale = false
            guard let url = try? URL(resolvingBookmarkData: data, options: [.withSecurityScope],
                                     relativeTo: nil, bookmarkDataIsStale: &stale) else {
                store.removeValue(forKey: path); changed = true; continue
            }
            _ = url.startAccessingSecurityScopedResource() // held for the app's lifetime
            if stale { saveBookmark(for: url); changed = true }
        }
        if changed { UserDefaults.standard.set(store, forKey: defaultsKey) }
    }

    static var grantedPaths: [String] { Array(bookmarkStore().keys) }

    // MARK: storage

    private static func saveBookmark(for url: URL) {
        guard let data = try? url.bookmarkData(options: [.withSecurityScope],
                                               includingResourceValuesForKeys: nil, relativeTo: nil) else { return }
        var store = bookmarkStore()
        store[url.path] = data
        UserDefaults.standard.set(store, forKey: defaultsKey)
    }

    private static func bookmarkStore() -> [String: Data] {
        (UserDefaults.standard.dictionary(forKey: defaultsKey) as? [String: Data]) ?? [:]
    }
}

import Foundation
import Security

// KeychainBridge — API keys live in the macOS Keychain, never in a config or state file.
//
// The engine never receives a key from disk; the Swift app reads keys here and injects them into
// the engine's process env as FLEET_KEY_<PROVIDER> (see EngineProcess.engineEnvironment). The
// engine's secrets.mjs reads exactly those vars. This keeps the "no key on disk" guarantee whole:
// keys exist only in the Keychain and transiently in the engine's environment.
enum KeychainBridge {
    /// Providers that authenticate with an API key (must match providers/registry.mjs).
    static let apiKeyProviders = ["openai", "anthropic", "deepseek", "gemini", "openrouter"]

    private static let service = "com.fleetloops.app.providerkey"

    static func setKey(_ key: String, for providerId: String) {
        let account = providerId.lowercased()
        // delete any existing item, then add fresh (simplest correct upsert)
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(base as CFDictionary)
        guard !key.isEmpty, let data = key.data(using: .utf8) else { return }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func key(for providerId: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: providerId.lowercased(),
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data, let s = String(data: data, encoding: .utf8) else { return nil }
        return s
    }

    static func removeKey(for providerId: String) {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: providerId.lowercased()
        ]
        SecItemDelete(q as CFDictionary)
    }

    /// All configured provider keys, for injecting into the engine env. Empty if none set yet.
    static func allProviderKeys() -> [(String, String)] {
        var out: [(String, String)] = []
        for id in apiKeyProviders {
            if let k = key(for: id), !k.isEmpty { out.append((id, k)) }
        }
        return out
    }
}

// secrets.mjs — API keys for raw-API providers, resolved WITHOUT ever writing them to config
// or state. Resolution order (first hit wins):
//   1. FLEET_KEY_<PROVIDER>           — explicit per-provider env (the Swift app injects these
//                                       into the engine's spawn env after reading the Keychain).
//   2. provider's standard env var    — OPENAI_API_KEY, ANTHROPIC_API_KEY, … (descriptor.envKey).
//   3. macOS Keychain                 — `security find-generic-password -s <service> -w`
//                                       (descriptor.keychainService), for CLI/dev use.
// none-local providers (Ollama/LM Studio) need no key → returns "".
//
// There is deliberately NO setApiKey-to-disk path here. Writing a key into fleet.config.json or
// state.json is structurally impossible because nothing in the engine ever serializes a key.

import { spawnSync } from "node:child_process";
import { platform } from "node:os";

// One Keychain service for all provider keys, keyed by provider id as the account. Must match the
// Swift app's KeychainBridge (service "com.fleet.app.providerkey", account = provider id) so a key
// saved by either side is readable by both.
const KEYCHAIN_SERVICE = "com.fleet.app.providerkey";

function keychainGet(account) {
  if (platform() !== "darwin") return "";
  try {
    const r = spawnSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout) return r.stdout.trim();
  } catch {}
  return "";
}
function keychainSet(account, value) {
  if (platform() !== "darwin") return false;
  try {
    // -U updates an existing item in place. (The value is passed via argv — acceptable on a
    // single-user Mac; the native Swift path uses SecItemAdd which avoids even that.)
    const r = spawnSync("security", ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", account, "-w", value], { encoding: "utf8" });
    return r.status === 0;
  } catch { return false; }
}
function keychainDelete(account) {
  if (platform() !== "darwin") return false;
  try {
    const r = spawnSync("security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account], { encoding: "utf8" });
    return r.status === 0;
  } catch { return false; }
}

export function getApiKey(provider, { env = process.env } = {}) {
  if (!provider || provider.auth === "none-local") return "";
  const id = (provider.id || "").toUpperCase();
  // 1) FLEET_KEY_<ID> — the Swift app's fast-path injection (and what tests use).
  if (env[`FLEET_KEY_${id}`]) return String(env[`FLEET_KEY_${id}`]).trim();
  // 2) the provider's own standard env var (OPENAI_API_KEY, …) for CLI/dev use.
  if (provider.envKey && env[provider.envKey]) return String(env[provider.envKey]).trim();
  // 3) the Keychain (so a key saved in the UI while the engine runs is picked up next task —
  //    no restart needed, since this is read at call time).
  return keychainGet(provider.id) || "";
}

// Persist / remove a provider key in the Keychain (macOS). Returns true on success.
export function setApiKey(provider, key) {
  if (!provider || !provider.id) return false;
  if (!key) return keychainDelete(provider.id);
  return keychainSet(provider.id, String(key).trim());
}
export function deleteApiKey(provider) {
  if (!provider || !provider.id) return false;
  return keychainDelete(provider.id);
}

export function hasApiKey(provider, opts) {
  if (!provider) return false;
  if (provider.auth === "none-local") return true; // local endpoint, nothing to hold
  return !!getApiKey(provider, opts);
}

// Build a redactor that masks every known key value (and any long token-shaped string it was
// seeded with) so a key can NEVER appear in a log, state.log, or report.raw. Called on ALL
// harness stdout/log output before it leaves this process.
export function makeRedactor(secrets = []) {
  const vals = [...new Set(secrets.filter((s) => s && String(s).length >= 8))].sort((a, b) => b.length - a.length);
  return function redact(s) {
    let out = String(s == null ? "" : s);
    for (const v of vals) out = out.split(v).join("«redacted»");
    // belt-and-braces: also mask anything shaped like a provider key, even if not in `vals`
    out = out.replace(/\b(sk-[A-Za-z0-9_\-]{16,}|sk-ant-[A-Za-z0-9_\-]{16,})\b/g, "«redacted»");
    return out;
  };
}

// providers/validate.mjs — provider connection status for the Providers screen, and a cheap
// "does this key work?" check for the moment the user pastes one.
//
// Agentic CLIs are connected only when the binary is installed, authentication is verified, and
// the account looks usable. Raw API providers are connected when a key is present (env or
// Keychain). Local providers are selectable without a key.

import { PROVIDERS, getProvider } from "./registry.mjs";
import { getApiKey, hasApiKey } from "../secrets.mjs";
import { checkCliProvider } from "../provider-cli.mjs";
import * as openaiCodec from "./codec-openai.mjs";
import * as anthropicCodec from "./codec-anthropic.mjs";

// One status row per provider for the UI.
export function listProviderStatus() {
  return Object.values(PROVIDERS).map((p) => {
    let connected = false, detail = "", installed = false, authenticated = false, usable = false, command = "", path = "", version = "", cli = p.cli || "";
    if (p.kind === "agentic-cli") {
      const status = checkCliProvider(p.id, { auth: false });
      installed = !!status.installed;
      authenticated = !!status.authenticated;
      usable = !!status.usable;
      connected = !!status.connected;
      detail = status.detail || (installed ? "Refresh to check sign-in" : `install the ${p.cli} CLI`);
      command = status.command || `${p.cli} login`;
      cli = status.cli || p.cli || "";
      path = status.path || "";
      version = status.version || "";
    } else if (p.auth === "none-local") {
      connected = true; usable = true; detail = "local endpoint";
    } else {
      connected = hasApiKey(p);
      usable = connected;
      detail = connected ? "key saved" : "add a key";
    }
    return {
      id: p.id, label: p.label, kind: p.kind, auth: p.auth,
      models: p.models || [], defaultModel: p.defaultModel || "",
      keysUrl: p.keysUrl || "", blurb: p.blurb || "",
      connected, installed, authenticated, usable, command, path, version, cli, detail,
    };
  });
}

// Live check that a pasted key authenticates, by hitting the provider's models endpoint. Returns
// { ok, count?, models?, error? }. Used by the "Save & verify" button.
export async function validateApiKey(providerId, key, { fetchImpl = globalThis.fetch } = {}) {
  const p = getProvider(providerId);
  if (!p || p.kind !== "api") return { ok: false, error: "not an API provider" };
  if (p.auth === "api-key" && !key) return { ok: false, error: "no key provided" };
  const base = String(p.baseUrl).replace(/\/$/, "");
  const url = `${base}/models`;
  const headers = p.dialect === "anthropic" ? anthropicCodec.headers(key) : openaiCodec.headers(key);
  try {
    const res = await fetchImpl(url, { method: "GET", headers });
    if (res.status === 401 || res.status === 403) return { ok: false, error: `${p.label} rejected the key (invalid or expired).` };
    if (!res.ok) return { ok: false, error: `${p.label} returned HTTP ${res.status}.` };
    let json = null; try { json = await res.json(); } catch {}
    const arr = (json && (json.data || json.models)) || [];
    const models = Array.isArray(arr) ? arr.map((m) => m.id || m.name).filter(Boolean) : [];
    return { ok: true, count: models.length, models: models.slice(0, 50) };
  } catch (e) {
    return { ok: false, error: `Couldn't reach ${p.label}: ${String((e && e.message) || e)}` };
  }
}

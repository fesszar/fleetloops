// providers/validate.mjs — provider connection status for the Providers screen, and a cheap
// "does this key work?" check for the moment the user pastes one.
//
// Status is intentionally cheap (no network for the list): an agentic CLI is "connected" when its
// binary is on PATH; an api provider is "connected" when a key is present (env or Keychain); a
// local provider is assumed reachable. The live key check (validateApiKey) is only run on demand.

import { spawnSync } from "node:child_process";
import { PROVIDERS, getProvider } from "./registry.mjs";
import { getApiKey, hasApiKey } from "../secrets.mjs";
import * as openaiCodec from "./codec-openai.mjs";
import * as anthropicCodec from "./codec-anthropic.mjs";

function cliInstalled(bin) {
  try { return spawnSync("bash", ["-lc", `command -v ${bin}`], { encoding: "utf8" }).status === 0; }
  catch { return false; }
}

// One status row per provider for the UI.
export function listProviderStatus() {
  return Object.values(PROVIDERS).map((p) => {
    let connected = false, detail = "";
    if (p.kind === "agentic-cli") {
      connected = cliInstalled(p.cli);
      detail = connected ? "signed in via CLI" : `install the ${p.cli} CLI`;
    } else if (p.auth === "none-local") {
      connected = true; detail = "local endpoint";
    } else {
      connected = hasApiKey(p);
      detail = connected ? "key saved" : "add a key";
    }
    return {
      id: p.id, label: p.label, kind: p.kind, auth: p.auth,
      models: p.models || [], defaultModel: p.defaultModel || "",
      keysUrl: p.keysUrl || "", blurb: p.blurb || "",
      connected, detail,
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

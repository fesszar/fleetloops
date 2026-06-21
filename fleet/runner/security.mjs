// security.mjs — the trust boundary for the local bridge. Kept separate from bridge-server.mjs
// (which self-starts an HTTP listener on import) so this logic is unit-testable in isolation.
//
// Threat model for a localhost service that a stranger installs:
//   1. Other processes / other users on the same machine hitting 127.0.0.1   → per-install TOKEN.
//   2. A malicious web page in the user's browser POSTing to localhost (CSRF /
//      DNS-rebind): it can FIRE requests but, being a different origin, CANNOT read our page to
//      learn the token, and its Origin header won't be in the allowlist                → TOKEN + ORIGIN.
//   3. The local network reaching the port                                   → LOOPBACK bind (server side).
// This module owns 1 and 2; bridge-server binds 127.0.0.1 for 3.
//
// The same-origin dashboard gets the token injected into its HTML (injectToken) and auto-attaches
// it to every /api/ fetch, so the UI keeps working with zero changes to the React code.

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, chmodSync, renameSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";

// --- per-install token --------------------------------------------------------
export function ensureToken(stateDir) {
  const f = join(stateDir, "bridge.token");
  if (existsSync(f)) { try { const t = readFileSync(f, "utf8").trim(); if (t) return t; } catch {} }
  const tok = randomBytes(32).toString("hex");
  try { writeFileSync(f, tok, { mode: 0o600 }); chmodSync(f, 0o600); } catch {}
  return tok;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  try { return timingSafeEqual(ab, bb); } catch { return false; }
}

export function allowedOrigins(port) {
  const out = [];
  for (const h of ["localhost", "127.0.0.1", "[::1]"]) out.push(`http://${h}:${port}`);
  return out;
}

// Pull a presented token from Authorization: Bearer, the x-fleet-token header, or a ?token= query
// (the last only as a convenience for opening a stream URL directly).
function presentedToken(req) {
  const auth = req.headers["authorization"] || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  if (req.headers["x-fleet-token"]) return String(req.headers["x-fleet-token"]).trim();
  try { return new URL(req.url, "http://x").searchParams.get("token") || ""; } catch { return ""; }
}

// The single gate every /api/* request passes through. Returns { ok } or { ok:false, code, reason }.
export function checkAuth(req, { token, port }) {
  if (req.method === "OPTIONS") return { ok: true };           // CORS preflight carries no auth
  if (!token) return { ok: true };                              // token disabled (degraded mode)
  if (!safeEqual(presentedToken(req), token)) return { ok: false, code: 401, reason: "missing or invalid token" };
  // CSRF: a state-changing request that carries a browser Origin must be one of ours. Native
  // callers (the Swift app, curl, the scheduler) send no Origin and pass on the token alone.
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers["origin"];
    if (origin && !allowedOrigins(port).includes(origin)) return { ok: false, code: 403, reason: "cross-origin request blocked" };
  }
  return { ok: true };
}

// Give the same-origin dashboard the token and transparently attach it to /api/ fetches.
export function injectToken(html, token) {
  const snippet = `<script>window.__FLEET_TOKEN__=${JSON.stringify(token)};(function(){var f=window.fetch;if(!f)return;window.fetch=function(u,o){o=o||{};var s=typeof u==="string"?u:(u&&u.url)||"";if(s.indexOf("/api/")>=0){var h=Object.assign({},o.headers||{});h["Authorization"]="Bearer "+window.__FLEET_TOKEN__;o.headers=h;}return f.call(this,u,o);};})();</script>`;
  const s = String(html);
  if (s.includes("</head>")) return s.replace("</head>", snippet + "</head>");
  if (s.includes("<body>")) return s.replace("<body>", "<body>" + snippet);
  return snippet + s;
}

// --- setup-script consent -----------------------------------------------------
// A repo's .fleet/setup.sh is ARBITRARY CODE that runs outside the sandbox with the user's env.
// For the owner's own machine that's fine; for a stranger pointing Fleet at a cloned repo it is
// not. When FLEET_REQUIRE_SETUP_CONSENT is set (the productized default), a setup script runs
// only after the user has approved its exact contents (by sha256). Approval is invalidated
// automatically if the script later changes. Unset (the owner's current install) = run as before.
export function setupConsentRequired() {
  return !!process.env.FLEET_REQUIRE_SETUP_CONSENT && process.env.FLEET_REQUIRE_SETUP_CONSENT !== "0";
}
function consentFile(stateDir) { return join(stateDir, "setup-consent.json"); }
function readConsent(stateDir) { try { return JSON.parse(readFileSync(consentFile(stateDir), "utf8")); } catch { return { approved: {}, pending: {} }; } }
function writeConsent(stateDir, obj) {
  const tmp = consentFile(stateDir) + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj, null, 2)); renameSync(tmp, consentFile(stateDir));
}
export function hashScript(path) { try { return createHash("sha256").update(readFileSync(path)).digest("hex"); } catch { return ""; } }

// Decide whether a repo's setup.sh may run now. Records a pending-approval entry when it may not.
export function setupApproved(stateDir, repoPath, scriptPath) {
  if (!setupConsentRequired()) return true;          // owner mode: unchanged behavior
  const hash = hashScript(scriptPath);
  if (!hash) return false;
  const c = readConsent(stateDir);
  if (c.approved[repoPath] === hash) return true;     // approved AND unchanged since
  c.pending[repoPath] = { hash, at: new Date().toISOString() };
  try { writeConsent(stateDir, c); } catch {}
  return false;
}
export function approveSetup(stateDir, repoPath) {
  const c = readConsent(stateDir);
  const p = c.pending[repoPath];
  if (!p) return { ok: false, reason: "nothing pending for this repo" };
  c.approved[repoPath] = p.hash; delete c.pending[repoPath];
  writeConsent(stateDir, c);
  return { ok: true };
}
export function pendingSetups(stateDir) {
  const c = readConsent(stateDir);
  return Object.entries(c.pending || {}).map(([repo, v]) => ({ repo, hash: v.hash, at: v.at }));
}

// Stable-ish machine identity for the run lock, so a lock file that travels between machines
// (e.g. a cloud-synced state dir) isn't mistaken for "held by a live local PID".
export function machineId() {
  return `${hostname()}:${process.platform}`;
}

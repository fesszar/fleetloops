// util.mjs — shared infrastructure for the fleet engine.
// Atomic state IO, crash-safe JSON, async command execution with real timeouts
// (process-group kill so grandchildren die too), home expansion, notifications.

import { writeFileSync, readFileSync, existsSync, renameSync, copyFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { homedir, platform } from "node:os";
import { setupApproved, machineId } from "./security.mjs";

// State dir resolution mirrors loop.mjs (FLEET_STATE_DIR wins) without importing it (util.mjs is
// a leaf dependency). Used by the setup-consent gate to find the consent ledger.
function stateDirGuess() {
  return process.env.FLEET_STATE_DIR || join(homedir(), ".fleet", "state");
}

// --- paths ----------------------------------------------------------------
// Expand a LEADING ~ only (never a ~ in the middle of a path).
export function expandHome(p) {
  const s = p || "";
  if (s === "~") return homedir();
  if (s.startsWith("~/")) return join(homedir(), s.slice(2));
  return s;
}

// --- atomic JSON state ----------------------------------------------------
// Write temp + rename so a crash mid-write can never leave a half-written file.
// Keep a rolling .bak of the last good version for recovery.
export function writeJsonAtomic(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  try { if (existsSync(file)) copyFileSync(file, file + ".bak"); } catch {}
  renameSync(tmp, file);
}

// Read JSON; on a corrupt file fall back to the .bak, and if that's also bad
// return null (caller reseeds) instead of throwing and killing the whole service.
export function readJsonSafe(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch {}
  try {
    const v = JSON.parse(readFileSync(file + ".bak", "utf8"));
    try { writeJsonAtomic(file, v); } catch {}
    return v;
  } catch {}
  return null;
}

// Cap an in-state log array so multi-day runs can't grow state without bound.
export const LOG_CAP = 400;
export function pushLog(state, line) {
  state.log = state.log || [];
  state.log.push(line);
  if (state.log.length > LOG_CAP) state.log = state.log.slice(-LOG_CAP);
}

// --- test-environment provisioning (the root fix for "provide me an environment") ----------
// The agent persists how to make this repo testable into two files IN THE REPO:
//   .fleet/setup.sh — idempotent: install deps, start local services, seed a throwaway test
//                     user. Run ONCE per process per repo, before gates. Network is allowed.
//   .fleet/env.sh   — exports SAFE LOCAL test env vars (NODE_ENV=test, a local sqlite
//                     DATABASE_URL, etc.) — never real secrets. Sourced into every gate/probe.
// The engine just runs + sources them, so "set up a test environment" stops being a human ask.
const _setupDone = new Set();
export async function ensureRepoSetup(repoPath) {
  if (!repoPath || _setupDone.has(repoPath)) return;
  const setup = join(repoPath, ".fleet", "setup.sh");
  if (!existsSync(setup)) { _setupDone.add(repoPath); return; }
  // CONSENT GATE: setup.sh is arbitrary code that runs with the user's env, outside the sandbox.
  // In owner mode (default) it runs as before. When FLEET_REQUIRE_SETUP_CONSENT is set (the
  // productized default for strangers), it runs only after the user approved its exact contents.
  // Do NOT mark done when we skip for consent — so it can run on the next pass once approved.
  if (!setupApproved(stateDirGuess(), repoPath, setup)) return;
  _setupDone.add(repoPath); // mark first so a failing setup doesn't loop every gate
  try { await execAsync(`bash "${setup}"`, { cwd: repoPath, timeoutMs: 10 * 60 * 1000 }); } catch {}
}
// Wrap a gate/probe command so it sources the repo's .fleet/env.sh first (if present).
export function withRepoEnv(repoPath, cmd) {
  const envf = repoPath ? join(repoPath, ".fleet", "env.sh") : "";
  if (envf && existsSync(envf)) return `set -a; . "${envf}"; set +a; ${cmd}`;
  return cmd;
}

// --- async command execution ----------------------------------------------
// Run a shell command asynchronously with a REAL timeout: the child is started in
// its own process group and the WHOLE group is killed on timeout, so a hung test
// runner / dev server can't outlive the gate. Never blocks the event loop.
export function execAsync(cmd, { cwd, timeoutMs = 0, onData, env } = {}) {
  return new Promise((resolve) => {
    let out = "", settled = false, timer = null, timedOut = false;
    const child = spawn("bash", ["-lc", cmd], {
      cwd, detached: process.platform !== "win32",
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const killGroup = (sig) => {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, sig); else child.kill(sig); } catch {}
    };
    const done = (extra) => {
      if (settled) return; settled = true;
      if (timer) clearTimeout(timer);
      resolve({ out, timedOut, ...extra });
    };
    const tee = (d) => { out += d; if (onData) { try { onData(d); } catch {} } };
    child.stdout.on("data", tee);
    child.stderr.on("data", tee);
    child.on("error", (e) => done({ status: -1, error: String(e && e.message || e) }));
    child.on("close", (code) => done({ status: code == null ? -1 : code }));
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killGroup("SIGTERM");
        setTimeout(() => killGroup("SIGKILL"), 5000).unref?.();
      }, timeoutMs);
    }
  });
}

// --- failure classification -------------------------------------------------
// Tell an auth/credentials failure apart from ordinary bad output, so an expired
// Codex login pauses the fleet with ONE clear message instead of burning every
// app's retries into 9 piles of escalations.
// Tight on purpose: a working agent's transcript legitimately contains phrases like
// "rate-limiting" while discussing the app's own code (this caused a false fleet-pause on the
// first live pass). Real CLI auth errors are SPECIFIC and appear at the END of the output, so
// we only scan the tail and only for unambiguous credential/quota failures.
const AUTH_RE = /(401 unauthorized|http 401|error 401|not logged in|login required|token (?:is )?expired|invalid[_ ]token|authentication failed|please run.{0,30}login|usage limit reached|exceeded your usage|quota exceeded|too many requests)/i;
export function classifyAgentFailure(raw) {
  const tail = String(raw || "").slice(-2500);
  if (AUTH_RE.test(tail)) return "auth";
  return "output";
}

// --- notifications -----------------------------------------------------------
// Best-effort, never throws. Desktop notification on macOS/Linux, plus an
// append-only notifications log next to the state dir so nothing is ever lost
// silently (replaces escalationChannel:"console").
export function notify(stateDir, title, message, { fleet } = {}) {
  const line = `[${new Date().toISOString()}] ${title}: ${message}`;
  try { appendFileSync(join(stateDir, "notifications.log"), line + "\n"); } catch {}
  const cfg = (fleet && fleet.notifications) || {};
  if (cfg.desktop === false) return;
  const esc = (s) => String(s || "").replace(/["\\]/g, " ").slice(0, 200);
  try {
    if (platform() === "darwin") {
      execAsync(`osascript -e 'display notification "${esc(message)}" with title "Fleet: ${esc(title)}" sound name "Glass"'`, { timeoutMs: 5000 });
    } else if (platform() === "linux") {
      execAsync(`command -v notify-send >/dev/null && notify-send "Fleet: ${esc(title)}" "${esc(message)}" || true`, { timeoutMs: 5000 });
    }
  } catch {}
  if (cfg.webhook) {
    try {
      fetch(cfg.webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, message, at: new Date().toISOString() }) }).catch(() => {});
    } catch {}
  }
}

// --- cross-PROCESS run lock ---------------------------------------------------
// The scheduler (service) and manual `fleet.mjs run` are different processes; the in-process
// queue can't serialize them. A lock file in the state dir does: whoever holds it runs, the
// other skips politely. Stale locks (crashed holder) expire after 2h.
const LOCK_TTL_MS = 2 * 3600 * 1000;
// Is the lock-holding process actually alive? (signal 0 = existence check). A service restart
// KILLS the old process mid-pass; without this check its leftover lock silently froze every
// tick for up to 2h — observed live. Dead holder ⇒ take the lock immediately.
function pidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === "EPERM"; }
}
export function acquireRunLock(stateDir, who = "fleet") {
  const f = join(stateDir, "fleet.lock");
  const me = machineId();
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(f, JSON.stringify({ pid: process.pid, who, machine: me, at: new Date().toISOString() }), { flag: "wx" });
    return { ok: true, file: f };
  } catch {
    const cur = readJsonSafe(f);
    const age = cur && cur.at ? Date.now() - Date.parse(cur.at) : Infinity;
    // A PID is only meaningful on the machine that wrote it. If the lock came from a DIFFERENT
    // machine (e.g. a cloud-synced state dir), pidAlive() here is meaningless — a coincidental
    // local PID match could otherwise look "alive" forever. Treat a foreign holder as not-alive.
    const foreignMachine = cur && cur.machine && cur.machine !== me;
    const holderDead = !cur || foreignMachine || !pidAlive(cur.pid) || cur.pid === process.pid;
    if (holderDead || age > LOCK_TTL_MS) {
      try { writeFileSync(f, JSON.stringify({ pid: process.pid, who, machine: me, at: new Date().toISOString() })); return { ok: true, file: f, tookStale: true, previous: cur || null }; } catch {}
    }
    return { ok: false, holder: cur || {} };
  }
}
export function releaseRunLock(stateDir) {
  try { renameSync(join(stateDir, "fleet.lock"), join(stateDir, "fleet.lock.released")); } catch {}
}

// --- fleet-level pause flag (e.g. agent auth expired) ------------------------
export function pauseFlagFile(stateDir) { return join(stateDir, "fleet.paused.json"); }
export function setFleetPause(stateDir, reason) {
  try { writeJsonAtomic(pauseFlagFile(stateDir), { reason, at: new Date().toISOString() }); } catch {}
}
export function getFleetPause(stateDir) {
  return existsSync(pauseFlagFile(stateDir)) ? readJsonSafe(pauseFlagFile(stateDir)) : null;
}
export function clearFleetPause(stateDir) {
  try { if (existsSync(pauseFlagFile(stateDir))) renameSync(pauseFlagFile(stateDir), pauseFlagFile(stateDir) + ".cleared"); } catch {}
}

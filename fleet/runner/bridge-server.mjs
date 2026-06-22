#!/usr/bin/env node
// bridge-server.mjs — the always-on local service.
// - Serves the FleetView dashboard at http://localhost:<port> (default 7777, auto-falls-forward
//   if the port is taken; the bound port is written to state/bridge.port)
// - GET  /api/state        live overlay (loop + task status + approvals) for the UI
// - POST /api/approve       {appId, taskId, decision}  clear an escalation
// - POST /api/loop          {slug|'*', action: pause|resume|stop}
// - POST /api/task          {slug, action: add|delete|update|config, ...}
// - POST /api/run           {only?, live?}  trigger one loop pass on demand (serialized)
// Scheduler: --watch [--interval <min>] [--live] [--hours <h>] runs SINGLE-FLIGHT loop passes:
// a tick never starts while the previous one is still running (v1's setInterval overlap
// corrupted long runs), errors are LOGGED (v1 swallowed them), and an unattended-runtime
// budget (--hours / fleet.maxUnattendedHours, default 48) stops live work with a notification
// instead of running forever silently.
//
// Zero dependencies. Tiny memory footprint (idle Node http server).

import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, homedir } from "node:os";
import { loadConfig, loadState, saveState, runLoopOnce, readAllEscalations, mergeBranch, discardBranch, branchDiff, expandHome, STATE_DIR, CONFIG_FILE } from "./loop.mjs";
import { runEvolvePass, ensureConditions, markConditionMet, addCondition, acceptSuggestion, dismissSuggestion, pendingHuman } from "./conditions.mjs";
import { notify, pushLog, getFleetPause, setFleetPause, clearFleetPause, acquireRunLock, releaseRunLock } from "./util.mjs";
import { recordCleanMerge, recordRejection } from "./autonomy.mjs";
import { ensureToken, checkAuth, injectToken, allowedOrigins, pendingSetups, approveSetup } from "./security.mjs";
import { listProviderStatus, validateApiKey } from "./providers/validate.mjs";
import { getProvider } from "./providers/registry.mjs";
import { setApiKey, deleteApiKey } from "./secrets.mjs";
import { costSummary } from "./cost.mjs";
import { applyAppConfigPatch, applyFleetConfigPatch, publicAppConfig, publicFleetConfig, isWithinQuietHours } from "./config-api.mjs";
import { addProjectToConfig } from "./project-onboard.mjs";

// An app is condition-driven if it DECLARES exitConditions (even an empty list — the planner
// seeds those on the first live pass) or already has conditions in its state.
function usesConditions(app, state) {
  return Array.isArray(app.exitConditions) || (state && (state.graduated || (Array.isArray(state.conditions) && state.conditions.length)));
}
async function runApp(app, fleet, opts) {
  let state; try { state = loadState(app, fleet); } catch { state = null; }
  return usesConditions(app, state) ? runEvolvePass(app, fleet, opts) : runLoopOnce(app, fleet, opts);
}

// Background services get a minimal PATH (launchd/systemd). Restore the usual tool dirs so
// scheduled loops can find codex, git, node, npm. nvm: add each version's bin dir (the v1 shim
// added the versions PARENT dir, which contains no binaries).
function toolPaths() {
  const p = [];
  if (platform() === "darwin") p.push("/opt/homebrew/bin", "/opt/homebrew/sbin");
  p.push("/usr/local/bin", join(homedir(), ".local", "bin"));
  const nvm = join(homedir(), ".nvm", "versions", "node");
  try { for (const v of readdirSync(nvm)) p.push(join(nvm, v, "bin")); } catch {}
  return p;
}
process.env.PATH = [...toolPaths(), process.env.PATH || ""].join(":");

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");            // fleet/
const OUTPUTS = dirname(ROOT);             // parent (holds FleetView.jsx)
const WEB = join(ROOT, "web");
const BASE_PORT = Number(process.env.FLEET_PORT || 7777);
const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const val = (f, d) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : d; };

const MIME = { ".html": "text/html", ".js": "text/javascript", ".jsx": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

// Per-install bearer token (created once in the state dir, 0600). Every /api/* request must
// present it; the dashboard gets it injected into its HTML and attaches it automatically.
const TOKEN = ensureToken(STATE_DIR);
let BOUND_PORT = BASE_PORT; // set for real once the listener binds; used for the origin allowlist

// No wildcard CORS. The dashboard is same-origin (served by this very server), so it needs no
// CORS grant at all. We reflect an Origin header ONLY when it's one of our own localhost origins,
// which keeps legitimate same-origin/preflight behavior while blocking cross-site reads.
function corsHeaders(req) {
  const origin = req && req.headers && req.headers["origin"];
  if (origin && allowedOrigins(BOUND_PORT).includes(origin)) {
    return { "access-control-allow-origin": origin, "vary": "Origin", "access-control-allow-headers": "content-type,authorization,x-fleet-token", "access-control-allow-methods": "GET,POST,OPTIONS" };
  }
  return {};
}
function send(res, code, body, type = "application/json", req = null) {
  res.writeHead(code, { "content-type": type, ...corsHeaders(req) });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) { return new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { r(d ? JSON.parse(d) : {}); } catch { r({}); } }); }); }

// Only surface a brief that has a real (non-placeholder) "what"; never show <template> text.
const briefOk = (b) => !!(b && typeof b.what === "string" && b.what.trim() && !b.what.trim().startsWith("<"));
function pickBrief(stateBrief, cfgBrief) { return briefOk(stateBrief) ? stateBrief : (briefOk(cfgBrief) ? cfgBrief : null); }

function logKind(line) {
  if (/^DONE/.test(line)) return "ok";
  if (/^(ESCALATE|REVIEW|RETRY)/.test(line)) return "warn";
  if (/unsafe|blocked|FAIL/i.test(line)) return "err";
  return "info";
}

// Full live state for the dashboard — app metadata from config, everything else
// (loop status, task statuses, the run log as activity, escalations) from real state.
function buildState() {
  const cfg = loadConfig();
  const apps = cfg.apps.map((a) => {
    let s;
    try { s = loadState(a, cfg.fleet); } catch { s = { slug: a.slug, loop: "blocked", backlog: [], escalations: [], log: ["state unreadable"] }; }
    try { ensureConditions(a, s); } catch {}
    const cfgT = Object.fromEntries((a.backlog || []).map((t) => [t.id, t]));
    return {
      id: a.slug, name: a.name, purpose: a.purpose || a.northStar || "", stack: a.stack || "",
      stage: a.stage, repo: a.repo, loop: s.loop, autonomy: a.autonomy, deployPolicy: a.deployPolicy,
      reasoning: a.reasoning || "medium", model: a.model || "", adapter: a.agent?.adapter || "manual",
      config: publicAppConfig(a, cfg.fleet),
      retryCap: a.retryCap ?? cfg.fleet.defaultRetryCap, triggers: a.triggers || [], schedule: a.schedule || "—",
      guardrails: a.guardrails || [], offLimits: a.offLimits || [], skills: a.skills || [],
      loopPhase: s.loopPhase || null,
      autonomyEarned: (s.autonomy && s.autonomy.earned) || 0,
      conditions: (s.conditions || []).map((c) => ({ id: c.id, say: c.say, check: c.check, status: c.status,
        effort: c.effort, blockedBy: c.blockedBy || [], evidence: (c.evidence || "").slice(-400),
        signoff: c.signoff || null, source: c.source || "seed", retryAfter: c.retryAfter || null })),
      suggestions: (s.suggestions || []).map((g) => ({ id: g.id, say: g.say, why: g.why || "" })),
      tasks: (s.backlog || []).map((t) => ({ id: t.id, title: t.title, status: t.status, difficulty: t.difficulty,
        deps: t.deps || [], ac: t.acceptance || t.ac || "", files: t.files || "", attempts: t.attempts || 0,
        lastFailure: t._lastFailure || "", notBefore: t.notBefore || null, humanDecision: t.humanDecision || "", priority: t.priority ?? 50,
        branch: t.branch || null, summary: t.lastSummary || "", plainSummary: t.plainSummary || "", userImpact: t.userImpact || "",
        category: (cfgT[t.id] || {}).category || t.category || null, gate: t.gate || null, review: t.review || null, decisionBrief: pickBrief(t.decisionBrief, (cfgT[t.id] || {}).decisionBrief) })),
      activity: (s.log || []).slice(-12).reverse().map((line) => ({ t: "", msg: line, kind: logKind(line) })),
    };
  });
  // Approvals = escalations the loop raised + every needs-human backlog task. Deduped by app+task.
  const seen = new Set();
  const approvals = [];
  for (const e of readAllEscalations()) {
    const key = e.slug + "-" + e.taskId;
    if (seen.has(key)) continue;             // v1 stacked duplicates; dedupe here
    seen.add(key);
    const app = apps.find((a) => a.id === e.slug);
    const task = (app?.tasks || []).find((t) => t.id === e.taskId) || {};
    approvals.push({ id: key, appId: e.slug, appName: (cfg.apps.find((a) => a.slug === e.slug) || {}).name || e.slug,
      taskId: e.taskId, type: e.type || "decision", title: e.title || task.title, detail: e.reason || task.ac || "",
      kind: e.type === "brain" ? "brain" : (task.branch ? "code" : "decision"), branch: task.branch || null, summary: task.summary || "", plainSummary: task.plainSummary || "", userImpact: task.userImpact || "", gate: task.gate || null, review: task.review || null,
      brief: task.decisionBrief || null, acceptance: task.ac, files: task.files, deps: task.deps, raised: e.at || "" });
  }
  for (const app of apps) {
    for (const t of app.tasks) {
      const key = app.id + "-" + t.id;
      if (t.status === "needs-human" && !seen.has(key)) {
        seen.add(key);
        approvals.push({ id: key, appId: app.id, appName: app.name, taskId: t.id, type: "decision", kind: "decision",
          title: t.title, detail: t.ac, brief: t.decisionBrief || null, acceptance: t.ac, files: t.files, deps: t.deps, raised: "" });
      }
    }
  }
  const milestones = [];
  for (const app of apps) for (const t of app.tasks) if (t.status === "done")
    milestones.push({ appId: app.id, appName: app.name, taskId: t.id, title: t.title, plainSummary: t.plainSummary || "", userImpact: t.userImpact || "", readiness: t.category === "readiness" });
  const pause = getFleetPause(STATE_DIR);
  return { connected: true, apps, approvals, milestones, fleet: publicFleetConfig(cfg.fleet), fleetPause: pause || null, lastPass: lastPass || null, fullPassAt, current, schedulerLive: schedulerLive, updatedAt: new Date().toISOString() };
}
// heartbeat: per-APP completions (a full 9-app pass with real agent runs can legitimately take
// an hour+, so the full-pass clock alone cries wolf). `current` = what the tick is doing RIGHT
// NOW, so a stall points at the exact app it died in.
let lastPass = null;      // { at, app, action, live } — most recent per-app completion
let fullPassAt = null;    // when the last complete 9-app sweep finished
let current = null;       // { app, since } while a pass is executing
let schedulerLive = false;

function withState(slug, fn) {
  const cfg = loadConfig();
  const app = cfg.apps.find((a) => a.slug === slug);
  if (!app) return false;
  const s = loadState(app, cfg.fleet);
  fn(s, app, cfg);
  saveState(s);
  return true;
}

// ---- TRUST: category-based auto-approval --------------------------------------
// The owner doesn't trust "merging" — they trust CATEGORIES of work ("accessibility audit",
// "design-contract check"). Every manual decision is recorded in a ledger keyed by category;
// the owner can promote a category to auto-approve in the Trust panel, and remove it anytime.
// HARD FLOORS (never auto-approved): live/shipping apps, human-tier gates, safety-flagged
// changes (secrets/migrations/payment paths), and work the AI reviewers objected to.
import { writeJsonAtomic, readJsonSafe } from "./util.mjs";
const TRUST_FILE = join(STATE_DIR, "trust.json");
export function categoryKey(title) {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).slice(0, 5).join("-") || "untitled";
}
function loadTrust() { return readJsonSafe(TRUST_FILE) || { rules: [], ledger: [] }; }
function saveTrust(t) { if (t.ledger.length > 500) t.ledger = t.ledger.slice(-500); writeJsonAtomic(TRUST_FILE, t); }
function ledgerPush(decision, key, app, task, via = "manual") {
  const t = loadTrust();
  t.ledger.push({ key, app, task, decision, via, at: new Date().toISOString() });
  saveTrust(t);
}
function trustRule(t, key, app) {
  return (t.rules || []).find((r) => r.enabled && r.key === key && (r.scope === "fleet" || r.app === app));
}
// Reap STALE env-class escalations: old cards that asked the human for an environment/tool/
// browser/DB the loop can now build itself. Clear them and requeue the task with the standing
// "build it yourself" instruction, so they stop pestering the owner across restarts/upgrades.
const ENV_ESC = /(browser runner|browser support|database (url|config)|certification script|test environment|provide.*(environment|access|tool|login|database|browser)|missing.*(script|url|config)|local (server|port)|playwright|dev server|uncommitted changes|env_app|no such file|install the|dependency install|node environment|required database)/i;
const HUMAN_ESC = /(real (payment|card|charge|checkout)|app ?store|testflight|notari|publisher|identity verif|rotate.*(production|real).*secret|google.*verif|microsoft.*verif|apple.*(developer|account))/i;
function reapStaleEnvEscalations(app, fleet) {
  if (!(app.environment && app.environment.autoProvision !== false)) return;
  if (app.stage === "live" || app.stage === "shipping") return; // be conservative on live apps
  const s = loadState(app, fleet); let changed = false;
  const keep = [];
  for (const e of s.escalations || []) {
    const txt = `${e.reason || ""} ${e.title || ""}`;
    if (ENV_ESC.test(txt) && !HUMAN_ESC.test(txt)) {
      const t = (s.backlog || []).find((x) => x.id === e.taskId);
      if (t) {
        if (t.branch) { try { discardBranch(expandHome(app.repo), t); } catch {} delete t.branch; }
        t.status = "queued"; delete t.notBefore;
        t.humanDecision = "ENVIRONMENT IS YOURS TO BUILD — network + localhost are on and the loop runs .fleet/setup.sh + .fleet/env.sh before gates. Provision deps, browsers, a local DB and a throwaway test user yourself; never ask for an environment. Only escalate real payments, real identity verification, or real production secrets.";
      }
      changed = true; // drop the escalation
    } else keep.push(e);
  }
  if (changed) { s.escalations = keep; pushLog(s, "REAPED stale environment escalation(s) — the loop self-provisions now"); saveState(s); }
}

// Post-pass sweep: apply standing rules to anything newly awaiting a signature.
async function autoApproveSweep(app, fleet) {
  try {
    const trust = loadTrust();
    if (!(trust.rules || []).some((r) => r.enabled)) return;
    if (app.stage === "live" || app.stage === "shipping" || app.requireHumanSignoff) return; // floor
    const s = loadState(app, fleet);
    let changed = false;
    for (const t of s.backlog || []) {
      if (t.status !== "review" || !t.branch) continue;
      if (t.review && t.review.verdict === "REVISE") continue;                      // reviewers objected
      if (/secret|migration|idempot/i.test((t.gate && t.gate.note) || "")) continue; // safety flag
      const rule = trustRule(trust, categoryKey(t.title), app.slug);
      if (!rule) continue;
      const m = mergeBranch(expandHome(app.repo), t);
      if (!m.ok) continue;
      t.status = "done"; delete t.branch;
      s.escalations = (s.escalations || []).filter((e) => e.taskId !== t.id);
      pushLog(s, `AUTO-APPROVED ${t.id}: ${m.note} (your standing rule: ${rule.key})`);
      ledgerPush("auto-approve", rule.key, app.slug, t.id, "rule");
      notify(STATE_DIR, `${app.name}: auto-approved`, `${t.title} — per your standing rule`, { fleet });
      changed = true;
    }
    if (changed) saveState(s);
    for (const c of s.conditions || []) {
      if (c.status === "met" || c.check === "human" || !c.signoff) continue;
      const rule = trustRule(trust, categoryKey(c.say), app.slug);
      if (!rule) continue;
      const r = await markConditionMet(app, fleet, c.id, { confirmProbe: true });
      if (r.ok) { ledgerPush("auto-approve", rule.key, app.slug, c.id, "rule"); notify(STATE_DIR, `${app.name}: gate auto-confirmed`, c.say, { fleet }); }
    }
  } catch (e) { logErr(`auto-approve ${app.slug}`, e); }
}

// ---- serialized pass execution (shared by scheduler + /api/run) -------------
// One global chain: passes never overlap, regardless of who triggered them.
let runChain = Promise.resolve();
function enqueueRun(label, fn) {
  // in-process serialization + a CROSS-PROCESS lock (manual `fleet.mjs run` and this service
  // are different processes; without the file lock they could work the same app at once).
  const locked = async () => {
    const lock = acquireRunLock(STATE_DIR, `bridge:${label}`);
    if (!lock.ok) {
      console.log(`[lock] skipping ${label} — another fleet process is running (${(lock.holder || {}).who || "?"} pid ${(lock.holder || {}).pid || "?"})`);
      return { skipped: true, reason: "another fleet process holds the run lock" };
    }
    try { return await fn(); } finally { releaseRunLock(STATE_DIR); }
  };
  const p = runChain.then(locked, locked);
  runChain = p.catch((e) => { logErr(`${label} failed`, e); });
  return p;
}
function logErr(msg, e) {
  const line = `[${new Date().toISOString()}] ERROR ${msg}: ${e && e.stack || e}`;
  console.error(line);
  try { writeFileSync(join(STATE_DIR, "bridge-errors.log"), line + "\n", { flag: "a" }); } catch {}
}

async function api(req, res, path) {
  if (req.method === "OPTIONS") return send(res, 204, "", "text/plain", req);
  if (path === "/api/state" && req.method === "GET") return send(res, 200, buildState());

  if (path === "/api/setup-consent" && req.method === "GET") {
    return send(res, 200, { pending: pendingSetups(STATE_DIR) });
  }

  if (path === "/api/providers" && req.method === "GET") {
    return send(res, 200, { providers: listProviderStatus() });
  }

  if (path === "/api/cost" && req.method === "GET") {
    return send(res, 200, costSummary(STATE_DIR));
  }

  if (path === "/api/fleet-config" && req.method === "GET") {
    const cfg = loadConfig();
    return send(res, 200, { ok: true, fleet: publicFleetConfig(cfg.fleet), schedulerLive });
  }

  if (path === "/api/approval" && req.method === "GET") {
    const q = new URL(req.url, "http://x").searchParams;
    const slug = q.get("appId"), taskId = q.get("taskId");
    const cfg = loadConfig();
    const appCfg = cfg.apps.find((a) => a.slug === slug);
    if (!appCfg) return send(res, 404, { error: "no app" });
    const s = loadState(appCfg, cfg.fleet);
    const t = (s.backlog || []).find((x) => x.id === taskId) || {};
    const hasBranch = !!t.branch;
    let diff = null;
    if (hasBranch) { try { diff = branchDiff(expandHome(appCfg.repo), t); } catch { diff = null; } }
    return send(res, 200, {
      appId: slug, taskId, title: t.title, status: t.status,
      kind: hasBranch ? "code" : "decision",
      summary: t.lastSummary || "", gate: t.gate || null,
      branch: t.branch || null, baseBranch: t.baseBranch || null, diff,
      acceptance: t.acceptance || t.ac || "", files: t.files || "", deps: t.deps || [],
      humanDecision: t.humanDecision || "",
      app: { autonomy: appCfg.autonomy, deployPolicy: appCfg.deployPolicy, reasoning: appCfg.reasoning,
        guardrails: appCfg.guardrails || [], standingContext: appCfg.standingContext || "", skills: appCfg.skills || [], northStar: appCfg.northStar || "" },
    });
  }

  if (path === "/api/diag" && req.method === "GET") {
    // one-stop stall diagnosis: what's running, what last finished, recent errors, lock holder
    let errs = "";
    try { errs = readFileSync(join(STATE_DIR, "bridge-errors.log"), "utf8").slice(-2000); } catch {}
    const lock = existsSync(join(STATE_DIR, "fleet.lock")) ? (JSON.parse(readFileSync(join(STATE_DIR, "fleet.lock"), "utf8") || "{}")) : null;
    return send(res, 200, { pid: process.pid, current, lastPass, fullPassAt, schedulerLive, lock, recentErrors: errs });
  }

  if (path === "/api/log" && req.method === "GET") {
    const slug = new URL(req.url, "http://x").searchParams.get("slug") || "";
    const f = join(STATE_DIR, `${slug}.run.log`);
    let text = existsSync(f) ? readFileSync(f, "utf8") : "";
    if (text.length > 60000) text = text.slice(-60000); // tail
    return send(res, 200, { slug, log: text });
  }

  const body = await readBody(req);

  if (path === "/api/project" && req.method === "POST") {
    try {
      const cfgPath = CONFIG_FILE;
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      const result = addProjectToConfig(cfg, body);
      if (!result.ok) return send(res, result.status, { ok: false, error: result.error });
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
      return send(res, 200, {
        ok: true,
        app: {
          id: result.app.slug,
          name: result.app.name,
          repo: result.app.repo,
          stack: result.app.stack,
          loop: result.app.loop,
        },
        git: result.isGit,
        stack: result.det.stack,
      });
    } catch (e) { return send(res, 500, { ok: false, error: String(e) }); }
  }

  if (path === "/api/app-config" && req.method === "POST") {
    // Live per-app tuning: reasoning strength (low|medium|high) + model. Written to
    // fleet.config.json (the source of truth, re-read every pass), so changes take effect on
    // the next sweep with no restart. Agent command interpolates {{REASONING}}/{{MODEL}}.
    try {
      const cfgPath = CONFIG_FILE; // honors FLEET_CONFIG (Application Support in the packaged app)
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      const result = applyAppConfigPatch(cfg, body);
      if (!result.ok) return send(res, result.status, { ok: false, error: result.error });
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
      return send(res, 200, { ok: true, ...result.config });
    } catch (e) { return send(res, 500, { ok: false, error: String(e) }); }
  }

  if (path === "/api/fleet-config" && req.method === "POST") {
    try {
      const cfgPath = CONFIG_FILE;
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      const result = applyFleetConfigPatch(cfg, body);
      if (!result.ok) return send(res, result.status, { ok: false, error: result.error });
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
      return send(res, 200, { ok: true, fleet: result.fleet, note: "saved" });
    } catch (e) { return send(res, 500, { ok: false, error: String(e) }); }
  }

  if (path === "/api/approve" && req.method === "POST") {
    const { appId, taskId, decision, answer } = body;
    const cfg = loadConfig();
    const appCfg = cfg.apps.find((a) => a.slug === appId);
    let result = { ok: false, note: "" };
    const stored = withState(appId, (s) => {
      s.escalations = (s.escalations || []).filter((e) => e.taskId !== taskId);
      const t = s.backlog.find((x) => x.id === taskId);
      if (!t) { result = { ok: false, note: "task not found" }; return; }
      const repo = expandHome(appCfg.repo);

      if (decision === "revise") {
        // THIRD OPTION: keep the task, throw away the imperfect attempt, and hand the agent
        // YOUR instructions (or the reviewer's critique) as authoritative. Fresh retry budget.
        if (t.branch) { try { discardBranch(expandHome(appCfg.repo), t); } catch {} delete t.branch; }
        t.humanDecision = (answer && answer.trim()) || (t.review && t.review.issues) || "Address the reviewer's objections fully before resubmitting.";
        t.status = "queued"; t.attempts = 0;
        delete t.notBefore; delete t._infraFails;
        t._lastFailure = "Sent back by the owner with instructions — see the human decision.";
        result = { ok: true, note: "sent back — the agent redoes it with your instructions (fresh attempts)" };
        pushLog(s, `SENT-BACK ${taskId}: owner instructions recorded`);
      } else if (decision === "reject") {
        if (t.branch) { const r = discardBranch(repo, t); result = { ok: true, note: r.note || "branch discarded" }; }
        else result = { ok: true, note: "task blocked" };
        t.status = "blocked";
        pushLog(s, `REJECTED ${taskId}${t.branch ? " (discarded " + t.branch + ")" : ""}`);
        delete t.branch;
        recordRejection(appCfg, cfg.fleet, s, { reason: `rejected ${taskId}` }); // ladder: demote/reset streak
      } else if (answer && answer.trim() && (t.status === "needs-human" || t.difficulty === "needs-human-decision" || !t.branch)) {
        // A typed decision ALWAYS wins. v2 fix: when the agent escalated MID-task it left a
        // half-done branch on the task; the old priority routed your answer into "merge that
        // branch" — your text was ignored and you got a merge error instead. Now: record the
        // answer, discard the stale half-done branch (the loop redoes the work WITH your
        // decision; keeping it would trip the no-clobber guard on retry), and requeue.
        if (t.branch) { try { discardBranch(expandHome(appCfg.repo), t); } catch {} delete t.branch; }
        t.humanDecision = answer.trim(); t.status = "queued";
        delete t.notBefore; delete t._infraFails;
        result = { ok: true, note: "decision recorded; the loop will act on it next pass" };
        pushLog(s, `ANSWERED ${taskId} (via dashboard)`);
      } else if (t.branch) {
        const m = mergeBranch(repo, t);
        if (m.ok) {
          t.status = "done"; result = { ok: true, note: m.note }; pushLog(s, `MERGED ${taskId}: ${m.note}`); delete t.branch;
          const ladder = recordCleanMerge(appCfg, cfg.fleet, s, { via: "human-approve" });
          if (ladder && ladder.promoted) { pushLog(s, `AUTONOMY: promoted to ${ladder.now} after a clean streak`); result.note += ` — autonomy promoted to ${ladder.now}`; }
        }
        else { result = { ok: false, note: "Merge failed (likely a conflict): " + m.note + ". Branch kept for manual merge." }; pushLog(s, `MERGE-FAILED ${taskId}: ${m.note}`); }
      } else {
        t.status = "done"; result = { ok: true, note: "marked done" };
        pushLog(s, `APPROVED ${taskId} (via dashboard)`);
      }
      if (t.status === "done" && t.category === "readiness") t.gateVerified = true;
      // TRUST LEDGER: remember WHAT KIND of work you decided on (not the mechanism) so the
      // Trust panel can offer "auto-approve this category" once a pattern emerges.
      try { ledgerPush(decision === "reject" ? "reject" : decision === "revise" ? "send-back" : (answer && answer.trim() && t.status === "queued") ? "answer" : "approve", categoryKey(t.title), appId, taskId); } catch {}
    });
    return send(res, stored ? 200 : 404, result);
  }

  if (path === "/api/trust" && req.method === "GET") {
    const t = loadTrust();
    const agg = {};
    for (const e of t.ledger || []) {
      const k = e.key;
      agg[k] = agg[k] || { key: k, approves: 0, rejects: 0, sendBacks: 0, answers: 0, autos: 0, apps: {}, last: "" };
      if (e.decision === "approve") agg[k].approves++;
      else if (e.decision === "reject") agg[k].rejects++;
      else if (e.decision === "send-back") agg[k].sendBacks++;
      else if (e.decision === "auto-approve") agg[k].autos++;
      else agg[k].answers++;
      agg[k].apps[e.app] = 1; agg[k].last = e.at;
    }
    return send(res, 200, { rules: t.rules || [], categories: Object.values(agg).map((x) => ({ ...x, apps: Object.keys(x.apps) })) });
  }
  if (path === "/api/trust" && req.method === "POST") {
    const b = body;   // already read above for all POST routes
    const t = loadTrust();
    t.rules = t.rules || [];
    if (b.action === "enable") {
      const existing = t.rules.find((r) => r.key === b.key && (b.app ? r.app === b.app : r.scope === "fleet"));
      if (existing) existing.enabled = true;
      else t.rules.push({ id: "rule-" + Date.now().toString(36), key: b.key, scope: b.app ? "app" : "fleet", app: b.app || null, enabled: true, createdAt: new Date().toISOString() });
    } else if (b.action === "disable") {
      t.rules = t.rules.filter((r) => !(r.key === b.key && (b.app ? r.app === b.app : true)));
    }
    saveTrust(t);
    return send(res, 200, { ok: true, rules: t.rules });
  }

  if (path === "/api/loop" && req.method === "POST") {
    const { slug, action } = body;
    const map = { pause: "paused", resume: "running", stop: "idle" };
    const cfg = loadConfig();
    const targets = slug === "*" ? cfg.apps.map((a) => a.slug) : [slug];
    for (const sl of targets) withState(sl, (s) => { if (!(slug === "*" && s.loop === "blocked")) s.loop = map[action] || s.loop; });
    if (action === "resume") clearFleetPause(STATE_DIR);
    return send(res, 200, { ok: true });
  }

  if (path === "/api/task" && req.method === "POST") {
    const { slug, action, task, taskId, patch } = body;
    const ok = withState(slug, (s) => {
      if (action === "add" && task) s.backlog.push({ ...task, acceptance: task.ac || task.acceptance, attempts: 0 });
      else if (action === "delete") s.backlog = s.backlog.filter((t) => t.id !== taskId);
      else if (action === "update") s.backlog = s.backlog.map((t) => (t.id === taskId ? { ...t, ...patch, ...(patch.ac ? { acceptance: patch.ac } : {}) } : t));
      else if (action === "move") {
        const i = s.backlog.findIndex((t) => t.id === taskId), j = i + (body.dir || 0);
        if (i >= 0 && j >= 0 && j < s.backlog.length) { const c = [...s.backlog];[c[i], c[j]] = [c[j], c[i]]; s.backlog = c; }
      } else if (action === "config") s.overrides = { ...(s.overrides || {}), ...patch };
    });
    return send(res, ok ? 200 : 404, { ok });
  }

  if (path === "/api/brain" && req.method === "GET") {
    const q = new URL(req.url, "http://x").searchParams;
    const slug = q.get("appId");
    const cfg = loadConfig(); const appCfg = cfg.apps.find((a) => a.slug === slug);
    if (!appCfg) return send(res, 404, { error: "no app" });
    const { readProposed, brainFile } = await import("./brain.mjs");
    const s = loadState(appCfg, cfg.fleet);
    let active = ""; try { if (existsSync(brainFile(appCfg))) active = readFileSync(brainFile(appCfg), "utf8"); } catch {}
    return send(res, 200, { appId: slug, status: (s.brain && s.brain.status) || "none", version: (s.brain && s.brain.version) || 0, proposed: readProposed(appCfg), active });
  }
  if (path === "/api/brain" && req.method === "POST") {
    // body: { slug, action: "approve"|"refine", editedText?, notes? }
    const cfg = loadConfig(); const appCfg = cfg.apps.find((a) => a.slug === body.slug);
    if (!appCfg) return send(res, 404, { ok: false, error: "no app" });
    const { approveBrain } = await import("./brain.mjs");
    if (body.action === "approve") {
      const r = approveBrain(appCfg, { editedText: body.editedText || "" });
      if (r.ok) withState(body.slug, (s) => { s.brain = { status: "approved", version: (s.brain && s.brain.version) || 1, at: new Date().toISOString() }; s.escalations = (s.escalations || []).filter((e) => e.taskId !== "__brain__"); pushLog(s, "BRAIN: you approved the project understanding — every run now reads it"); });
      return send(res, r.ok ? 200 : 409, r);
    }
    if (body.action === "refine") {
      // store the owner's notes (or their edited text) and re-open comprehension next pass
      withState(body.slug, (s) => { s.brain = { status: "refining", version: (s.brain && s.brain.version) || 1, notes: (body.notes || body.editedText || "").slice(0, 4000), at: new Date().toISOString() }; s.escalations = (s.escalations || []).filter((e) => e.taskId !== "__brain__"); pushLog(s, "BRAIN: you asked for a re-analysis — the fleet will revise its understanding next pass"); });
      return send(res, 200, { ok: true, note: "the fleet will re-analyze with your notes next pass" });
    }
    return send(res, 400, { ok: false, error: "unknown action" });
  }

  if (path === "/api/condition" && req.method === "POST") {
    const cfg = loadConfig();
    const app = cfg.apps.find((a) => a.slug === body.slug);
    if (!app) return send(res, 404, { ok: false, error: "no such app" });
    if (body.action === "signoff") {
      const r = await markConditionMet(app, cfg.fleet, body.id, { confirmProbe: true });
      return send(res, r.ok ? 200 : 409, r);
    }
    if (body.action === "add") {
      const r = addCondition(app, cfg.fleet, body.condition || {});
      return send(res, 200, r);
    }
    if (body.action === "accept") { return send(res, 200, acceptSuggestion(app, cfg.fleet, body.id)); }
    if (body.action === "dismiss") { return send(res, 200, dismissSuggestion(app, cfg.fleet, body.id)); }
    if (body.action === "reject") {
      // ✗ on a pending gate: drop the branch + re-open it so the loop re-works it next pass.
      const st = loadState(app, cfg.fleet); ensureConditions(app, st);
      const c = (st.conditions || []).find((x) => x.id === body.id);
      if (c) {
        if (c.signoff && c.signoff.branch) {
          try { const { resolveBaseBranch } = await import("./loop.mjs"); discardBranch(expandHome(app.repo), { branch: c.signoff.branch, baseBranch: resolveBaseBranch(expandHome(app.repo), app) }); } catch {}
        }
        c.signoff = null; c.status = "unmet"; c.tries = 0; c.retryAfter = null;
        pushLog(st, `GATE-REJECT ${c.id}: re-opened for another attempt`);
        recordRejection(app, cfg.fleet, st, { reason: `gate ${c.id} rejected` });
        saveState(st);
      }
      return send(res, 200, { ok: !!c });
    }
    return send(res, 400, { ok: false, error: "unknown action" });
  }

  if (path === "/api/provider-key" && req.method === "POST") {
    // body: { provider, action: "save"|"delete"|"validate", key? }
    const provider = getProvider(body.provider);
    if (!provider || provider.kind !== "api") return send(res, 400, { ok: false, error: "unknown API provider" });
    if (body.action === "validate") {
      const r = await validateApiKey(body.provider, body.key || "");
      return send(res, 200, r);
    }
    if (body.action === "delete") {
      const ok = deleteApiKey(provider);
      return send(res, 200, { ok });
    }
    // save: verify the key works first, then store it in the Keychain (never on disk).
    const check = await validateApiKey(body.provider, body.key || "");
    if (!check.ok) return send(res, 200, { ok: false, error: check.error });
    const stored = setApiKey(provider, body.key || "");
    return send(res, 200, { ok: stored, count: check.count, models: check.models, error: stored ? "" : "saved check passed but the Keychain write failed (macOS only)" });
  }

  if (path === "/api/setup-consent" && req.method === "POST") {
    // The user approves a repo's setup.sh by its exact contents (hash). Only meaningful when
    // FLEET_REQUIRE_SETUP_CONSENT is set; otherwise nothing is ever pending.
    const r = approveSetup(STATE_DIR, body.repo);
    return send(res, r.ok ? 200 : 404, r);
  }

  if (path === "/api/run" && req.method === "POST") {
    const out = await enqueueRun("api-run", async () => {
      const cfg = loadConfig();
      const apps = cfg.apps.filter((a) => !body.only || a.slug === body.only);
      const results = [];
      for (const a of apps) {
        try { results.push(await runApp(a, cfg.fleet, { dryRun: !body.live })); }
        catch (e) { logErr(`pass ${a.slug}`, e); results.push({ slug: a.slug, action: "error", reason: String(e).slice(0, 200) }); }
      }
      return results;
    });
    return send(res, 200, { results: out });
  }
  return send(res, 404, { error: "no such endpoint" });
}

function serveStatic(req, res, path) {
  let file;
  if (path === "/" || path === "") file = join(WEB, "app.html");
  else if (path === "/FleetView.jsx") file = join(OUTPUTS, "FleetView.jsx");
  else file = join(WEB, path.replace(/^\/+/, ""));
  if (!existsSync(file)) return send(res, 404, "not found", "text/plain");
  const type = MIME[extname(file)] || "application/octet-stream";
  // HTML is served with the per-install token injected, so the same-origin dashboard authenticates
  // its /api/ calls automatically — no change needed in the React app.
  if (type === "text/html") return send(res, 200, injectToken(readFileSync(file, "utf8"), TOKEN), type);
  send(res, 200, readFileSync(file), type);
}

// ---- start: bind the port (fall forward if taken), then the scheduler -------
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url || "/").split("?")[0]);
  if (path.startsWith("/api/")) {
    // Auth gate: every /api/* call must present the per-install token, and state-changing calls
    // must not come from a foreign browser origin. Preflights pass through to the OPTIONS handler.
    const auth = checkAuth(req, { token: TOKEN, port: BOUND_PORT });
    if (!auth.ok) return send(res, auth.code, { error: auth.reason }, "application/json", req);
    return api(req, res, path).catch((e) => { logErr(`api ${path}`, e); send(res, 500, { error: String(e) }, "application/json", req); });
  }
  serveStatic(req, res, path);
});

function listen(port, triesLeft) {
  server.once("error", (e) => {
    if (e && e.code === "EADDRINUSE" && triesLeft > 0) {
      console.error(`port ${port} is in use — trying ${port + 1}`);
      listen(port + 1, triesLeft - 1);
    } else {
      logErr("listen", e);
      process.exit(1);
    }
  });
  // Bind to LOOPBACK only (127.0.0.1) — the bridge is never exposed to the local network. This is
  // defense layer 3 (origin + token are layers 1–2). The Swift app reads bridge.port + bridge.token
  // from the state dir to open the dashboard.
  server.listen(port, "127.0.0.1", () => {
    const actualPort = Number(server.address()?.port || port);
    BOUND_PORT = actualPort;
    try { writeFileSync(join(STATE_DIR, "bridge.port"), String(actualPort)); } catch {}
    console.log(`\n  FleetView bridge → http://127.0.0.1:${actualPort}  (loopback only, token-protected)\n  (bookmark it — the dashboard reads live loop state and writes your approvals back)\n`);
    startScheduler();
  });
}

function startScheduler() {
  if (!has("watch")) return;
  const cfg0 = (() => { try { return loadConfig(); } catch { return { fleet: {} }; } })();
  // Faster defaults: shorter sweep gap + real concurrency. Both overridable via config/flags.
  const min = Number(val("interval", cfg0.fleet.intervalMinutes || 5));
  const concurrency = Math.max(1, Number(val("concurrency", cfg0.fleet.maxConcurrentLoops || 3)));
  const live = has("live");
  schedulerLive = live;
  const maxHours = Number(val("hours", cfg0.fleet.maxUnattendedHours || 48));
  const startedAt = Date.now();
  let stopped = false;
  const active = new Set();
  const setCurrent = () => { current = active.size ? { app: [...active].join(", "), since: new Date().toISOString(), count: active.size } : null; };

  // Run all apps for one sweep with a CONCURRENCY POOL — up to `concurrency` agents at once,
  // instead of one-app-at-a-time. With async agent runs this is the real throughput lever.
  async function sweep(cfg) {
    let i = 0;
    const worker = async () => {
      while (i < cfg.apps.length && !stopped) {
        const a = cfg.apps[i++];
        active.add(a.slug); setCurrent();
        try {
          if (live) { try { reapStaleEnvEscalations(a, cfg.fleet); } catch (e) { logErr(`reap ${a.slug}`, e); } }
          const res = await runApp(a, cfg.fleet, { dryRun: !live });
          lastPass = { at: new Date().toISOString(), app: a.slug, action: (res || {}).action || "?", live };
          if (live) await autoApproveSweep(a, cfg.fleet);
        } catch (e) { logErr(`tick ${a.slug}`, e); }
        finally { active.delete(a.slug); setCurrent(); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, cfg.apps.length) }, worker));
  }

  const tick = () => enqueueRun("tick", async () => {
    if (stopped) return;
    if (live && (Date.now() - startedAt) > maxHours * 3600 * 1000) {
      stopped = true;
      const msg = `Unattended runtime budget reached (${maxHours}h). Live work paused — the dashboard stays up; restart the service (or press Resume) to continue.`;
      console.log(msg);
      notify(STATE_DIR, "Fleet runtime budget reached", msg, { fleet: cfg0.fleet });
      return;
    }
    const cfg = loadConfig();
    if (isWithinQuietHours(cfg.fleet)) {
      console.log(`[${new Date().toLocaleTimeString()}] sweep skipped (quiet hours)`);
      return;
    }
    if (live && cfg.fleet?.budget) {
      const spend = costSummary(STATE_DIR);
      const dailyCap = Number(cfg.fleet.budget.dailyUsd || 0);
      const monthlyCap = Number(cfg.fleet.budget.monthlyUsd || 0);
      if (dailyCap > 0 && spend.todayUsd >= dailyCap) {
        const msg = `Fleet daily API spend cap reached ($${spend.todayUsd} >= $${dailyCap}). Live work pauses until the cap is raised or tomorrow's spend window starts.`;
        setFleetPause(STATE_DIR, msg);
        notify(STATE_DIR, "Fleet spend cap reached", msg, { fleet: cfg.fleet });
        console.log(msg);
        return;
      }
      if (monthlyCap > 0 && spend.monthUsd >= monthlyCap) {
        const msg = `Fleet monthly API spend cap reached ($${spend.monthUsd} >= $${monthlyCap}). Live work pauses until the cap is raised or next month starts.`;
        setFleetPause(STATE_DIR, msg);
        notify(STATE_DIR, "Fleet spend cap reached", msg, { fleet: cfg.fleet });
        console.log(msg);
        return;
      }
    }
    await sweep(cfg);
    fullPassAt = new Date().toISOString();
    console.log(`[${new Date().toLocaleTimeString()}] sweep done ${live ? "(LIVE)" : "(dry-run)"}`);
  });

  console.log(`  Scheduler: every ${min} min, ${concurrency} apps in parallel, ${live ? "LIVE" : "dry-run"}${live ? ` (runtime budget ${maxHours}h)` : ""}.\n`);
  const loop = async () => {
    if (stopped) return;
    await tick();
    setTimeout(loop, min * 60 * 1000);
  };
  loop();
}

listen(BASE_PORT, 10);

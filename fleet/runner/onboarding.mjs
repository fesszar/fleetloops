import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { CONFIG_FILE, loadState, saveState, expandHome } from "./loop.mjs";
import { comprehendProject, proposedFile, brainFile, readBrain, readProposed } from "./brain.mjs";
import { normalizeGateDraft } from "./project-onboard.mjs";
import { hasAgentProvider, resolveProvider } from "./providers/registry.mjs";
import { pushLog } from "./util.mjs";
import { runExplainer } from "./adapters.mjs";
import { COSTLY } from "./gates.mjs";
import { ensureStarterTask, runPreflight } from "./preflight.mjs";

export const ONBOARDING_VERSION = "night-deck-1";
export const BRAIN_ANALYZE_STALE_MS = 10 * 60 * 1000;

const clean = (v) => String(v || "").trim();
const iso = () => new Date().toISOString();
const HERE = new URL(".", import.meta.url);
const DRAFT_GATES_TEMPLATE = (() => { try { return readFileSync(new URL("../prompts/draft-gates.md", HERE), "utf8"); } catch { return ""; } })();
let explainGateDraft = runExplainer;

export function setGateDraftExplainerForTests(fn) {
  explainGateDraft = typeof fn === "function" ? fn : runExplainer;
}

export function defaultOnboardingState() {
  return {
    version: ONBOARDING_VERSION,
    completed: false,
    step: 0,
    providerId: null,
    providerPath: null,
    mode: null,
    projectDraft: null,
    appId: null,
    brainApproved: false,
    gatesApproved: false,
    mergePolicy: "approve",
    shipPolicy: "manual",
    migration: { choice: null, importedAt: null, dismissedAt: null },
    updatedAt: iso(),
  };
}

export function normalizeOnboarding(cfg) {
  cfg.fleet = cfg.fleet || {};
  const existing = cfg.fleet.onboarding || {};
  const base = defaultOnboardingState();
  cfg.fleet.onboarding = {
    ...base,
    ...existing,
    migration: { ...base.migration, ...(existing.migration || {}) },
    version: existing.version || ONBOARDING_VERSION,
    completed: existing.completed === true,
    step: Number.isFinite(Number(existing.step)) ? Math.max(0, Math.min(4, Number(existing.step))) : 0,
    updatedAt: existing.updatedAt || iso(),
  };
  return cfg.fleet.onboarding;
}

function oldFleetConfigPath() {
  if (process.env.FLEET_OLD_CONFIG) return process.env.FLEET_OLD_CONFIG;
  if (process.platform !== "darwin") return "";
  return join(homedir(), "Library", "Application Support", "Fleet", "fleet.config.json");
}

export function oldFleetSummary() {
  const oldPath = oldFleetConfigPath();
  if (!oldPath || resolve(oldPath) === resolve(CONFIG_FILE) || !existsSync(oldPath)) {
    return { detected: false, path: oldPath, appCount: 0, apps: [] };
  }
  try {
    const old = JSON.parse(readFileSync(oldPath, "utf8"));
    const apps = Array.isArray(old.apps) ? old.apps.map((a) => ({ slug: a.slug, name: a.name, repo: a.repo })).filter((a) => a.slug || a.repo) : [];
    return { detected: apps.length > 0, path: oldPath, appCount: apps.length, apps: apps.slice(0, 12) };
  } catch {
    return { detected: true, path: oldPath, appCount: 0, apps: [], unreadable: true };
  }
}

export function publicOnboarding(cfg) {
  const ob = normalizeOnboarding(cfg);
  const app = (cfg.apps || []).find((a) => a.slug === ob.appId);
  const appState = app ? recoverStaleBrainAnalysis(app, cfg.fleet || {}).state : null;
  return {
    ...ob,
    oldFleet: oldFleetSummary(),
    brain: app ? brainMeta(appState) : { status: "none", origin: "ai", analyzing: false },
    gates: Array.isArray(appState?.onboardingGates) ? appState.onboardingGates : [],
  };
}

function brainMeta(state) {
  const brain = state?.brain || {};
  const status = brain.status || "none";
  const origin = brain.origin || (status === "none" ? "ai" : "ai");
  return { status, origin, analyzing: status === "analyzing", analyzeStartedAt: brain.analyzeStartedAt || null, failed: !!brain.analyzeFailedAt && origin === "template" };
}

function hasOnboardingAnalysisProvider(app) {
  if (!hasAgentProvider(app)) return false;
  if (resolveProvider(app)) return true;
  const adapter = app?.agent?.adapter || "";
  return !!adapter && adapter !== "manual" && adapter !== "shell";
}

export function recoverStaleBrainAnalysis(app, fleet = {}) {
  const state = loadState(app, fleet || {});
  if (state.brain?.status !== "analyzing") return { state, recovered: false };
  const started = Date.parse(state.brain.analyzeStartedAt || state.brain.at || "");
  if (Number.isFinite(started) && Date.now() - started <= BRAIN_ANALYZE_STALE_MS) return { state, recovered: false };
  state.brain = { ...(state.brain || {}), status: "pending", origin: "template", at: iso(), analyzeFailedAt: iso() };
  delete state.brain.analyzeStartedAt;
  pushLog(state, "BRAIN: deep comprehension timed out; continuing with the quick local summary");
  saveState(state);
  return { state, recovered: true };
}

export function publicOnboardingBrain(app, fleet = {}) {
  const { state } = recoverStaleBrainAnalysis(app, fleet || {});
  return brainMeta(state);
}

function uniqueSlug(cfg, slug) {
  const base = clean(slug).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  const used = new Set((cfg.apps || []).map((a) => a.slug));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function importOldFleetApps(cfg) {
  const summary = oldFleetSummary();
  if (!summary.detected || summary.unreadable) return { ok: false, status: 404, error: "no readable old Fleet config found" };
  const old = JSON.parse(readFileSync(summary.path, "utf8"));
  cfg.apps = cfg.apps || [];
  const currentRepos = new Set(cfg.apps.map((a) => resolve(expandHome(a.repo || ""))));
  let imported = 0;
  for (const app of old.apps || []) {
    const repo = resolve(expandHome(app.repo || ""));
    if (!repo || currentRepos.has(repo)) continue;
    const copy = JSON.parse(JSON.stringify(app));
    copy.slug = uniqueSlug(cfg, copy.slug || basename(repo));
    copy.loop = "paused";
    copy.importedFrom = { product: "Fleet", at: iso(), config: summary.path };
    cfg.apps.push(copy);
    currentRepos.add(repo);
    imported++;
  }
  const ob = normalizeOnboarding(cfg);
  ob.migration = { ...(ob.migration || {}), choice: "imported", importedAt: iso(), source: summary.path };
  ob.updatedAt = iso();
  return { ok: true, imported, apps: cfg.apps.slice(-imported).map((a) => ({ id: a.slug, name: a.name, repo: a.repo })) };
}

export function applyOnboardingAction(cfg, body = {}) {
  const ob = normalizeOnboarding(cfg);
  const action = clean(body.action || "save-step");
  if (action === "reset") {
    cfg.fleet.onboarding = defaultOnboardingState();
    return { ok: true, onboarding: publicOnboarding(cfg) };
  }
  if (action === "complete") {
    ob.completed = true;
    ob.step = 4;
    ob.completedAt = iso();
  } else if (action === "save-step") {
    if (body.step !== undefined) ob.step = Math.max(0, Math.min(4, Number(body.step) || 0));
  } else if (action === "start-fresh") {
    ob.migration = { ...(ob.migration || {}), choice: "fresh", dismissedAt: iso() };
  } else if (action === "dismiss-existing") {
    ob.dismissedForExistingUser = true;
    ob.dismissedAt = iso();
  } else if (action === "set-provider") {
    ob.providerId = clean(body.providerId || body.provider) || null;
    ob.providerPath = clean(body.providerPath || body.path) || null;
  } else if (action === "save-project") {
    if (body.step !== undefined) ob.step = Math.max(ob.step || 0, Math.max(0, Math.min(4, Number(body.step) || 0)));
    ob.mode = clean(body.mode) || ob.mode;
    ob.appId = clean(body.appId || body.slug || ob.appId) || null;
    ob.projectDraft = { ...(ob.projectDraft || {}), ...(body.projectDraft || body.project || {}) };
  } else if (action === "approve-brain") {
    if (body.step !== undefined) ob.step = Math.max(ob.step || 0, Math.max(0, Math.min(4, Number(body.step) || 0)));
    ob.brainApproved = true;
    ob.brainApprovedAt = iso();
  } else if (action === "save-gates") {
    if (body.step !== undefined) ob.step = Math.max(ob.step || 0, Math.max(0, Math.min(4, Number(body.step) || 0)));
    ob.gatesApproved = body.gatesApproved !== false;
    ob.mergePolicy = clean(body.mergePolicy) || ob.mergePolicy || "approve";
    ob.shipPolicy = clean(body.shipPolicy) || ob.shipPolicy || "manual";
  } else if (action === "import-existing") {
    const r = importOldFleetApps(cfg);
    if (!r.ok) return r;
    return { ok: true, ...r, onboarding: publicOnboarding(cfg) };
  } else {
    return { ok: false, status: 400, error: "unknown onboarding action" };
  }
  ob.updatedAt = iso();
  return { ok: true, onboarding: publicOnboarding(cfg) };
}

function safeRead(file, max = 6000) {
  try { return readFileSync(file, "utf8").slice(0, max); } catch { return ""; }
}

function listFiles(root, limit = 60) {
  const out = [];
  const skip = new Set([".git", "node_modules", ".build", "build", "dist", ".next", "DerivedData", ".fleet"]);
  function walk(dir, depth) {
    if (out.length >= limit || depth > 2) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (out.length >= limit || skip.has(ent.name)) continue;
      const p = join(dir, ent.name);
      const rel = p.slice(root.length + 1);
      if (ent.isDirectory()) walk(p, depth + 1);
      else out.push(rel);
    }
  }
  walk(root, 0);
  return out;
}

function packageFacts(repo) {
  const pkgText = safeRead(join(repo, "package.json"), 12000);
  if (!pkgText) return null;
  try {
    const pkg = JSON.parse(pkgText);
    return {
      name: pkg.name || "",
      scripts: Object.keys(pkg.scripts || {}),
      dependencies: Object.keys(pkg.dependencies || {}).slice(0, 20),
      devDependencies: Object.keys(pkg.devDependencies || {}).slice(0, 20),
    };
  } catch {
    return null;
  }
}

function gitFacts(repo) {
  const run = (args) => {
    try {
      const { spawnSync } = awaitImportChildProcess();
      const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 5000 });
      return r.status === 0 ? clean(r.stdout) : "";
    } catch { return ""; }
  };
  return {
    branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
    head: run(["rev-parse", "--short", "HEAD"]),
  };
}

function awaitImportChildProcess() {
  // Static import would be cleaner, but this helper keeps older tests that monkeypatch modules
  // from seeing child_process until this optional fact gathering runs.
  return globalThis.__fleetChildProcess || (globalThis.__fleetChildProcess = requireChildProcess());
}

function requireChildProcess() {
  // ESM-safe lazy import replacement: createRequire is overkill here, so use Function only for
  // optional diagnostics. If it ever fails, git facts simply stay blank.
  try {
    return Function("return require('node:child_process')")();
  } catch {
    return { spawnSync: () => ({ status: 1, stdout: "" }) };
  }
}

function deterministicFacts(app, mode, brief = "") {
  const repo = resolve(expandHome(app.repo || ""));
  const readme = safeRead(join(repo, "README.md"), 4000) || safeRead(join(repo, "PROJECT_BRIEF.md"), 4000);
  const pkg = packageFacts(repo);
  const files = existsSync(repo) ? listFiles(repo) : [];
  const facts = [];
  facts.push({ label: "Mode", value: mode === "scratch" ? "New idea / scratch project" : "Existing code" });
  facts.push({ label: "Repository", value: repo });
  if (app.stack) facts.push({ label: "Detected stack", value: app.stack });
  if (pkg?.scripts?.length) facts.push({ label: "Scripts", value: pkg.scripts.join(", ") });
  if (files.length) facts.push({ label: "Files sampled", value: files.slice(0, 12).join(", ") });
  if (brief) facts.push({ label: "Owner brief", value: brief.slice(0, 220) });
  if (readme) facts.push({ label: "Readable product context", value: readme.replace(/\s+/g, " ").slice(0, 260) });
  return { repo, readme, pkg, files, facts };
}

export function draftGatesForApp(app, { mode = "code", brief = "" } = {}) {
  const gates = [];
  const cmds = app.commands || {};
  if (cmds.test) gates.push({ id: "gate-tests", say: "Automated test suite passes cleanly", check: "auto", probe: cmds.test, effort: "S", source: "onboarding" });
  if (cmds.build) gates.push({ id: "gate-build", say: "Production build completes without errors", check: "auto", probe: cmds.build, effort: "M", source: "onboarding" });
  gates.push({ id: "gate-empty-loading-error", say: "Core screens handle empty, loading, partial, error, and populated states", check: "agent", effort: "M", source: "onboarding" });
  gates.push({ id: "gate-real-flow", say: "Primary user workflow completes end to end with real persisted state", check: "agent", effort: "L", source: "onboarding" });
  gates.push({ id: "gate-human-release", say: mode === "scratch" ? "Owner confirms the generated product matches the original brief" : "Owner confirms the app is ready for a real release path", check: "human", effort: "S", source: "onboarding" });
  if (/payment|billing|stripe|checkout/i.test(`${brief} ${app.northStar || ""}`)) {
    gates.push({ id: "gate-payments-human", say: "Real payment and billing behavior is verified by the owner", check: "human", effort: "M", source: "onboarding" });
  }
  return normalizeGateDraft(gates);
}

function scriptsSummary(app) {
  const bits = [];
  const cmds = app.commands || {};
  for (const [k, v] of Object.entries(cmds)) if (v) bits.push(`${k}: ${v}`);
  return bits.length ? bits.join("\n") : "(no commands detected)";
}

function yamlValue(v) {
  let out = clean(v);
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) out = out.slice(1, -1);
  return out.replace(/\\"/g, '"').trim();
}

export function parseGateDraft(raw) {
  const text = String(raw || "");
  const fenced = [...text.matchAll(/```ya?ml\s*([\s\S]*?)```/gi)].map((m) => m[1]).pop() || text;
  const out = [];
  let cur = null;
  for (const line of fenced.split("\n")) {
    const start = /^\s*-\s+say:\s*(.+)\s*$/.exec(line);
    if (start) {
      if (cur) out.push(cur);
      cur = { say: yamlValue(start[1]) };
      continue;
    }
    const attr = /^\s+(check|probe|effort|why):\s*(.*?)\s*$/.exec(line);
    if (attr && cur) cur[attr[1]] = yamlValue(attr[2]);
  }
  if (cur) out.push(cur);
  return out;
}

function normalizeSay(s) {
  return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function humanReleaseEquivalent(g) {
  return g.check === "human" && /(release|ready|deploy|ship|store|owner confirms)/i.test(g.say || "");
}

function paymentEquivalent(g) {
  return g.check === "human" && /(payment|billing|stripe|checkout)/i.test(g.say || "");
}

function smokeCheckProbe(repo, cmd) {
  if (!cmd) return { runnable: false };
  const r = spawnSync("bash", ["-lc", cmd], { cwd: repo, encoding: "utf8", timeout: 60 * 1000 });
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  if (r.error) return { runnable: false };
  if (r.status === 127 || /command not found|not found|No such file or directory/i.test(text)) return { runnable: false };
  return { runnable: true };
}

function validateAgentGateDraft(app, gates, { mode = "code", brief = "" } = {}) {
  const seen = new Set();
  const repo = resolve(expandHome(app.repo || ""));
  const valid = [];
  for (const g of gates || []) {
    const check = clean(g.check).toLowerCase();
    const say = clean(g.say);
    if (!say || !["auto", "agent", "human"].includes(check)) continue;
    const key = normalizeSay(say);
    if (!key || seen.has(key)) continue;
    if (check === "auto" && COSTLY.test(g.probe || "")) continue;
    const next = { ...g, say, check, effort: ["S", "M", "L"].includes(g.effort) ? g.effort : "M", source: "agent" };
    if (next.check === "auto") {
      const smoke = smokeCheckProbe(repo, next.probe || "");
      if (!smoke.runnable) {
        next.check = "agent";
        next.say = `${next.say} (proposed command wasn't runnable here)`;
        next.probe = "";
      }
    }
    valid.push(next);
    seen.add(key);
    if (valid.length >= 8) break;
  }
  const floor = draftGatesForApp(app, { mode, brief });
  if (!valid.some(humanReleaseEquivalent)) {
    const release = floor.find((g) => g.id === "gate-human-release");
    if (release) valid.push(release);
  }
  if (/payment|billing|stripe|checkout/i.test(`${brief} ${app.northStar || ""}`) && !valid.some(paymentEquivalent)) {
    const payments = floor.find((g) => g.id === "gate-payments-human");
    if (payments) valid.push(payments);
  }
  return normalizeGateDraft(valid);
}

export async function draftGatesWithAgent(app, fleet, { mode = "code", brief = "" } = {}) {
  const fallback = draftGatesForApp(app, { mode, brief });
  if (!DRAFT_GATES_TEMPLATE || !hasOnboardingAnalysisProvider(app)) return fallback;
  const brain = (readProposed(app) || readBrain(app, { cap: 6000 }) || "").slice(0, 6000);
  const prompt = DRAFT_GATES_TEMPLATE
    .replaceAll("{{APP_NAME}}", app.name || app.slug)
    .replaceAll("{{STACK}}", app.stack || "unknown")
    .replaceAll("{{NORTH_STAR}}", app.northStar || brief || "(not given)")
    .replaceAll("{{BRAIN}}", brain || "(no brain text available)")
    .replaceAll("{{SCRIPTS}}", scriptsSummary(app))
    .replaceAll("{{MODE}}", mode || "code");
  let raw = "";
  try { raw = await explainGateDraft(app, prompt, { reasoning: "high", timeoutMs: 4 * 60 * 1000 }); } catch { return fallback; }
  const parsed = parseGateDraft(raw);
  const valid = validateAgentGateDraft(app, parsed, { mode, brief });
  return valid.some((g) => g.source === "agent") ? valid : fallback;
}

export function writeProposedBrain(app, { mode = "code", brief = "", notes = "" } = {}) {
  const { repo, readme, pkg, files, facts } = deterministicFacts(app, mode, brief);
  const deps = [...(pkg?.dependencies || []), ...(pkg?.devDependencies || [])].slice(0, 30);
  const body = `# Project Brain — ${app.name}
*Proposed by FleetLoops during onboarding from real local project context. Review and approve before live work starts. Proposed ${new Date().toISOString().slice(0, 10)}.*

## Product
${app.northStar || brief || "The owner has not written a north star yet. Treat the codebase and README as source of truth."}

## Architecture
- Repository: ${repo}
- Mode: ${mode === "scratch" ? "scratch project from owner brief" : "existing codebase"}
- Detected stack: ${app.stack || "unknown"}
${pkg ? `- Package: ${pkg.name || "(unnamed package)"}\n- Scripts: ${(pkg.scripts || []).join(", ") || "(none)"}` : "- Package metadata: none detected"}
${deps.length ? `- Key dependencies sampled: ${deps.join(", ")}` : "- Key dependencies sampled: none detected"}

## Conventions
${readme ? readme.replace(/\n{3,}/g, "\n\n").slice(0, 2500) : "No README or PROJECT_BRIEF content was found. Preserve the existing file organization and infer conventions from nearby code before editing."}

## Files Reviewed
${files.length ? files.slice(0, 40).map((f) => `- ${f}`).join("\n") : "- No files could be sampled from the project folder."}

## Owner Notes
${notes || "(none yet)"}

## Known Risks
- Live deployment, app-store submission, production secrets, real billing, and identity verification remain human-only gates.
- This onboarding brain is deterministic and local. A connected agent can refine it after approval if you request re-analysis.
`;
  const dir = join(repo, ".fleet");
  mkdirSync(dir, { recursive: true });
  writeFileSync(proposedFile(app), body.endsWith("\n") ? body : body + "\n");
  const state = loadState(app, {});
  state.brain = { status: "pending", origin: "template", version: ((state.brain && state.brain.version) || 0) + 1, notes: "", at: iso(), onboarding: true, upgradeProposed: false };
  state.onboardingGates = draftGatesForApp(app, { mode, brief });
  state.escalations = (state.escalations || []).filter((e) => e.taskId !== "__brain__");
  saveState(state);
  return { ok: true, appId: app.slug, proposed: body, facts, gates: state.onboardingGates, brain: brainMeta(state), analyzing: false };
}

export function approveOnboardingBrain(app, editedText = "") {
  const text = clean(editedText) || safeRead(proposedFile(app), 40000);
  if (text.length < 100) return { ok: false, status: 409, error: "brain text is too short to approve" };
  const state = loadState(app, {});
  const origin = state.brain?.origin || "template";
  mkdirSync(dirname(brainFile(app)), { recursive: true });
  writeFileSync(brainFile(app), text.endsWith("\n") ? text : text + "\n");
  state.brain = { ...(state.brain || {}), status: "approved", origin, version: (state.brain && state.brain.version) || 1, at: iso(), onboarding: true, ...(origin === "template" ? { upgradeProposed: state.brain?.upgradeProposed === true } : {}) };
  delete state.brain.analyzeStartedAt;
  saveState(state);
  return { ok: true };
}

export function beginOnboardingBrainAnalysis(app, fleet = {}, { mode = "code", brief = "" } = {}) {
  const { state } = recoverStaleBrainAnalysis(app, fleet || {});
  if (state.brain?.status === "analyzing") return { analyzing: true, brain: brainMeta(state), started: false };
  if (mode === "scratch" || !hasOnboardingAnalysisProvider(app)) return { analyzing: false, brain: brainMeta(state), started: false };
  const startedAt = iso();
  state.brain = { ...(state.brain || {}), status: "analyzing", origin: "template", analyzeStartedAt: startedAt, at: startedAt, onboarding: true };
  saveState(state);
  const startedVersion = state.brain.version || 0;
  comprehendProject(app, fleet || {}, { timeoutMs: 5 * 60 * 1000 })
    .then(async (proposed) => {
      const next = loadState(app, fleet || {});
      if (next.brain?.status !== "analyzing" || next.brain?.analyzeStartedAt !== startedAt) return;
      if (!proposed || proposed.length < 200) {
        next.brain = { ...(next.brain || {}), status: "pending", origin: "template", at: iso(), analyzeFailedAt: iso() };
        delete next.brain.analyzeStartedAt;
        pushLog(next, "BRAIN: deep comprehension didn't complete; continuing with the quick local summary");
      } else {
        const gates = await draftGatesWithAgent(app, fleet || {}, { mode });
        next.brain = { ...(next.brain || {}), status: "pending", origin: "ai", version: startedVersion + 1, notes: "", at: iso(), onboarding: true };
        next.onboardingGates = gates;
        delete next.brain.analyzeStartedAt;
        pushLog(next, "BRAIN: deep comprehension ready");
      }
      saveState(next);
    })
    .catch(() => {
      const next = loadState(app, fleet || {});
      if (next.brain?.status !== "analyzing" || next.brain?.analyzeStartedAt !== startedAt) return;
      next.brain = { ...(next.brain || {}), status: "pending", origin: "template", at: iso(), analyzeFailedAt: iso() };
      delete next.brain.analyzeStartedAt;
      pushLog(next, "BRAIN: deep comprehension didn't complete; continuing with the quick local summary");
      saveState(next);
    });
  return { analyzing: true, brain: brainMeta({ brain: state.brain }), started: true };
}

export function saveOnboardingGates(app, fleet, gates = []) {
  const normalized = normalizeGateDraft(gates);
  if (!normalized.length) return { ok: false, status: 400, error: "at least one enabled gate is required" };
  app.exitConditions = normalized;
  app.onboarding = { ...(app.onboarding || {}), gatesApproved: true, gatesApprovedAt: iso() };
  const state = loadState(app, fleet || {});
  state.conditions = normalized.map((g, i) => ({
    id: g.id || `gate-${i + 1}`,
    say: g.say,
    check: g.check,
    probe: g.probe || "",
    effort: g.effort || "M",
    status: "unmet",
    blockedBy: [],
    evidence: "",
    signoff: null,
    source: g.source || "onboarding",
    why: g.why || "",
    tries: 0,
    retryAfter: null,
    lastChecked: null,
  }));
  state.conditionsSeeded = iso();
  saveState(state);
  return { ok: true, gates: normalized };
}

export async function launchOnboardingApp(app, fleet, { force = false } = {}) {
  const state = loadState(app, fleet || {});
  if (!app.exitConditions || !app.exitConditions.length) return { ok: false, status: 409, error: "define at least one gate before launch" };
  const brainStatus = state.brain && state.brain.status;
  if (brainStatus !== "approved") return { ok: false, status: 409, error: "approve the project brain before launch" };
  const preflight = await runPreflight(app, fleet || {});
  const failed = (preflight.checks || []).filter((c) => c.status === "fail");
  if (failed.length) {
    return {
      ok: false,
      status: 409,
      error: `Pre-flight checks need attention: ${failed.map((c) => c.label).join(", ")}.`,
      preflight,
    };
  }
  ensureStarterTask(app, fleet || {}, preflight);
  app.loop = "running";
  app.onboarding = { ...(app.onboarding || {}), launchedAt: iso(), brainApproved: true, gatesApproved: true };
  const next = loadState(app, fleet || {});
  next.loop = "running";
  next.preflight = preflight;
  saveState(next);
  return { ok: true, preflight, forced: force === true };
}

export function attachDocumentsToApp(app, files = []) {
  const repo = resolve(expandHome(app.repo || ""));
  const dest = join(repo, ".fleet", "source-docs");
  mkdirSync(dest, { recursive: true });
  const copied = [];
  for (const raw of (Array.isArray(files) ? files : []).slice(0, 20)) {
    const src = resolve(expandHome(clean(raw.path || raw)));
    if (!existsSync(src)) continue;
    try {
      const st = statSync(src);
      if (!st.isFile() || st.size > 50 * 1024 * 1024) continue;
      const target = join(dest, basename(src));
      copyFileSync(src, target);
      copied.push(target);
    } catch {}
  }
  return copied;
}

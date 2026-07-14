import * as fs from "node:fs";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { checkCliProvider } from "./provider-cli.mjs";
import { getApiKey, hasApiKey } from "./secrets.mjs";
import { validateApiKey } from "./providers/validate.mjs";
import { resolveProvider } from "./providers/registry.mjs";
import { resolveProviderChain } from "./providers/failover.mjs";
import { COSTLY } from "./gates.mjs";
import { setupApproved } from "./security.mjs";
import { STATE_DIR, WT_ROOT, discardBranch, expandHome, loadState, resolveBaseBranch, safetyPreflight, saveState, setupWorktree } from "./loop.mjs";

const clean = (v) => String(v || "").trim();
const iso = () => new Date().toISOString();
const GiB = 1024 * 1024 * 1024;
const G = (repo, args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 30000 });

function check(id, label, status, detail, fix = "", extra = {}) {
  return { id, label, status, detail: clean(detail), fix: clean(fix), ...extra };
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function guarded(id, label, fn, timeoutMs = 30000) {
  try {
    return await withTimeout(Promise.resolve().then(fn), timeoutMs, label);
  } catch (e) {
    return check(id, label, "fail", String(e && e.message || e), "Try again after fixing this environment problem.");
  }
}

function gitRepoCheck(app) {
  const repo = expandHome(app.repo || "");
  if (!repo || !existsSync(repo)) return check("repo-exists", "Project folder", "fail", `Project folder was not found at ${app.repo || "(blank)"}.`, "Pick the project folder again in Settings.");
  const r = G(repo, ["rev-parse", "--git-dir"]);
  if (r.status !== 0) return check("repo-exists", "Git repository", "fail", "This folder is not a git repository.", "Initialize git for this project or pick the correct project folder.");
  return check("repo-exists", "Git repository", "pass", "Project folder exists and git is available.");
}

function baseBranchCheck(app) {
  const repo = expandHome(app.repo || "");
  const base = resolveBaseBranch(repo, app);
  const r = G(repo, ["rev-parse", "--verify", "--quiet", base]);
  if (r.status !== 0) return check("base-branch", "Base branch", "fail", `Base branch '${base}' does not resolve.`, "Fix the app's base branch in Settings or create the branch locally.");
  return check("base-branch", "Base branch", "pass", `Base branch '${base}' resolves.`, "", { baseBranch: base });
}

function worktreeCheck(app) {
  const repo = expandHome(app.repo || "");
  const task = { id: `preflight-${Date.now().toString(36)}`, title: "preflight" };
  const branch = `fleet/preflight-${Date.now().toString(36)}`;
  const r = setupWorktree(repo, app.slug || "app", task, branch, app);
  if (!r.ok) return check("worktree", "Isolated worktree", "fail", r.note || "Could not create a test worktree.", "Clean up old worktrees or fix the git repository.");
  const d = discardBranch(repo, task);
  if (!d.ok) return check("worktree", "Isolated worktree", "fail", d.note || "Could not remove the test worktree.", "Remove the preflight worktree manually and retry.");
  return check("worktree", "Isolated worktree", "pass", "FleetLoops can create and remove an isolated worktree.");
}

function dirtyStateCheck(app, fleet) {
  const r = safetyPreflight(app, fleet, { reportOnly: true });
  if (!r.ok) return check("dirty-state", "Working tree", "warn", r.reason || "Working tree could not be inspected.", "Review the project working tree before launch.");
  if (!r.dirty) return check("dirty-state", "Working tree", "pass", "Working tree is clean.");
  if (r.wouldAutoStash) {
    const files = (r.nonChoreFiles || r.files || []).join(", ");
    return check("dirty-state", "Working tree", "warn", `Live runs will place current source changes in a reversible stash first: ${files || "changed files"}.`, "Commit or stash your changes yourself if you do not want FleetLoops to auto-stash them.");
  }
  return check("dirty-state", "Working tree", "warn", `Uncommitted project files are present: ${(r.files || []).join(", ") || "changed files"}.`, "Review these changes before launch.");
}

async function providerCheck(app, fleet) {
  const provider = resolveProvider(app);
  if (!provider) return check("provider", "Agent provider", "fail", "No coding agent provider is selected for this project.", "Reconnect in Settings -> Agents & keys.");
  const fallbackCount = Math.max(0, resolveProviderChain(app, fleet).length - 1);
  const fallbackNote = ` Fallback providers usable now: ${fallbackCount}.`;
  if (provider.kind === "agentic-cli") {
    const s = checkCliProvider(provider.id, { deep: true });
    if (!s.ok || !s.connected) return check("provider", "Agent provider", "fail", `${provider.label}: ${s.detail || s.error || "not connected"}.${fallbackNote}`, "Reconnect in Settings -> Agents & keys.");
    return check("provider", "Agent provider", "pass", `${provider.label}: ${s.detail || "usable"}.${fallbackNote}`, "", { fallbackUsable: fallbackCount });
  }
  if (provider.auth === "none-local") {
    return check("provider", "Agent provider", "pass", `${provider.label} is configured as a local provider.${fallbackNote}`, "", { fallbackUsable: fallbackCount });
  }
  if (!hasApiKey(provider)) return check("provider", "Agent provider", "fail", `${provider.label} has no saved API key.${fallbackNote}`, "Reconnect in Settings -> Agents & keys.");
  const key = getApiKey(provider);
  const v = await validateApiKey(provider.id, key);
  if (!v.ok) return check("provider", "Agent provider", "fail", `${provider.label}: ${v.error || "key verification failed"}.${fallbackNote}`, "Reconnect in Settings -> Agents & keys.");
  return check("provider", "Agent provider", "pass", `${provider.label} key verified.${fallbackNote}`, "", { fallbackUsable: fallbackCount });
}

function setupConsentCheck(app) {
  const repo = expandHome(app.repo || "");
  const script = join(repo, ".fleet", "setup.sh");
  if (!existsSync(script)) return check("setup-consent", "Setup script consent", "pass", "No setup script needs approval.");
  if (setupApproved(STATE_DIR, repo, script)) return check("setup-consent", "Setup script consent", "pass", "Setup script is approved for this exact content.");
  return check("setup-consent", "Setup script consent", "fail", "The project's setup script needs approval before FleetLoops can run it.", "Review and approve the setup script.");
}

function gateProbeCheck(app, fleet) {
  const repo = expandHome(app.repo || "");
  let state = null;
  try { state = loadState(app, fleet || {}); } catch {}
  const gates = ((state && Array.isArray(state.conditions) && state.conditions.length) ? state.conditions : (app.exitConditions || []))
    .filter((g) => g && g.check === "auto" && clean(g.probe));
  if (!gates.length) return check("gate-probes", "Gate commands", "pass", "No automated gate commands are configured yet.", "", { gates: [] });
  const results = [];
  for (const g of gates) {
    const probe = clean(g.probe);
    if (COSTLY.test(probe)) {
      results.push({ id: g.id, say: g.say, probe, effort: g.effort || "M", runnable: false, passes: false, status: "warn", detail: "Probe looks like deploy/publish/release work and will not run." });
      continue;
    }
    const r = spawnSync("bash", ["-lc", probe], { cwd: repo, encoding: "utf8", timeout: 60000 });
    const text = `${r.stdout || ""}\n${r.stderr || ""}`;
    const missing = r.error || r.status === 127 || /command not found|not found|No such file or directory/i.test(text);
    results.push({
      id: g.id,
      say: g.say,
      probe,
      effort: g.effort || "M",
      runnable: !missing,
      passes: !missing && r.status === 0,
      status: missing ? "warn" : "pass",
      detail: missing ? "Command could not start." : (r.status === 0 ? "This gate already passes." : "This gate currently fails; that is fine, it is work to be done."),
    });
  }
  const bad = results.filter((r) => !r.runnable);
  if (bad.length) return check("gate-probes", "Gate commands", "warn", `${bad.length} automated gate command(s) could not start.`, "Edit the gate command.", { gates: results });
  const failing = results.filter((r) => r.runnable && !r.passes).length;
  return check("gate-probes", "Gate commands", "pass", failing ? `${failing} gate command(s) currently fail; FleetLoops can still run them.` : "All automated gate commands start and pass.", "", { gates: results });
}

function diskCheck() {
  if (typeof fs.statfsSync !== "function") return null;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    mkdirSync(WT_ROOT, { recursive: true });
    const dirs = [
      ["state", STATE_DIR, fs.statfsSync(STATE_DIR)],
      ["worktree cache", WT_ROOT, fs.statfsSync(WT_ROOT)],
    ];
    const low = dirs.map(([label, path, s]) => ({ label, path, free: Number(s.bavail || s.bfree || 0) * Number(s.bsize || 0) })).filter((x) => x.free < GiB);
    if (low.length) return check("disk", "Disk space", "warn", `${low[0].label} has less than 1 GB free.`, "Free disk space before long runs.");
    return check("disk", "Disk space", "pass", "State and worktree cache have more than 1 GB free.");
  } catch {
    return null;
  }
}

function readShort(file, max = 400) {
  try { return readFileSync(file, "utf8").slice(0, max); } catch { return ""; }
}

export function chooseStarterTask(app, preflight) {
  const gateReport = (preflight?.checks || []).find((c) => c.id === "gate-probes");
  const failingSmall = (gateReport?.gates || []).find((g) => g.runnable && g.passes === false && g.effort === "S");
  if (failingSmall) {
    return {
      title: `Make "${failingSmall.say}" pass`,
      acceptance: `The command exits 0 from the project root: ${failingSmall.probe}`,
    };
  }
  if (!clean(app.commands?.test)) {
    return {
      title: "Add a minimal smoke test and wire a test script so FleetLoops can verify future work",
      acceptance: "A test command exists in the project configuration and passes locally.",
    };
  }
  const repo = expandHome(app.repo || "");
  const readme = readShort(join(repo, "README.md"), 320);
  if (readme.trim().length < 300) {
    return {
      title: "Write a README covering what this project is, how to run it, and how to test it",
      acceptance: "README.md clearly explains the project purpose, local run steps, and test command.",
    };
  }
  return {
    title: "Fix all linter/type warnings in the smallest file that has any",
    acceptance: "The smallest affected file has no remaining linter or type warnings.",
  };
}

export function ensureStarterTask(app, fleet, preflight) {
  const state = loadState(app, fleet || {});
  const existing = (state.backlog || []).find((t) => t.starter === true || t.id === "starter-first-win");
  if (existing && existing.status === "done") return { ok: true, task: existing, added: false };
  const pick = chooseStarterTask(app, preflight);
  const starter = {
    id: "starter-first-win",
    title: pick.title,
    status: "queued",
    difficulty: "easy",
    category: "starter",
    priority: 1,
    starter: true,
    deps: [],
    acceptance: pick.acceptance,
    attempts: 0,
  };
  state.backlog = [starter, ...(state.backlog || []).filter((t) => t.id !== starter.id && t.starter !== true)];
  saveState(state);
  return { ok: true, task: starter, added: true };
}

export async function runPreflight(app, fleet = {}) {
  const checks = [];
  checks.push(await guarded("repo-exists", "Git repository", () => gitRepoCheck(app)));
  checks.push(await guarded("base-branch", "Base branch", () => baseBranchCheck(app)));
  checks.push(await guarded("worktree", "Isolated worktree", () => worktreeCheck(app)));
  checks.push(await guarded("dirty-state", "Working tree", () => dirtyStateCheck(app, fleet)));
  checks.push(await guarded("provider", "Agent provider", () => providerCheck(app, fleet), 30000));
  checks.push(await guarded("setup-consent", "Setup script consent", () => setupConsentCheck(app)));
  checks.push(await guarded("gate-probes", "Gate commands", () => gateProbeCheck(app, fleet), 70000));
  const disk = await guarded("disk", "Disk space", () => diskCheck());
  if (disk) checks.push(disk);
  const report = { ok: checks.every((c) => c.status !== "fail"), at: iso(), checks };
  try {
    const state = loadState(app, fleet || {});
    state.preflight = report;
    saveState(state);
  } catch {}
  return report;
}

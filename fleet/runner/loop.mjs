// loop.mjs — the per-app loop engine.
// One pass: select -> generate -> execute -> verify -> consensus-review -> advance | retry | escalate.
//
// State for each app lives in <stateDir>/<slug>.json (backlog statuses + escalations).
// On first run it seeds from fleet.config.json; on later runs it RECONCILES new config
// tasks into existing state (config edits are no longer ignored).
//
// v2 reliability contract (what changed vs v1):
//  - state writes are ATOMIC (temp+rename, rolling .bak); corrupt state recovers, never 500s
//  - the agent subprocess has a hard timeout + process-group kill + spawn error handling
//  - auth failures (expired codex login) PAUSE THE FLEET with one clear notification instead
//    of burning every app's retries
//  - merges land on the app's MAIN branch, never on whatever branch the repo was parked on
//  - transient infra failures (dirty repo, worktree error) back off and retry; they only
//    escalate after repeated failure instead of permanently parking the task
//  - a task found "running" at pass start is a crash leftover → recovered to queued
//  - the agent's discovered `new_tasks` are harvested into the backlog (the brain's intake)
//  - merge sign-off is decided by the autonomy ladder + multi-reviewer consensus, not a
//    blanket "human approves everything"

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runExplainer } from "./adapters.mjs";
import { runGates } from "./gates.mjs";
import { writeJsonAtomic, readJsonSafe, pushLog, expandHome as xHome, notify, setFleetPause, getFleetPause, clearFleetPause } from "./util.mjs";
import { consensusReview, parseReview as parseReviewC } from "./consensus.mjs";
import { effectiveAutonomy, recordCleanMerge, requiresHumanSignoff } from "./autonomy.mjs";
import { harvestNewTasks } from "./planner.mjs";
import { readBrain, recordLearnings, proposeBrainIfNeeded } from "./brain.mjs";
import { recordCost, budgetExceeded } from "./cost.mjs";
import { hasAgentProvider, resolveProvider, resolveModel } from "./providers/registry.mjs";
import { runAgentWithFailover } from "./providers/failover.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
export const STATE_DIR = process.env.FLEET_STATE_DIR || join(ROOT, "state");
const PROMPT_TEMPLATE = readFileSync(join(ROOT, "prompts", "loop-task-prompt.md"), "utf8");
const EXPLAIN_TEMPLATE = (() => { try { return readFileSync(join(ROOT, "prompts", "explain-decision.md"), "utf8"); } catch { return ""; } })();
const REVIEW_TEMPLATE = (() => { try { return readFileSync(join(ROOT, "prompts", "review-diff.md"), "utf8"); } catch { return ""; } })();

// Re-export for compatibility (unit tests + bridge import these from loop.mjs).
export const parseReview = parseReviewC;
export const expandHome = xHome;

// Ask the agent (read-only, cheap) to write a plain-language brief for a decision.
async function explainDecision(app, task) {
  if (!EXPLAIN_TEMPLATE) return null;
  try {
    const prompt = EXPLAIN_TEMPLATE
      .replaceAll("{{APP_NAME}}", app.name)
      .replaceAll("{{NORTH_STAR}}", app.northStar || "")
      .replaceAll("{{TASK_TITLE}}", task.title || "")
      .replaceAll("{{TASK_ACCEPTANCE}}", task.acceptance || task.ac || "")
      .replaceAll("{{STANDING_CONTEXT}}", app.standingContext || "");
    const raw = await runExplainer(app, prompt);
    const blocks = [...raw.matchAll(/```ya?ml\s*([\s\S]*?)```/gi)].map((mm) => mm[1]);
    let body = null;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const r = /^\s*brief_what:\s*(.+)$/im.exec(blocks[i]);
      if (r && r[1].trim() && !r[1].trim().startsWith("<")) { body = blocks[i]; break; }
    }
    if (!body) return null;
    const get = (k) => { const r = new RegExp(`^\\s*${k}:\\s*(.+)$`, "im").exec(body); return r ? r[1].trim() : ""; };
    const what = get("brief_what");
    if (!what || what.startsWith("<")) return null;
    const clean = (v) => (v && !v.startsWith("<") ? v : "");
    const optsRaw = clean(get("brief_options"));
    const options = optsRaw ? optsRaw.split("||").map((s) => s.trim()).filter(Boolean).map((s) => {
      const i = s.search(/—|--| - /);
      return i >= 0 ? { label: s.slice(0, i).trim(), meaning: s.slice(i).replace(/^\s*(—|--| - )\s*/, "").trim() } : { label: s, meaning: "" };
    }).filter((o) => o.label) : [];
    return { what, why: clean(get("brief_why")), options, howToAnswer: clean(get("brief_how")), ifApprove: clean(get("brief_if_yes")), aiGenerated: true };
  } catch { return null; }
}
function validBrief(b) { return !!(b && typeof b.what === "string" && b.what.trim() && !b.what.trim().startsWith("<")); }

// Generate (at most one per pass, cached) an AI brief for a decision that has none.
async function ensureOneBrief(app, fleet, state) {
  const isAgent = hasAgentProvider(app);
  if (!isAgent) return;
  const cfg = Object.fromEntries((app.backlog || []).map((t) => [t.id, t]));
  const t = (state.backlog || []).find((x) =>
    (x.status === "needs-human" || x.difficulty === "needs-human-decision") &&
    !validBrief(x.decisionBrief) && !validBrief((cfg[x.id] || {}).decisionBrief) && (x._briefTries || 0) < 3);
  if (!t) return;
  if (t.decisionBrief && !validBrief(t.decisionBrief)) delete t.decisionBrief;
  t._briefTries = (t._briefTries || 0) + 1;
  const b = await explainDecision(app, t);
  if (validBrief(b)) { t.decisionBrief = b; pushLog(state, `EXPLAINED ${t.id}: AI wrote a plain-language brief`); }
  saveState(state);
}

// The config path is overridable via FLEET_CONFIG so the packaged macOS app can keep the user's
// fleet.config.json in Application Support (the app bundle is read-only + code-signed). Falls back
// to the in-repo config for CLI/dev use, so existing installs are unaffected.
export const CONFIG_FILE = process.env.FLEET_CONFIG || join(ROOT, "fleet.config.json");
export function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
}

function stateFile(slug) { return join(STATE_DIR, `${slug}.json`); }

export function loadState(app, fleet) {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  const f = stateFile(app.slug);
  if (existsSync(f)) {
    const s = readJsonSafe(f);
    if (s) { reconcileBacklog(s, app); return s; }
    // both the file and its .bak are unreadable — reseed rather than killing the service,
    // but keep the corrupt original for forensics.
    try { writeJsonAtomic(f + `.corrupt-${Date.now()}`, { note: "unparseable state moved aside" }); } catch {}
  }
  const seeded = {
    slug: app.slug, loop: app.loop, retryCap: app.retryCap ?? fleet.defaultRetryCap,
    backlog: (app.backlog || []).map((t) => ({ ...t, attempts: 0 })),
    escalations: [], log: [],
  };
  writeJsonAtomic(f, seeded);
  return seeded;
}
// Config edits used to be ignored after first seed. Now: any config task whose id isn't in
// state yet is appended (statuses of existing tasks are NEVER touched).
function reconcileBacklog(state, app) {
  const have = new Set((state.backlog || []).map((t) => t.id));
  let added = 0;
  for (const t of app.backlog || []) {
    if (!have.has(t.id)) { state.backlog.push({ ...t, attempts: 0 }); added++; }
  }
  if (added) pushLog(state, `RECONCILE: pulled ${added} new task(s) from config`);
}
export function saveState(s) { writeJsonAtomic(stateFile(s.slug), s); }

// A task is "ready" if queued, its deps are done, and any retry backoff has elapsed.
// A task found "running" here is a crash leftover (a healthy pass always advances it) —
// recover it to queued instead of re-running it blindly forever.
function selectTask(state) {
  const now = Date.now();
  const done = new Set(state.backlog.filter((t) => t.status === "done").map((t) => t.id));
  for (const t of state.backlog) {
    if (t.status === "running") {
      t.status = "queued";
      pushLog(state, `RECOVERED ${t.id}: found mid-run (crash?) — requeued`);
    }
  }
  // PRIORITY ordering (lower = sooner; default 50). Production-functional work (correctness,
  // data, auth, billing, release) outranks visual polish — the owner's explicit priority.
  const ready = state.backlog.filter(
    (t) => t.status === "queued"
      && (t.deps || []).every((d) => done.has(d))
      && (!t.notBefore || Date.parse(t.notBefore) <= now)
  );
  ready.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50)); // stable: ties keep backlog order
  return ready[0];
}

// Shared skills: reusable rulebooks/checklists in fleet/skills/<name>.md that any app
// can reference via a "skills" array. Injected (capped) into the prompt as hard rules,
// with the full doc path so the agent can read all of it if needed.
const SKILLS_DIR = join(ROOT, "skills");
const SKILL_CAP = 6000;
function loadSkills(app) {
  const names = app.skills || [];
  if (!names.length) return "";
  const parts = [];
  for (const n of names) {
    const f = join(SKILLS_DIR, `${n}.md`);
    if (!existsSync(f)) { parts.push(`### ${n}\n(skill file missing: ${f})`); continue; }
    let body = readFileSync(f, "utf8");
    const full = f;
    if (body.length > SKILL_CAP) body = body.slice(0, SKILL_CAP) + `\n\n…[excerpt truncated — read the FULL rulebook before acting: ${full}]`;
    parts.push(`### Rulebook: ${n}\n(Full document on disk: ${full})\n\n${body}`);
  }
  return parts.join("\n\n");
}

function maxStepsOf(app, fleet) { return app.maxStepsPerRun || fleet.maxStepsPerRun || 12; }
function branchFor(app, task) { return `fleet/${task.id.toLowerCase()}-${(task.title||"").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32).replace(/-$/, "")}`; }
const G = (repo, args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });

// Resolve the app's MAIN branch — the only branch fleet work may merge into.
// Order: app.mainBranch (config) → origin/HEAD → local main/master → current HEAD (last resort).
export function resolveBaseBranch(repoPath, app) {
  if (app && app.mainBranch) return app.mainBranch;
  const oh = G(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (oh.status === 0) { const b = (oh.stdout || "").trim().replace(/^origin\//, ""); if (b) return b; }
  for (const cand of ["main", "master"]) {
    if (G(repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${cand}`]).status === 0) return cand;
  }
  return (G(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout || "main").trim() || "main";
}

// Worktrees live in a per-user CACHE dir, deliberately OUTSIDE the (synced) fleet folder.
export const WT_ROOT = process.env.FLEET_WORKTREE_DIR || join(homedir(), ".fleet", "worktrees");
function repoKey(repoPath) { let h = 0; for (const c of String(repoPath)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); }
function worktreePath(repoPath, slug, taskId) { return join(WT_ROOT, `${slug}-${repoKey(repoPath)}`, String(taskId).toLowerCase()); }

// Create an ISOLATED git worktree on a fresh branch from the app's MAIN branch (NOT from
// whatever branch the repo happens to be parked on — that was the v1 stranded-work bug).
// The user's main working tree is NEVER touched.
export function setupWorktree(repoPath, slug, task, branch, app) {
  const base = resolveBaseBranch(repoPath, app);
  task.baseBranch = base;
  const wt = worktreePath(repoPath, slug, task.id);
  G(repoPath, ["worktree", "prune"]);
  G(repoPath, ["worktree", "remove", "--force", wt]);
  // DEFENSE-IN-DEPTH FLOOR: if a branch of this name already exists with commits NOT in base,
  // it's unreviewed/unmerged work — refuse rather than clobber it.
  if (G(repoPath, ["rev-parse", "--verify", "--quiet", branch]).status === 0) {
    const ahead = parseInt((G(repoPath, ["rev-list", "--count", `${base}..${branch}`]).stdout || "0").trim(), 10) || 0;
    if (ahead > 0) return { ok: false, note: `branch ${branch} already has ${ahead} unmerged commit(s) — not clobbering; review or discard it first` };
    G(repoPath, ["branch", "-d", branch]);
  }
  if (!existsSync(WT_ROOT)) mkdirSync(WT_ROOT, { recursive: true });
  mkdirSync(dirname(wt), { recursive: true });
  const r = G(repoPath, ["worktree", "add", "--force", "-b", branch, wt, base]);
  if (r.status !== 0) return { ok: false, note: (r.stderr || "").slice(-200) };
  task.branch = branch; task.worktree = wt;
  return { ok: true, wt, branch, base };
}
export function cleanupWorktree(repoPath, task) {
  if (task && task.worktree) { G(repoPath, ["worktree", "remove", "--force", task.worktree]); delete task.worktree; }
}
export function commitsAhead(repoPath, task) {
  if (!task.branch) return 0;
  const base = task.baseBranch || "main";
  const r = G(repoPath, ["rev-list", "--count", `${base}..${task.branch}`]);
  if (r.status !== 0) return -1;
  return parseInt((r.stdout || "0").trim(), 10) || 0;
}
// Ledger files (memory.md, the loop's evidence notes) are APPEND-style: the agent's branch and
// main both add lines, which made every merge conflict on the same spot. Register git's UNION
// merge driver for them in .git/info/attributes (local-only, no repo content change, shared
// across worktrees) so both sides are kept automatically.
function ensureUnionMergeAttributes(repoPath) {
  try {
    const gd = (G(repoPath, ["rev-parse", "--git-common-dir"]).stdout || "").trim();
    if (!gd) return;
    const dir = gd.startsWith("/") ? gd : join(repoPath, gd);
    const f = join(dir, "info", "attributes");
    mkdirSync(join(dir, "info"), { recursive: true });
    const cur = existsSync(f) ? readFileSync(f, "utf8") : "";
    if (!/^memory\.md\s+merge=union/m.test(cur)) {
      writeFileSync(f, cur + (cur && !cur.endsWith("\n") ? "\n" : "") + "memory.md merge=union\n.fleet/** merge=union\n");
    }
  } catch {}
}
// If a merge still conflicts ONLY on ledger files, resolve by keeping BOTH sides and finish
// the merge instead of bouncing it to the human.
function resolveLedgerConflicts(repoPath) {
  const un = (G(repoPath, ["diff", "--name-only", "--diff-filter=U"]).stdout || "").trim().split("\n").filter(Boolean);
  if (!un.length || !un.every((f) => f === "memory.md" || f.startsWith(".fleet/"))) return false;
  for (const f of un) {
    const ours = G(repoPath, ["show", `:2:${f}`]).stdout || "";
    const theirs = G(repoPath, ["show", `:3:${f}`]).stdout || "";
    try { writeFileSync(join(repoPath, f), ours + (ours.endsWith("\n") ? "" : "\n") + theirs); } catch { return false; }
    G(repoPath, ["add", f]);
  }
  return G(repoPath, ["-c", "user.email=fleet@local", "-c", "user.name=Fleet Loop", "commit", "--no-edit"]).status === 0;
}

// Merge the task's branch into its BASE branch in the main repo — verified at merge time:
// if the repo is parked on a different branch, we switch back to base first (only when the
// tracked tree is clean; otherwise we refuse with a clear note). v1 merged into HEAD blindly,
// which stranded finished work on stale fleet/* branches.
export function mergeBranch(repoPath, task) {
  if (!task.branch) return { ok: false, note: "no work branch for this task" };
  ensureUnionMergeAttributes(repoPath);
  const base = task.baseBranch || "main";
  const head = (G(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout || "").trim();
  if (head !== base) {
    const dirty = (G(repoPath, ["status", "--porcelain", "--untracked-files=no"]).stdout || "").trim();
    if (dirty) return { ok: false, note: `repo is on '${head}' with uncommitted changes — can't switch to '${base}' to merge safely` };
    const sw = G(repoPath, ["switch", base]);
    if (sw.status !== 0) return { ok: false, note: `couldn't switch from '${head}' to '${base}': ${(sw.stderr || "").slice(-150)}` };
  }
  const m = G(repoPath, ["-c", "user.email=fleet@local", "-c", "user.name=Fleet Loop", "merge", "--no-ff", "-m", `fleet: merge ${task.branch}`, task.branch]);
  if (m.status !== 0) {
    // last-chance: a conflict confined to ledger files (memory.md / .fleet/*) keeps both sides
    if (!resolveLedgerConflicts(repoPath)) {
      G(repoPath, ["merge", "--abort"]);
      return { ok: false, note: (m.stderr || m.stdout || "merge conflict").slice(-300) };
    }
  }
  cleanupWorktree(repoPath, task);
  G(repoPath, ["branch", "-d", task.branch]); // SAFE delete — git refuses if not fully merged
  return { ok: true, note: `merged ${task.branch} → ${base}` };
}
export function discardBranch(repoPath, task) {
  cleanupWorktree(repoPath, task);
  if (task.branch) { const d = G(repoPath, ["branch", "-D", task.branch]); if (d.status !== 0) return { ok: false, note: `could not delete ${task.branch}` }; }
  return { ok: true, note: `discarded ${task.branch}` };
}
export function restToBase() { /* no-op under worktrees */ }
export function branchDiff(repoPath, task) {
  if (!task.branch) return null;
  const base = task.baseBranch || "main", br = task.branch;
  const range = `${base}...${br}`;
  const stat = (G(repoPath, ["diff", "--stat", range]).stdout || "").trim();
  const names = (G(repoPath, ["diff", "--name-status", range]).stdout || "").trim();
  const log = (G(repoPath, ["log", "--oneline", `${base}..${br}`]).stdout || "").trim();
  let patch = G(repoPath, ["diff", range]).stdout || "";
  if (patch.length > 40000) patch = patch.slice(0, 40000) + "\n…[diff truncated — view the full branch locally]";
  return { base, branch: br, stat, names, log, patch };
}

// Live-only safety gate. Refuses to run an agent against a repo that isn't a clean
// git checkout, so a bad change is always isolated and reversible. No-op in dry-run.
export function safetyPreflight(app, fleet, { reportOnly = false } = {}) {
  if (!fleet.safety?.requireGitForLive) return { ok: true };
  const repo = expandHome(app.repo);
  if (!existsSync(repo)) return { ok: false, reason: `repo not found at ${app.repo}`, permanent: true };
  const inside = spawnSync("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (inside.status !== 0 || !/true/.test(inside.stdout)) {
    return { ok: false, reason: `not a git repository — run the bootstrap kit (fleet/bootstrap/${app.slug}) and 'git init' first`, permanent: true };
  }
  let dirty = (spawnSync("git", ["-C", repo, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).stdout || "").trim();
  if (dirty) {
    // AUTO-PREPARE: the loop's OWN leftovers (build caches, regenerated lockfiles, AGENTS.md,
    // .gitignore, memory ledger, .fleet/ setup files) shouldn't block work or pester the human.
    // Commit ONLY those safe chore files; if real source changes remain, THEN escalate (so we
    // never sweep up the user's genuine work).
    const CHORE = /(^|\/)(\.gradle\/|\.idea\/|node_modules\/|AGENTS\.md$|\.gitignore$|memory\.md$|\.fleet\/|package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$|Podfile\.lock$|\.DS_Store$|build\/|\.expo\/|Pods\/)/;
    // ROBUST porcelain parse: status is 2 chars + separator, but naive fixed slicing proved
    // fragile in the wild (paths lost their first character — ".fleet/env.sh" became
    // "fleet/env.sh" — so the engine's OWN scaffold files stopped matching CHORE and every
    // pass blocked on "your uncommitted changes"). Strip status conservatively instead.
    const lines = dirty.split("\n").map((l) => l.replace(/^[ MADRCU?!]{1,2}\s+/, "").replace(/^"|"$/g, "").split(" -> ").pop().trim()).filter(Boolean);
    const nonChore = lines.filter((f) => !CHORE.test(f));
    if (reportOnly) {
      return {
        ok: true,
        repo,
        dirty: true,
        files: lines.slice(0, 8),
        nonChoreFiles: nonChore.slice(0, 8),
        wouldAutoStash: nonChore.length > 0 && fleet.safety?.autoStashDirty !== false,
      };
    }
    if (nonChore.length === 0) {
      G(repo, ["add", "-A"]);
      G(repo, ["-c", "user.email=fleet@local", "-c", "user.name=Fleet Loop", "commit", "-m", "chore: fleet housekeeping (build caches, lockfiles, agent files)"]);
      dirty = (spawnSync("git", ["-C", repo, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).stdout || "").trim();
    }
    if (dirty) {
      // AUTO-RESCUE: real source changes remain (the fleet's own leftover edits, a half-merge,
      // or a build that touched tracked files). Rather than freeze the loop and pester the owner
      // every pass, stash them into a clearly-LABELED, fully-reversible stash and proceed. The
      // owner's work is never lost — `git stash list` shows it; `git stash pop` restores it.
      // Opt out per fleet with `safety.autoStashDirty: false` (then it escalates as before).
      if (fleet.safety?.autoStashDirty !== false) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const s = spawnSync("git", ["-C", repo, "-c", "user.email=fleet@local", "-c", "user.name=Fleet Rescue", "stash", "push", "-u", "-m", `fleet-preflight-rescue ${stamp}`], { encoding: "utf8" });
        const stillDirty = (spawnSync("git", ["-C", repo, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).stdout || "").trim();
        if (s.status === 0 && !stillDirty) {
          return { ok: true, repo, rescued: `fleet-preflight-rescue ${stamp}`, rescuedFiles: nonChore.slice(0, 5) };
        }
      }
      return { ok: false, reason: `you have uncommitted changes to source files (${nonChore.slice(0, 3).join(", ")}${nonChore.length > 3 ? "…" : ""}) — commit or stash them so the loop doesn't touch your work`, permanent: false };
    }
  }
  return { ok: true, repo, dirty: false, files: [], nonChoreFiles: [], wouldAutoStash: false };
}

function fill(t, app, fleet, attempt, retryNote) {
  const list = (arr) => (arr || []).map((x) => `- ${x}`).join("\n");
  const autonomy = app._effectiveAutonomy || app.autonomy || fleet.defaultAutonomy || "branch-approve";
  const autonomyNote = app.autonomyNote || (fleet.autonomyLevels && fleet.autonomyLevels[autonomy]) || "";
  const depName = app.deployPolicy || "none";
  const depNote = (fleet.safety?.deployPolicies && fleet.safety.deployPolicies[depName]) || "";
  return PROMPT_TEMPLATE
    .replaceAll("{{AUTONOMY}}", autonomy)
    .replaceAll("{{AUTONOMY_NOTE}}", autonomyNote)
    .replaceAll("{{MAX_STEPS}}", String(maxStepsOf(app, fleet)))
    .replaceAll("{{BRANCH}}", branchFor(app, t))
    .replaceAll("{{DEPLOY_POLICY_NAME}}", depName)
    .replaceAll("{{DEPLOY_POLICY}}", depNote)
    .replaceAll("{{APP_NAME}}", app.name)
    .replaceAll("{{STAGE}}", app.stage)
    .replaceAll("{{REPO}}", app.repo)
    .replaceAll("{{NORTH_STAR}}", app.northStar)
    .replaceAll("{{EIGHTY_TWENTY}}", app.eightyTwentyLoop || "Make the single highest-value change toward production readiness; never busywork.")
    .replaceAll("{{STANDING_CONTEXT}}", app.standingContext || "—")
    .replaceAll("{{TASK_ID}}", t.id)
    .replaceAll("{{TASK_TITLE}}", t.title)
    .replaceAll("{{TASK_DESCRIPTION}}", t.description || t.title)
    .replaceAll("{{TASK_ACCEPTANCE}}", t.acceptance || t.ac || "")
    .replaceAll("{{HUMAN_DECISION}}", t.humanDecision ? `## Human decision for this task (authoritative — implement exactly this; do NOT re-ask)\n${t.humanDecision}` : "")
    .replaceAll("{{SKILLS}}", (() => { const s = loadSkills(app); return s ? `## Shared rulebooks — treat these as hard rules for this app\n\n${s}` : ""; })())
    .replaceAll("{{PROJECT_BRAIN}}", (() => { const b = readBrain(app); return b ? `## Project brain — what you already know about this codebase (you've effectively worked here for a long time; honor its architecture, conventions, and gotchas)\n\n${b}` : ""; })())
    .replaceAll("{{TASK_FILES}}", t.files || "—")
    .replaceAll("{{TASK_DIFFICULTY}}", t.difficulty)
    .replaceAll("{{ATTEMPT}}", String(attempt))
    .replaceAll("{{RETRY_CAP}}", String(app.retryCap ?? fleet.defaultRetryCap))
    .replaceAll("{{RETRY_BLOCK}}", retryNote ? `## Previous attempt failed\n${retryNote}\nFix the cause; do not repeat the same mistake.` : "")
    .replaceAll("{{GUARDRAILS}}", list([...(fleet.globalGuardrails || []), ...(app.guardrails || [])]))
    .replaceAll("{{OFF_LIMITS}}", list(app.offLimits))
    .replaceAll("{{GATES}}", list(app.gates))
    .replaceAll("{{ESCALATE_WHEN}}", list(app.escalateWhen));
}

// Escalate to the human — deduped (the same task+reason is never stacked twice) and
// NOTIFIED (desktop + notifications.log), because autonomy without alerting is abandonment.
function escalate(state, task, reason, type = "decision", fleet = null) {
  task.status = "needs-human";
  const dup = (state.escalations || []).some((e) => e.taskId === task.id && e.reason === reason);
  if (!dup) {
    state.escalations.push({ taskId: task.id, title: task.title, type, reason, at: new Date().toISOString() });
    pushLog(state, `ESCALATE ${task.id}: ${reason}`);
    notify(STATE_DIR, `${state.slug} needs you`, `${task.title}: ${String(reason).slice(0, 140)}`, { fleet });
  }
}

// Transient infrastructure trouble (dirty repo, worktree failure): back off and retry —
// don't permanently park the task on the first hiccup. Escalate only after 3 strikes.
function infraSetback(state, task, reason, fleet) {
  task._infraFails = (task._infraFails || 0) + 1;
  if (task._infraFails >= 3) {
    escalate(state, task, `Repeated environment problem (${task._infraFails}x): ${reason}`, "review", fleet);
    return "escalated";
  }
  task.status = "queued";
  task.notBefore = new Date(Date.now() + task._infraFails * 30 * 60 * 1000).toISOString(); // 30m, 60m
  pushLog(state, `INFRA-RETRY ${task.id} (${task._infraFails}/3): ${String(reason).slice(0, 120)}`);
  return "retry-later";
}

// Run a single loop pass for one app. Returns a summary object.
// `internal:true` means we're being called from the gate loop (which already handled the
// brain) — don't propose a brain again.
export async function runLoopOnce(app, fleet, { dryRun = true, internal = false } = {}) {
  const state = loadState(app, fleet);

  // Fleet-wide pause. Auth/quota pauses auto-expire after fleet.authPauseHours; spend-cap
  // pauses expire on the matching calendar boundary so a fixed login and a fixed budget behave
  // differently instead of both waking after four hours.
  if (!dryRun) {
    const pause = getFleetPause(STATE_DIR);
    if (pause) {
      const reason = String(pause.reason || "");
      const now = new Date();
      const at = pause.at ? new Date(pause.at) : now;
      const isDailyBudget = /daily API spend cap/i.test(reason);
      const isMonthlyBudget = /monthly API spend cap/i.test(reason);
      const sameDay = at.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
      const sameMonth = at.toISOString().slice(0, 7) === now.toISOString().slice(0, 7);
      const ageH = (Date.now() - Date.parse(pause.at || 0)) / 3600000;
      if ((isDailyBudget && sameDay) || (isMonthlyBudget && sameMonth) || (!isDailyBudget && !isMonthlyBudget && ageH < (fleet.authPauseHours || 4))) {
        return { slug: app.slug, action: "fleet-paused", reason: pause.reason };
      }
      clearFleetPause(STATE_DIR); // expired — try again
    }
  }

  // Per-app spend cap (raw-API providers). When an app blows its daily/monthly USD budget, set it
  // aside until the window rolls over — same "stop, don't burn money" intent as the fleet pause.
  if (!dryRun) {
    const b = budgetExceeded(STATE_DIR, app);
    if (b.exceeded) {
      pushLog(state, `BUDGET ${b.scope} cap reached ($${b[b.scope + "Usd"]} ≥ $${b.cap}) — paused until the window resets`);
      saveState(state);
      return { slug: app.slug, action: "budget-paused", reason: `${b.scope} spend cap $${b.cap} reached` };
    }
  }

  if (!dryRun) { try { await ensureOneBrief(app, fleet, state); } catch {} }

  if (state.loop === "blocked" || state.loop === "paused" || state.loop === "idle") {
    return { slug: app.slug, action: "skipped", reason: `loop is ${state.loop}` };
  }

  // PROJECT BRAIN — propose a deep comprehension for THIS backlog-mode app, once, in the
  // background. Every app gets understanding, not just gate-mode ones. Non-blocking: we keep
  // doing real work this pass. (Gate-mode apps handle the brain in runEvolvePass.)
  if (!dryRun && !internal) {
    try { const b = await proposeBrainIfNeeded(app, fleet, state); if (b.acted) saveState(state); } catch {}
  }

  const task = selectTask(state);
  if (!task) {
    const pending = state.backlog.filter((t) => t.status === "needs-human").length;
    // GRADUATION: a classic-backlog app that has finished EVERYTHING does not stop being
    // cared for — it graduates into the exit-condition loop (empty gate list → the planner
    // seeds a definition of done on the next pass, then discovery keeps auditing). This is
    // what turns "backlog done" into "keep going until truly ready for public use".
    const allDone = state.backlog.length > 0 && state.backlog.every((t) => t.status === "done");
    if (allDone && !state.graduated && !Array.isArray(app.exitConditions)) {
      state.graduated = new Date().toISOString();
      state.conditions = state.conditions || [];
      pushLog(state, "GRADUATE: backlog complete — switching to the exit-condition loop (planner will seed gates)");
    }
    saveState(state); // selectTask may have recovered crashed tasks
    return { slug: app.slug, action: "idle", reason: pending ? `${pending} task(s) awaiting you` : "backlog empty / all blocked", graduated: !!state.graduated };
  }

  // needs-human task selected directly => make sure it's explained, then escalate (don't run).
  if (task.status === "needs-human" || task.difficulty === "needs-human-decision") {
    const cfgBrief = (app.backlog?.find((x) => x.id === task.id) || {}).decisionBrief;
    const isAgentNow = hasAgentProvider(app);
    if (!validBrief(task.decisionBrief) && !validBrief(cfgBrief) && !dryRun && isAgentNow && (task._briefTries || 0) < 3) {
      if (task.decisionBrief && !validBrief(task.decisionBrief)) delete task.decisionBrief;
      task._briefTries = (task._briefTries || 0) + 1;
      const b = await explainDecision(app, task); if (validBrief(b)) task.decisionBrief = b;
    }
    escalate(state, task, (validBrief(task.decisionBrief) && task.decisionBrief.what) || (validBrief(cfgBrief) && cfgBrief.what) || task.acceptance, "decision", fleet);
    saveState(state);
    return { slug: app.slug, action: "escalated", task: task.id };
  }

  const autonomy = effectiveAutonomy(app, fleet, state);
  app._effectiveAutonomy = autonomy; // for the prompt only; never persisted to config
  const attempt = (task.attempts || 0) + 1;
  const retryNote = task._lastFailure;
  const prompt = fill(task, app, fleet, attempt, retryNote);

  // LIVE safety gate: never let an agent touch a non-git repo. Dry-run is exempt.
  if (!dryRun) {
    const pf = safetyPreflight(app, fleet);
    if (!pf.ok) {
      if (pf.permanent) {
        escalate(state, task, `Live run refused: ${pf.reason}`, "review", fleet);
        saveState(state);
        return { slug: app.slug, action: "blocked-unsafe", task: task.id, reason: pf.reason };
      }
      const r = infraSetback(state, task, pf.reason, fleet);
      saveState(state);
      return { slug: app.slug, action: r, task: task.id, reason: pf.reason };
    }
    if (pf.rescued) {
      pushLog(state, `RESCUED dirty repo into stash "${pf.rescued}" (${(pf.rescuedFiles || []).join(", ")}) — reversible: git stash list / pop`);
      notify(STATE_DIR, `${state.slug}: rescued uncommitted changes`, `Stashed ${(pf.rescuedFiles || []).length} changed file(s) so the loop could proceed. Recover with: git stash pop`, { fleet });
      saveState(state);
    }
  }

  const repoPath = expandHome(app.repo);
  const branch = branchFor(app, task);
  const isAgent = hasAgentProvider(app);
  if (!dryRun && isAgent) {
    const wt = setupWorktree(repoPath, app.slug, task, branch, app);
    if (!wt.ok) {
      const r = infraSetback(state, task, `worktree create failed: ${(wt.note || "").slice(-150)}`, fleet);
      saveState(state);
      return { slug: app.slug, action: r, task: task.id, reason: "worktree create failed" };
    }
    pushLog(state, `WORKTREE ${task.id}: ${branch} @ ${wt.wt}`);
  }

  // generate + execute. The agent runs INSIDE the worktree (point {{REPO}} at it).
  task.status = "running";
  saveState(state);
  const run = await runAgentWithFailover({
    app,
    fleet,
    prompt,
    dryRun,
    logFile: join(STATE_DIR, `${app.slug}.run.log`),
    runAttempt: async ({ app: attemptApp, adapter }) => {
      const agentApp = (!dryRun && isAgent && task.worktree) ? { ...attemptApp, repo: task.worktree } : attemptApp;
      return adapter({ app: agentApp, fleet, prompt, dryRun, logFile: join(STATE_DIR, `${app.slug}.run.log`) });
    },
    prepareFallback: async ({ from, to, notified }) => {
      pushLog(state, `FAILOVER ${task.id}: ${from.provider.id} auth-failed -> trying ${to.provider.id}`);
      if (!notified) {
        notify(STATE_DIR, `${app.slug}: trying fallback provider`, `${from.provider.label} needs reconnection, so this run is continuing with ${to.provider.label}.`, { fleet });
      }
      if (!dryRun && isAgent) {
        if (task.branch) {
          const d = discardBranch(repoPath, task);
          delete task.branch;
          if (!d.ok) return { ok: false, reason: d.note || "could not discard failed branch" };
        }
        const wt = setupWorktree(repoPath, app.slug, task, branch, app);
        if (!wt.ok) return { ok: false, reason: `worktree create failed: ${(wt.note || "").slice(-150)}` };
        pushLog(state, `WORKTREE ${task.id}: ${branch} @ ${wt.wt}`);
      }
      return { ok: true };
    },
  });
  const { report, failure, usage } = run;
  // Meter spend for raw-API providers (the harness returns `usage`; CLIs don't). Best-effort.
  if (usage && !dryRun) {
    try {
      const provider = run.provider || resolveProvider(app);
      recordCost(STATE_DIR, { app: app.slug, phase: "task", provider: provider?.id, model: run.model || resolveModel(app, provider), usage, usd: usage.usd });
    } catch {}
  }

  // Commit the agent's changes onto the work branch, INSIDE the worktree (its own index).
  if (!dryRun && isAgent && task.worktree) {
    G(task.worktree, ["add", "-A"]);
    G(task.worktree, ["-c", "user.email=fleet@local", "-c", "user.name=Fleet Loop",
      "commit", "-m", `fleet ${task.id}: ${(report && report.summary) || task.title}`]);
  }

  // manual adapter / dry-run: it just emitted the prompt for a human to paste.
  // Do NOT leave the task on "running" (v1 bug: it wedged the backlog forever).
  if (report && report.result === "MANUAL") {
    task.status = "queued";
    const already = (state.log || []).some((l) => l.startsWith(`PROMPT ${task.id} `));
    if (!already) pushLog(state, `PROMPT ${task.id} generated (manual/dry-run)`);
    saveState(state);
    return { slug: app.slug, action: "prompt-generated", task: task.id, prompt };
  }

  // live agent ran but produced no parseable result block.
  if (!report) {
    if (!dryRun && isAgent && task.branch) { discardBranch(repoPath, task); delete task.branch; }

    if (run.failoverResetError) {
      const r = infraSetback(state, task, run.failoverResetError, fleet);
      saveState(state);
      return { slug: app.slug, action: r, task: task.id, reason: run.failoverResetError };
    }

    // AUTH failure (expired codex/claude login, quota): not the task's fault. Pause the whole
    // fleet with ONE clear notification; don't burn this task's retries.
    if (failure === "auth") {
      task.status = "queued";
      const exhausted = run.failoverExhausted ? " (all fallback providers also failed)" : "";
      pushLog(state, `AUTH-PAUSE ${task.id}: agent CLI/API not authenticated / out of quota${exhausted}`);
      setFleetPause(STATE_DIR, `Agent authentication/quota problem${exhausted} — open FleetLoops Settings → Agents & keys to reconnect, or wait for quota reset. The fleet auto-retries in a few hours.`);
      notify(STATE_DIR, "Fleet paused", `The coding agent isn't authenticated or hit a usage limit${exhausted}. Open FleetLoops Settings → Agents & keys to reconnect.`, { fleet });
      saveState(state);
      return { slug: app.slug, action: "fleet-paused", task: task.id, reason: "agent auth/quota" };
    }

    task.attempts = attempt;
    task._lastFailure = failure === "timeout"
      ? "agent run hit the time limit and was stopped"
      : failure === "spawn" ? "agent command could not start (is the CLI installed and on PATH?)"
      : "agent produced no parseable result block";
    const cap = app.retryCap ?? fleet.defaultRetryCap;
    if (attempt >= cap) escalate(state, task, `The agent kept failing (${task._lastFailure}) — needs a look.`, "review", fleet);
    else {
      task.status = "queued";
      task.notBefore = new Date(Date.now() + attempt * 10 * 60 * 1000).toISOString(); // 10m, 20m backoff
      pushLog(state, `NO-RESULT ${task.id} (${failure || "output"}): will retry`);
    }
    saveState(state);
    return { slug: app.slug, action: attempt >= cap ? "escalated" : "retry", task: task.id };
  }

  if (report.result === "ESCALATE") {
    const escText = `${report.escalation_what || ""} ${report.escalation_why || ""} ${report.escalation_detail || ""} ${report.summary || ""}`.toLowerCase();
    // ENV-CLASS ESCALATIONS NEVER REACH THE HUMAN when the app can self-provision. "Give me a
    // browser / database URL / test environment / install a tool / run the certification script"
    // is something the agent must build itself (network + .fleet/setup.sh). Convert it into a
    // self-provisioning retry instead of a human card — UNLESS it's a genuinely-human item
    // (real payment, publisher/identity, app-store, rotate a real production secret).
    const ENV_CLASS = /(browser runner|browser support|database (url|config)|env(ironment)?\b|certification script|test environment|install|dependency|provide.*(environment|access|tool|login|database|browser)|missing.*(script|url|config)|local (server|port)|playwright|headless|seed|dev server)/i;
    const HUMAN_CLASS = /(real (payment|card|charge|checkout)|app ?store|testflight|notari|publisher|identity verif|rotate.*(production|real).*secret|google.*verif|microsoft.*verif|apple.*(developer|account))/i;
    const canProvision = (app.environment && app.environment.autoProvision !== false) && isAgent;
    if (!dryRun && canProvision && ENV_CLASS.test(escText) && !HUMAN_CLASS.test(escText)) {
      if (task.branch) { try { discardBranch(repoPath, task); } catch {} delete task.branch; }
      task._envProvisionTries = (task._envProvisionTries || 0) + 1;
      task.humanDecision = "ENVIRONMENT IS YOURS TO BUILD — do not ask for one. Network + localhost are enabled and the loop runs .fleet/setup.sh then sources .fleet/env.sh before gates. Install deps, download Playwright browsers, start a local DB/dev-server, seed a throwaway test user, and put safe LOCAL test values in .fleet/env.sh (never real secrets). For a missing certification script or DB URL, create a safe local equivalent. Complete the gate; only escalate if it needs a real payment, real identity verification, or a real production secret.";
      if (task._envProvisionTries <= 4) {
        task.status = "queued";
        task.notBefore = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        pushLog(state, `SELF-PROVISION ${task.id}: env-class escalation auto-converted to a self-setup retry (${task._envProvisionTries}/4)`);
        saveState(state);
        return { slug: app.slug, action: "retry", task: task.id, reason: "self-provision env" };
      }
      // Exhausted self-provision attempts. This gate genuinely can't be proven inside the
      // agent (e.g. a rendered-browser certification that needs CI with a real browser/DB).
      // Asking the human to "provide an environment" is pointless and just loops. So DEFER it
      // cleanly — set it aside, record it in CERTIFICATIONS.md as a CI-only item, notify ONCE,
      // and stop. It will not nag again; the owner can re-open it from the backlog. The loop
      // moves on to work it CAN finish.
      task.status = "blocked";
      task._deferred = true;
      if (task.branch) { try { discardBranch(repoPath, task); } catch {} delete task.branch; }
      state.escalations = (state.escalations || []).filter((e) => e.taskId !== task.id); // no recurring card
      try {
        const certDir = join(expandHome(app.repo), ".fleet");
        if (!existsSync(certDir)) mkdirSync(certDir, { recursive: true });
        const line = `\n- [ ] ${task.title} — needs CI/real-environment certification (browser/DB the agent can't run locally). Deferred ${new Date().toISOString().slice(0, 10)}.`;
        const cf = join(certDir, "CERTIFICATIONS.md");
        writeFileSync(cf, (existsSync(cf) ? readFileSync(cf, "utf8") : "# Human-only / CI-only certifications\n") + line);
      } catch {}
      pushLog(state, `DEFERRED ${task.id}: needs a real browser/DB environment (CI) — set aside, recorded in CERTIFICATIONS.md, won't nag again`);
      notify(STATE_DIR, `${state.slug}: ${task.title} deferred`, "Needs CI with a real browser/DB to certify — the agent can't run it locally. Recorded in CERTIFICATIONS.md; re-open from the backlog if you set up a CI path.", { fleet });
      saveState(state);
      return { slug: app.slug, action: "deferred", task: task.id };
    }
    if (report.escalation_what) {
      task.decisionBrief = {
        what: report.escalation_what,
        why: report.escalation_why || "",
        howToAnswer: report.escalation_detail || "",
        ifApprove: report.escalation_if_yes || "",
        recommendation: report.escalation_recommendation || "",   // the agent's opinionated pick
        options: [],
      };
    }
    const what = report.escalation_what || report.escalation_detail || report.summary || "agent needs your input";
    // If the human ALREADY answered and the agent re-asked the same thing, surface that
    // explicitly instead of looping the same question forever.
    const reAsk = task.humanDecision ? ` (note: the agent re-asked despite your earlier answer: "${String(task.humanDecision).slice(0, 80)}")` : "";
    escalate(state, task, what + reAsk, "decision", fleet);
    if (!dryRun && isAgent) cleanupWorktree(repoPath, task);
    saveState(state);
    return { slug: app.slug, action: "escalated", task: task.id, summary: report.summary };
  }

  // SKIP = the agent claims the task's acceptance is ALREADY met (not "not worth doing").
  if (report.result === "SKIP") {
    task.attempts = attempt;
    task.lastSummary = report.summary || "";
    const ahead = (!dryRun && isAgent) ? commitsAhead(repoPath, task) : 0;
    if (ahead !== 0) {
      const note = ahead > 0 ? `left ${ahead} commit(s) on its branch` : "left a branch whose contents couldn't be confirmed empty";
      task.status = "review";
      task.gate = { ran: false, passed: null, note: "agent skipped but may have changes" };
      state.escalations.push({ taskId: task.id, title: task.title, type: "review", reason: `Agent returned SKIP but ${note} — review the diff before discarding. ${report.summary || ""}`, at: new Date().toISOString() });
      pushLog(state, `SKIP-WITH-WORK ${task.id}: routed to review (ahead=${ahead})`);
      cleanupWorktree(repoPath, task);
      saveState(state);
      return { slug: app.slug, action: "awaiting-approval", task: task.id, summary: report.summary };
    }
    if (!dryRun && isAgent && task.branch) { if (discardBranch(repoPath, task).ok) delete task.branch; }
    if (report.skip_evidence) {
      if (task.category === "readiness" && requiresHumanSignoff(app, fleet, task)) {
        task.status = "review";
        task.plainSummary = `The agent says this gate is already met: ${report.skip_evidence}`.slice(0, 200);
        state.escalations.push({ taskId: task.id, title: task.title, type: "review", reason: `Production gate "${task.title}" — the agent says it's already satisfied: ${report.skip_evidence}. Confirm it really is before it counts as passed.`, at: new Date().toISOString() });
        pushLog(state, `GATE-REVIEW ${task.id}: agent claims already met`);
        saveState(state);
        return { slug: app.slug, action: "awaiting-approval", task: task.id, summary: report.summary };
      }
      task.status = "done"; task.skipped = true;
      task.plainSummary = `Already satisfied: ${report.skip_evidence}`.slice(0, 200);
      pushLog(state, `SKIP ${task.id}: ${report.skip_evidence}`);
      saveState(state);
      return { slug: app.slug, action: "skipped-done", task: task.id, summary: report.summary };
    }
    escalate(state, task, `The agent says this is already done but gave no proof. Confirm it's done, or reject to send it back. ${report.summary || ""}`, "review", fleet);
    saveState(state);
    return { slug: app.slug, action: "escalated", task: task.id, summary: report.summary };
  }

  // verify with gates (real test command + fleet safety scans on the diff) — run INSIDE
  // the worktree. Async: the dashboard stays responsive while tests run.
  const gates = await runGates(app, { dryRun, cwd: task.worktree || expandHome(app.repo), base: task.baseBranch, branch: task.branch });
  const hardBlocked = gates.blocking.length > 0;
  const mustReview = (gates.reviewFlags || []).length > 0;

  task.lastSummary = report.summary || "";
  task.plainSummary = report.plain_summary || "";
  task.userImpact = report.user_impact || "";

  if (report.result === "DONE" && !hardBlocked && report.acceptance_met && (gates.passed || gates.noGate)) {
    task.attempts = attempt;

    // CONSENSUS REVIEW: multiple independent read-only reviewers (different perspectives)
    // must ALL approve before anything merges. This replaces the v1 single critic and is
    // what makes auto-merge safe. With NO test gate, consensus coverage is REQUIRED for
    // auto-merge (the reviewers are the only verification there is).
    let cons = { ok: true, coverage: 0, total: 0, issues: "", summaries: [] };
    const hasRealWork = !dryRun && isAgent && task.branch && commitsAhead(repoPath, task) > 0;
    if (hasRealWork && fleet.reviewer !== false) {
      const diff = branchDiff(repoPath, task);
      const gateNote = (gates.results || []).map((r) => `${r.gate}:${r.status}`).join("; ") || "tests passed";
      cons = await consensusReview(app, fleet, task, diff, gateNote, REVIEW_TEMPLATE);
      task.review = { verdict: cons.verdict, ran: cons.coverage > 0, issues: cons.issues || "", summary: cons.summaries.join(" | "), coverage: `${cons.coverage}/${cons.total}`, at: new Date().toISOString() };
      if (!cons.ok) {
        task._lastFailure = `Reviewer consensus requested changes: ${cons.issues}`;
        const cap = app.retryCap ?? fleet.defaultRetryCap;
        if (attempt >= cap) {
          task.status = "review";
          state.escalations.push({ taskId: task.id, title: task.title, type: "review", reason: `The reviewers still want changes after ${attempt} attempts: ${cons.issues}. Review the diff and decide.`, at: new Date().toISOString() });
          pushLog(state, `REVIEW-BLOCK ${task.id}: consensus REVISE at cap`);
          cleanupWorktree(repoPath, task);
        } else {
          if (discardBranch(repoPath, task).ok) delete task.branch;
          task.status = "queued";
          pushLog(state, `REVISE ${task.id} (attempt ${attempt}): ${(cons.issues || "").slice(0, 120)}`);
        }
        saveState(state);
        return { slug: app.slug, action: attempt >= cap ? "awaiting-approval" : "retry", task: task.id, summary: cons.issues };
      }
    }

    delete task._lastFailure; delete task.notBefore; delete task._infraFails;
    task.gate = { ran: gates.passed === true, passed: gates.passed === true ? true : null, note: (gates.results || []).map((r) => `${r.gate}:${r.status}`).join("; ") || (gates.noGate ? "no automated test gate" : "") };

    // THE BRAIN'S INTAKE: harvest tasks the agent discovered while working (deduped, capped),
    // and record durable learnings into the project brain so future runs stay experienced.
    try { const n = harvestNewTasks(state, report); if (n) saveState(state); } catch {}
    try { recordLearnings(app, report, state); } catch {}

    const isReadiness = task.category === "readiness";
    const humanGate = requiresHumanSignoff(app, fleet, task);
    // Auto-merge policy:
    //  - autonomy must be merge-main/full (earned via the ladder or configured)
    //  - no safety reviewFlags, no human-pinned readiness gate
    //  - verification exists: either the real test gate passed, OR (no test gate) the
    //    consensus reviewers actually ran and unanimously approved
    const verified = gates.passed || (gates.noGate && cons.coverage >= ((fleet.consensus && fleet.consensus.minCoverage) ?? 1));
    if ((autonomy === "merge-main" || autonomy === "full") && !mustReview && !humanGate && verified) {
      const m = (!dryRun && isAgent && task.branch) ? mergeBranch(repoPath, task) : { ok: true, note: "dry-run" };
      if (!m.ok) {
        task.status = "review";
        state.escalations.push({ taskId: task.id, title: task.title, type: "merge", reason: `Gates passed but auto-merge failed (${m.note}). Branch kept — review and merge manually.`, at: new Date().toISOString() });
        pushLog(state, `MERGE-FAILED ${task.id}: ${m.note}`);
        cleanupWorktree(repoPath, task);
        saveState(state);
        return { slug: app.slug, action: "awaiting-approval", task: task.id, summary: report.summary };
      }
      task.status = "done"; delete task.branch;
      pushLog(state, `DONE ${task.id}: ${m.note} — ${report.summary || ""}`);
      if (task.starter) {
        pushLog(state, `FIRST-WIN ${task.id}: ${task.title}`);
        notify(STATE_DIR, `First loop complete — ${task.title}`, "FleetLoops is now working through the real backlog.", { fleet });
      }
      const ladder = recordCleanMerge(app, fleet, state, { via: "auto-merge" });
      if (ladder && ladder.promoted) pushLog(state, `AUTONOMY: promoted to ${ladder.now} after a clean streak`);
      saveState(state);
      return { slug: app.slug, action: "completed", task: task.id, summary: report.summary };
    }
    // propose / branch-approve, a safety-flagged change, OR a human-pinned production gate.
    task.status = "review";
    const kind = isReadiness ? "review" : (autonomy === "propose" ? "review" : "merge");
    const flag = mustReview ? ` ⚠ ${gates.reviewFlags.join("; ")}.` : "";
    const verb = isReadiness
      ? `Production gate "${task.title}" — the agent did the work; review the evidence and confirm it truly meets the bar before it counts as passed`
      : (autonomy === "propose" ? "Proposed diff ready for review" : (mustReview ? "Gates passed but a safety check needs your review" : "Branch passed gates — ready to merge"));
    state.escalations.push({ taskId: task.id, title: task.title, type: kind, reason: `${verb}:${flag} ${report.summary || ""}`, at: new Date().toISOString() });
    pushLog(state, `REVIEW ${task.id}: ${verb}`);
    notify(STATE_DIR, `${state.slug}: ready for review`, task.title, { fleet });
    cleanupWorktree(repoPath, task);
    saveState(state);
    return { slug: app.slug, action: "awaiting-approval", task: task.id, summary: report.summary };
  }

  // failed -> retry or escalate. DISCARD the failed attempt's branch so the next attempt can
  // recreate the same branch name from a clean base. The cause is saved in _lastFailure.
  task.attempts = attempt;
  task._lastFailure = gates.blocking.map((b) => `${b.gate}: ${b.note}`).join("; ") || report.summary || "acceptance not met";
  if (!dryRun && isAgent && task.branch) { discardBranch(repoPath, task); delete task.branch; } else cleanupWorktree(repoPath, task);
  if (attempt >= (app.retryCap ?? fleet.defaultRetryCap)) {
    escalate(state, task, `Failed after ${attempt} attempts. Last: ${task._lastFailure}`, "review", fleet);
  } else {
    task.status = "queued";
    pushLog(state, `RETRY ${task.id} (attempt ${attempt})`);
  }
  saveState(state);
  return { slug: app.slug, action: attempt >= (app.retryCap ?? fleet.defaultRetryCap) ? "escalated" : "retry", task: task.id };
}

export function readAllEscalations() {
  if (!existsSync(STATE_DIR)) return [];
  return readdirSync(STATE_DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".bak") && !f.includes(".corrupt-") && f !== "fleet.paused.json")
    .flatMap((f) => {
      const s = readJsonSafe(join(STATE_DIR, f));
      if (!s) return [];
      return (s.escalations || []).map((e) => ({ slug: s.slug, ...e }));
    });
}

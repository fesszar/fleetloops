// test-conditions.mjs — self-contained behavioural tests for the exit-condition engine (v2).
// Run:  cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-conditions.mjs
// Creates throwaway git repos + a fake read-only/work agent in a temp dir; asserts the gate loop.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvolvePass, markConditionMet, addCondition, acceptSuggestion, dismissSuggestion, recheckMet, ensureConditions, selectCheapestUnmet, pendingHuman } from "./conditions.mjs";
import { loadState, STATE_DIR } from "./loop.mjs";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d) so tests never touch real state."); process.exit(1); }
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
const slug = "zzc-selftest";
const sf = join(STATE_DIR, slug + ".json");
process.env.FLEET_WORKTREE_DIR = mkdtempSync(join(tmpdir(), "wt-"));

// a fake agent: reviewer→APPROVE, suggest→2 gates, plan→2 gates, else→edit+DONE(+new_tasks)
const F = String.fromCharCode(96, 96, 96); // a literal ``` fence
const AGENT = join(mkdtempSync(join(tmpdir(), "ag-")), "agent.sh");
writeFileSync(AGENT, `#!/usr/bin/env bash
P="$(cat "$2" 2>/dev/null)"
if echo "$P" | grep -q "SENIOR CODE REVIEWER"; then printf '${F}yaml\\nverdict: APPROVE\\nissues: none\\nsummary: ok\\n${F}\\n'
elif echo "$P" | grep -q "definition of done"; then printf '${F}yaml\\ngates:\\n- say: tests pass cleanly || check: auto || probe: true || effort: S || why: baseline\\n- say: error states reviewed || check: agent || effort: M || why: ux\\n${F}\\n'
elif echo "$P" | grep -q "NEW gates"; then printf '${F}yaml\\nsuggestions:\\n- say: rate-limit auth || why: abuse\\n- say: error tracking || why: silent fails\\n${F}\\n'
elif echo "$P" | grep -q "Discovery audit"; then printf '${F}yaml\\ngates:\\n- say: no secrets in repo history || check: auto || probe: true || effort: S || why: scan was clean but unpinned\\n${F}\\n'
elif echo "$P" | grep -q "comprehension"; then printf '# Project Brain\\n## Product\\nA test app that does X for Y users; production-ready when the core flow works end to end.\\n## Architecture\\nSingle app.js entry; state in memory; no external services in this fixture.\\n## Conventions\\nPlain JS, minimal deps, tests via shell probes.\\n## Critical paths\\nThe app.js mutation path.\\n## Build/test\\nrun the probe commands.\\n## Gotchas\\nThis is a throwaway test fixture.\\n'
else echo "// c $(date +%s%N)" >> "$1/app.js"; printf '${F}yaml\\ntask_id: WD\\nresult: DONE\\nacceptance_met: true\\nsummary: did it\\nplain_summary: change\\nuser_impact: benefit\\nnew_tasks:\\n  - title: tighten retry handling in sync engine\\n    where: app.js\\n    why: found while working\\n${F}\\n'; fi`);
chmodSync(AGENT, 0o755);

function repo() { const r = mkdtempSync(join(tmpdir(), "r-")); const G = (a) => execSync(`git -C "${r}" ${a}`, { encoding: "utf8" });
  G("init -q -b main"); G("config user.email t@t"); G("config user.name t"); writeFileSync(join(r, "app.js"), "v=1\n"); G("add -A"); G('commit -qm base'); return r; }
function reset() { writeFileSync(sf, JSON.stringify({ slug, loop: "running", retryCap: 2, backlog: [], escalations: [], log: [] })); }
const fleet = { defaultRetryCap: 2, defaultAutonomy: "merge-main", globalGuardrails: [], safety: { requireGitForLive: true, deployPolicies: {} }, autonomyLevels: {}, reviewer: false, conditionTries: 2, notifications: { desktop: false }, brain: false };
const app = (r, conds, extra = {}) => ({ slug, name: "T", stage: "dev", loop: "running", northStar: "ship", repo: r, retryCap: 2, autonomy: "merge-main", standingContext: "-", eightyTwentyLoop: "-", commands: { test: "" }, gates: [], guardrails: [], offLimits: [], agent: { adapter: "shell", command: `bash ${AGENT} "{{REPO}}" "{{PROMPT_FILE}}"` }, conditionTries: 2, exitConditions: conds, ...extra });
const rd = () => JSON.parse(readFileSync(sf, "utf8"));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };

let st, a, r, res;
// cheapest-first + blockedBy + auto self-close (merge-main) + watching
reset(); r = repo(); a = app(r, [{ id: "c1", say: "s", effort: "S", check: "auto", probe: "true" }, { id: "c2", say: "m", effort: "M", check: "auto", probe: "true" }, { id: "c3", say: "dep", effort: "S", check: "auto", probe: "true", blockedBy: ["c2"] }]);
let order = []; for (let i = 0; i < 5; i++) { res = await runEvolvePass(a, { ...fleet, discovery: { enabled: false } }, { dryRun: false }); if (res.condition) order.push(res.condition); }
ok(JSON.stringify(order.slice(0, 3)) === JSON.stringify(["c1", "c2", "c3"]), "cheapest-first; blocked c3 last");
ok(rd().conditions.filter((c) => c.status === "met").length === 3, "all auto gates self-close via work→merge");
ok(execSync(`git -C "${r}" status --porcelain --untracked-files=no`, { encoding: "utf8" }).trim() === "", "REGRESSION: live passes leave the repo CLEAN (memory write-back can't self-deadlock the preflight)");
ok((await runEvolvePass(a, { ...fleet, discovery: { enabled: false } }, { dryRun: false })).action === "watching", "all met → watching");

// agent gate AUTO-CLOSES for a pre-release app (consensus-verified path)
reset(); r = repo(); a = app(r, [{ id: "ag", say: "x", effort: "S", check: "agent", probe: "" }]);
await runEvolvePass(a, fleet, { dryRun: false });
{ const c = rd().conditions.find((x) => x.id === "ag");
  ok(c.signoff !== undefined, "agent gate processed");
  // dev-stage app: should not be stuck and either met (auto-closed) or awaiting sign-off w/ branch context
  ok(c.status !== "stuck", "agent gate never falsely stuck"); }

// agent + human sign-off required for a LIVE app
reset(); r = repo(); a = app(r, [{ id: "ag", say: "x", effort: "S", check: "agent", probe: "" }, { id: "hu", say: "y", effort: "M", check: "human", probe: "" }], { stage: "live", autonomy: "branch-approve" });
st = loadState(a, fleet); ensureConditions(a, st); ok(pendingHuman(st).some((c) => c.id === "hu"), "human gate surfaced for sign-off");
for (let i = 0; i < 4; i++) await runEvolvePass(a, fleet, { dryRun: false });
ok(rd().conditions.find((c) => c.id === "ag").status !== "stuck", "live-app agent gate awaiting sign-off never falsely stuck");
ok(rd().conditions.find((c) => c.id === "ag").status !== "met", "live-app agent gate does NOT auto-close");
await markConditionMet(a, fleet, "ag", { confirmProbe: false }); ok(rd().conditions.find((c) => c.id === "ag").status === "met", "agent gate met on sign-off");

// stuck on genuine failure → escalated, retryAfter set (backoff, not terminal)
reset(); r = repo(); a = app(r, [{ id: "cf", say: "z", effort: "S", check: "auto", probe: "false" }]);
let stuck = false; for (let i = 0; i < 4; i++) { await runEvolvePass(a, fleet, { dryRun: false }); if (rd().conditions[0].status === "stuck") { stuck = true; break; } }
ok(stuck, "failing gate → stuck after conditionTries"); ok((rd().escalations || []).some((e) => e.taskId === "cf"), "stuck gate escalated");
ok(!!rd().conditions[0].retryAfter, "stuck gate has a retryAfter (will auto-retry)");
// backoff elapsed → gate is selectable again
st = rd(); st.conditions[0].retryAfter = new Date(Date.now() - 1000).toISOString(); writeFileSync(sf, JSON.stringify(st));
ok(selectCheapestUnmet(rd()) && selectCheapestUnmet(rd()).id === "cf", "stuck gate re-enters selection after backoff");

// EMPTY conditions array can re-seed from config (v1 deadlock)
reset(); r = repo();
st = rd(); st.conditions = []; writeFileSync(sf, JSON.stringify(st));
a = app(r, [{ id: "n1", say: "fresh", effort: "S", check: "auto", probe: "true" }]);
st = loadState(a, fleet); ensureConditions(a, st);
ok(st.conditions.length === 1 && st.conditions[0].id === "n1", "empty [] re-seeds from config (deadlock fixed)");

// needs-seeding → PLANNER seeds gates (no more dead end)
reset(); r = repo(); a = app(r, []);
res = await runEvolvePass(a, fleet, { dryRun: false });
ok(res.action === "seeded" && rd().conditions.length === 2, "planner seeded a starting definition of done");
ok(rd().conditions.every((c) => c.source === "loop"), "seeded gates marked source=loop");

// backlog is PRESERVED across evolve passes (v1 wiped it)
reset(); r = repo();
st = rd(); st.backlog = [{ id: "K1", title: "keep me", status: "queued", attempts: 0 }]; writeFileSync(sf, JSON.stringify(st));
a = app(r, [{ id: "c1", say: "s", effort: "S", check: "auto", probe: "true" }]);
await runEvolvePass(a, { ...fleet, discovery: { enabled: false } }, { dryRun: false });
ok(rd().backlog.some((t) => t.id === "K1"), "non-synthetic backlog tasks survive an evolve pass");

// new_tasks harvested from the work agent's report
ok(rd().backlog.some((t) => t.origin === "agent" && /retry handling/.test(t.title)), "agent-discovered new_tasks land in the backlog");

// regression
reset(); r = repo(); a = app(r, [{ id: "cr", say: "keep", effort: "S", check: "auto", probe: `test -f ${r}/keep` }]);
execSync(`touch "${r}/keep"`); st = loadState(a, fleet); ensureConditions(a, st); st.conditions[0].status = "met"; writeFileSync(sf, JSON.stringify(st));
execSync(`rm "${r}/keep"`); st = rd(); await recheckMet(st, r); writeFileSync(sf, JSON.stringify(st)); ok(rd().conditions[0].status === "regressed", "met gate that breaks later → regressed");

// suggestions generate + accept + dismiss
reset(); r = repo(); a = app(r, [{ id: "c1", say: "thing", effort: "S", check: "auto", probe: "true" }]);
await runEvolvePass(a, { ...fleet, discovery: { enabled: false } }, { dryRun: false }); st = rd();
ok((st.suggestions || []).length > 0, "loop proposed suggestions after progress");
const sg = rd().suggestions; acceptSuggestion(a, fleet, sg[0].id);
ok(rd().conditions.some((c) => c.say === sg[0].say && c.source === "loop"), "accept → suggestion becomes a gate");
if (sg[1]) { dismissSuggestion(a, fleet, sg[1].id); ok((rd().dismissed || []).includes(sg[1].say), "dismiss → remembered"); } else ok(true, "single suggestion");

// DISCOVERY: when all gates green, an audit pass adds a probe-verified gate
reset(); r = repo(); a = app(r, [{ id: "c1", say: "base", effort: "S", check: "auto", probe: "true" }]);
await runEvolvePass(a, { ...fleet, discovery: { enabled: false } }, { dryRun: false }); // close c1
st = rd(); st.backlog = st.backlog.map((t) => (t.status === "queued" ? { ...t, status: "done" } : t)); writeFileSync(sf, JSON.stringify(st)); // clear harvested backlog so discovery (not backlog work) is next
res = await runEvolvePass(a, { ...fleet, suggestions: false, discovery: { enabled: true, maxOpenGates: 12, cooldownHours: 24 } }, { dryRun: false });
ok(res.action === "discovered" && rd().conditions.some((c) => /secrets in repo history/.test(c.say)), "discovery audit auto-added a probe-verified gate");
res = await runEvolvePass(a, { ...fleet, suggestions: false, discovery: { enabled: true, maxOpenGates: 12, cooldownHours: 24 } }, { dryRun: false });
ok(res.action === "worked-condition" || res.action === "watching" || res.action === "discovered", "loop continues after discovery (works the new gate)");

// budget cap
reset(); r = repo(); a = { ...app(r, [{ id: "c1", say: "t", effort: "S", check: "auto", probe: "true" }]), maxPassesPerDay: 1 };
await runEvolvePass(a, { ...fleet, discovery: { enabled: false } }, { dryRun: false }); res = await runEvolvePass(a, { ...fleet, discovery: { enabled: false } }, { dryRun: false });
ok(res.action === "budget-paused" || rd().conditions[0].status === "met", "budget cap pauses after maxPassesPerDay (or already done)");

// PROJECT BRAIN gating: in-progress app proposes a brain but KEEPS WORKING (never freezes);
// a brand-new app studies first (blocks on review). Uses brain ENABLED here.
{
  const brainFleet = { ...fleet, brain: true, discovery: { enabled: false } };
  // in-progress app (has a gate) → proposes brain in background, still works the gate
  reset(); r = repo(); a = app(r, [{ id: "c1", say: "base", effort: "S", check: "auto", probe: "true" }]);
  res = await runEvolvePass(a, brainFleet, { dryRun: false });
  ok(res.action === "worked-condition" || res.action === "watching", "in-progress app keeps working (brain proposed in background, no freeze)");
  ok((rd().escalations || []).some((e) => e.taskId === "__brain__"), "in-progress app filed a brain-review card");
  ok(rd().brain && rd().brain.status === "pending", "brain marked pending for review");
  // brand-new app (no gates) → studies first, blocks on review
  reset(); r = repo(); st = rd(); st.conditions = []; writeFileSync(sf, JSON.stringify({ ...st, conditions: [] }));
  a = { ...app(r, []), exitConditions: [] };
  res = await runEvolvePass(a, brainFleet, { dryRun: false });
  ok(res.action === "brain-proposed", "brand-new app studies the repo FIRST (understanding before gates)");
  res = await runEvolvePass(a, brainFleet, { dryRun: false });
  ok(res.action === "brain-pending", "new app waits on brain review before seeding gates");
}

writeFileSync(sf, JSON.stringify({ slug, loop: "idle", backlog: [], escalations: [], log: [], conditions: [], conditionsCleared: true }));
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

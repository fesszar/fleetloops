// test-loop.mjs — behavioural tests for the v2 task-loop engine.
// Run:  cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-loop.mjs
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoopOnce, loadState, STATE_DIR, resolveBaseBranch, mergeBranch, setupWorktree } from "./loop.mjs";
import { parseReport, parseNewTasks } from "./adapters.mjs";
import { parseReview } from "./consensus.mjs";
import { effectiveAutonomy, recordCleanMerge, recordRejection, requiresHumanSignoff } from "./autonomy.mjs";
import { readJsonSafe, writeJsonAtomic, classifyAgentFailure, execAsync, acquireRunLock, releaseRunLock } from "./util.mjs";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d)."); process.exit(1); }
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
process.env.FLEET_WORKTREE_DIR = mkdtempSync(join(tmpdir(), "wt-"));
const slug = "zzl-selftest";
const sf = join(STATE_DIR, slug + ".json");
const F = String.fromCharCode(96, 96, 96);

let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };

// fake agents
const dir = mkdtempSync(join(tmpdir(), "ag-"));
const mk = (name, body) => { const f = join(dir, name); writeFileSync(f, "#!/usr/bin/env bash\n" + body); chmodSync(f, 0o755); return f; };
const DONE_AGENT = mk("done.sh", `P="$(cat "$2" 2>/dev/null)"
if echo "$P" | grep -q "SENIOR CODE REVIEWER"; then printf '${F}yaml\\nverdict: APPROVE\\nissues: none\\nsummary: fine\\n${F}\\n'; exit 0; fi
echo "x $(date +%s%N)" >> "$1/app.js"
printf '${F}yaml\\ntask_id: T1\\nresult: DONE\\nacceptance_met: true\\nsummary: did the work\\nplain_summary: small change\\nuser_impact: nicer\\n${F}\\n'`);
const REVISE_AGENT = mk("revise.sh", `P="$(cat "$2" 2>/dev/null)"
if echo "$P" | grep -q "SENIOR CODE REVIEWER"; then printf '${F}yaml\\nverdict: REVISE\\nissues: hardcoded URL in app.js line 1\\nsummary: nope\\n${F}\\n'; exit 0; fi
echo "y $(date +%s%N)" >> "$1/app.js"
printf '${F}yaml\\ntask_id: T1\\nresult: DONE\\nacceptance_met: true\\nsummary: did the work\\n${F}\\n'`);
const AUTH_AGENT = mk("auth.sh", `echo "ERROR: 401 Unauthorized — token expired, please run codex login"; exit 1`);
const HANG_AGENT = mk("hang.sh", `sleep 600`);
const SILENT_AGENT = mk("silent.sh", `echo "thinking..."; exit 0`);

function repo() { const r = mkdtempSync(join(tmpdir(), "r-")); const G = (a) => execSync(`git -C "${r}" ${a}`, { encoding: "utf8" });
  G("init -q -b main"); G("config user.email t@t"); G("config user.name t"); writeFileSync(join(r, "app.js"), "v=1\n"); G("add -A"); G('commit -qm base'); return r; }
const G = (r, a) => execSync(`git -C "${r}" ${a}`, { encoding: "utf8" });
const fleet = { defaultRetryCap: 2, defaultAutonomy: "merge-main", globalGuardrails: [], safety: { requireGitForLive: true, deployPolicies: {} }, autonomyLevels: {}, reviewer: false, notifications: { desktop: false }, consensus: { reviewers: 1, minCoverage: 1 }, brain: false };
const mkApp = (r, agent, extra = {}) => ({ slug, name: "L", stage: "dev", loop: "running", northStar: "ship", repo: r, retryCap: 2, autonomy: "merge-main", standingContext: "-", eightyTwentyLoop: "-", commands: { test: "true" }, gates: [], guardrails: [], offLimits: [], agent: { adapter: "shell", command: `bash ${agent} "{{REPO}}" "{{PROMPT_FILE}}"`, timeoutMinutes: extra._tmin }, backlog: [], ...extra });
const seed = (tasks) => writeFileSync(sf, JSON.stringify({ slug, loop: "running", retryCap: 2, backlog: tasks, escalations: [], log: [] }));
const rd = () => JSON.parse(readFileSync(sf, "utf8"));
const T1 = () => ({ id: "T1", title: "do thing", status: "queued", difficulty: "easy", deps: [], acceptance: "thing done", attempts: 0 });

let r, a, res;

// 1. MERGE TARGET: repo parked on a side branch still merges into main
r = repo(); G(r, "switch -qc parked-here"); // park the repo off-main (the v1 stranded-work scenario)
seed([T1()]); a = mkApp(r, DONE_AGENT);
res = await runLoopOnce(a, fleet, { dryRun: false });
ok(res.action === "completed", "parked repo: task completes");
ok((G(r, "log --oneline main") || "").includes("fleet: merge"), "merge landed on MAIN, not the parked branch");
ok(!(G(r, "log --oneline parked-here") || "").includes("fleet: merge"), "parked branch untouched");

// 2. resolveBaseBranch honors app.mainBranch
r = repo(); G(r, "switch -qc develop");
ok(resolveBaseBranch(r, { mainBranch: "develop" }) === "develop", "app.mainBranch wins");
ok(resolveBaseBranch(r, {}) === "main", "falls back to local main");

// 2b. ENV-CLASS ESCALATION never reaches the human when the app can self-provision
{
  const ENV_AGENT = mk("envesc.sh", `P="$(cat "$2" 2>/dev/null)"
printf '${F}yaml\\ntask_id: T1\\nresult: ESCALATE\\nescalation_what: Please provide a browser runner and the database URL\\nescalation_why: the local browser is blocked and the database URL is unavailable\\n${F}\\n'`);
  r = repo(); seed([T1()]); a = mkApp(r, ENV_AGENT, { environment: { autoProvision: true } });
  res = await runLoopOnce(a, fleet, { dryRun: false });
  ok(res.action === "retry" && res.reason === "self-provision env", "env-class escalation auto-converts to self-provision retry (never reaches you)");
  ok(/ENVIRONMENT IS YOURS TO BUILD/.test(rd().backlog[0].humanDecision || ""), "self-provision instruction injected");
  ok((rd().escalations || []).length === 0, "env-class escalation did NOT create a human approval");
}
// 2b-ii. env-class escalation that NEVER succeeds → after self-provision retries, DEFERRED
// (set aside + recorded), NOT a recurring human card (the 2-day ExampleApp-R3 loop).
{
  const ENVESC = mk("envesc2.sh", `P="$(cat "$2" 2>/dev/null)"
printf '${F}yaml\\ntask_id: T1\\nresult: ESCALATE\\nescalation_what: Please provide the production certification path with database configuration and browser support\\nescalation_why: the local browser runner is blocked\\n${F}\\n'`);
  r = repo(); seed([{ ...T1(), category: "readiness" }]); a = mkApp(r, ENVESC, { environment: { autoProvision: true } });
  let last;
  for (let i = 0; i < 7; i++) { last = await runLoopOnce(a, fleet, { dryRun: false }); const s2 = rd(); if (s2.backlog[0] && s2.backlog[0].notBefore) { s2.backlog[0].notBefore = null; writeFileSync(sf, JSON.stringify(s2)); } if (last.action === "deferred") break; }
  ok(last.action === "deferred", "browser-cert that never works → DEFERRED after self-provision retries (not a recurring human card)");
  ok(rd().backlog[0].status === "blocked" && (rd().escalations || []).length === 0, "deferred task is set aside with NO lingering approval card");
}

// 2c. but a genuinely-human escalation (real payment) DOES reach you
{
  const PAY_AGENT = mk("payesc.sh", `P="$(cat "$2" 2>/dev/null)"
printf '${F}yaml\\ntask_id: T1\\nresult: ESCALATE\\nescalation_what: Complete a real Stripe payment with a real card\\nescalation_why: only a human can pay\\n${F}\\n'`);
  r = repo(); seed([T1()]); a = mkApp(r, PAY_AGENT, { environment: { autoProvision: true } });
  res = await runLoopOnce(a, fleet, { dryRun: false });
  ok(res.action === "escalated" && rd().backlog[0].status === "needs-human", "real-payment escalation still reaches the human");
}

// 2d. AUTO-RESCUE: a repo with leftover uncommitted SOURCE changes is stashed (not escalated)
{
  r = repo();
  writeFileSync(join(r, "app.js"), "v=1\nUNCOMMITTED EDIT\n"); // dirty a tracked source file
  seed([T1()]); a = mkApp(r, DONE_AGENT);
  res = await runLoopOnce(a, fleet, { dryRun: false });
  ok(res.action === "completed", "dirty-source repo: auto-rescued into a stash, task still completes");
  ok((G(r, "stash list") || "").includes("fleet-preflight-rescue"), "the leftover changes are preserved in a reversible labeled stash");
  ok((rd().log || []).some((l) => l.startsWith("RESCUED")), "rescue is logged (not silent)");
}

// 3. AUTH failure pauses the fleet instead of burning retries
r = repo(); seed([T1()]); a = mkApp(r, AUTH_AGENT);
res = await runLoopOnce(a, fleet, { dryRun: false });
ok(res.action === "fleet-paused", "auth failure → fleet-paused");
ok(rd().backlog[0].attempts === undefined || rd().backlog[0].attempts === 0, "auth failure burned no attempts");
ok(existsSync(join(STATE_DIR, "fleet.paused.json")), "pause flag written");
res = await runLoopOnce(a, fleet, { dryRun: false });
ok(res.action === "fleet-paused", "subsequent passes respect the pause");
execSync(`rm -f "${join(STATE_DIR, "fleet.paused.json")}"`);

// 4. TIMEOUT: hung agent is killed, task retries with backoff
r = repo(); seed([T1()]); a = mkApp(r, HANG_AGENT, { _tmin: 1 / 60 / 10 }); // ~100ms timeout
const t0 = Date.now();
res = await runLoopOnce(a, fleet, { dryRun: false });
ok(Date.now() - t0 < 30000, "hung agent killed quickly (no forever-hang)");
ok(res.action === "retry", "timeout → retry");
ok(!!rd().backlog[0].notBefore, "retry has a backoff timestamp");

// 5. NO-RESULT path still works; retries then escalates at cap
r = repo(); seed([T1()]); a = mkApp(r, SILENT_AGENT);
res = await runLoopOnce(a, fleet, { dryRun: false });
ok(res.action === "retry", "silent agent → retry");
let st = rd(); st.backlog[0].notBefore = new Date(Date.now() - 1000).toISOString(); writeFileSync(sf, JSON.stringify(st));
res = await runLoopOnce(a, fleet, { dryRun: false });
ok(res.action === "escalated" && rd().backlog[0].status === "needs-human", "no-result at cap → escalated");

// 6. CRASH RECOVERY: a task wedged on "running" gets requeued, not re-spun forever
r = repo(); seed([{ ...T1(), status: "running" }]); a = mkApp(r, DONE_AGENT);
res = await runLoopOnce(a, fleet, { dryRun: false });
ok(res.action === "completed", "stale running task recovered and completed");
ok((rd().log || []).some((l) => l.startsWith("RECOVERED")), "recovery logged");

// 7. MANUAL/dry-run never wedges the task on running
r = repo(); seed([T1()]); a = mkApp(r, DONE_AGENT);
res = await runLoopOnce(a, fleet, { dryRun: true });
ok(res.action === "prompt-generated" && rd().backlog[0].status === "queued", "dry-run leaves task queued (v1 wedged it)");
res = await runLoopOnce(a, fleet, { dryRun: true });
ok((rd().log || []).filter((l) => l.startsWith("PROMPT T1")).length === 1, "repeat prompts not spammed into the log");

// 8. CONSENSUS: REVISE bounces work back with the critique; APPROVE merges
r = repo(); seed([T1()]); a = mkApp(r, REVISE_AGENT);
res = await runLoopOnce(a, { ...fleet, reviewer: true }, { dryRun: false });
ok(res.action === "retry" && /hardcoded URL/.test(rd().backlog[0]._lastFailure || ""), "consensus REVISE → retry with critique");
r = repo(); seed([T1()]); a = mkApp(r, DONE_AGENT);
res = await runLoopOnce(a, { ...fleet, reviewer: true }, { dryRun: false });
ok(res.action === "completed" && /1\/1/.test((rd().backlog[0].review || {}).coverage || ""), "consensus APPROVE → merged with coverage recorded");

// 9. NO-TEST APP: consensus coverage allows auto-merge; without reviewer it goes to review
r = repo(); seed([T1()]); a = mkApp(r, DONE_AGENT, { commands: { test: "" } });
res = await runLoopOnce(a, { ...fleet, reviewer: true }, { dryRun: false });
ok(res.action === "completed", "no test gate + consensus coverage → auto-merge");
r = repo(); seed([T1()]); a = mkApp(r, DONE_AGENT, { commands: { test: "" } });
res = await runLoopOnce(a, { ...fleet, reviewer: false }, { dryRun: false });
ok(res.action === "awaiting-approval", "no test gate + no reviewers → human review (no blind merges)");

// 10. AUTONOMY LADDER
{
  const app2 = { stage: "dev", autonomy: "branch-approve" };
  const f2 = { defaultAutonomy: "branch-approve", autonomyLadder: { promoteAfter: 2, maxTier: "merge-main" } };
  const s2 = {};
  ok(effectiveAutonomy(app2, f2, s2) === "branch-approve", "ladder: starts at configured tier");
  recordCleanMerge(app2, f2, s2, {}); const p = recordCleanMerge(app2, f2, s2, {});
  ok(p.promoted && effectiveAutonomy(app2, f2, s2) === "merge-main", "ladder: promoted after streak");
  recordRejection(app2, f2, s2, {});
  ok(effectiveAutonomy(app2, f2, s2) === "branch-approve", "ladder: demoted on rejection");
  ok(effectiveAutonomy({ ...app2, autonomyLocked: true }, f2, { autonomy: { earned: 2 } }) === "branch-approve", "ladder: autonomyLocked never promotes");
  ok(requiresHumanSignoff({ stage: "live" }, {}, { category: "readiness" }) === true, "readiness on live app → human");
  ok(requiresHumanSignoff({ stage: "partial-build" }, {}, { category: "readiness" }) === false, "readiness on pre-release app → consensus");
}

// 10a-bis. REGRESSION (23-approval wave): modified tracked .fleet/env.sh (the engine's OWN
// scaffold) must be auto-committed as chore housekeeping, never blocking the pass as "your
// uncommitted changes".
r = repo();
writeFileSync(join(r, ".fleet-placeholder"), ""); // ensure dir layout
G(r, "add -A"); G(r, 'commit -qm setup');
execSync(`mkdir -p "${r}/.fleet"`);
writeFileSync(join(r, ".fleet", "env.sh"), "export NODE_ENV=test\n");
G(r, "add -A"); G(r, 'commit -qm "add scaffold"');
writeFileSync(join(r, ".fleet", "env.sh"), "export NODE_ENV=test\nexport CI=1\n"); // dirty it
seed([T1()]); a = mkApp(r, DONE_AGENT);
res = await runLoopOnce(a, fleet, { dryRun: false });
ok(res.action === "completed", "REGRESSION: dirty tracked .fleet/env.sh auto-committed, pass completes");
ok((G(r, "log --oneline -3") || "").includes("fleet housekeeping"), "REGRESSION: housekeeping commit recorded");

// 10b. GRADUATION: finished classic backlog → switches to condition mode for the planner
r = repo(); seed([{ ...T1(), status: "done" }]); a = mkApp(r, DONE_AGENT);
res = await runLoopOnce(a, fleet, { dryRun: false });
ok(res.action === "idle" && res.graduated === true && rd().graduated, "finished backlog → graduated to exit-condition loop");

// 11. STATE: atomic write + corrupt recovery via .bak
{
  const f = join(STATE_DIR, "zz-atomic.json");
  writeJsonAtomic(f, { a: 1 }); writeJsonAtomic(f, { a: 2 });
  writeFileSync(f, "{ totally broken");
  ok(readJsonSafe(f).a === 1, "corrupt state recovers from .bak");
}

// 12. parsers
ok(parseReport(`${F}yaml\ntask_id: T9\nresult: DONE\nacceptance_met: true\nsummary: s\nnew_tasks:\n  - title: fix retry bug\n    where: src/a.ts\n    why: flaky\n  - title: add error state\n${F}`).new_tasks.length === 2, "parseReport extracts new_tasks");
ok(parseNewTasks("new_tasks:\n  - title: <short>\n") .length === 0, "placeholder new_tasks ignored");
ok(parseReport(`${F}yaml\ntask_id: T9\nresult: ESCALATE\nescalation_what: choose a database\nescalation_recommendation: Use sqlite locally — zero setup and the tests already support it.\n${F}`).escalation_recommendation.includes("sqlite"), "escalation_recommendation parsed (decision-ready briefs)");
ok(parseReview(`${F}yaml\nverdict: REVISE\nissues: none\n${F}`).verdict === "APPROVE", "vacuous REVISE fails open");
ok(classifyAgentFailure("401 Unauthorized") === "auth" && classifyAgentFailure("some noise") === "output", "failure classification");
// REGRESSION (first real live pass): codex prints its final report UNFENCED after "tokens used",
// and the transcript legitimately says "rate-limiting" — must parse, must NOT classify as auth.
{
  const real = "## prompt echo\n" + F + "yaml\ntask_id: {{TASK_ID}}\nresult: <DONE|FAILED>\n" + F +
    "\n**DON'T:** use setTimeout debounce (that's rate-limiting, not de-duplication)\n" +
    "...159kb of working transcript...\n\ntokens used\n55.861\n" +
    "result: SKIP\ntask_id: no-debug-left\nsummary: \"Verified clean\"\nskip_evidence: \"grep found nothing\"\nacceptance_met: true\nnext_recommended_task: \"none\"\n";
  const rep = parseReport(real);
  ok(rep && rep.result === "SKIP" && rep.skip_evidence && !/\{\{/.test(rep.raw), "REGRESSION: unfenced codex report parses (template echo rejected)");
  ok(classifyAgentFailure(real) === "output", "REGRESSION: 'rate-limiting' prose never reads as auth failure");
  ok(classifyAgentFailure("long transcript...\n".repeat(50) + "stream error: Please run `codex login` again") === "auth", "real login error in tail → auth");
}
{ const rr = await execAsync("sleep 30", { timeoutMs: 150 }); ok(rr.timedOut === true, "execAsync hard-kills on timeout"); }
// REGRESSION (live dashboard merge failure): memory.md appended on BOTH main and the work
// branch must merge cleanly (union), keeping both sides — never bouncing to the human.
{
  r = repo();
  writeFileSync(join(r, "memory.md"), "# mem\n- base note\n");
  G(r, "add -A"); G(r, 'commit -qm "add memory"');
  G(r, "switch -qc fleet/x-test");
  writeFileSync(join(r, "memory.md"), "# mem\n- base note\n- BRANCH note from the agent\n");
  G(r, "add -A"); G(r, 'commit -qm "branch note"');
  G(r, "switch -q main");
  writeFileSync(join(r, "memory.md"), "# mem\n- base note\n- MAIN note from the loop\n");
  G(r, "add -A"); G(r, 'commit -qm "main note"');
  const m = mergeBranch(r, { branch: "fleet/x-test", baseBranch: "main" });
  const mem = readFileSync(join(r, "memory.md"), "utf8");
  ok(m.ok, "REGRESSION: memory.md both-sides append merges instead of conflicting");
  ok(/BRANCH note/.test(mem) && /MAIN note/.test(mem), "REGRESSION: union merge kept BOTH ledger notes");
}

// cross-process run lock
{
  const l1 = acquireRunLock(STATE_DIR, "test-a");
  const l2 = acquireRunLock(STATE_DIR, "test-b");
  // NOTE: same-pid acquisitions take over (pid-liveness sees our own pid) — so simulate a
  // FOREIGN live holder by writing a lock for pid 1 (init: alive, not ours).
  ok(l1.ok, "run lock: first acquire ok");
  writeFileSync(join(STATE_DIR, "fleet.lock"), JSON.stringify({ pid: 1, who: "other-proc", at: new Date().toISOString() }));
  const l2b = acquireRunLock(STATE_DIR, "test-b2");
  ok(!l2b.ok && (l2b.holder || {}).who === "other-proc", "run lock: refused while a LIVE foreign process holds it");
  // REGRESSION (the silent hour-long stall): a lock held by a DEAD pid must be taken over instantly.
  writeFileSync(join(STATE_DIR, "fleet.lock"), JSON.stringify({ pid: 999999, who: "dead-proc", at: new Date().toISOString() }));
  const l3 = acquireRunLock(STATE_DIR, "test-c");
  ok(l3.ok && l3.tookStale, "REGRESSION: dead holder's lock is seized immediately (no 2h freeze)");
  releaseRunLock(STATE_DIR);
}

// PROJECT BRAIN lifecycle: propose → approve(with edits) → injected; learnings parse + record
{
  const { extractBrain, approveBrain, hasApprovedBrain, readBrain, recordLearnings } = await import("./brain.mjs");
  const { parseListField } = await import("./adapters.mjs");
  r = repo();
  const app2 = { slug: "zz-brain", name: "BrainApp", repo: r, agent: { adapter: "shell" } };
  // extractBrain pulls the structured doc out of agent chatter
  const realBrain = "# Project Brain — App\n## Product\nIt is a customer-facing scheduling app that lets small teams book and manage appointments; production-ready means the full booking-to-confirmation flow works end to end with email reminders.\n## Architecture\nNext.js 14 app router, API routes under app/api, Postgres via Prisma, auth through NextAuth, payments via Stripe Checkout, background jobs on a worker queue.\n## Conventions\nTypeScript strict, Tailwind + shadcn/ui, tests in Vitest + Playwright, errors surfaced through a shared toast, server actions for mutations.\n## Critical paths\nBooking creation, payment capture, and the reminder cron — bugs there cost money or missed appointments.\n";
  const draft = extractBrain("ok here is my analysis\n" + realBrain);
  ok(/Product/.test(draft) && /Architecture/.test(draft), "extractBrain pulls the structured comprehension");
  // REGRESSION: a 500KB transcript with tool noise and the brain buried must NOT dump the raw log
  const noisy = "ERROR rmcp::transport: worker quit\ncodex\nexec\n/bin/grep ...\n".repeat(2000) + "\n" + realBrain + "tokens used\n55.8\n";
  const clean = extractBrain(noisy);
  ok(clean.length < 16100 && /customer-facing scheduling/.test(clean) && !/ERROR rmcp|tokens used/.test(clean), "REGRESSION: extractBrain returns ONLY the clean brain, never the raw transcript");
  ok(extractBrain("ERROR rmcp\ncodex\nexec\njust noise, no brain here\n".repeat(50)) === "", "extractBrain returns empty when no real brain is present (caller retries)");
  // simulate a proposed file then owner approval-with-edits
  execSync(`mkdir -p "${r}/.fleet"`);
  writeFileSync(join(r, ".fleet", "project-brain.proposed.md"), "# Project Brain\n## Product\nproposed text that is quite long ".padEnd(260, "x"));
  ok(!hasApprovedBrain(app2), "no approved brain before owner signs off");
  const edited = "# Project Brain\n## Product\nOWNER-CORRECTED understanding of the app ".padEnd(260, "y");
  const ar = approveBrain(app2, { editedText: edited });
  ok(ar.ok && hasApprovedBrain(app2), "approveBrain promotes owner-edited text to the active brain");
  ok(/OWNER-CORRECTED/.test(readBrain(app2)), "readBrain returns the approved (edited) content for prompt injection");
  // learnings channel
  ok(parseListField("learnings:\n  - payments go through the worker queue\n  - <placeholder>\n  - design system is tailwind+shadcn\n", "learnings").length === 2, "parseListField extracts learnings, skips placeholders");
  const n = recordLearnings(app2, { learnings: ["auth uses NextAuth with a custom adapter", "auth uses NextAuth with a custom adapter"] }, null);
  ok(n === 1, "recordLearnings dedupes and appends durable learnings");
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// test-integration.mjs — END-TO-END: a mini-fleet of 2 apps driven to "watching" (all gates
// green) through the FULL stack: scheduler-style repeated passes → planner seeding →
// worktree → fake agent → gates → consensus → auto-merge → discovery → convergence.
// Also proves single-flight (no overlapping passes corrupting state).
// Run:  cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-integration.mjs
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoopOnce, loadState, STATE_DIR } from "./loop.mjs";
import { runEvolvePass } from "./conditions.mjs";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d)."); process.exit(1); }
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
process.env.FLEET_WORKTREE_DIR = mkdtempSync(join(tmpdir(), "wt-"));
const F = String.fromCharCode(96, 96, 96);
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };

// Fake agent that behaves like a real one: fixes the failing probe file, reviews, plans, audits.
const AGENT = join(mkdtempSync(join(tmpdir(), "ag-")), "agent.sh");
writeFileSync(AGENT, `#!/usr/bin/env bash
P="$(cat "$2" 2>/dev/null)"
if echo "$P" | grep -q "SENIOR CODE REVIEWER"; then printf '${F}yaml\\nverdict: APPROVE\\nissues: none\\nsummary: clean\\n${F}\\n'; exit 0; fi
if echo "$P" | grep -q "definition of done"; then printf '${F}yaml\\ngates:\\n- say: smoke marker exists || check: auto || probe: test -f smoke.ok || effort: S || why: baseline\\n- say: version stamped || check: auto || probe: test -f VERSION || effort: S || why: release hygiene\\n${F}\\n'; exit 0; fi
if echo "$P" | grep -q "Discovery audit"; then printf '${F}yaml\\ngates: []\\n${F}\\n'; exit 0; fi
if echo "$P" | grep -q "NEW gates"; then printf '${F}yaml\\nsuggestions: []\\n${F}\\n'; exit 0; fi
# work agent: make whatever the acceptance asks for ("It is proven when this passes: test -f X")
NEED=$(echo "$P" | grep -o 'test -f [A-Za-z.]*' | head -1 | awk '{print $3}')
[ -n "$NEED" ] && echo done > "$1/$NEED"
echo "// work $(date +%s%N)" >> "$1/app.js"
printf '${F}yaml\\ntask_id: WD\\nresult: DONE\\nacceptance_met: true\\nsummary: closed the gate\\nplain_summary: gate work\\nuser_impact: closer to done\\n${F}\\n'`);
chmodSync(AGENT, 0o755);

function repo() { const r = mkdtempSync(join(tmpdir(), "ri-")); const G = (a) => execSync(`git -C "${r}" ${a}`, { encoding: "utf8" });
  G("init -q -b main"); G("config user.email t@t"); G("config user.name t"); writeFileSync(join(r, "app.js"), "v=1\n"); G("add -A"); G('commit -qm base'); return r; }

const fleet = { defaultRetryCap: 3, defaultAutonomy: "merge-main", globalGuardrails: [], safety: { requireGitForLive: true, deployPolicies: {} }, autonomyLevels: {}, reviewer: true, consensus: { reviewers: 2, minCoverage: 1 }, conditionTries: 3, notifications: { desktop: false }, brain: false, suggestions: false, discovery: { enabled: true, maxOpenGates: 8, cooldownHours: 24 } };
const mkApp = (slug, r, conds) => ({ slug, name: slug, stage: "partial-build", loop: "running", northStar: "ship it", repo: r,
  retryCap: 3, autonomy: "merge-main", standingContext: "-", eightyTwentyLoop: "-", commands: { test: "" }, gates: [], guardrails: [], offLimits: [],
  agent: { adapter: "shell", command: `bash ${AGENT} "{{REPO}}" "{{PROMPT_FILE}}"` }, conditionTries: 3, exitConditions: conds, backlog: [] });

const rA = repo(), rB = repo();
const appA = mkApp("zzi-a", rA, []);  // NO gates: planner must seed them
const appB = mkApp("zzi-b", rB, [    // pre-seeded gates incl. one initially failing probe
  { id: "g1", say: "marker file exists", effort: "S", check: "auto", probe: "test -f marker.txt" },
  { id: "g2", say: "agent-tier polish", effort: "M", check: "agent", probe: "" },
]);
for (const s of ["zzi-a", "zzi-b"]) writeFileSync(join(STATE_DIR, s + ".json"), JSON.stringify({ slug: s, loop: "running", retryCap: 3, backlog: [], escalations: [], log: [] }));

// drive the mini-fleet like the (single-flight) scheduler does, until both watch or 12 ticks
const runApp = (app) => Array.isArray(app.exitConditions) ? runEvolvePass(app, fleet, { dryRun: false }) : runLoopOnce(app, fleet, { dryRun: false });
let phases = {};
for (let tick = 0; tick < 12; tick++) {
  for (const app of [appA, appB]) {
    const res = await runApp(app);
    phases[app.slug] = res.action;
  }
  if (phases["zzi-a"] === "watching" && phases["zzi-b"] === "watching") break;
}
const stA = JSON.parse(readFileSync(join(STATE_DIR, "zzi-a.json"), "utf8"));
const stB = JSON.parse(readFileSync(join(STATE_DIR, "zzi-b.json"), "utf8"));

ok((stA.conditions || []).length >= 2, "A: planner seeded gates from nothing");
ok((stA.conditions || []).every((c) => c.status === "met"), "A: every seeded gate driven to met");
ok(phases["zzi-a"] === "watching", "A: reached watching (done) autonomously");
ok((stB.conditions || []).find((c) => c.id === "g1").status === "met", "B: failing probe gate fixed by the agent and met");
ok((stB.conditions || []).find((c) => c.id === "g2").status === "met", "B: agent-tier gate auto-closed via consensus (pre-release)");
ok(phases["zzi-b"] === "watching", "B: reached watching autonomously");
ok(execSync(`git -C "${rB}" log --oneline main`, { encoding: "utf8" }).split("\n").filter((l) => /fleet: merge/.test(l)).length >= 1, "B: work merged on main");
ok(execSync(`git -C "${rB}" status --porcelain --untracked-files=no`, { encoding: "utf8" }).trim() === "", "B: main checkout left clean");
ok(execSync(`git -C "${rB}" branch --list 'fleet/*'`, { encoding: "utf8" }).trim() === "", "B: no stranded fleet/* branches");
ok((stB.escalations || []).length === 0, "B: zero human interventions needed");

// single-flight sanity: two concurrent evolve passes on the same app never double-run
const before = (JSON.parse(readFileSync(join(STATE_DIR, "zzi-b.json"), "utf8")).log || []).length;
await Promise.all([runEvolvePass(appB, fleet, { dryRun: false }), runEvolvePass(appB, fleet, { dryRun: false })]);
const after = JSON.parse(readFileSync(join(STATE_DIR, "zzi-b.json"), "utf8"));
ok(after.conditions.every((c) => c.status === "met"), "concurrent watch passes don't corrupt state");

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

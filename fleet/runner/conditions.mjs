// conditions.mjs — the EXIT-CONDITION loop.
//
// An app's "done" is a list of exit conditions (gates). Each pass we close the CHEAPEST unmet
// gate, then stop when all are green and switch to a watching mode that (a) re-checks for
// regressions and (b) runs bounded DISCOVERY audits that propose new gates until the auditors
// genuinely find nothing. The actual work (worktree → agent → tests → consensus → merge) runs
// through the verified runLoopOnce by handing it ONE synthetic task per condition.
//
// A condition:
//   { id, say, check:"auto"|"agent"|"human", probe, effort:"S"|"M"|"L",
//     status:"unmet"|"met"|"regressed"|"stuck"|"blocked", blockedBy:[ids],
//     evidence, signoff:{evidence,branch,at}|null, source:"seed"|"you"|"loop", tries,
//     retryAfter }   ← stuck gates RETRY with exponential backoff; stuck is no longer terminal
//
// v2 fixes vs v1:
//  - an EMPTY conditions array can re-seed (v1 deadlocked on `[]` forever)
//  - "needs-seeding" is no longer a dead end: a read-only planner pass proposes the starting
//    definition of done (spec'd behavior, previously unimplemented)
//  - runEvolvePass no longer DESTROYS the app's backlog (v1 wiped seeded tasks + the branch
//    references the dashboard's Approve button needs)
//  - agent-tier gates auto-close for pre-release apps (consensus already reviewed the work);
//    human sign-off is reserved for live/shipping apps and human-tier gates
//  - probes run async (no event-loop freeze) with process-group kill

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadState, saveState, expandHome, runLoopOnce, resolveBaseBranch, mergeBranch } from "./loop.mjs";
import { runExplainer } from "./adapters.mjs";
import { execAsync, pushLog, ensureRepoSetup, withRepoEnv } from "./util.mjs";
import { seedConditions, discoveryPass } from "./planner.mjs";
import { brainStatus, hasApprovedBrain, proposeBrainIfNeeded } from "./brain.mjs";
import { hasAgentProvider } from "./providers/registry.mjs";

const EFFORT_RANK = { S: 0, M: 1, L: 2 };
const DEFAULT_TRIES = 3;            // tries before a gate is marked stuck (then: backoff retries)
const PROBE_TIMEOUT_MS = 1000 * 60 * 15;

// --- seeding -------------------------------------------------------------
export function ensureConditions(app, state) {
  if (Array.isArray(state.conditions) && state.conditions.length) return state.conditions;
  const seed = app.exitConditions || [];
  // Seed from config whenever we have nothing — including the v1 deadlock case where a stray
  // `conditions: []` could never re-seed. `conditionsSeeded` records that a deliberate seeding
  // happened so an owner who intentionally deletes ALL gates isn't fought by the engine.
  if (!Array.isArray(state.conditions)) state.conditions = [];
  if (!state.conditions.length && seed.length && !state.conditionsCleared) {
    state.conditions = seed.map((c, i) => normalizeCondition(c, i));
    state.conditionsSeeded = new Date().toISOString();
  }
  return state.conditions;
}
export function normalizeCondition(c, i = 0) {
  return {
    id: c.id || `cond-${i + 1}`,
    say: c.say || c.id || "(unnamed condition)",
    check: ["auto", "agent", "human"].includes(c.check) ? c.check : "auto",
    probe: c.probe || "",
    effort: ["S", "M", "L"].includes(c.effort) ? c.effort : "M",
    status: c.status || "unmet",
    blockedBy: Array.isArray(c.blockedBy) ? c.blockedBy : [],
    evidence: c.evidence || "",
    signoff: c.signoff || null,
    source: c.source || "seed",
    tries: c.tries || 0,
    retryAfter: c.retryAfter || null,
    lastChecked: c.lastChecked || null,
  };
}

// --- probing -------------------------------------------------------------
// Run a condition's probe (read-only check). Returns {ok, out}. Never runs a deploy/costly cmd.
const COSTLY = /eas build|--auto-submit|fastlane|upload|promote|publish|notari|app ?store|testflight|--track|vercel|netlify|firebase deploy|wrangler|serverless deploy|(?:fly|flyctl) deploy|heroku|gh release|(?:npm|yarn|pnpm) run deploy|git push/i;
export async function runProbe(probe, cwd) {
  if (!probe) return { ok: false, out: "(no probe defined)" };
  if (COSTLY.test(probe)) return { ok: false, out: "(refused: probe looks like a deploy/costly command)" };
  await ensureRepoSetup(cwd);
  const r = await execAsync(withRepoEnv(cwd, probe), { cwd, timeoutMs: PROBE_TIMEOUT_MS });
  return { ok: !r.timedOut && r.status === 0, out: (r.out || "").slice(-800) };
}

// Re-run the probes of conditions currently believed MET, to catch regressions.
export async function recheckMet(state, cwd) {
  let regressed = 0;
  for (const c of state.conditions) {
    if (c.check !== "auto" || !c.probe || c.status !== "met") continue;
    const r = await runProbe(c.probe, cwd);
    c.lastChecked = new Date().toISOString();
    if (!r.ok) { c.status = "regressed"; c.evidence = r.out; regressed++; }
  }
  return regressed;
}

// --- selection (quick wins first; stuck gates retry after their backoff) --
const now = () => Date.now();
const stuckEligible = (c) => c.status === "stuck" && c.retryAfter && Date.parse(c.retryAfter) <= now();
const isOpen = (c) => c.status === "unmet" || c.status === "regressed" || stuckEligible(c);
function depsMet(c, byId) { return (c.blockedBy || []).every((id) => (byId[id] || {}).status === "met"); }

export function selectCheapestUnmet(state) {
  const byId = Object.fromEntries(state.conditions.map((c) => [c.id, c]));
  const workable = state.conditions.filter(
    // Skip gates whose work is already done and waiting on YOU (ANY pending sign-off) — they
    // aren't re-worked (that would collide on the branch name); they wait for your action.
    (c) => isOpen(c) && c.check !== "human" && !c.signoff && depsMet(c, byId)
  );
  if (!workable.length) return null;
  workable.sort((a, b) => (EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort]) || (a.tries - b.tries));
  return workable[0];
}

// Human-tier conditions whose blockers are all met and that still need your sign-off.
export function pendingHuman(state) {
  const byId = Object.fromEntries(state.conditions.map((c) => [c.id, c]));
  return state.conditions.filter((c) => c.check === "human" && c.status !== "met" && depsMet(c, byId));
}

// --- one synthetic task per condition (flows through the verified loop) --
function synthTask(cond) {
  const difficulty = cond.effort === "S" ? "easy" : cond.effort === "L" ? "hard" : "medium";
  return {
    id: cond.id, title: cond.say, status: "queued", difficulty, deps: [],
    acceptance: `${cond.say}.${cond.probe ? ` It is proven when this passes: ${cond.probe}` : ""}`,
    files: "—", attempts: 0, _condition: true,
  };
}
// Insert/refresh the synthetic task WITHOUT destroying the rest of the backlog (v1 wiped it).
// Keep: all non-synthetic tasks, and synthetic tasks that are awaiting a human (their branch
// reference is what the dashboard's Approve button merges).
function placeSynthTask(state, task) {
  const keep = (state.backlog || []).filter((t) =>
    t.id !== task.id && (!t._condition || ["review", "needs-human"].includes(t.status)));
  state.backlog = [task, ...keep];
}

// Does an AGENT-tier gate still need the owner's click? Live/shipping apps: yes (real users).
// Pre-release apps: no — the work already passed gates + reviewer consensus inside the loop.
function agentGateNeedsHuman(app, fleet) {
  if (app.requireHumanSignoff) return true;
  const policy = (fleet && fleet.signoff && fleet.signoff.agentGates) || "stage-based";
  if (policy === "human") return true;
  if (policy === "consensus") return false;
  return app.stage === "live" || app.stage === "shipping";
}

function backoffMs(tries) {
  // 1h, 4h, then 24h forever — a stuck gate keeps retrying with a fresh strategy, never burns.
  const over = Math.max(0, tries - DEFAULT_TRIES);
  return Math.min(24, [1, 4, 24][Math.min(over, 2)]) * 3600 * 1000;
}

// --- memory write-back -----------------------------------------------------
// READ from memory.md (the human/agent-maintained ledger) but WRITE the loop's own notes to
// .fleet/memory.log — an UNTRACKED file. v2 fix: appending to the tracked memory.md dirtied
// the repo, which the next pass's safety preflight then refused to touch (self-deadlock,
// observed live on ExampleApp).
function memoryFile(app) {
  const repo = expandHome(app.repo || "");
  return repo ? join(repo, "memory.md") : "";
}
export function readMemory(app) {
  const parts = [];
  const f = memoryFile(app);
  if (f && existsSync(f)) { try { parts.push(readFileSync(f, "utf8").slice(0, 4000)); } catch {} }
  const lg = f ? join(expandHome(app.repo), ".fleet", "memory.log") : "";
  if (lg && existsSync(lg)) { try { parts.push("## Loop notes\n" + readFileSync(lg, "utf8").slice(-2000)); } catch {} }
  return parts.join("\n\n") || "(no memory.md)";
}
function appendMemory(app, line) {
  const repo = expandHome(app.repo || "");
  if (!repo || !existsSync(repo)) return;
  try {
    const dir = join(repo, ".fleet");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "memory.log"), `\n- ${new Date().toISOString().slice(0, 10)} ${line}`);
  } catch {}
}

// --- the pass ------------------------------------------------------------
// One exit-condition pass for one app. Returns a summary. dryRun never executes/merges.
export async function runEvolvePass(app, fleet, { dryRun = true } = {}) {
  const state0 = loadState(app, fleet);
  ensureConditions(app, state0);
  saveState(state0);
  const repo = expandHome(app.repo);

  if (state0.loop === "blocked" || state0.loop === "paused" || state0.loop === "idle") {
    return { slug: app.slug, action: "skipped", reason: `loop is ${state0.loop}` };
  }

  // PROJECT BRAIN — the deep, owner-approved understanding that makes every run "experienced".
  // On first sight (or when the owner asks for a re-analysis), study the repo and PROPOSE a
  // comprehension for review. Gate-seeding waits for an approved brain so the definition of
  // done is informed by real understanding, not a cold first glance.
  // PROJECT BRAIN. Onboarding (no gates yet) studies the repo FIRST — understanding before a
  // definition of done. Apps already in progress get a one-time brain proposal IN THE
  // BACKGROUND and keep working; they never freeze waiting for your review (that was the old
  // "loops stopped" trap). Either way the brain rides into runs only once you approve it.
  // PROJECT BRAIN. Onboarding (no gates yet) studies the repo FIRST — understanding before a
  // definition of done. Apps already in progress get a one-time brain proposal in the
  // BACKGROUND and keep working (no freeze). Shared helper → identical behavior to the backlog
  // loop, so EVERY app gets a brain.
  const isAgentApp = hasAgentProvider(app);
  const onboarding = !state0.conditions.length;
  if (!dryRun && isAgentApp && !hasApprovedBrain(app)) {
    const before = brainStatus(state0);
    if (onboarding) {
      const b = await proposeBrainIfNeeded(app, fleet, state0);
      if (b.acted) { saveState(state0); return { slug: app.slug, action: b.status === "pending" ? "brain-proposed" : "brain-failed" }; }
      if (before === "pending") return { slug: app.slug, action: "brain-pending", reason: "waiting on your review of the project understanding (Approvals)" };
    } else {
      // in-progress: propose once in the background, then fall through to real gate work
      try { const b = await proposeBrainIfNeeded(app, fleet, state0); if (b.acted) saveState(state0); } catch {}
    }
  }

  // NO GATES YET → the planner seeds the starting definition of done (read-only pass).
  // v1 returned "needs-seeding" forever; now seeding is the loop's own job.
  if (!state0.conditions.length) {
    if (dryRun || !isAgentApp) {
      return { slug: app.slug, action: "needs-seeding", reason: "no exit conditions yet — run live with an agent adapter so the planner can propose them" };
    }
    let proposed = [];
    try { proposed = await seedConditions(app, fleet); } catch {}
    if (!proposed.length) {
      return { slug: app.slug, action: "needs-seeding", reason: "planner couldn't propose gates (agent unavailable?) — add one on the dashboard to start" };
    }
    const st = loadState(app, fleet);
    st.conditions = proposed.map((c, i) => normalizeCondition({ ...c, source: "loop" }, i));
    st.conditionsSeeded = new Date().toISOString();
    pushLog(st, `BRAIN: planner seeded ${st.conditions.length} starting gate(s) — review them on the dashboard`);
    saveState(st);
    appendMemory(app, `planner seeded ${st.conditions.length} exit conditions`);
    return { slug: app.slug, action: "seeded", count: st.conditions.length };
  }

  // RECONCILE: an auto gate whose work is on a branch you merged elsewhere (Approvals) is "met"
  // the moment its probe passes on the base branch.
  if (!dryRun) {
    for (const c of state0.conditions) {
      if (c.check === "auto" && c.signoff && c.status !== "met" && c.probe) {
        const r = await runProbe(c.probe, repo);
        if (r.ok) { c.status = "met"; c.evidence = r.out; c.signoff = null; }
      }
    }
    saveState(state0);
  }

  // BUDGET FLOOR: cap how many real (live) work passes an app spends per day. Resets daily.
  const today = new Date().toISOString().slice(0, 10);
  const budget = state0.budget && state0.budget.day === today ? state0.budget : { day: today, passes: 0 };
  const maxPasses = app.maxPassesPerDay || fleet.maxPassesPerDay || 40;
  if (!dryRun && budget.passes >= maxPasses) {
    state0.budget = budget; state0.loopPhase = "budget-paused";
    pushLog(state0, `EVOLVE: daily budget reached (${maxPasses} passes) — paused until tomorrow`);
    saveState(state0);
    return { slug: app.slug, action: "budget-paused", reason: `hit ${maxPasses} passes today` };
  }

  // Pick the cheapest workable gate (auto/agent, unblocked, not in backoff).
  const cond = selectCheapestUnmet(state0);

  if (!cond) {
    // Nothing to work on the gate list. Either everything's met (verify → discover → watch)
    // or we're waiting on you.
    let phase;
    if (state0.conditions.every((c) => c.status === "met")) {
      const reg = !dryRun ? await recheckMet(state0, repo) : 0;
      if (reg > 0) { phase = "working"; }
      else {
        // Backlog leftovers (e.g. readiness tasks) still queued? Work those before idling.
        const classic = (state0.backlog || []).find((t) => !t._condition && t.status === "queued");
        if (classic && !dryRun) {
          saveState(state0);
          const res = await runLoopOnce(app, fleet, { dryRun, internal: true });
          return { slug: app.slug, action: "worked-backlog", task: res.task || null, sub: res.action };
        }
        // DISCOVERY: audit one dimension for NEW problems. Auto-accept probe-verifiable gates;
        // agent-tier proposals go to suggestions for the owner. Bounded + cooled-down inside.
        if (!dryRun) {
          try {
            const found = await discoveryPass(app, fleet, state0);
            if (found && found.gates.length) {
              let accepted = 0;
              for (const g of found.gates) {
                const dup = state0.conditions.some((c) => c.say.toLowerCase() === g.say.toLowerCase())
                  || (state0.dismissed || []).some((s) => s.toLowerCase() === g.say.toLowerCase());
                if (dup) continue;
                if (g.check === "auto" && g.probe) {
                  state0.conditions.push(normalizeCondition({ ...g, source: "loop" }, state0.conditions.length));
                  accepted++;
                } else {
                  state0.suggestions = state0.suggestions || [];
                  if (state0.suggestions.length < 5) state0.suggestions.push({ id: `sug-${Date.now().toString(36)}-${accepted}`, say: g.say, why: g.why || `found in ${found.dimension} audit`, check: g.check, effort: g.effort, source: "loop" });
                }
              }
              if (accepted) pushLog(state0, `BRAIN: ${found.dimension} audit added ${accepted} gate(s)`);
              else pushLog(state0, `BRAIN: ${found.dimension} audit — proposals queued for you (or none new)`);
              saveState(state0);
              if (accepted) return { slug: app.slug, action: "discovered", dimension: found.dimension, added: accepted };
            } else if (found) {
              pushLog(state0, `BRAIN: ${found.dimension} audit found nothing — that's progress toward truly done`);
            }
          } catch {}
        }
        phase = "watching";
      }
    } else {
      phase = "waiting-on-you";
    }
    state0.loopPhase = phase;
    pushLog(state0, `EVOLVE: ${phase} (${state0.conditions.filter((c) => c.status === "met").length}/${state0.conditions.length} gates green)`);
    saveState(state0);
    return { slug: app.slug, action: phase, met: state0.conditions.filter((c) => c.status === "met").length, total: state0.conditions.length };
  }

  // A stuck gate coming off backoff re-opens for a fresh attempt.
  if (cond.status === "stuck") { cond.status = "unmet"; cond.retryAfter = null; pushLog(state0, `EVOLVE ${cond.id}: backoff elapsed — retrying a stuck gate with a fresh attempt`); }

  // Hand ONE synthetic task to the verified loop. Its test gate = this condition's probe.
  const task = synthTask(cond);
  placeSynthTask(state0, task);
  state0.loopPhase = "working";
  saveState(state0);

  const appForRun = { ...app, commands: { ...(app.commands || {}), test: cond.probe || (app.commands && app.commands.test) || "" } };
  const res = await runLoopOnce(appForRun, fleet, { dryRun, internal: true });

  // Interpret the verified loop's outcome into this condition's status.
  const st = loadState(app, fleet);
  ensureConditions(app, st);
  const t = (st.backlog || []).find((x) => x.id === task.id) || {};
  const c = st.conditions.find((x) => x.id === cond.id);
  if (c) {
    if (t.status === "done") {
      if (c.check === "auto") { c.status = "met"; c.evidence = (t.gate && t.gate.note) || t.lastSummary || "probe passed + merged"; c.signoff = null; c.retryAfter = null; }
      else if (c.check === "agent" && !agentGateNeedsHuman(app, fleet)) {
        // Pre-release app: gates + consensus already verified the work. Closing it is the
        // autonomous path; the evidence trail stays on the dashboard.
        c.status = "met"; c.evidence = t.userImpact || t.lastSummary || "work complete (gates + reviewer consensus)"; c.signoff = null; c.retryAfter = null;
        pushLog(st, `GATE-MET ${c.id}: auto-closed (consensus-verified, pre-release app)`);
      }
      else { c.signoff = { evidence: t.userImpact || t.lastSummary || "work complete — needs your sign-off", branch: t.branch || null, at: new Date().toISOString() }; }
    } else if (t.status === "review" || t.status === "needs-human") {
      // Work is on a branch / a decision is needed → your call. This is PROGRESS (awaiting you),
      // not a failed attempt, so it does NOT count toward the stuck budget.
      c.signoff = { evidence: t.plainSummary || t.lastSummary || t.userImpact || "branch ready for your review", branch: t.branch || null, at: new Date().toISOString() };
    } else {
      // genuine failure / retry — ONLY this increments the stuck counter.
      c.tries = (c.tries || 0) + 1;
      if (c.tries >= (app.conditionTries || fleet.conditionTries || DEFAULT_TRIES)) {
        c.status = "stuck";
        c.retryAfter = new Date(Date.now() + backoffMs(c.tries)).toISOString();
        c.evidence = t._lastFailure || "couldn't make progress after several tries";
        const reason = `Gate "${c.say}" is stuck after ${c.tries} tries: ${c.evidence}. It will auto-retry later with a fresh approach — or re-scope it, do it manually, or drop it.`;
        if (!(st.escalations || []).some((e) => e.taskId === c.id)) {
          st.escalations.push({ taskId: c.id, title: c.say, type: "review", reason, at: new Date().toISOString() });
        }
      }
    }
  }
  if (!dryRun) { appendMemory(app, `worked gate "${cond.say}" → ${t.status || "?"}`); budget.passes += 1; st.budget = budget; }
  pushLog(st, `EVOLVE ${cond.id}: ${t.status || "?"} (tries=${c ? c.tries : 0})`);
  saveState(st);

  // SUGGEST (opt-in): after a pass that made PROGRESS, let the loop propose ≤2 contextual
  // new gates for the owner. Read-only, best-effort, bounded.
  const progressed = t.status === "done" || t.status === "review" || t.status === "needs-human";
  if (!dryRun && progressed) { try { await maybeSuggest(app, fleet); } catch {} }
  return { slug: app.slug, action: "worked-condition", condition: cond.id, taskResult: t.status || null };
}

// Read-only suggestion generator. Asks the agent (cheap, read-only) for up to 2 NEW exit conditions
// that this app still plausibly needs, given its memory + current gates.
const SUGGEST_TEMPLATE = (() => { try { return readFileSync(new URL("../prompts/suggest-conditions.md", import.meta.url), "utf8"); } catch { return ""; } })();
async function maybeSuggest(app, fleet) {
  if (fleet.suggestions === false || !SUGGEST_TEMPLATE) return;
  const st = loadState(app, fleet); ensureConditions(app, st);
  st.suggestions = st.suggestions || [];
  if (st.suggestions.length >= 2) return;                 // don't pile up
  const dismissed = new Set((st.dismissed || []).map((s) => s.toLowerCase()));
  const have = new Set(st.conditions.map((c) => (c.say || "").toLowerCase()));
  const memory = readMemory(app);
  const gatesList = st.conditions.map((c) => `- [${c.check}/${c.status}] ${c.say}`).join("\n");
  const prompt = SUGGEST_TEMPLATE
    .replaceAll("{{APP_NAME}}", app.name).replaceAll("{{NORTH_STAR}}", app.northStar || "")
    .replaceAll("{{MEMORY}}", memory).replaceAll("{{GATES}}", gatesList || "(none yet)");
  let raw = ""; try { raw = await runExplainer(app, prompt); } catch { return; }
  const block = [...String(raw).matchAll(/```ya?ml\s*([\s\S]*?)```/gi)].map((m) => m[1]).pop();
  if (!block) return;
  const added = [];
  for (const line of block.split("\n")) {
    const m = /^\s*-\s*say:\s*(.+?)\s*(?:\|\|\s*why:\s*(.+))?$/i.exec(line);
    if (!m) continue;
    const say = m[1].trim().replace(/^["']|["']$/g, "");
    if (!say || say.startsWith("<") || have.has(say.toLowerCase()) || dismissed.has(say.toLowerCase())) continue;
    added.push({ id: `sug-${Date.now().toString(36)}-${added.length}`, say, why: (m[2] || "").trim(), check: "agent", effort: "M", source: "loop" });
    if (st.suggestions.length + added.length >= 2) break;
  }
  if (added.length) { st.suggestions.push(...added); pushLog(st, `SUGGEST: proposed ${added.length} new gate(s)`); saveState(st); }
}

// Called by the bridge when YOU sign off a condition (✓) or when a code branch for a condition
// merges. For auto gates whose work is still sitting on an unmerged fleet/ branch, MERGE IT
// FIRST, then confirm the probe on base (v1 probed base without merging → your ✓ was rejected).
export async function markConditionMet(app, fleet, condId, { confirmProbe = true } = {}) {
  const st = loadState(app, fleet);
  ensureConditions(app, st);
  const c = st.conditions.find((x) => x.id === condId);
  if (!c) return { ok: false, note: "no such condition" };
  const repo = expandHome(app.repo);
  if (c.check === "auto" && confirmProbe && c.probe) {
    let r = await runProbe(c.probe, repo);
    if (!r.ok && c.signoff && c.signoff.branch) {
      const stub = { branch: c.signoff.branch, baseBranch: resolveBaseBranch(repo, app) };
      const m = mergeBranch(repo, stub);
      if (m.ok) { pushLog(st, `GATE-MERGE ${condId}: ${m.note} (sign-off)`); r = await runProbe(c.probe, repo); }
    }
    if (!r.ok) { saveState(st); return { ok: false, note: "probe still fails — not marking met", out: r.out }; }
    c.evidence = r.out;
  }
  c.status = "met"; c.retryAfter = null; c.signoff = c.signoff || { evidence: "signed off", at: new Date().toISOString() };
  pushLog(st, `GATE-MET ${condId}: signed off`);
  saveState(st);
  return { ok: true, met: st.conditions.filter((x) => x.status === "met").length, total: st.conditions.length };
}

// Add / dismiss conditions (you, or accepting a loop suggestion).
export function addCondition(app, fleet, cond) {
  const st = loadState(app, fleet);
  ensureConditions(app, st);
  const n = normalizeCondition({ ...cond, source: cond.source || "you" }, st.conditions.length);
  if (st.conditions.some((x) => x.id === n.id)) n.id = `${n.id}-${Date.now().toString(36)}`;
  st.conditions.push(n);
  pushLog(st, `GATE-ADD ${n.id}: ${n.say}`);
  saveState(st);
  return { ok: true, id: n.id };
}
export function acceptSuggestion(app, fleet, sugId) {
  const st = loadState(app, fleet); ensureConditions(app, st);
  st.suggestions = st.suggestions || [];
  const i = st.suggestions.findIndex((s) => s.id === sugId);
  if (i < 0) return { ok: false, note: "no such suggestion" };
  const sug = st.suggestions.splice(i, 1)[0];
  const n = normalizeCondition({ say: sug.say, check: sug.check || "agent", effort: sug.effort || "M", probe: sug.probe || "", source: "loop" }, st.conditions.length);
  st.conditions.push(n);
  pushLog(st, `GATE-ADD ${n.id}: ${n.say} (accepted suggestion)`);
  saveState(st);
  return { ok: true, id: n.id };
}
export function dismissSuggestion(app, fleet, sugId) {
  const st = loadState(app, fleet);
  st.dismissed = st.dismissed || [];
  st.suggestions = (st.suggestions || []).filter((s) => { if (s.id === sugId) { st.dismissed.push(s.say); return false; } return true; });
  saveState(st);
  return { ok: true };
}

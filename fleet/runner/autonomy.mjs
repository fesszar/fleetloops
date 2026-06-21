// autonomy.mjs — the autonomy ladder.
//
// Autonomy is EARNED, not assumed. Each app starts at its configured tier; a track record of
// clean merges promotes it one rung, a rejection/revert demotes it. The human stops being the
// verifier of record and becomes an exception handler.
//
// Tiers (low → high): propose → branch-approve → merge-main → full
//   - propose:        verify + propose only, never merge (e.g. a live app not yet under git)
//   - branch-approve: commit to a branch, human approves the merge
//   - merge-main:     auto-merge when gates + consensus pass
//   - full:           merge-main + may also close agent-tier exit conditions itself
//
// Promotion: after `promoteAfter` consecutive clean merges (default 5), an app moves up one
// rung — but never above `app.maxAutonomy` (default: merge-main; "full" must be granted
// explicitly) and NEVER for apps with `autonomyLocked: true` (e.g. ExampleApp stays propose
// until it is in git, period).
// Demotion: a human reject (or a reverted merge) drops it one rung and resets the streak.

const LADDER = ["propose", "branch-approve", "merge-main", "full"];

export function configuredAutonomy(app, fleet) {
  return app.autonomy || fleet.defaultAutonomy || "branch-approve";
}

// The autonomy tier in force right now, given the app's earned track record.
export function effectiveAutonomy(app, fleet, state) {
  const base = configuredAutonomy(app, fleet);
  if (app.autonomyLocked || (fleet.autonomyLadder && fleet.autonomyLadder.enabled === false)) return base;
  const earned = (state && state.autonomy && state.autonomy.earned) || 0; // rungs above base
  const maxTier = app.maxAutonomy || (fleet.autonomyLadder && fleet.autonomyLadder.maxTier) || "merge-main";
  const baseIdx = LADDER.indexOf(base);
  const maxIdx = LADDER.indexOf(maxTier);
  if (baseIdx < 0) return base;
  const idx = Math.min(baseIdx + Math.max(0, earned), Math.max(baseIdx, maxIdx));
  return LADDER[idx];
}

function ledger(state) {
  state.autonomy = state.autonomy || { streak: 0, earned: 0, history: [] };
  if (!Array.isArray(state.autonomy.history)) state.autonomy.history = [];
  return state.autonomy;
}
function remember(a, event) {
  a.history.push({ ...event, at: new Date().toISOString() });
  if (a.history.length > 50) a.history = a.history.slice(-50);
}

// A merge landed cleanly (human-approved without edits, or consensus-approved auto-merge).
export function recordCleanMerge(app, fleet, state, { via } = {}) {
  if (app.autonomyLocked) return null;
  const cfg = (fleet && fleet.autonomyLadder) || {};
  const promoteAfter = cfg.promoteAfter || 5;
  const a = ledger(state);
  a.streak += 1;
  remember(a, { kind: "clean-merge", via: via || "loop" });
  const base = configuredAutonomy(app, fleet);
  const maxTier = app.maxAutonomy || cfg.maxTier || "merge-main";
  const canRise = LADDER.indexOf(base) + a.earned < LADDER.indexOf(maxTier);
  if (a.streak >= promoteAfter && canRise) {
    a.earned += 1;
    a.streak = 0;
    remember(a, { kind: "promoted", to: effectiveAutonomy(app, fleet, state) });
    return { promoted: true, now: effectiveAutonomy(app, fleet, state) };
  }
  return { promoted: false };
}

// A human rejected the work (or a merge was reverted): drop a rung, reset the streak.
export function recordRejection(app, fleet, state, { reason } = {}) {
  const a = ledger(state);
  a.streak = 0;
  if (a.earned > 0) {
    a.earned -= 1;
    remember(a, { kind: "demoted", reason: reason || "rejected" });
    return { demoted: true, now: effectiveAutonomy(app, fleet, state) };
  }
  remember(a, { kind: "rejected", reason: reason || "rejected" });
  return { demoted: false };
}

// Does this completed work still need a human signature?
// Policy: readiness gates need a human ONLY for live/shipping apps (real users at stake) or
// when the app pins `requireHumanSignoff: true`. Pre-release apps accept consensus instead —
// that's the difference between "autonomous" and "waiting-on-you".
export function requiresHumanSignoff(app, fleet, task) {
  if (app.requireHumanSignoff) return true;
  const isReadiness = task && task.category === "readiness";
  if (!isReadiness) return false;
  const policy = (fleet && fleet.signoff && fleet.signoff.readiness) || "stage-based";
  if (policy === "human") return true;
  if (policy === "consensus") return false;
  return app.stage === "live" || app.stage === "shipping"; // stage-based default
}

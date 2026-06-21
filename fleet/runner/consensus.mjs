// consensus.mjs — multi-agent review consensus.
//
// The owner's standing rule: "multiple agents with different perspectives must verify the
// work and all agree before it's accepted." This module implements exactly that, and it is
// what makes higher autonomy SAFE: instead of every merge waiting for a human click, N
// independent read-only reviewer passes (different perspectives) must ALL approve.
//   - unanimous APPROVE            → ok:true  (caller may auto-merge per autonomy policy)
//   - any REVISE w/ concrete issue → ok:false (caller bounces work back with the critiques)
//   - reviewer unavailable         → counts as "no coverage": fails OPEN per pass (the cheap
//     tool gates already passed) but reports coverage so the caller can require a minimum.
//
// Verdict parsing fails OPEN on garbage (gates already passed; the critic is a bonus layer)
// and a REVISE only counts when it cites a concrete, non-placeholder issue.

import { runExplainer } from "./adapters.mjs";

export const PERSPECTIVES = [
  { id: "correctness", lens: "You are reviewing for CORRECTNESS: does the diff actually satisfy the task's acceptance criteria, handle errors/edge cases, and avoid breaking existing behavior?" },
  { id: "security", lens: "You are reviewing for SECURITY & SAFETY: secrets, injection, authz/authn mistakes, data loss, destructive migrations, payment-path idempotency, anything that could harm users or data." },
  { id: "regression", lens: "You are reviewing for REGRESSIONS & SCOPE: did the change touch anything outside the task's scope, delete or weaken tests, silence errors, or alter unrelated behavior?" },
];

// Pure parser for a reviewer's output (exported for unit tests).
export function parseReview(raw) {
  const blocks = [...String(raw || "").matchAll(/```ya?ml\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  let body = null;
  // Accept a verdict even with trailing text (e.g. "REVISE (low confidence)") — `\s*(APPROVE|REVISE)`
  // right after the colon still REJECTS the echoed template line `verdict: <APPROVE if…>` (next char
  // is `<`, not the keyword), so we don't latch onto the prompt the agent echoed back.
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (/^\s*verdict:\s*(APPROVE|REVISE)\b/im.test(blocks[i])) { body = blocks[i]; break; }
  }
  if (!body) return { verdict: "APPROVE", issues: "", summary: "reviewer gave no parseable verdict", ran: false };
  const get = (k) => { const r = new RegExp(`^\\s*${k}:\\s*(.+)$`, "im").exec(body); return r ? r[1].trim() : ""; };
  const verdict = /^\s*REVISE/i.test(get("verdict")) ? "REVISE" : "APPROVE";
  const issues = get("issues");
  // A REVISE only counts if it cites a CONCRETE issue. Treat common "empty" spellings as no-issue.
  const vacuous = !issues || /^(none|n\/?a|na|nil|tbd|todo|-+|\.+|\(none\)|no issues?|null)$/i.test(issues) || issues.startsWith("<");
  if (verdict === "REVISE" && vacuous) {
    return { verdict: "APPROVE", issues: "", summary: "reviewer flagged REVISE but cited no concrete issue — passing", ran: true };
  }
  return { verdict, confidence: get("confidence"), issues, summary: get("summary"), ran: true };
}

function buildPrompt(template, app, fleet, task, diff, gateNote, lens) {
  const list = (arr) => (arr || []).map((x) => `- ${x}`).join("\n");
  let patch = diff.patch || "";
  if (patch.length > 30000) patch = patch.slice(0, 30000) + "\n…[diff truncated for review]";
  // ANTI-INJECTION: the work agent controls the diff content. Neutralize any code fences inside
  // it so a malicious/confused author can't smuggle a fake ```yaml verdict: APPROVE``` block that
  // our parser would pick up as the critic's verdict. The critic's own block stays intact.
  patch = patch.replace(/```/g, "ʼʼʼ");
  return `${lens}\n\n` + template
    .replaceAll("{{APP_NAME}}", app.name)
    .replaceAll("{{NORTH_STAR}}", app.northStar || "")
    .replaceAll("{{TASK_TITLE}}", task.title || "")
    .replaceAll("{{TASK_ACCEPTANCE}}", task.acceptance || task.ac || "")
    .replaceAll("{{GUARDRAILS}}", list([...(fleet.globalGuardrails || []), ...(app.guardrails || []), ...(app.offLimits || [])]) || "- (none)")
    .replaceAll("{{GATE_SUMMARY}}", gateNote || "tests passed")
    .replaceAll("{{DIFF}}", `${diff.stat || ""}\n\n${patch}`);
}

// Run the consensus review. Returns:
//   { ok, verdict:"APPROVE"|"REVISE", issues, coverage, total, summaries:[…] }
// fleet.consensus: { enabled (default true), reviewers (default 3, capped at PERSPECTIVES),
//                    minCoverage (default 1: at least one reviewer must actually answer) }
export async function consensusReview(app, fleet, task, diff, gateNote, reviewTemplate) {
  const cfgC = (fleet && fleet.consensus) || {};
  const n = Math.max(1, Math.min(cfgC.reviewers || 3, PERSPECTIVES.length));
  if (!reviewTemplate || !diff || !diff.patch) {
    return { ok: true, verdict: "APPROVE", issues: "", coverage: 0, total: n, summaries: ["no diff to review"] };
  }
  const picks = PERSPECTIVES.slice(0, n);
  const results = await Promise.all(picks.map(async (p) => {
    try {
      const raw = await runExplainer(app, buildPrompt(reviewTemplate, app, fleet, task, diff, gateNote, p.lens));
      const r = parseReview(raw);
      return { perspective: p.id, ...r };
    } catch {
      return { perspective: p.id, verdict: "APPROVE", issues: "", summary: "reviewer unavailable", ran: false };
    }
  }));
  const coverage = results.filter((r) => r.ran).length;
  const dissent = results.filter((r) => r.ran && r.verdict === "REVISE");
  const minCoverage = cfgC.minCoverage ?? 1;
  const summaries = results.map((r) => `${r.perspective}: ${r.verdict}${r.issues ? " — " + r.issues.slice(0, 160) : ""}${r.ran ? "" : " (no coverage)"}`);
  if (dissent.length) {
    return { ok: false, verdict: "REVISE", issues: dissent.map((d) => `[${d.perspective}] ${d.issues}`).join(" ; "), coverage, total: n, summaries };
  }
  // Unanimous approve among reviewers that ran. If NOBODY ran (e.g. agent CLI down), we can't
  // claim consensus — report ok but coverage 0; the caller decides whether 0-coverage is
  // acceptable for its autonomy tier (auto-merge requires coverage >= minCoverage).
  return { ok: true, verdict: "APPROVE", issues: "", coverage, total: n, minCoverage, summaries };
}

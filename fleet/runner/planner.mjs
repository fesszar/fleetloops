// planner.mjs — the BRAIN layer: the part that GENERATES work instead of only executing it.
//
// Three capabilities, all bounded so the loop converges instead of inventing work forever:
//   1. harvestNewTasks  — the work agent reports `new_tasks` it discovered; append them to the
//                         backlog (deduped, capped) instead of throwing them away.
//   2. seedConditions   — an app with NO exit conditions gets a planner pass that reads the
//                         repo + memory.md and proposes a starting "definition of done"
//                         (implements the spec's promised seeding; kills the needs-seeding dead end).
//   3. discoveryPass    — when all gates are green (watch mode), audit ONE dimension per pass
//                         (security, code health, tests, UX/a11y, performance, CI/CD) and propose
//                         new gates with evidence. Auto-accept probe-verifiable ones; cap totals.
//
// Convergence guarantees: per-pass caps, a total open-gate cap, per-dimension cooldowns, and
// dedupe against existing + dismissed gates. "Keeps finding problems" ends when the auditors
// genuinely find nothing — which is the owner's definition of done.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runExplainer } from "./adapters.mjs";
import { expandHome, pushLog } from "./util.mjs";

const HERE = new URL(".", import.meta.url);
const tpl = (name) => { try { return readFileSync(new URL(`../prompts/${name}`, HERE), "utf8"); } catch { return ""; } };
const SEED_TEMPLATE = tpl("plan-conditions.md");
const DISCOVER_TEMPLATE = tpl("discover-gates.md");

export const DIMENSIONS = [
  { id: "security", focus: "code security: secrets in code, injection, authz/authn gaps, unsafe deserialization, dependency vulnerabilities" },
  { id: "code-health", focus: "code health: dead code, error swallowing, missing error handling, race conditions, TODO/FIXME debt that hides bugs" },
  { id: "tests", focus: "test coverage: untested critical paths (payments, auth, data writes), flaky tests, missing regression tests for past bugs" },
  { id: "ux", focus: "UX/usability/accessibility: broken or confusing flows, missing loading/error/empty states, a11y basics (labels, contrast, focus), mobile behavior" },
  { id: "performance", focus: "performance: slow queries, unbounded lists, oversized bundles/images, memory leaks, missing pagination or caching" },
  { id: "cicd", focus: "CI/CD & release hygiene: build reproducibility, lint/typecheck in CI, versioning, changelog, release checklist, store/deploy readiness" },
  { id: "inbound", focus: "inbound reports: IF the `gh` CLI is available and authenticated, read-only list this repo's open GitHub issues and PRs (gh issue list / gh pr list, read-only — never comment, close, or merge). Propose a gate for any real, reproducible user-reported bug or a green, low-risk PR worth folding in. If gh is unavailable or there is no GitHub remote, output an empty list." },
];

function memoryText(app) {
  const repo = expandHome(app.repo || "");
  const parts = [];
  const f = join(repo, "memory.md");
  if (existsSync(f)) { try { parts.push(readFileSync(f, "utf8").slice(0, 4000)); } catch {} }
  const lg = join(repo, ".fleet", "memory.log"); // the loop's own untracked notes
  if (existsSync(lg)) { try { parts.push("## Loop notes\n" + readFileSync(lg, "utf8").slice(-2000)); } catch {} }
  return parts.join("\n\n") || "(no memory.md)";
}

// Parse `- say: … || check: auto|agent|human || probe: … || effort: S|M|L || why: …` lines
// from the LAST yaml block. Tolerant: missing fields default sanely; placeholders skipped.
export function parseGateLines(raw, { max = 6 } = {}) {
  const block = [...String(raw || "").matchAll(/```ya?ml\s*([\s\S]*?)```/gi)].map((m) => m[1]).pop();
  if (!block) return [];
  const out = [];
  for (const line of block.split("\n")) {
    const m = /^\s*-\s*say:\s*(.+)$/i.exec(line);
    if (!m) continue;
    const parts = m[1].split(/\s*\|\|\s*/);
    const say = parts[0].trim().replace(/^["']|["']$/g, "");
    if (!say || say.startsWith("<") || say.length < 5) continue;
    const field = (k) => { const p = parts.find((x) => new RegExp(`^${k}:`, "i").test(x.trim())); return p ? p.trim().replace(new RegExp(`^${k}:\\s*`, "i"), "").trim() : ""; };
    const check = /^(auto|agent|human)$/i.test(field("check")) ? field("check").toLowerCase() : "agent";
    const probe = field("probe").replace(/^["']|["']$/g, "");
    const effort = /^[SML]$/i.test(field("effort")) ? field("effort").toUpperCase() : "M";
    out.push({ say: say.slice(0, 200), check: probe ? (check === "human" ? "human" : "auto") : check, probe, effort, why: field("why").slice(0, 300) });
    if (out.length >= max) break;
  }
  return out;
}

// 1) Harvest the work agent's discovered tasks into the backlog. Mutates state; returns count.
export function harvestNewTasks(state, report, { maxPerPass = 3, maxOpen = 30 } = {}) {
  const found = (report && report.new_tasks) || [];
  if (!found.length) return 0;
  const titles = new Set((state.backlog || []).map((t) => (t.title || "").toLowerCase().trim()));
  const open = (state.backlog || []).filter((t) => t.status !== "done").length;
  let added = 0;
  for (const nt of found) {
    if (added >= maxPerPass || open + added >= maxOpen) break;
    const key = nt.title.toLowerCase().trim();
    if (titles.has(key)) continue;
    titles.add(key);
    const id = `A${Date.now().toString(36)}${added}`.toUpperCase();
    state.backlog.push({
      id, title: nt.title, status: "queued", difficulty: "medium", deps: [],
      acceptance: nt.acceptance || nt.title, files: "—", attempts: 0, origin: "agent",
    });
    added++;
  }
  if (added) pushLog(state, `BRAIN: harvested ${added} discovered task(s) from the agent's report`);
  return added;
}

// 2) Seed a starting definition of done for an app with no exit conditions.
// Read-only planner pass; auto-accepts what it proposes (this IS onboarding — the human
// reviews the gate list on the dashboard afterwards and can remove/add).
export async function seedConditions(app, fleet) {
  if (!SEED_TEMPLATE) return [];
  const prompt = SEED_TEMPLATE
    .replaceAll("{{APP_NAME}}", app.name)
    .replaceAll("{{STAGE}}", app.stage || "unknown")
    .replaceAll("{{NORTH_STAR}}", app.northStar || "")
    .replaceAll("{{STANDING_CONTEXT}}", app.standingContext || "—")
    .replaceAll("{{TEST_COMMAND}}", (app.commands && app.commands.test) || "(none configured)")
    .replaceAll("{{MEMORY}}", memoryText(app));
  let raw = "";
  try { raw = await runExplainer(app, prompt, { reasoning: "medium" }); } catch { return []; }
  return parseGateLines(raw, { max: 6 });
}

// 3) One bounded discovery (audit) pass over the NEXT dimension in the rotation.
// Returns { dimension, gates } — caller decides accept/suggest. Cooldowns + caps enforced here.
export async function discoveryPass(app, fleet, state) {
  const cfg = (fleet && fleet.discovery) || {};
  if (cfg.enabled === false || !DISCOVER_TEMPLATE) return null;
  const maxOpenGates = cfg.maxOpenGates || 12;
  const cooldownMs = (cfg.cooldownHours || 24) * 3600 * 1000;
  const openGates = (state.conditions || []).filter((c) => c.status !== "met").length;
  const totalGates = (state.conditions || []).length;
  if (openGates > 0 || totalGates >= maxOpenGates) return null; // only audit when green + under cap
  state.discovery = state.discovery || { lastByDim: {}, cursor: 0 };
  const now = Date.now();
  // pick the next dimension off cooldown, round-robin
  let dim = null;
  for (let i = 0; i < DIMENSIONS.length; i++) {
    const d = DIMENSIONS[(state.discovery.cursor + i) % DIMENSIONS.length];
    const last = state.discovery.lastByDim[d.id] || 0;
    if (now - last >= cooldownMs) { dim = d; state.discovery.cursor = (state.discovery.cursor + i + 1) % DIMENSIONS.length; break; }
  }
  if (!dim) return null; // everything audited recently — genuinely nothing left to find right now
  state.discovery.lastByDim[dim.id] = now;
  const gatesList = (state.conditions || []).map((c) => `- [${c.check}/${c.status}] ${c.say}`).join("\n");
  const dismissed = (state.dismissed || []).map((s) => `- ${s}`).join("\n");
  const prompt = DISCOVER_TEMPLATE
    .replaceAll("{{APP_NAME}}", app.name)
    .replaceAll("{{NORTH_STAR}}", app.northStar || "")
    .replaceAll("{{DIMENSION}}", dim.focus)
    .replaceAll("{{GATES}}", gatesList || "(none)")
    .replaceAll("{{DISMISSED}}", dismissed || "(none)")
    .replaceAll("{{MEMORY}}", memoryText(app));
  let raw = "";
  try { raw = await runExplainer(app, prompt, { reasoning: "medium" }); } catch { return { dimension: dim.id, gates: [] }; }
  const room = maxOpenGates - totalGates;
  const gates = parseGateLines(raw, { max: Math.min(2, Math.max(0, room)) });
  return { dimension: dim.id, gates };
}

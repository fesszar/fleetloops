// brain.mjs — the PROJECT BRAIN: deep, durable, OWNER-APPROVED understanding of each app, so
// the fleet works for a stranger on day one (zero-config comprehension) AND like it's been on
// the project for years (accumulated context injected into every run).
//
// Human-in-the-loop by design: the AI proposes a comprehension → the owner reviews it →
// approves as-is, edits-then-approves, or asks the AI to re-analyze with their notes. Only an
// APPROVED brain is injected into task prompts. This makes the foundation trustworthy.
//
// Files (in the repo, so the brain travels with the code and a human can read it):
//   .fleet/project-brain.md          ACTIVE — approved; injected into every run
//   .fleet/project-brain.proposed.md PENDING — awaiting the owner's review
//   .fleet/learnings.md              rolling structured learnings from each pass
// Lifecycle in state.brain = { status:"none"|"pending"|"refining"|"approved", version, notes, at }

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { runExplainer } from "./adapters.mjs";
import { expandHome, pushLog } from "./util.mjs";
import { hasAgentProvider } from "./providers/registry.mjs";

const HERE = new URL(".", import.meta.url);
const COMPREHEND_TEMPLATE = (() => { try { return readFileSync(new URL("../prompts/comprehend-project.md", HERE), "utf8"); } catch { return ""; } })();

function brainDir(app) { return join(expandHome(app.repo || ""), ".fleet"); }
export function brainFile(app) { return join(brainDir(app), "project-brain.md"); }            // ACTIVE
export function proposedFile(app) { return join(brainDir(app), "project-brain.proposed.md"); } // PENDING
function learningsFile(app) { return join(brainDir(app), "learnings.md"); }

export function brainStatus(state) { return (state && state.brain && state.brain.status) || "none"; }
export function hasApprovedBrain(app) {
  try { const f = brainFile(app); return existsSync(f) && readFileSync(f, "utf8").trim().length > 200; } catch { return false; }
}
export function readProposed(app) { try { return existsSync(proposedFile(app)) ? readFileSync(proposedFile(app), "utf8") : ""; } catch { return ""; } }

// Load the APPROVED brain + recent learnings, capped, for prompt injection. Only approved
// content rides into runs — a pending/unreviewed comprehension is never trusted.
export function readBrain(app, { cap = 7000 } = {}) {
  const parts = [];
  try { const f = brainFile(app); if (existsSync(f)) parts.push(readFileSync(f, "utf8")); } catch {}
  try { const l = learningsFile(app); if (existsSync(l)) parts.push("## Recent loop learnings (newest last)\n" + readFileSync(l, "utf8").slice(-2500)); } catch {}
  try { const m = join(expandHome(app.repo || ""), "memory.md"); if (existsSync(m)) parts.push("## memory.md\n" + readFileSync(m, "utf8").slice(0, 2000)); } catch {}
  let out = parts.join("\n\n");
  if (out.length > cap) out = out.slice(0, cap) + "\n…[brain truncated — full understanding in .fleet/project-brain.md]";
  return out;
}

// DEEP COMPREHENSION PASS — zero-config onboarding intelligence. Read-only; studies the repo
// and writes a structured understanding to the PROPOSED file (awaiting owner review). If the
// owner asked for a re-analysis, their notes + the prior version are fed back in so the result
// is a refinement, not a fresh guess. Returns the proposed text (or "" on failure).
export async function comprehendProject(app, fleet, { notes = "", priorBrain = "" } = {}) {
  if (!COMPREHEND_TEMPLATE) return "";
  if (!hasAgentProvider(app)) return "";
  let prompt = COMPREHEND_TEMPLATE
    .replaceAll("{{APP_NAME}}", app.name)
    .replaceAll("{{STAGE}}", app.stage || "unknown")
    .replaceAll("{{NORTH_STAR}}", app.northStar || "(not given — infer it from the code/README/product)")
    .replaceAll("{{STANDING_CONTEXT}}", app.standingContext || "—");
  if (notes || priorBrain) {
    prompt += `\n\n## REFINEMENT REQUESTED BY THE OWNER\nThe owner reviewed your previous comprehension and wants it improved. Treat their notes as authoritative — correct, expand, and re-verify against the code.\n\n### Owner's notes/corrections\n${notes || "(they edited the document directly — reconcile with the prior version below)"}\n\n### Your previous version (revise this, don't start from scratch)\n${(priorBrain || "").slice(0, 6000)}`;
  }
  let raw = "";
  try { raw = await runExplainer(app, prompt, { reasoning: "high", timeoutMs: 8 * 60 * 1000 }); } catch { return ""; }
  const body = extractBrain(raw);
  if (!body || body.length < 200) return "";
  try {
    const dir = brainDir(app); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const header = `# Project Brain — ${app.name}\n*Deep comprehension proposed by the fleet. Review, edit, or ask for a re-analysis on the dashboard. Once you approve it, every run reads it. Proposed ${new Date().toISOString().slice(0, 10)}.*\n\n`;
    writeFileSync(proposedFile(app), header + body.trim() + "\n");
    return header + body.trim() + "\n";
  } catch { return ""; }
}

// Owner approves the comprehension — optionally with their own edits. Promotes PROPOSED (or the
// edited text) to ACTIVE. From now on every run is "experienced".
export function approveBrain(app, { editedText = "" } = {}) {
  try {
    const dir = brainDir(app); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const text = editedText && editedText.trim().length > 100 ? editedText : readProposed(app);
    if (!text || text.trim().length < 100) return { ok: false, note: "nothing to approve" };
    writeFileSync(brainFile(app), text.endsWith("\n") ? text : text + "\n");
    try { if (existsSync(proposedFile(app))) renameSync(proposedFile(app), proposedFile(app) + ".approved"); } catch {}
    return { ok: true };
  } catch (e) { return { ok: false, note: String(e) }; }
}

// Pull ONLY the clean structured brain out of the agent's transcript — never the raw tool
// output. Real CLI runs interleave a lot of noise (exec lines, MCP errors, token counts), so
// we anchor on the LAST "# Project Brain" / "## Product" heading, cut at the first tool-noise
// or report tail after it, strip stray noise lines, and hard-cap the size. A brain that can't
// be cleanly located returns "" (the caller retries) — we never store a 500KB transcript.
const MAX_BRAIN = 16000;
const NOISE = /^(exec\b|codex\b|tokens used\b|\[?\d{4}-\d\d-\d\dT[\d:.]+Z?\s+(ERROR|WARN|INFO)|ERROR\s+rmcp|thinking\b|I['’]ll do this|I['’]m going to|```ya?ml)/i;
export function extractBrain(raw) {
  const text = String(raw || "");
  // last heading that starts the structured doc
  let idx = -1;
  for (const re of [/#+\s*Project Brain\b/gi, /^##\s*Product\b/gim]) {
    let m, last = -1; while ((m = re.exec(text))) last = m.index;
    if (last >= 0) { idx = last; break; }
  }
  let body;
  if (idx >= 0) {
    body = text.slice(idx).replace(/^#+\s*Project Brain[^\n]*\n/i, "");
  } else {
    // fallback: a fenced markdown block, but ONLY if it actually looks like a brain
    const fenced = [...text.matchAll(/```(?:markdown|md)?\s*([\s\S]*?)```/gi)].map((m) => m[1]).pop();
    if (!fenced || !/##\s*(Product|Architecture)/i.test(fenced)) return "";
    body = fenced;
  }
  // cut at the first clear tool-noise / report tail line, then drop any stray noise lines
  const lines = body.split("\n");
  const keep = [];
  for (const ln of lines) {
    if (NOISE.test(ln.trim())) {
      if (keep.length > 8) break;   // noise after real content = end of the brain
      continue;                      // leading noise = skip
    }
    keep.push(ln);
  }
  let out = keep.join("\n").trim();
  // require it to actually be a structured brain, not chatter
  if (out.length < 200 || !/##\s*(Product|Architecture|Conventions)/i.test(out)) return "";
  if (out.length > MAX_BRAIN) out = out.slice(0, MAX_BRAIN) + "\n\n…[brain truncated]";
  return out;
}

// Shared brain proposal used by BOTH loops (backlog + gate), so EVERY app gets a deep
// comprehension proposed exactly once. Mutates `state` (caller saves). Returns:
//   { acted:false }                      nothing to do (already approved, disabled, or pending)
//   { acted:true, status:"pending" }     proposed a comprehension + filed a review card
//   { acted:true, status:"failed" }      tried but couldn't comprehend (will retry next pass)
// Never blocks: callers continue their normal work after this.
export async function proposeBrainIfNeeded(app, fleet, state) {
  if (!fleet || fleet.brain === false) return { acted: false };
  if (!hasAgentProvider(app)) return { acted: false };
  if (hasApprovedBrain(app)) return { acted: false };
  const bs = brainStatus(state);
  if (bs === "pending") return { acted: false };       // already waiting on the owner
  if (bs !== "none" && bs !== "refining") return { acted: false };
  const notes = (state.brain && state.brain.notes) || "";
  const prior = bs === "refining" ? readProposed(app) : "";
  let proposed = "";
  try { proposed = await comprehendProject(app, fleet, { notes, priorBrain: prior }); } catch {}
  if (!proposed) { state.brain = { status: "none", at: new Date().toISOString() }; return { acted: true, status: "failed" }; }
  state.brain = { status: "pending", version: ((state.brain && state.brain.version) || 0) + 1, notes: "", at: new Date().toISOString() };
  state.escalations = state.escalations || [];
  if (!state.escalations.some((e) => e.taskId === "__brain__")) {
    state.escalations.push({ taskId: "__brain__", title: `Review ${app.name}'s project understanding`, type: "brain", reason: "The fleet studied this codebase and wrote how it understands the app. Approve it (or edit / ask for a re-analysis) — every future run reads it, so getting it right makes the work deeply contextual.", at: new Date().toISOString() });
  }
  pushLog(state, `BRAIN: proposed a deep comprehension of ${app.name} (v${state.brain.version}) — awaiting your review`);
  return { acted: true, status: "pending" };
}

// STRUCTURED ENRICHMENT — append this pass's learnings to the rolling store (dated, deduped,
// bounded). Only runs once a brain is approved, so learnings attach to a verified foundation.
export function recordLearnings(app, report, state) {
  const items = (report && report.learnings) || [];
  if (!items.length) return 0;
  try {
    const dir = brainDir(app); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const f = learningsFile(app);
    const day = new Date().toISOString().slice(0, 10);
    let added = 0, existing = existsSync(f) ? readFileSync(f, "utf8") : "";
    const lines = [], seenBatch = new Set();
    for (const it of items) {
      const clean = String(it).replace(/\s+/g, " ").trim().slice(0, 240);
      if (!clean || clean.startsWith("<") || existing.includes(clean) || seenBatch.has(clean)) continue;
      seenBatch.add(clean); lines.push(`- ${day} ${clean}`); if (++added >= 4) break;
    }
    if (lines.length) {
      appendFileSync(f, (existing && !existing.endsWith("\n") ? "\n" : "") + lines.join("\n") + "\n");
      const all = readFileSync(f, "utf8").split("\n");
      if (all.length > 420) writeFileSync(f, all.slice(-400).join("\n"));
      if (state) pushLog(state, `BRAIN: recorded ${lines.length} new learning(s)`);
    }
    return lines.length;
  } catch { return 0; }
}

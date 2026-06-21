// adapters.mjs — how a loop hands a generated prompt to a coding agent.
// Each adapter takes ({ app, fleet, prompt, dryRun, logFile }) and returns { raw, report, failure }.
// `report` is the parsed YAML result block the agent is asked to emit.
// `failure` (when set) classifies a run that produced no report: "auth" | "timeout" | "output" | "spawn".
//
// The whole fleet is runtime-agnostic: swapping the adapter is the only change
// needed to point a loop at Cursor, Claude Code, Codex, a local script, etc.

import { writeFileSync, appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execAsync, expandHome, classifyAgentFailure } from "./util.mjs";
import { resolveProvider } from "./providers/registry.mjs";
import { runApiAgent } from "./providers/harness.mjs";

function expand(template, app, promptFile) {
  // Commands read the prompt from a file — prefer stdin form (`- < "{{PROMPT_FILE}}"`) over
  // `"$(cat {{PROMPT_FILE}})"` so huge prompts can't hit argv limits.
  // {{REASONING}}/{{MODEL}} let each app set its Codex effort + model (cost/speed dial).
  let cmd = template
    .replaceAll("{{REPO}}", expandHome(app.repo))
    .replaceAll("{{PROMPT_FILE}}", promptFile)
    .replaceAll("{{REASONING}}", app.reasoning || "medium")
    .replaceAll("{{MODEL}}", app.model || "");
  // If a model is chosen but the command template doesn't already specify one, inject it for
  // codex (so the Settings model picker works without rewriting every app's command string).
  if (app.model && /codex\s+exec/.test(cmd) && !/-c\s+model=|--model\b/.test(cmd)) {
    cmd = cmd.replace(/codex\s+exec/, `codex exec -c model=${app.model}`);
  }
  return cmd;
}

function agentTimeoutMs(app, fleet) {
  const min = app.agent?.timeoutMinutes || (fleet && fleet.agentTimeoutMinutes) || 90;
  return min * 60 * 1000;
}

// Runs the app's configured agent command, feeding it the prompt, captures stdout,
// and tees it to a per-app log file so the dashboard can stream what the agent is doing.
// Hard timeout + process-group kill: a hung CLI (expired login prompt, dead network)
// can never freeze the fleet. Spawn errors resolve instead of crashing the pass.
async function runShellAgent(app, fleet, prompt, logFile) {
  const dir = mkdtempSync(join(tmpdir(), "fleet-"));
  const promptFile = join(dir, "prompt.md");
  writeFileSync(promptFile, prompt);
  const cmd = expand(app.agent.command, app, promptFile);
  if (logFile) { try { writeFileSync(logFile, `# ${app.name} — live agent run @ ${new Date().toISOString()}\n\n`); } catch {} }
  const onData = (d) => { process.stdout.write(d); if (logFile) { try { appendFileSync(logFile, d); } catch {} } };
  const r = await execAsync(cmd, { timeoutMs: agentTimeoutMs(app, fleet), onData });
  return r; // { out, status, timedOut, error? }
}

// Parse the result block the agent emits. The agent echoes the PROMPT (which contains a
// template block) before its real answer, so we take the LAST block with a valid verdict.
// REAL-WORLD FIX: Codex's `exec` prints its final message WITHOUT code fences (proven on the
// first live ExampleApp pass), so after the fenced scan we fall back to an UNFENCED trailing
// report — accepted only when it carries BOTH a concrete task_id and a result verdict near the
// end of the output, and never when it's the echoed {{TASK_ID}} template.
export function parseReport(raw) {
  const text = String(raw || "");
  const blocks = [...text.matchAll(/```ya?ml\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  const verdict = (b) => {
    const r = /^\s*result:\s*(DONE|FAILED|ESCALATE|SKIP)\s*$/im.exec(b || "");
    return r ? r[1].toUpperCase() : null;
  };
  const usable = (b) => verdict(b) && /^\s*task_id:\s*\S/im.test(b) && !/\{\{TASK_ID\}\}/.test(b) && !/^\s*task_id:\s*</im.test(b);
  let body = null;
  for (let i = blocks.length - 1; i >= 0; i--) { if (usable(blocks[i])) { body = blocks[i]; break; } }
  if (!body) {
    // unfenced fallback: look only at the TAIL of the output (a real CLI prints its final
    // answer last; the prompt echo with the template lives near the top).
    const tail = text.slice(-8000);
    const lines = tail.split("\n");
    let start = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^\s*(task_id|result):\s*\S/.test(lines[i])) start = i; else if (start >= 0 && !lines[i].trim()) break;
    }
    if (start >= 0) {
      const cand = lines.slice(start, start + 120).join("\n");
      if (usable(cand)) body = cand;
    }
  }
  if (!body) return null;
  const get = (k) => {
    const r = new RegExp(`^\\s*${k}:\\s*(.+)$`, "im").exec(body);
    return r ? r[1].trim() : null;
  };
  return {
    result: (verdict(body) || (get("result") || "").toUpperCase()),
    summary: get("summary"),
    plain_summary: get("plain_summary"),
    user_impact: get("user_impact"),
    skip_evidence: get("skip_evidence"),
    acceptance_met: /true/i.test(get("acceptance_met") || ""),
    escalation_detail: get("detail"),
    escalation_what: get("escalation_what"),
    escalation_why: get("escalation_why"),
    escalation_if_yes: get("escalation_if_yes"),
    escalation_recommendation: get("escalation_recommendation"),
    next: get("next_recommended_task"),
    new_tasks: parseNewTasks(body),
    learnings: parseListField(body, "learnings"),
    raw: body.trim(),
  };
}

// The prompt asks the agent for `new_tasks:` — work it DISCOVERED while doing this task.
// This is the loop's main channel for autonomous backlog growth (the brain's eyes).
// Accepted forms, all under a `new_tasks:` key (matches the loop-task-prompt schema):
//   new_tasks:
//     - title: Fix X
//       where: src/api.ts
//       why: retry loop never fires
//     - Fix the broken retry in api.ts || acceptance: retry fires on 5xx
// Parse a simple bulleted list field (e.g. `learnings:` followed by `- ...` lines). Used for
// the project-brain enrichment channel. Placeholders and empties are skipped.
export function parseListField(body, key) {
  const lines = String(body || "").split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\s*${key}:\\s*$`, "i").test(l) || new RegExp(`^\\s*${key}:\\s*\\[`, "i").test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!/^\s*-\s+/.test(l)) { if (/^\s*\w[\w_]*:/.test(l) || !l.trim()) break; continue; }
    const item = l.replace(/^\s*-\s+/, "").replace(/^["']|["']$/g, "").trim();
    if (item && !item.startsWith("<") && !/^none\b/i.test(item)) out.push(item.slice(0, 240));
    if (out.length >= 6) break;
  }
  return out;
}

export function parseNewTasks(body) {
  const lines = String(body || "").split("\n");
  const start = lines.findIndex((l) => /^\s*new_tasks:\s*$/i.test(l) || /^\s*new_tasks:\s*\[/i.test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!/^\s*-\s+/.test(l)) {
      // nested attributes of the previous item (where/why/acceptance) → attach, keep going
      const attr = /^\s+(where|why|acceptance|files)\s*:\s*(.+)$/i.exec(l);
      if (attr && out.length) {
        const v = attr[2].trim();
        if (!v.startsWith("<")) {
          const t = out[out.length - 1];
          if (/^acceptance$/i.test(attr[1])) t.acceptance = v.slice(0, 400);
          else t.acceptance = ((t.acceptance ? t.acceptance + "; " : "") + `${attr[1]}: ${v}`).slice(0, 400);
        }
        continue;
      }
      if (/^\s*\w[\w_]*:/.test(l) || !l.trim()) break; // next top-level key / blank → end of list
      continue;
    }
    let item = l.replace(/^\s*-\s+/, "").trim();
    item = item.replace(/^title:\s*/i, "");
    if (!item || item.startsWith("<") || /^none\b/i.test(item)) continue;
    const parts = item.split(/\s*\|\|\s*/);
    const title = parts[0].replace(/^["']|["']$/g, "").trim();
    const accRaw = (parts.find((p) => /^acceptance:/i.test(p)) || "").replace(/^acceptance:\s*/i, "").trim();
    if (title && title.length > 4) out.push({ title: title.slice(0, 160), acceptance: accRaw.slice(0, 400) });
    if (out.length >= 5) break;
  }
  return out;
}

export const adapters = {
  // manual: don't call any agent. Print the prompt for the human to paste into
  // whatever chat they're using, and pause. Perfect for week 1 / mixed platforms.
  manual: async ({ app, prompt }) => {
    return {
      raw: prompt,
      report: { result: "MANUAL", summary: "Prompt generated — paste into the agent chat and run.", raw: prompt },
    };
  },

  // shell/claude/codex: actually invoke the configured command.
  shell: async ({ app, fleet, prompt, dryRun, logFile }) => {
    if (dryRun) return adapters.manual({ app, prompt });
    const r = await runShellAgent(app, fleet, prompt, logFile);
    const report = parseReport(r.out);
    let failure = null;
    if (!report) {
      if (r.error) failure = "spawn";
      else if (r.timedOut) failure = "timeout";
      else failure = classifyAgentFailure(r.out); // "auth" | "output"
    }
    return { raw: r.out, report, failure };
  },

  // api: a raw chat/completion provider (OpenAI/Anthropic/DeepSeek/Gemini/OpenRouter/Ollama).
  // The bundled harness (providers/harness.mjs) gives it real file/command tools and runs the
  // agentic loop, leaving the worktree mutated just like a CLI would — so loop.mjs's commit/gate/
  // review/merge pipeline downstream is byte-for-byte identical to the shell path. Adds `usage`.
  api: async ({ app, fleet, prompt, dryRun, logFile }) => {
    if (dryRun) return adapters.manual({ app, prompt });
    const r = await runApiAgent({ app, fleet, prompt, mode: "write", logFile });
    const report = parseReport(r.reportText || r.raw);
    let failure = r.failure || null;
    if (!report && !failure) failure = "output";
    return { raw: r.raw, report, failure, usage: r.usage };
  },
};

// Cheap, READ-ONLY agent call for meta-questions (e.g. "explain this decision in plain
// language", reviews, suggestions, planning). Never edits files: forces read-only sandbox +
// low reasoning. Returns stdout ("" = unavailable; callers fail open).
export async function runExplainer(app, prompt, { reasoning = "low", timeoutMs = 180000 } = {}) {
  // Raw-API providers: run the harness in READ-ONLY mode (write tools are neither advertised nor
  // dispatchable), so explanations/reviews can never edit files. Returns the model's text.
  const apiProvider = resolveProvider(app);
  if (apiProvider && apiProvider.kind === "api") {
    try {
      const r = await runApiAgent({ app: { ...app, reasoning }, fleet: null, prompt, mode: "read" });
      return r.reportText || "";
    } catch { return ""; }
  }
  if (!app.agent?.command || app.agent.adapter === "manual") return "";
  let cmd = app.agent.command.replaceAll("workspace-write", "read-only").replaceAll("danger-full-access", "read-only").replaceAll("{{REASONING}}", reasoning);
  // Fail-closed read-only for codex: strip every bypass/escalation flag that could override the
  // sandbox, then ensure --sandbox read-only is present so the explainer can never edit files.
  cmd = cmd
    .replace(/--dangerously-bypass-approvals-and-sandbox/g, "")
    .replace(/--dangerously-bypass-hook-trust/g, "")
    .replace(/--dangerously-skip-permissions/g, "")   // Claude Code write bypass
    .replace(/--permission-mode\s+\S+/g, "")           // Claude Code permission override
    .replace(/--allowedTools\s+\S+/g, "")
    .replace(/--yolo/g, "")                            // Gemini/other "do anything" flag
    .replace(/--full-auto/g, "")
    .replace(/-c\s+sandbox_mode=\S+/g, "")
    .replace(/--ask-for-approval\s+\S+/g, "")
    .replace(/\s-a\s+\S+/g, " ");
  if (/codex\s+exec/.test(cmd) && !/--sandbox\s+read-only/.test(cmd)) cmd = cmd.replace(/codex\s+exec/, "codex exec --sandbox read-only");
  // SYMMETRIC read-only guarantee for ALL adapters: codex gets an explicit read-only sandbox
  // above. For anything else, if a known write-enabling token survived stripping, FAIL SAFE —
  // skip the read-only call entirely (callers treat "" as unavailable and fail open) rather than
  // risk a write during a meant-to-be-read-only review/explanation.
  const codexAsserted = /codex\s+exec/.test(cmd) && /--sandbox\s+read-only/.test(cmd);
  const stillWritable = /--dangerously|--yolo|--full-auto|sandbox_mode=|workspace-write|danger-full-access|--permission-mode|--allowedTools|--skip-permissions/i.test(cmd);
  if (!codexAsserted && stillWritable) return "";
  const dir = mkdtempSync(join(tmpdir(), "fleet-explain-"));
  const promptFile = join(dir, "prompt.md");
  writeFileSync(promptFile, prompt);
  cmd = cmd.replaceAll("{{REPO}}", expandHome(app.repo || "")).replaceAll("{{PROMPT_FILE}}", promptFile);
  const r = await execAsync(cmd, { timeoutMs });
  return r.out || "";
}

export function pickAdapter(app) {
  const a = app.agent?.adapter || "manual";
  if (a === "manual") return adapters.manual;
  // Provider-aware dispatch: a raw-API provider routes through the bundled harness; everything
  // else (Codex/Claude CLI/shell) keeps the verbatim shell path. resolveProvider also maps legacy
  // adapter:"codex"/"claude" configs, so existing fleets are unaffected.
  const provider = resolveProvider(app);
  if (provider && provider.kind === "api") return adapters.api;
  return adapters.shell; // claude/codex/shell all run through the shell adapter
}

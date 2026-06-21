// providers/harness.mjs — Fleet's own in-process agentic loop for RAW-API providers.
//
// WHY THIS EXISTS (the whole point of the multi-provider work):
// The engine assumes the worktree is ALREADY edited when the adapter returns — loop.mjs commits
// it immediately after. An agentic CLI does that itself. A raw chat API only returns TEXT. So to
// let OpenAI/Anthropic/DeepSeek/Gemini/OpenRouter/Ollama drive a real task, Fleet must give the
// model file/command TOOLS and run the read→think→edit→test loop ITSELF, leaving the worktree
// mutated exactly as a CLI would. To loop.mjs, this path is indistinguishable from the CLI path.
//
// Contract (mirrors adapters.shell, plus usage):
//   runApiAgent({ app, fleet, prompt, mode, logFile, fetchImpl })
//     -> { raw, reportText, usage:{inputTokens,outputTokens,usd}, failure }
//   raw        — full REDACTED transcript (for .run.log + report.raw fallback)
//   reportText — the string to feed parseReport (the model's finish report, or its last text)
//   failure    — null | "auth" | "timeout" | "output" | "spawn"  (same vocabulary as the CLI path)
//
// SAFETY: tools are confined to the worktree (providers/tools.mjs); read-mode omits write tools;
// run_command refuses the same COSTLY set gates.mjs refuses; the API key is redacted from ALL
// output and never persisted. STEP_CAP + a wall-clock deadline bound every run.

import { writeFileSync, appendFileSync } from "node:fs";
import { expandHome } from "../util.mjs";
import { getProvider, resolveModel, normalizeLevel } from "./registry.mjs";
import { getApiKey, makeRedactor } from "../secrets.mjs";
import { computeUsd } from "../cost.mjs";
import { makeTools } from "./tools.mjs";
import * as openaiCodec from "./codec-openai.mjs";
import * as anthropicCodec from "./codec-anthropic.mjs";

const CODECS = { openai: openaiCodec, anthropic: anthropicCodec };

const SYSTEM_PROMPT = [
  "You are Fleet's autonomous coding agent working INSIDE a single project's git worktree.",
  "You have tools to read and search the code, write files, apply patches, and run commands (tests, linters, builds).",
  "Work the task to completion: read what you need, make the edits, and PROVE them by running the project's tests.",
  "Rules:",
  "- Make real changes with write_file or apply_patch. Describing a change is not doing it.",
  "- Stay inside this project. Never run deploy, publish, or release commands — they are blocked.",
  "- When done, call the finish tool with report set to the exact YAML result block the task asked for",
  "  (the fenced yaml block with task_id, result, summary, plain_summary, etc.). Do not skip finish.",
].join("\n");

function stepCapOf(app, fleet) {
  return app?.maxSteps || app?.agent?.maxSteps || (fleet && fleet.maxSteps) || 40;
}
function deadlineMs(app, fleet) {
  const min = app?.agent?.timeoutMinutes || (fleet && fleet.agentTimeoutMinutes) || 90;
  return min * 60 * 1000;
}

// Classify an HTTP/transport error into the loop's existing failure vocabulary + retry hint.
function classifyApiError(status, bodyText) {
  const t = String(bodyText || "");
  if (status === 401 || status === 403) return { failure: "auth", retry: false };
  if (status === 429) return { failure: "spawn", retry: true };
  if (status === 408 || (status >= 500 && status <= 599)) return { failure: "spawn", retry: true };
  if (/context length|maximum context|too many tokens|prompt is too long/i.test(t)) return { failure: "output", retry: false, context: true };
  return { failure: "spawn", retry: false };
}

async function callModel(provider, codec, { url, apiKey, model, system, transcript, tools, reasoning, fetchImpl }) {
  const body = codec.serialize({ model, system, transcript, tools });
  if (typeof provider.applyReasoning === "function") provider.applyReasoning(body, reasoning, model);
  let res;
  try { res = await fetchImpl(url, { method: "POST", headers: codec.headers(apiKey), body: JSON.stringify(body) }); }
  catch (e) { return { transportError: String((e && e.message) || e) }; }
  if (!res.ok) {
    let txt = ""; try { txt = await res.text(); } catch {}
    return { httpError: { status: res.status, body: txt } };
  }
  let json; try { json = await res.json(); } catch (e) { return { httpError: { status: res.status, body: "unparseable JSON response" } }; }
  return { parsed: codec.parse(json) };
}

export async function runApiAgent({ app, fleet, prompt, mode = "write", logFile, fetchImpl = globalThis.fetch }) {
  const provider = getProvider(app?.provider?.id || app?.providerId);
  if (!provider || provider.kind !== "api") return { raw: "", reportText: "", usage: null, failure: "spawn" };
  const codec = CODECS[provider.dialect];
  if (!codec) return { raw: "", reportText: "", usage: null, failure: "spawn" };

  const apiKey = getApiKey(provider);
  if (provider.auth === "api-key" && !apiKey) {
    return { raw: `No API key for ${provider.label}.`, reportText: "", usage: null, failure: "auth" };
  }
  const redact = makeRedactor([apiKey]);
  const model = resolveModel(app, provider);
  const reasoning = normalizeLevel(app?.reasoning || app?.provider?.reasoning);
  const root = expandHome(app.repo);
  const { specs, dispatch } = makeTools({ root, mode, offLimits: app.offLimits || [], timeoutMs: 1000 * 60 * 5 });
  const url = codec.endpoint(provider.baseUrl);

  const system = mode === "read" ? "You are a read-only assistant. Use the read tools to answer; do not attempt to modify anything." : SYSTEM_PROMPT;
  const transcript = [{ role: "user", text: prompt }];
  const logLines = [`# ${app.name || app.slug} — ${provider.label} (${model || "default"}) agentic run @ ${new Date().toISOString()}\n`];
  const log = (s) => { const line = redact(s); logLines.push(line); if (logFile) { try { appendFileSync(logFile, line + "\n"); } catch {} } };
  if (logFile) { try { writeFileSync(logFile, logLines[0] + "\n"); } catch {} }

  const usage = { inputTokens: 0, outputTokens: 0, usd: 0 };
  const stepCap = stepCapOf(app, fleet);
  const deadline = Date.now() + deadlineMs(app, fleet);
  let reportText = "", failure = null, finished = false;

  for (let step = 0; step < stepCap; step++) {
    if (Date.now() > deadline) { failure = failure || "timeout"; break; }

    // call the model, with bounded backoff on transient (429/5xx/transport) errors
    let r = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      r = await callModel(provider, codec, { url, apiKey, model, system, transcript, tools: specs, reasoning, fetchImpl });
      if (r.parsed) break;
      const errObj = r.httpError || { status: 0, body: r.transportError };
      const cls = r.transportError ? { failure: "spawn", retry: true } : classifyApiError(errObj.status, errObj.body);
      log(`[api error] status=${errObj.status || "net"} ${String(errObj.body || r.transportError || "").slice(0, 300)}`);
      if (!cls.retry || attempt === 3) { failure = cls.failure; break; }
      await new Promise((res) => setTimeout(res, 800 * Math.pow(2, attempt))); // 0.8s,1.6s,3.2s
    }
    if (!r || !r.parsed) { failure = failure || "spawn"; break; }

    const p = r.parsed;
    if (p.usage) { usage.inputTokens += p.usage.inputTokens; usage.outputTokens += p.usage.outputTokens; }
    if (p.text) log(p.text);
    transcript.push({ role: "assistant", text: p.text, toolCalls: p.toolCalls });

    if (!p.toolCalls.length) { reportText = p.text; break; } // model answered in plain text → final

    const results = [];
    for (const c of p.toolCalls) {
      if (c.name === "finish") {
        reportText = c.args?.report || c.args?.summary || p.text || "";
        finished = true;
        results.push({ id: c.id, name: c.name, output: "ok" });
        break;
      }
      log(`→ ${c.name} ${redact(JSON.stringify(c.args)).slice(0, 200)}`);
      const out = await dispatch(c.name, c.args);
      results.push({ id: c.id, name: c.name, output: redact(out) });
    }
    transcript.push({ role: "tool", results });
    if (finished) break;
  }

  if (!reportText && !failure) failure = "output"; // ran but produced nothing usable
  usage.usd = computeUsd(usage, provider.pricing && provider.pricing[model]);
  return { raw: redact(logLines.join("\n")), reportText, usage, failure };
}

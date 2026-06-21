// test-providers.mjs — unit tests for the multi-provider layer (no network, no state).
// Run:  cd fleet/runner && node test-providers.mjs
import { getProvider, resolveProvider, resolveModel, legacyAdapterToProvider, normalizeLevel } from "./providers/registry.mjs";
import * as oai from "./providers/codec-openai.mjs";
import * as ant from "./providers/codec-anthropic.mjs";
import { computeUsd } from "./cost.mjs";
import { makeRedactor } from "./secrets.mjs";
import { applyUnifiedDiff, makeTools } from "./providers/tools.mjs";

let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };

// --- registry ---------------------------------------------------------------
ok(getProvider("openai").kind === "api" && getProvider("openai").dialect === "openai", "openai is an api/openai-dialect provider");
ok(getProvider("codex").kind === "agentic-cli", "codex is an agentic-cli provider");
ok(legacyAdapterToProvider("codex") === "codex" && legacyAdapterToProvider("claude") === "claude_cli", "legacy adapter names map to providers");
ok(resolveProvider({ agent: { adapter: "codex" } }).id === "codex", "legacy app.agent.adapter resolves a provider");
ok(resolveProvider({ provider: { id: "anthropic" } }).id === "anthropic", "new app.provider.id resolves a provider");
ok(resolveModel({}, getProvider("openai")) === "gpt-5", "model falls back to provider default");
ok(resolveModel({ provider: { model: "o4-mini" } }, getProvider("openai")) === "o4-mini", "app.provider.model wins");

// --- reasoning mapping ------------------------------------------------------
{
  const b = {}; getProvider("openai").applyReasoning(b, "high"); ok(b.reasoning_effort === "high", "openai high → reasoning_effort high");
  const d = { model: "deepseek-chat" }; getProvider("deepseek").applyReasoning(d, "high"); ok(d.model === "deepseek-reasoner", "deepseek high → swaps to reasoner model");
  const a = {}; getProvider("anthropic").applyReasoning(a, "high"); ok(a.thinking && a.thinking.budget_tokens === 16000, "anthropic high → 16k thinking budget");
  const a2 = {}; getProvider("anthropic").applyReasoning(a2, "low"); ok(!a2.thinking, "anthropic low → no thinking block");
  const o = {}; getProvider("ollama").applyReasoning(o, "high"); ok(Object.keys(o).length === 0, "ollama reasoning is a no-op (local)");
  ok(normalizeLevel("bogus") === "medium", "unknown level normalizes to medium");
}

// --- openai codec -----------------------------------------------------------
{
  const transcript = [
    { role: "user", text: "do it" },
    { role: "assistant", text: "", toolCalls: [{ id: "c1", name: "write_file", args: { path: "a", content: "x" } }] },
    { role: "tool", results: [{ id: "c1", name: "write_file", output: "wrote 1 bytes" }] },
  ];
  const tools = [{ name: "write_file", description: "w", parameters: { type: "object", properties: {} } }];
  const body = oai.serialize({ model: "gpt-5", system: "sys", transcript, tools });
  ok(body.messages[0].role === "system" && body.messages[0].content === "sys", "openai: system message first");
  ok(body.messages[1].role === "user", "openai: user message");
  ok(body.messages[2].tool_calls[0].function.name === "write_file", "openai: assistant tool_call serialized");
  ok(body.messages[3].role === "tool" && body.messages[3].tool_call_id === "c1", "openai: tool result carries tool_call_id");
  ok(body.tools[0].type === "function" && body.tools[0].function.name === "write_file", "openai: tools mapped to function shape");
  const parsed = oai.parse({ choices: [{ message: { content: "hi", tool_calls: [{ id: "c9", function: { name: "read_file", arguments: '{"path":"x"}' } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 4 } });
  ok(parsed.toolCalls[0].name === "read_file" && parsed.toolCalls[0].args.path === "x", "openai: parse tool_call args to object");
  ok(parsed.usage.inputTokens === 10 && parsed.usage.outputTokens === 4, "openai: parse usage");
}

// --- anthropic codec --------------------------------------------------------
{
  const transcript = [
    { role: "user", text: "do it" },
    { role: "assistant", text: "ok", toolCalls: [{ id: "c1", name: "write_file", args: { path: "a" } }] },
    { role: "tool", results: [{ id: "c1", name: "write_file", output: "done" }] },
  ];
  const body = ant.serialize({ model: "claude-sonnet-4-6", system: "sys", transcript, tools: [{ name: "write_file", parameters: {} }] });
  ok(body.system === "sys", "anthropic: system is top-level");
  ok(body.messages[1].content.some((c) => c.type === "tool_use" && c.name === "write_file"), "anthropic: tool_use block");
  ok(body.messages[2].content[0].type === "tool_result" && body.messages[2].content[0].tool_use_id === "c1", "anthropic: tool_result block");
  ok(body.tools[0].input_schema !== undefined, "anthropic: tools use input_schema");
  const parsed = ant.parse({ content: [{ type: "text", text: "hello" }, { type: "tool_use", id: "c2", name: "grep", input: { pattern: "x" } }], usage: { input_tokens: 7, output_tokens: 3 }, stop_reason: "tool_use" });
  ok(parsed.text === "hello" && parsed.toolCalls[0].name === "grep" && parsed.toolCalls[0].args.pattern === "x", "anthropic: parse text + tool_use");
  ok(parsed.usage.inputTokens === 7, "anthropic: parse usage");
}

// --- cost -------------------------------------------------------------------
ok(computeUsd({ inputTokens: 1e6, outputTokens: 1e6 }, { in: 1.25, out: 10 }) === 11.25, "computeUsd: 1M in + 1M out priced correctly");
ok(computeUsd(null, { in: 1 }) === 0 && computeUsd({ inputTokens: 1 }, null) === 0, "computeUsd: missing usage/pricing → 0");

// --- redaction --------------------------------------------------------------
{
  const redact = makeRedactor(["sk-secret-abc123XYZ"]);
  ok(!redact("key is sk-secret-abc123XYZ here").includes("sk-secret-abc123XYZ"), "redactor masks the seeded key");
  ok(redact("token sk-ant-LONGtokenvalue1234567890 end").includes("«redacted»"), "redactor masks key-shaped strings even if not seeded");
}

// --- unified diff applier ---------------------------------------------------
{
  const before = "line1\nline2\nline3\n";
  const diff = "@@ -1,3 +1,3 @@\n line1\n-line2\n+line2-EDITED\n line3";
  ok(applyUnifiedDiff(before, diff) === "line1\nline2-EDITED\nline3\n", "applyUnifiedDiff: single-line replace");
  let threw = false; try { applyUnifiedDiff(before, "@@ -1 +1 @@\n nope\n+x"); } catch { threw = true; }
  ok(threw, "applyUnifiedDiff: throws when context can't be matched");
}

// --- read-mode tool gating --------------------------------------------------
{
  const w = makeTools({ root: "/tmp", mode: "write" }).specs.map((s) => s.name);
  const r = makeTools({ root: "/tmp", mode: "read" }).specs.map((s) => s.name);
  ok(w.includes("write_file") && w.includes("finish"), "write mode advertises write_file + finish");
  ok(!r.includes("write_file") && !r.includes("run_command") && !r.includes("finish"), "read mode advertises NO write/run/finish tools");
}

console.log(`\nproviders: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

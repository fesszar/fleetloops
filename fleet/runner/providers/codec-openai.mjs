// providers/codec-openai.mjs — wire format for OpenAI chat-completions and its many clones
// (DeepSeek, Gemini's OpenAI-compat endpoint, OpenRouter, Ollama/LM Studio all speak this).
//
// A codec is pure translation: it converts the harness's NEUTRAL transcript + tool list into
// this provider's request shape, and parses the response back into a neutral
// { text, toolCalls, usage, stop }. No file/network/loop logic lives here — that's the harness.
//
// Neutral transcript turns:
//   { role:"user", text }
//   { role:"assistant", text, toolCalls:[{ id, name, args }] }
//   { role:"tool", results:[{ id, name, output }] }
// Neutral tool: { name, description, parameters /* JSON-schema object */ }

export const dialect = "openai";

export function endpoint(baseUrl) {
  return `${String(baseUrl).replace(/\/$/, "")}/chat/completions`;
}

export function headers(apiKey) {
  const h = { "content-type": "application/json" };
  if (apiKey) h["authorization"] = `Bearer ${apiKey}`;
  return h;
}

function toTool(t) {
  return { type: "function", function: { name: t.name, description: t.description || "", parameters: t.parameters || { type: "object", properties: {} } } };
}

export function serialize({ model, system, transcript, tools, maxTokens }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  for (const t of transcript) {
    if (t.role === "user") {
      messages.push({ role: "user", content: t.text || "" });
    } else if (t.role === "assistant") {
      const m = { role: "assistant", content: t.text || "" };
      if (t.toolCalls && t.toolCalls.length) {
        m.tool_calls = t.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
      }
      messages.push(m);
    } else if (t.role === "tool") {
      for (const r of t.results) messages.push({ role: "tool", tool_call_id: r.id, content: String(r.output ?? "") });
    }
  }
  const body = { model, messages, tools: (tools || []).map(toTool), tool_choice: "auto" };
  if (maxTokens) body.max_tokens = maxTokens;
  return body;
}

export function parse(json) {
  const choice = json && json.choices && json.choices[0];
  const msg = (choice && choice.message) || {};
  const toolCalls = [];
  for (const tc of msg.tool_calls || []) {
    let args = {};
    try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { args = { _raw: tc.function?.arguments || "" }; }
    toolCalls.push({ id: tc.id || `call_${toolCalls.length}`, name: tc.function?.name || "", args });
  }
  const u = json && json.usage;
  return {
    text: msg.content || "",
    toolCalls,
    usage: u ? { inputTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0 } : null,
    stop: choice && choice.finish_reason,
  };
}

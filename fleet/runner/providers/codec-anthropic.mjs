// providers/codec-anthropic.mjs — wire format for the Anthropic Messages API.
//
// Same neutral contract as codec-openai.mjs. The two material differences Anthropic forces:
//   1. the system prompt is a TOP-LEVEL field, not a message;
//   2. tool calls/results are CONTENT BLOCKS inside user/assistant messages (tool_use /
//      tool_result), not separate "tool"-role messages with a tool_call_id.
// Keeping this entirely inside the codec is exactly why the harness stays dialect-agnostic.

export const dialect = "anthropic";
const API_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 8192;

export function endpoint(baseUrl) {
  return `${String(baseUrl).replace(/\/$/, "")}/messages`;
}

export function headers(apiKey) {
  const h = { "content-type": "application/json", "anthropic-version": API_VERSION };
  if (apiKey) h["x-api-key"] = apiKey;
  return h;
}

function toTool(t) {
  return { name: t.name, description: t.description || "", input_schema: t.parameters || { type: "object", properties: {} } };
}

export function serialize({ model, system, transcript, tools, maxTokens }) {
  const messages = [];
  for (const t of transcript) {
    if (t.role === "user") {
      messages.push({ role: "user", content: [{ type: "text", text: t.text || "" }] });
    } else if (t.role === "assistant") {
      const content = [];
      if (t.text) content.push({ type: "text", text: t.text });
      for (const c of t.toolCalls || []) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.args || {} });
      messages.push({ role: "assistant", content });
    } else if (t.role === "tool") {
      // tool results are delivered as a USER message of tool_result blocks
      messages.push({ role: "user", content: t.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: String(r.output ?? "") })) });
    }
  }
  const body = { model, max_tokens: maxTokens || DEFAULT_MAX_TOKENS, messages, tools: (tools || []).map(toTool) };
  if (system) body.system = system;
  return body;
}

export function parse(json) {
  const blocks = (json && json.content) || [];
  let text = "";
  const toolCalls = [];
  for (const b of blocks) {
    if (b.type === "text") text += b.text || "";
    else if (b.type === "tool_use") toolCalls.push({ id: b.id, name: b.name, args: b.input || {} });
  }
  const u = json && json.usage;
  return {
    text,
    toolCalls,
    usage: u ? { inputTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0 } : null,
    stop: json && json.stop_reason,
  };
}

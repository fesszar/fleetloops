// providers/registry.mjs — the single declarative table of agent providers.
//
// Two execution classes (see harness.mjs for the full rationale):
//   kind "agentic-cli" — an external CLI (Codex, Claude Code) edits the repo itself; the engine
//                        only spawns it and parses its YAML report. Runs through adapters.shell.
//   kind "api"         — a raw chat/completion API only returns TEXT. The engine's own agentic
//                        harness gives it real file/command tools. Runs through adapters.api.
//
// Everything provider-specific lives HERE so the harness, codecs and UI stay provider-agnostic.
// Adding a provider later = adding one descriptor object below. Nothing else changes.

// dialect: which wire format the API speaks. Six of the launch providers speak OpenAI's
// chat-completions shape, so one codec ("openai") covers them; Anthropic needs its own.
// Gemini is reached through its OpenAI-compatible endpoint to avoid a third codec.

// pricing: USD per 1,000,000 tokens, used only for cost VISIBILITY (cost.mjs). Subscription
// CLIs have no per-token bill, so pricing is null (we still surface token counts).
// OpenRouter prices are hydrated live from its /models endpoint (pricing left as a hint).

// applyReasoning(body, level, model): translate our universal low|medium|high dial onto each
// provider's actual knob, mutating the request body in place. Keeps the dial meaningful across
// wildly different APIs (OpenAI reasoning_effort, Anthropic thinking budget, model swaps, …).

const LEVELS = { low: 0, medium: 1, high: 2 };
export function normalizeLevel(level) {
  const l = String(level || "medium").toLowerCase();
  return l in LEVELS ? l : "medium";
}

// Anthropic thinking-token budget per level (only applied to models that support it).
function anthropicThinking(body, level) {
  const budget = { low: 0, medium: 6000, high: 16000 }[normalizeLevel(level)];
  if (budget > 0) body.thinking = { type: "enabled", budget_tokens: budget };
  return body;
}
// OpenAI / OpenRouter reasoning_effort (honoured by reasoning-capable models; ignored otherwise).
function openaiEffort(body, level) {
  body.reasoning_effort = normalizeLevel(level); // "low" | "medium" | "high"
  return body;
}

export const PROVIDERS = {
  // ---- agentic CLIs (unchanged execution path) ----------------------------------------
  codex: {
    id: "codex", label: "Codex (ChatGPT)", kind: "agentic-cli", auth: "oauth-cli",
    cli: "codex", reasoningFlag: "model_reasoning_effort", pricing: null,
    blurb: "Uses your ChatGPT plan. Nothing to paste.",
  },
  claude_cli: {
    id: "claude_cli", label: "Claude Code", kind: "agentic-cli", auth: "oauth-cli",
    cli: "claude", pricing: null,
    blurb: "Uses your Claude subscription.",
  },

  // ---- raw APIs (run through the bundled harness) -------------------------------------
  openai: {
    id: "openai", label: "OpenAI API", kind: "api", auth: "api-key", dialect: "openai",
    baseUrl: "https://api.openai.com/v1", envKey: "OPENAI_API_KEY", keychainService: "fleet:openai",
    models: ["gpt-5", "gpt-5-mini", "o4-mini", "gpt-4.1", "gpt-4o"],
    defaultModel: "gpt-5", preferPatch: true, applyReasoning: openaiEffort,
    pricing: { "gpt-5": { in: 1.25, out: 10 }, "gpt-5-mini": { in: 0.25, out: 2 }, "gpt-4.1": { in: 2, out: 8 }, "gpt-4o": { in: 2.5, out: 10 }, "o4-mini": { in: 1.1, out: 4.4 } },
    keysUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    id: "anthropic", label: "Anthropic API", kind: "api", auth: "api-key", dialect: "anthropic",
    baseUrl: "https://api.anthropic.com/v1", envKey: "ANTHROPIC_API_KEY", keychainService: "fleet:anthropic",
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
    defaultModel: "claude-sonnet-4-6", preferPatch: true, applyReasoning: anthropicThinking,
    pricing: { "claude-opus-4-8": { in: 15, out: 75 }, "claude-sonnet-4-6": { in: 3, out: 15 }, "claude-haiku-4-5-20251001": { in: 1, out: 5 } },
    keysUrl: "https://console.anthropic.com/settings/keys",
  },
  deepseek: {
    id: "deepseek", label: "DeepSeek", kind: "api", auth: "api-key", dialect: "openai",
    baseUrl: "https://api.deepseek.com/v1", envKey: "DEEPSEEK_API_KEY", keychainService: "fleet:deepseek",
    models: ["deepseek-chat", "deepseek-reasoner"], defaultModel: "deepseek-chat", preferPatch: false,
    // DeepSeek splits reasoning into a SEPARATE model rather than an effort knob.
    applyReasoning: (body, level) => { if (normalizeLevel(level) === "high") body.model = "deepseek-reasoner"; return body; },
    pricing: { "deepseek-chat": { in: 0.27, out: 1.1 }, "deepseek-reasoner": { in: 0.55, out: 2.19 } },
    keysUrl: "https://platform.deepseek.com/api_keys",
  },
  gemini: {
    id: "gemini", label: "Gemini", kind: "api", auth: "api-key", dialect: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", envKey: "GEMINI_API_KEY", keychainService: "fleet:gemini",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"], defaultModel: "gemini-2.5-flash", preferPatch: false,
    applyReasoning: openaiEffort,
    pricing: { "gemini-2.5-pro": { in: 1.25, out: 10 }, "gemini-2.5-flash": { in: 0.3, out: 2.5 } },
    keysUrl: "https://aistudio.google.com/apikey",
  },
  openrouter: {
    id: "openrouter", label: "OpenRouter", kind: "api", auth: "api-key", dialect: "openai",
    baseUrl: "https://openrouter.ai/api/v1", envKey: "OPENROUTER_API_KEY", keychainService: "fleet:openrouter",
    models: [], modelsEndpoint: "/models", defaultModel: "", preferPatch: true, applyReasoning: openaiEffort,
    pricing: {}, // hydrated live from /models
    keysUrl: "https://openrouter.ai/keys",
  },
  ollama: {
    id: "ollama", label: "Local (Ollama / LM Studio)", kind: "api", auth: "none-local", dialect: "openai",
    baseUrl: "http://127.0.0.1:11434/v1", envKey: null, keychainService: null,
    models: [], modelsEndpoint: "/models", defaultModel: "", preferPatch: false, applyReasoning: () => {},
    pricing: {}, // local = free
    blurb: "Runs on your Mac. No key, no bill.",
  },
};

export function getProvider(id) {
  return PROVIDERS[id] || null;
}

// Map a legacy app.agent.adapter value ("codex" | "claude" | "shell" | "manual") onto a provider
// id so existing configs keep working unchanged after this refactor.
export function legacyAdapterToProvider(adapter) {
  if (adapter === "codex") return "codex";
  if (adapter === "claude") return "claude_cli";
  return null; // shell/manual handled by pickAdapter directly
}

// Resolve the provider an app should use, from new-style app.provider or legacy app.agent.adapter.
export function resolveProvider(app) {
  const pid = app?.provider?.id || app?.providerId || legacyAdapterToProvider(app?.agent?.adapter);
  return pid ? getProvider(pid) : null;
}

// The model + reasoning an app wants, with sane provider defaults.
export function resolveModel(app, provider) {
  return app?.provider?.model || app?.model || provider?.defaultModel || "";
}

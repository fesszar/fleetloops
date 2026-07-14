import { pickAdapter } from "../adapters.mjs";
import { defaultAgentCommand } from "../project-onboard.mjs";
import { hasApiKey } from "../secrets.mjs";
import { which } from "../provider-cli.mjs";
import { getProvider, resolveProvider, resolveModel } from "./registry.mjs";

function cleanString(v) { return String(v || "").trim(); }

export function commandForProvider(app, provider, { primary = false } = {}) {
  if (!provider || provider.kind !== "agentic-cli") return "";
  const current = cleanString(app?.agent?.command);
  if (primary && current) return current;
  if (current && new RegExp(`(^|\\s|/)${provider.cli}(\\s|$)`).test(current)) return current;
  return defaultAgentCommand(provider.id);
}

function isUsableFallback(app, provider, opts = {}) {
  if (!provider) return false;
  if (provider.kind === "api") return provider.auth === "none-local" || hasApiKey(provider, opts);
  if (provider.kind === "agentic-cli") return !!(which(provider.cli) && commandForProvider(app, provider));
  return false;
}

export function resolveProviderChain(app, fleet = {}, opts = {}) {
  const primary = resolveProvider(app);
  if (!primary) return [];
  const chain = [{
    provider: primary,
    model: resolveModel(app, primary),
    primary: true,
    command: commandForProvider(app, primary, { primary: true }),
  }];
  const seen = new Set([primary.id]);
  const fallback = Array.isArray(fleet?.routing?.fallback) ? fleet.routing.fallback : [];
  for (const raw of fallback) {
    if (chain.length >= 4) break;
    const id = cleanString(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const provider = getProvider(id);
    if (!provider || !isUsableFallback(app, provider, opts)) continue;
    chain.push({
      provider,
      model: provider.defaultModel || "",
      primary: false,
      command: commandForProvider(app, provider),
    });
  }
  return chain;
}

export function appForProvider(app, entry) {
  if (!entry?.provider) return app;
  const provider = entry.provider;
  const providerConfig = { id: provider.id };
  if (entry.model) providerConfig.model = entry.model;
  const out = {
    ...app,
    provider: providerConfig,
    ...(entry.model ? { model: entry.model } : {}),
  };
  if (provider.kind === "agentic-cli") {
    out.agent = {
      ...(app.agent || {}),
      adapter: "shell",
      command: entry.primary ? (app.agent?.command || entry.command) : entry.command,
    };
  }
  return out;
}

export async function runAgentWithFailover({ app, fleet, prompt, dryRun, logFile, runAttempt, prepareFallback } = {}) {
  const chain = resolveProviderChain(app, fleet);
  if (!chain.length) {
    const adapter = pickAdapter(app);
    return {
      ...(await (runAttempt ? runAttempt({ app, entry: null, adapter, attemptIndex: 0 }) : adapter({ app, fleet, prompt, dryRun, logFile }))),
      provider: resolveProvider(app),
      model: "",
      chain,
      attempts: [],
    };
  }

  const attempts = [];
  let notified = false;
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    const attemptApp = appForProvider(app, entry);
    const adapter = pickAdapter(attemptApp);
    const res = await (runAttempt
      ? runAttempt({ app: attemptApp, entry, adapter, attemptIndex: i })
      : adapter({ app: attemptApp, fleet, prompt, dryRun, logFile }));
    attempts.push({ provider: entry.provider.id, failure: res.failure || null, report: !!res.report });
    const canAdvance = !res.report && res.failure === "auth" && i < chain.length - 1;
    if (!canAdvance) {
      return {
        ...res,
        provider: entry.provider,
        model: entry.model,
        chain,
        attempts,
        failoverExhausted: !res.report && res.failure === "auth" && chain.length > 1 && i === chain.length - 1,
      };
    }
    const prep = await prepareFallback?.({ from: entry, to: chain[i + 1], notified });
    if (prep && prep.ok === false) {
      return {
        ...res,
        report: null,
        failure: "spawn",
        provider: entry.provider,
        model: entry.model,
        chain,
        attempts,
        failoverResetError: prep.reason || "could not prepare fallback worktree",
      };
    }
    notified = true;
  }
  return { raw: "", report: null, failure: "output", provider: null, model: "", chain, attempts };
}

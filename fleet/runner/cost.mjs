// cost.mjs — real money metering for raw-API providers.
//
// Raw APIs return billable `usage`, so we convert tokens → USD from the provider's pricing table
// (USD per 1,000,000 tokens) and attribute spend to { app, phase }. Subscription CLIs
// (Codex/Claude Code) can report token usage too, but those are API-equivalent estimates included
// in the user's plan; they are displayed separately and never feed spend caps.

import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getProvider } from "./providers/registry.mjs";
import { readJsonSafe } from "./util.mjs";

export function computeUsd(usage, pricing) {
  if (!usage || !pricing) return 0;
  const inUsd = ((usage.inputTokens || 0) / 1e6) * (pricing.in || 0);
  const outUsd = ((usage.outputTokens || 0) / 1e6) * (pricing.out || 0);
  return +(inUsd + outUsd).toFixed(6);
}

function ledgerFile(stateDir) { return join(stateDir, "cost.jsonl"); }
function num(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}
function money(v, places = 4) { return +num(v).toFixed(places); }
function pricingFor(table, model) {
  if (!table) return null;
  const m = String(model || "");
  if (m && table[m]) return table[m];
  if (m) {
    for (const [k, v] of Object.entries(table)) {
      if (k !== "default" && m.includes(k)) return v;
    }
  }
  return table.default || null;
}
function tokenUsage(usage = {}) {
  const inputTokens = num(usage.inputTokens ?? usage.tokensIn ?? usage.inTok);
  const outputTokens = num(usage.outputTokens ?? usage.tokensOut ?? usage.outTok);
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens: num(usage.cacheReadInputTokens ?? usage.cachedInputTokens),
    cacheCreationInputTokens: num(usage.cacheCreationInputTokens),
    reasoningOutputTokens: num(usage.reasoningOutputTokens),
  };
}
function isSubscriptionRecord(r) {
  if (r?.subscription === true) return true;
  const p = getProvider(r?.provider);
  return p?.kind === "agentic-cli";
}
function isEstimatedRecord(r) {
  return r?.estimated === true || isSubscriptionRecord(r);
}
function recordTokens(r) {
  return {
    input: num(r?.tokensIn ?? r?.inTok),
    output: num(r?.tokensOut ?? r?.outTok),
    cacheRead: num(r?.cacheReadInputTokens),
    cacheCreation: num(r?.cacheCreationInputTokens),
    reasoningOutput: num(r?.reasoningOutputTokens),
  };
}
function addUsd(obj, key, usd) { obj[key] = money((obj[key] || 0) + num(usd)); }
function addTokens(obj, key, t) {
  const cur = obj[key] || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, reasoningOutput: 0, runs: 0 };
  cur.input += t.input;
  cur.output += t.output;
  cur.cacheRead += t.cacheRead;
  cur.cacheCreation += t.cacheCreation;
  cur.reasoningOutput += t.reasoningOutput;
  cur.runs += 1;
  obj[key] = cur;
}
function finalizeTokenMap(obj) {
  for (const v of Object.values(obj || {})) {
    v.input = Math.round(v.input);
    v.output = Math.round(v.output);
    v.cacheRead = Math.round(v.cacheRead);
    v.cacheCreation = Math.round(v.cacheCreation);
    v.reasoningOutput = Math.round(v.reasoningOutput);
  }
}

// Append one spend record. Best-effort, never throws (metering must never break a run).
export function recordCost(stateDir, { app, phase, provider, model, usage, usd }) {
  if (!stateDir) return;
  const providerObj = getProvider(provider);
  const subscription = providerObj?.kind === "agentic-cli";
  const tokens = tokenUsage(usage);
  const explicitUsd = typeof usd === "number" && Number.isFinite(usd)
    ? usd
    : (typeof usage?.usd === "number" && Number.isFinite(usage.usd) ? usage.usd : null);
  let pricedUsd = explicitUsd == null ? null : explicitUsd;
  let estimated = usage?.estimated === true;
  if (pricedUsd == null) {
    const pricing = pricingFor(providerObj?.pricing, model);
    const estPricing = pricingFor(providerObj?.estPricing, model);
    if (pricing) {
      pricedUsd = computeUsd(tokens, pricing);
      estimated = false;
    } else if (estPricing) {
      pricedUsd = computeUsd(tokens, estPricing);
      estimated = true;
    } else {
      pricedUsd = 0;
      estimated = true;
    }
  } else if (usage?.estimated === false) {
    estimated = false;
  } else if (subscription || !providerObj?.pricing) {
    estimated = usage?.estimated !== false;
  }
  const rec = {
    at: new Date().toISOString(), app: app || "?", phase: phase || "task",
    provider: provider || "?", model: model || "?",
    inTok: tokens.inputTokens, outTok: tokens.outputTokens,
    tokensIn: tokens.inputTokens, tokensOut: tokens.outputTokens,
    cacheReadInputTokens: tokens.cacheReadInputTokens,
    cacheCreationInputTokens: tokens.cacheCreationInputTokens,
    reasoningOutputTokens: tokens.reasoningOutputTokens,
    usd: money(pricedUsd, 6),
    estimated: !!estimated,
    subscription: !!subscription,
  };
  try { appendFileSync(ledgerFile(stateDir), JSON.stringify(rec) + "\n"); } catch {}
  return rec;
}

function readRecords(stateDir) {
  const f = ledgerFile(stateDir);
  if (!existsSync(f)) return [];
  try {
    return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return [] }
}

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const monthKey = (d) => new Date(d).toISOString().slice(0, 7);

// Spend for one app over today / this month (used for cap checks + the Cost screen).
export function spendForApp(stateDir, appSlug, now = new Date()) {
  const recs = readRecords(stateDir).filter((r) => r.app === appSlug);
  const today = dayKey(now), month = monthKey(now);
  let dailyUsd = 0, monthlyUsd = 0, dailyEstUsd = 0, monthlyEstUsd = 0;
  for (const r of recs) {
    const estimated = isEstimatedRecord(r);
    const real = estimated ? 0 : num(r.usd);
    const est = estimated ? num(r.usd) : 0;
    if (dayKey(r.at) === today) { dailyUsd += real; dailyEstUsd += est; }
    if (monthKey(r.at) === month) { monthlyUsd += real; monthlyEstUsd += est; }
  }
  return {
    dailyUsd: money(dailyUsd), monthlyUsd: money(monthlyUsd),
    dailyEstUsd: money(dailyEstUsd), monthlyEstUsd: money(monthlyEstUsd),
    usd: money(dailyUsd), estUsd: money(dailyEstUsd),
  };
}

// True when an app has blown its configured daily or monthly USD cap. Caps are optional; a
// missing cap means "no limit". Returns { exceeded, scope, dailyUsd, monthlyUsd, cap }.
export function budgetExceeded(stateDir, app, now = new Date()) {
  const budget = app?.budget || app?.provider?.budget || {};
  const { dailyUsd, monthlyUsd } = spendForApp(stateDir, app.slug, now);
  if (budget.dailyUsd && dailyUsd >= budget.dailyUsd) return { exceeded: true, scope: "daily", dailyUsd, monthlyUsd, cap: budget.dailyUsd };
  if (budget.monthlyUsd && monthlyUsd >= budget.monthlyUsd) return { exceeded: true, scope: "monthly", dailyUsd, monthlyUsd, cap: budget.monthlyUsd };
  return { exceeded: false, dailyUsd, monthlyUsd };
}

function usageMisses(stateDir) {
  const byApp = {};
  let total = 0;
  let files = [];
  try { files = readdirSync(stateDir).filter((f) => f.endsWith(".json")); } catch { return { total, byApp }; }
  for (const f of files) {
    const s = readJsonSafe(join(stateDir, f));
    if (!s?.slug || !s.usageMisses) continue;
    const m = s.usageMisses;
    const n = typeof m === "number"
      ? m
      : num(m.total ?? Object.entries(m).filter(([k]) => k !== "total").reduce((sum, [, v]) => sum + num(v), 0));
    if (n > 0) {
      byApp[s.slug] = n;
      total += n;
    }
  }
  return { total, byApp };
}

// Roll the ledger up for the Cost dashboard: totals this month, per-app and per-phase splits.
export function costSummary(stateDir, now = new Date()) {
  const recs = readRecords(stateDir);
  const month = monthKey(now), today = dayKey(now);
  const out = {
    monthUsd: 0, todayUsd: 0, monthEstUsd: 0, todayEstUsd: 0,
    byApp: {}, byPhase: {}, byProvider: {},
    estByApp: {}, estByPhase: {}, estByProvider: {},
    tokensByApp: {}, tokensByProvider: {},
    usageMisses: 0, usageMissesByApp: {},
  };
  for (const r of recs) {
    const estimated = isEstimatedRecord(r);
    const real = estimated ? 0 : num(r.usd);
    const est = estimated ? num(r.usd) : 0;
    if (dayKey(r.at) === today) { out.todayUsd += real; out.todayEstUsd += est; }
    if (monthKey(r.at) !== month) continue;
    out.monthUsd += real;
    out.monthEstUsd += est;
    if (real) {
      addUsd(out.byApp, r.app, real);
      addUsd(out.byPhase, r.phase, real);
      addUsd(out.byProvider, r.provider, real);
    }
    if (est) {
      addUsd(out.estByApp, r.app, est);
      addUsd(out.estByPhase, r.phase, est);
      addUsd(out.estByProvider, r.provider, est);
    }
    const t = recordTokens(r);
    if (t.input || t.output || t.cacheRead || t.cacheCreation || t.reasoningOutput) {
      addTokens(out.tokensByApp, r.app, t);
      addTokens(out.tokensByProvider, r.provider, t);
    }
  }
  out.todayUsd = money(out.todayUsd);
  out.monthUsd = money(out.monthUsd);
  out.todayEstUsd = money(out.todayEstUsd);
  out.monthEstUsd = money(out.monthEstUsd);
  finalizeTokenMap(out.tokensByApp);
  finalizeTokenMap(out.tokensByProvider);
  const misses = usageMisses(stateDir);
  out.usageMisses = misses.total;
  out.usageMissesByApp = misses.byApp;
  return out;
}

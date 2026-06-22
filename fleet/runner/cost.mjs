// cost.mjs — real money metering for raw-API providers.
//
// Subscription CLIs (Codex/Claude Code) have no per-token bill; for them we only surface token
// counts. Raw APIs return exact `usage` in every response, so we convert tokens → USD from the
// provider's pricing table (USD per 1,000,000 tokens) and attribute spend to { app, phase },
// where phase ∈ task | explain | review. Per-app daily/monthly caps let the scheduler pause an
// app that's overspending (loop.mjs checks budgetExceeded beside the fleet-pause check).

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function computeUsd(usage, pricing) {
  if (!usage || !pricing) return 0;
  const inUsd = ((usage.inputTokens || 0) / 1e6) * (pricing.in || 0);
  const outUsd = ((usage.outputTokens || 0) / 1e6) * (pricing.out || 0);
  return +(inUsd + outUsd).toFixed(6);
}

function ledgerFile(stateDir) { return join(stateDir, "cost.jsonl"); }

// Append one spend record. Best-effort, never throws (metering must never break a run).
export function recordCost(stateDir, { app, phase, provider, model, usage, usd }) {
  if (!stateDir) return;
  const rec = {
    at: new Date().toISOString(), app: app || "?", phase: phase || "task",
    provider: provider || "?", model: model || "?",
    inTok: usage?.inputTokens || 0, outTok: usage?.outputTokens || 0,
    usd: typeof usd === "number" ? usd : 0,
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
  let dailyUsd = 0, monthlyUsd = 0;
  for (const r of recs) {
    if (dayKey(r.at) === today) dailyUsd += r.usd;
    if (monthKey(r.at) === month) monthlyUsd += r.usd;
  }
  return { dailyUsd: +dailyUsd.toFixed(4), monthlyUsd: +monthlyUsd.toFixed(4) };
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

// Roll the ledger up for the Cost dashboard: totals this month, per-app and per-phase splits.
export function costSummary(stateDir, now = new Date()) {
  const recs = readRecords(stateDir);
  const month = monthKey(now), today = dayKey(now);
  const out = { monthUsd: 0, todayUsd: 0, byApp: {}, byPhase: {}, byProvider: {} };
  for (const r of recs) {
    if (dayKey(r.at) === today) out.todayUsd += r.usd;
    if (monthKey(r.at) !== month) continue;
    out.monthUsd += r.usd;
    out.byApp[r.app] = +(((out.byApp[r.app] || 0) + r.usd)).toFixed(4);
    out.byPhase[r.phase] = +(((out.byPhase[r.phase] || 0) + r.usd)).toFixed(4);
    out.byProvider[r.provider] = +(((out.byProvider[r.provider] || 0) + r.usd)).toFixed(4);
  }
  out.todayUsd = +out.todayUsd.toFixed(4);
  out.monthUsd = +out.monthUsd.toFixed(4);
  return out;
}

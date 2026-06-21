// test-config.mjs — provider status, key validation, and cost metering (the Providers/Cost UI backend).
// Run:  cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-config.mjs
import { existsSync, mkdirSync } from "node:fs";
import { listProviderStatus, validateApiKey } from "./providers/validate.mjs";
import { recordCost, costSummary, spendForApp, budgetExceeded, computeUsd } from "./cost.mjs";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d)."); process.exit(1); }
const SD = process.env.FLEET_STATE_DIR;
if (!existsSync(SD)) mkdirSync(SD, { recursive: true });
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };

// --- provider status list ---------------------------------------------------
{
  const rows = listProviderStatus();
  ok(rows.length >= 8, "status lists every provider");
  const oai = rows.find((r) => r.id === "openai");
  ok(oai && oai.kind === "api" && Array.isArray(oai.models), "openai row carries kind + models");
  const ollama = rows.find((r) => r.id === "ollama");
  ok(ollama && ollama.connected === true, "local provider reports connected (no key needed)");
  const oaiConnected = rows.find((r) => r.id === "openai").connected;
  ok(typeof oaiConnected === "boolean", "api provider reports a boolean connected state");
}

// --- key validation (mock fetch) --------------------------------------------
{
  const okFetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: "gpt-5" }, { id: "gpt-4o" }] }) });
  const r = await validateApiKey("openai", "sk-test", { fetchImpl: okFetch });
  ok(r.ok && r.count === 2, "valid key → ok with model count");

  const badFetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const r2 = await validateApiKey("openai", "sk-bad", { fetchImpl: badFetch });
  ok(!r2.ok && /rejected/.test(r2.error), "401 → friendly 'key rejected' error");

  const r3 = await validateApiKey("openai", "", { fetchImpl: okFetch });
  ok(!r3.ok && /no key/.test(r3.error), "empty key → 'no key provided'");

  const antFetch = async (url, opts) => { ok(!!opts.headers["x-api-key"], "anthropic validate uses x-api-key header"); return { ok: true, status: 200, json: async () => ({ data: [{ id: "claude-sonnet-4-6" }] }) }; };
  await validateApiKey("anthropic", "sk-ant", { fetchImpl: antFetch });
}

// --- cost metering ----------------------------------------------------------
{
  ok(computeUsd({ inputTokens: 2e6, outputTokens: 1e6 }, { in: 1.25, out: 10 }) === 12.5, "computeUsd prices 2M in + 1M out");
  recordCost(SD, { app: "acme", phase: "task", provider: "openai", model: "gpt-5", usage: { inputTokens: 1e6, outputTokens: 1e6 }, usd: 11.25 });
  recordCost(SD, { app: "acme", phase: "review", provider: "openai", model: "gpt-5", usage: { inputTokens: 1e5, outputTokens: 1e5 }, usd: 1.13 });
  recordCost(SD, { app: "beta", phase: "task", provider: "deepseek", model: "deepseek-chat", usage: { inputTokens: 1e6, outputTokens: 1e6 }, usd: 1.37 });
  const sum = costSummary(SD);
  ok(Math.abs(sum.monthUsd - (11.25 + 1.13 + 1.37)) < 0.01, "costSummary totals the month");
  ok(Math.abs(sum.byApp.acme - 12.38) < 0.01, "costSummary splits by app");
  ok(sum.byPhase.review > 0 && sum.byPhase.task > 0, "costSummary splits by phase");
  const acme = spendForApp(SD, "acme");
  ok(Math.abs(acme.dailyUsd - 12.38) < 0.01, "spendForApp sums today's spend");
  const over = budgetExceeded(SD, { slug: "acme", budget: { dailyUsd: 5 } });
  ok(over.exceeded && over.scope === "daily", "budgetExceeded fires when the daily cap is blown");
  const under = budgetExceeded(SD, { slug: "acme", budget: { dailyUsd: 100 } });
  ok(!under.exceeded, "budgetExceeded stays calm under the cap");
  const nocap = budgetExceeded(SD, { slug: "acme" });
  ok(!nocap.exceeded, "no cap configured → never exceeded");
}

console.log(`\nconfig: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

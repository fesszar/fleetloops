// test-config.mjs — provider status, key validation, and cost metering (the Providers/Cost UI backend).
// Run:  cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-config.mjs
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { listProviderStatus, validateApiKey } from "./providers/validate.mjs";
import { checkCliProvider, handleCliProviderAction } from "./provider-cli.mjs";
import { recordCost, costSummary, spendForApp, budgetExceeded, computeUsd } from "./cost.mjs";
import { applyAppConfigPatch, applyFleetConfigPatch, isWithinQuietHours, publicFleetConfig } from "./config-api.mjs";
import { addProjectToConfig } from "./project-onboard.mjs";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d)."); process.exit(1); }
const SD = process.env.FLEET_STATE_DIR;
if (!existsSync(SD)) mkdirSync(SD, { recursive: true });
const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };
const withPath = (path, fn) => {
  const old = process.env.PATH;
  process.env.PATH = path;
  try { return fn(); } finally { process.env.PATH = old; }
};
const writeExecutable = (path, body) => {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
};

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

// --- CLI readiness ----------------------------------------------------------
{
  const fakeBin = mkdtempSync(join(tmpdir(), "fleet-cli-test-"));
  const basePath = "/bin:/usr/bin";
  const fakePath = `${fakeBin}:${basePath}`;
  const missing = withPath(basePath, () => checkCliProvider("codex"));
  ok(missing.installed === false && missing.connected === false, "missing Codex CLI is not connected");

  writeExecutable(join(fakeBin, "codex"), `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli test"; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Not logged in"; exit 1; fi
exit 1
`);
  const unauth = withPath(fakePath, () => checkCliProvider("codex"));
  ok(unauth.installed === true && unauth.authenticated === false && unauth.connected === false, "installed but signed-out Codex CLI is not connected");

  writeExecutable(join(fakeBin, "codex"), `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli test"; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in using ChatGPT"; exit 0; fi
if [ "$1" = "exec" ]; then echo "READY"; exit 0; fi
exit 1
`);
  const ready = withPath(fakePath, () => checkCliProvider("codex"));
  ok(ready.installed === true && ready.authenticated === true && ready.usable === true && ready.connected === true, "authenticated Codex CLI is connected");
  const shallow = withPath(fakePath, () => checkCliProvider("codex", { auth: false }));
  ok(shallow.installed === true && shallow.connected === false && /refresh/i.test(shallow.detail), "shallow CLI status never marks a provider connected before explicit verification");
  const verifiedReady = withPath(fakePath, () => checkCliProvider("codex", { deep: true }));
  ok(verifiedReady.connected === true && /verified/i.test(verifiedReady.detail), "deep Codex probe verifies the executable token path");

  writeExecutable(join(fakeBin, "codex"), `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli test"; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in using ChatGPT"; exit 0; fi
if [ "$1" = "exec" ]; then echo "Your authentication token has been invalidated. Please try signing in again."; exit 1; fi
exit 1
`);
  const staleToken = withPath(fakePath, () => checkCliProvider("codex", { deep: true }));
  ok(staleToken.authenticated === false && staleToken.connected === false, "deep Codex probe rejects invalidated browser tokens");

  writeExecutable(join(fakeBin, "codex"), `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli test"; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Not logged in"; exit 1; fi
if [ "$1" = "login" ] && [ "$2" = "--device-auth" ]; then printf '%s\\n' 'Open this link in your browser' 'https://auth.openai.com/codex/device' 'Enter this one-time code' 'ABCD-EFGH'; exit 0; fi
exit 1
`);
  const deviceLogin = withPath(fakePath, () => handleCliProviderAction({ provider: "codex", action: "login" }));
  ok(deviceLogin.ok && deviceLogin.method === "device-code" && deviceLogin.authUrl && deviceLogin.deviceCode === "ABCD-EFGH", "Codex login uses in-app device-code flow without Terminal");

  writeExecutable(join(fakeBin, "claude"), `#!/bin/sh
if [ "$1" = "--version" ]; then echo "claude test"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then printf '%s\\n' '{"loggedIn":true,"email":"qa@example.com"}'; exit 0; fi
if [ "$1" = "status" ]; then echo "Credit balance is too low"; exit 1; fi
exit 1
`);
  const accountIssue = withPath(fakePath, () => checkCliProvider("claude_cli"));
  ok(accountIssue.authenticated === true && accountIssue.usable === false && accountIssue.connected === false, "signed-in but unusable Claude CLI is not connected");
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
  ok(Math.abs(sum.todayUsd - (11.25 + 1.13 + 1.37)) < 0.01, "costSummary totals today");
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

// --- project onboarding helpers + CLI config path --------------------------
{
  const repo = join(SD, "node-project");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node --test", build: "vite build" } }));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  spawnSync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
  spawnSync("git", ["config", "user.name", "Tests"], { cwd: repo });
  spawnSync("git", ["add", "-A"], { cwd: repo });
  spawnSync("git", ["commit", "-qm", "base"], { cwd: repo });

  const cfg = { fleet: { defaultRetryCap: 2 }, apps: [] };
  const r = addProjectToConfig(cfg, { repo });
  ok(r.ok && cfg.apps.length === 1, "project onboarding writes one app into config");
  ok(cfg.apps[0].stack === "node" && cfg.apps[0].commands.test === "npm test --silent", "project onboarding detects node test/build commands");
  ok(cfg.apps[0].loop === "paused" && cfg.apps[0].vcs === "git", "git projects start paused until brain/gates are approved");
  ok(existsSync(join(repo, ".fleet", "setup.sh")) && existsSync(join(repo, ".fleet", "env.sh")), "git projects get test-environment scaffolding");
  ok(readFileSync(join(repo, ".gitignore"), "utf8").includes(".fleet/test.db"), "gitignore protects Fleet local test artifacts");
  const dup = addProjectToConfig(cfg, { repo });
  ok(!dup.ok && dup.status === 409, "duplicate project path is rejected");

  const repo2 = join(SD, "other", "node-project");
  mkdirSync(repo2, { recursive: true });
  writeFileSync(join(repo2, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  const r2 = addProjectToConfig(cfg, { repo: repo2 });
  ok(r2.ok && r2.app.slug === "node-project-2", "auto-generated slugs stay unique");
  ok(r2.app.loop === "paused" && r2.app.vcs === "none", "non-git projects are added paused instead of pretending live work is safe");

  const cliRepo = join(SD, "cli-project");
  mkdirSync(cliRepo, { recursive: true });
  writeFileSync(join(cliRepo, "Package.swift"), "// swift package marker\n");
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: cliRepo });
  const cfgPath = join(SD, "cli-fleet.config.json");
  writeFileSync(cfgPath, JSON.stringify({ fleet: { defaultRetryCap: 2 }, apps: [] }));
  const cli = spawnSync(process.execPath, ["fleet.mjs", "onboard", "swiftapp", "--repo", cliRepo, "--name", "Swift App"], {
    cwd: HERE,
    env: { ...process.env, FLEET_CONFIG: cfgPath, FLEET_STATE_DIR: SD },
    encoding: "utf8",
  });
  const cliCfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  ok(cli.status === 0 && cliCfg.apps[0]?.slug === "swiftapp" && cliCfg.apps[0]?.stack === "swift", "CLI onboard honors FLEET_CONFIG and shared stack detection");
}

// --- bridge config patch helpers -------------------------------------------
{
  const cfg = { fleet: { defaultRetryCap: 2 }, apps: [{ slug: "acme", name: "Acme", agent: { adapter: "manual" } }] };
  const r = applyAppConfigPatch(cfg, { slug: "acme", providerId: "openai", providerModel: "gpt-5-mini", reasoning: "high", budget: { dailyUsd: 12 } });
  ok(r.ok && cfg.apps[0].provider.id === "openai", "app-config stores provider id");
  ok(cfg.apps[0].provider.model === "gpt-5-mini" && cfg.apps[0].model === "gpt-5-mini", "app-config stores provider model + legacy model fallback");
  ok(cfg.apps[0].reasoning === "high", "app-config stores reasoning");
  ok(cfg.apps[0].budget.dailyUsd === 12, "app-config stores per-app spend cap");
  const bad = applyAppConfigPatch(cfg, { slug: "acme", providerId: "missing" });
  ok(!bad.ok && bad.status === 400, "app-config rejects unknown providers");

  const f = applyFleetConfigPatch(cfg, { intervalMinutes: 2, maxConcurrentLoops: 4, maxUnattendedHours: 36, notifications: { desktop: false }, budget: { dailyUsd: 25, monthlyUsd: 200, alertPct: 70 }, quietHours: { enabled: true, start: "22:00", end: "07:00" } });
  ok(f.ok && cfg.fleet.intervalMinutes === 2 && cfg.fleet.maxConcurrentLoops === 4, "fleet-config stores scheduler knobs");
  ok(publicFleetConfig(cfg.fleet).notifications.desktop === false, "fleet-config stores notification preference");
  ok(isWithinQuietHours(cfg.fleet, new Date("2026-06-22T23:00:00")) && isWithinQuietHours(cfg.fleet, new Date("2026-06-22T06:30:00")), "quiet hours handle overnight windows");
  ok(!isWithinQuietHours(cfg.fleet, new Date("2026-06-22T12:00:00")), "quiet hours allow daytime windows");
  const f2 = applyFleetConfigPatch(cfg, { routing: { routine: "ollama", standard: "codex", risky: "openai", fallback: ["codex", "anthropic"] }, schedule: { overnightDrain: { enabled: true, start: "22:30", end: "06:30" } }, notifications: { email: true, mobile: true, categories: { needs: true, review: false, stuck: true, cap: true, win: false } } });
  ok(f2.ok && cfg.fleet.routing.risky === "openai" && cfg.fleet.routing.fallback.length === 2, "fleet-config stores difficulty routing and fallback chain");
  ok(publicFleetConfig(cfg.fleet).schedule.overnightDrain.enabled === true, "fleet-config stores overnight drain schedule");
  ok(publicFleetConfig(cfg.fleet).notifications.email === true && publicFleetConfig(cfg.fleet).notifications.categories.review === false, "fleet-config stores notification channels and categories");
}

console.log(`\nconfig: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

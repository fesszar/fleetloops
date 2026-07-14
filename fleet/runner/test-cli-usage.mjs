// test-cli-usage.mjs — CLI usage parsing and subscription cost visibility.
// Run: cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-cli-usage.mjs
import { execSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d)."); process.exit(1); }
if (!existsSync(process.env.FLEET_STATE_DIR)) mkdirSync(process.env.FLEET_STATE_DIR, { recursive: true });
process.env.FLEET_WORKTREE_DIR = mkdtempSync(join(tmpdir(), "wt-"));

const HERE = dirname(fileURLToPath(import.meta.url));
const SD = process.env.FLEET_STATE_DIR;
const F = String.fromCharCode(96, 96, 96);

const { parseCliUsage } = await import("./adapters.mjs");
const { runLoopOnce, STATE_DIR } = await import("./loop.mjs");
const { budgetExceeded, costSummary, recordCost, spendForApp } = await import("./cost.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };

const codexFixture = readFileSync(join(HERE, "fixtures", "codex-usage-sample.txt"), "utf8");
const claudeFixture = readFileSync(join(HERE, "fixtures", "claude-usage-sample.json"), "utf8");

// 1. Fixture-driven parser coverage.
{
  const codex = parseCliUsage("codex", codexFixture);
  ok(codex && codex.inputTokens === 20170 && codex.outputTokens === 8, "codex JSONL fixture extracts input/output tokens");
  ok(codex.cacheReadInputTokens === 9984 && codex.estimated === true, "codex fixture preserves cached input tokens and marks estimate");

  const claude = parseCliUsage("claude_cli", claudeFixture);
  ok(claude && claude.inputTokens === 1200 && claude.outputTokens === 80, "claude JSON fixture extracts input/output tokens");
  ok(claude.cacheCreationInputTokens === 300 && claude.cacheReadInputTokens === 450, "claude fixture preserves cache token fields");
  ok(claude.usd === 0.0042 && claude.estimated === false, "claude total_cost_usd is used verbatim");

  ok(parseCliUsage("codex", "no tokens here") === null, "garbage CLI output returns null");
}

function repo() {
  const r = mkdtempSync(join(tmpdir(), "r-"));
  const G = (a) => execSync(`git -C "${r}" ${a}`, { encoding: "utf8" });
  G("init -q -b main");
  G("config user.email t@t");
  G("config user.name t");
  writeFileSync(join(r, "app.js"), "v=1\n");
  G("add -A");
  G("commit -qm base");
  return r;
}
function seed(slug, tasks) {
  writeFileSync(join(STATE_DIR, `${slug}.json`), JSON.stringify({ slug, loop: "running", retryCap: 2, backlog: tasks, escalations: [], log: [] }));
}
function rd(slug) {
  return JSON.parse(readFileSync(join(STATE_DIR, `${slug}.json`), "utf8"));
}
function task(id = "T1") {
  return { id, title: `do ${id}`, status: "queued", difficulty: "easy", deps: [], acceptance: "change is made", attempts: 0 };
}
function app(slug, r, agent, provider = "codex") {
  return {
    slug, name: slug, stage: "dev", loop: "running", northStar: "ship", repo: r,
    retryCap: 2, autonomy: "merge-main", standingContext: "-", eightyTwentyLoop: "-",
    commands: { test: "true" }, gates: [], guardrails: [], offLimits: [],
    provider: { id: provider, model: provider === "codex" ? "gpt-5.3-codex" : "claude-sonnet-5" },
    agent: { adapter: "shell", command: `bash "${agent}" "{{REPO}}" "{{PROMPT_FILE}}"` },
    backlog: [],
  };
}
function fleet() {
  return {
    defaultRetryCap: 2, defaultAutonomy: "merge-main", globalGuardrails: [],
    safety: { requireGitForLive: true, deployPolicies: {} }, autonomyLevels: {},
    reviewer: false, notifications: { desktop: false }, consensus: { reviewers: 1, minCoverage: 1 },
    brain: false,
  };
}
const agentDir = mkdtempSync(join(tmpdir(), "ag-"));
function mkAgent(name, body) {
  const f = join(agentDir, name);
  writeFileSync(f, "#!/usr/bin/env bash\n" + body);
  chmodSync(f, 0o755);
  return f;
}

// 2. Shell adapter through the real loop records subscription usage in the cost ledger.
{
  const usageFile = join(agentDir, "codex-usage.txt");
  writeFileSync(usageFile, codexFixture);
  const agent = mkAgent("codex-usage.sh", `echo "// usage $(date +%s%N)" >> "$1/app.js"
cat "${usageFile}"
printf '${F}yaml\\ntask_id: T1\\nresult: DONE\\nacceptance_met: true\\nsummary: done with usage\\nplain_summary: changed app\\nuser_impact: usage is visible\\n${F}\\n'`);
  const slug = "cli-usage";
  const r = repo();
  seed(slug, [task()]);
  const res = await runLoopOnce(app(slug, r, agent), fleet(), { dryRun: false });
  ok(res.action === "completed", "fake Codex CLI run completes");
  const ledger = readFileSync(join(SD, "cost.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const rec = ledger.find((x) => x.app === slug && x.provider === "codex");
  ok(rec && rec.estimated === true && rec.subscription === true, "CLI run records an estimated subscription cost line");
  ok(rec.tokensIn === 20170 && rec.tokensOut === 8 && rec.cacheReadInputTokens === 9984, "cost line records token counts from the CLI output");
}

// 3. Estimated subscription usage never trips budgets; real API spend still does.
{
  recordCost(SD, { app: "budget-cli", phase: "task", provider: "codex", model: "gpt-5.3-codex", usage: { inputTokens: 1e9, outputTokens: 1e9, estimated: true } });
  const cliSpend = spendForApp(SD, "budget-cli");
  ok(cliSpend.dailyUsd === 0 && cliSpend.dailyEstUsd > 1000, "CLI estimates are separate from real spend");
  ok(!budgetExceeded(SD, { slug: "budget-cli", budget: { dailyUsd: 1 } }).exceeded, "estimated CLI spend does not trip daily budget");

  recordCost(SD, { app: "budget-api", phase: "task", provider: "openai", model: "gpt-5", usage: { inputTokens: 1, outputTokens: 1 }, usd: 2 });
  ok(budgetExceeded(SD, { slug: "budget-api", budget: { dailyUsd: 1 } }).exceeded, "real API spend still trips daily budget");
}

// 4. Old-format records still aggregate as real spend.
{
  appendFileSync(join(SD, "cost.jsonl"), JSON.stringify({ at: new Date().toISOString(), app: "old-app", phase: "task", provider: "openai", model: "gpt-5", inTok: 10, outTok: 20, usd: 0.5 }) + "\n");
  const sum = costSummary(SD);
  ok(sum.byApp["old-app"] === 0.5 && sum.monthUsd >= 2.5, "old-format records aggregate without estimated fields");
}

// 5. Successful CLI runs with no parseable usage are counted, not hidden.
{
  const agent = mkAgent("no-usage.sh", `echo "// no usage $(date +%s%N)" >> "$1/app.js"
printf '${F}yaml\\ntask_id: T1\\nresult: DONE\\nacceptance_met: true\\nsummary: done without usage\\nplain_summary: changed app\\nuser_impact: usage miss counted\\n${F}\\n'`);
  const slug = "cli-no-usage";
  const r = repo();
  seed(slug, [task()]);
  const res = await runLoopOnce(app(slug, r, agent), fleet(), { dryRun: false });
  const st = rd(slug);
  const sum = costSummary(SD);
  ok(res.action === "completed" && st.usageMisses?.codex === 1, "CLI run without usage increments per-provider miss counter");
  ok(sum.usageMissesByApp[slug] === 1, "costSummary exposes usage miss counts by app");
}

console.log(`\ncli-usage: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

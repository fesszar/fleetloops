// test-failover.mjs — provider fallback chain behavior.
// Run: cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-failover.mjs
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d)."); process.exit(1); }
if (!existsSync(process.env.FLEET_STATE_DIR)) mkdirSync(process.env.FLEET_STATE_DIR, { recursive: true });
process.env.FLEET_WORKTREE_DIR = mkdtempSync(join(tmpdir(), "wt-"));

const { runLoopOnce, STATE_DIR } = await import("./loop.mjs");
const { resolveProviderChain } = await import("./providers/failover.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };
const F = String.fromCharCode(96, 96, 96);

const agentDir = mkdtempSync(join(tmpdir(), "ag-"));
function mkAgent(name, body) {
  const f = join(agentDir, name);
  writeFileSync(f, "#!/usr/bin/env bash\n" + body);
  chmodSync(f, 0o755);
  return f;
}
const AUTH_AGENT = mkAgent("auth.sh", `echo "ERROR: 401 Unauthorized - token expired, please run codex login"; exit 1`);
const SILENT_AGENT = mkAgent("silent.sh", `echo "thinking without a report"; exit 0`);
const DONE_AGENT = mkAgent("done.sh", `echo "// primary $(date +%s%N)" >> "$1/app.js"
printf '${F}yaml\\ntask_id: T1\\nresult: DONE\\nacceptance_met: true\\nsummary: primary finished\\nplain_summary: primary change\\nuser_impact: primary works\\n${F}\\n'`);

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
const G = (r, a) => execSync(`git -C "${r}" ${a}`, { encoding: "utf8" });

function seed(slug, tasks) {
  writeFileSync(join(STATE_DIR, `${slug}.json`), JSON.stringify({ slug, loop: "running", retryCap: 2, backlog: tasks, escalations: [], log: [] }));
}
function rd(slug) {
  return JSON.parse(readFileSync(join(STATE_DIR, `${slug}.json`), "utf8"));
}
function task(id = "T1") {
  return { id, title: `do ${id}`, status: "queued", difficulty: "easy", deps: [], acceptance: "change is made", attempts: 0 };
}
function app(slug, r, agent, extra = {}) {
  return {
    slug, name: slug, stage: "dev", loop: "running", northStar: "ship", repo: r,
    retryCap: 2, autonomy: "merge-main", standingContext: "-", eightyTwentyLoop: "-",
    commands: { test: "true" }, gates: [], guardrails: [], offLimits: [],
    provider: { id: "claude_cli" },
    agent: { adapter: "shell", command: `bash ${agent} "{{REPO}}" "{{PROMPT_FILE}}"` },
    backlog: [],
    ...extra,
  };
}
function fleet(extra = {}) {
  return {
    defaultRetryCap: 2, defaultAutonomy: "merge-main", globalGuardrails: [],
    safety: { requireGitForLive: true, deployPolicies: {} }, autonomyLevels: {},
    reviewer: false, notifications: { desktop: false }, consensus: { reviewers: 1, minCoverage: 1 },
    brain: false,
    ...extra,
  };
}
function clearPause() {
  rmSync(join(STATE_DIR, "fleet.paused.json"), { force: true });
  rmSync(join(STATE_DIR, "fleet.paused.json.cleared"), { force: true });
}

function mockOpenAI(url, opts) {
  const body = JSON.parse(opts.body);
  const hasToolResult = (body.messages || []).some((m) => m.role === "tool");
  const message = !hasToolResult
    ? { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "app.js", content: "v=2\n// edited by fallback API\n" }) } }] }
    : { role: "assistant", content: "", tool_calls: [{ id: "c2", type: "function", function: { name: "finish", arguments: JSON.stringify({ report: `${F}yaml\ntask_id: T1\nresult: DONE\nacceptance_met: true\nsummary: fallback finished\nplain_summary: fallback change\nuser_impact: fallback works\n${F}` }) } }] };
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ choices: [{ message, finish_reason: "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 50 } }),
    text: () => Promise.resolve(""),
  });
}
function authOpenAI() {
  return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("invalid token"), json: () => Promise.resolve({}) });
}

// 1. Chain construction.
{
  const oldPath = process.env.PATH;
  process.env.PATH = `/usr/bin:/bin`;
  const env = { FLEET_KEY_ANTHROPIC: "sk-ant-test", FLEET_KEY_DEEPSEEK: "sk-ds-test", FLEET_KEY_GEMINI: "sk-gem-test" };
  const base = { provider: { id: "codex" }, agent: { adapter: "codex", command: "codex exec - < {{PROMPT_FILE}}" } };
  const chain = resolveProviderChain(base, { routing: { fallback: ["missing", "openai", "codex", "anthropic", "claude_cli", "ollama", "deepseek", "gemini"] } }, { env, keychain: false });
  ok(chain.map((e) => e.provider.id).join(",") === "codex,anthropic,ollama,deepseek", "chain skips unknowns, duplicates, keyless APIs, missing CLIs, and caps at primary+3");
  ok(resolveProviderChain(base, { routing: { fallback: [] } }, { env, keychain: false }).length === 1, "empty fallback chain leaves only the primary provider");
  process.env.PATH = oldPath;
}

// 2. Auth failure on primary + usable fallback completes via fallback.
{
  clearPause();
  process.env.FLEET_KEY_OPENAI = "sk-test-fallback";
  const savedFetch = globalThis.fetch;
  globalThis.fetch = mockOpenAI;
  const slug = "fo-api";
  const r = repo();
  seed(slug, [task()]);
  const res = await runLoopOnce(app(slug, r, AUTH_AGENT), fleet({ routing: { fallback: ["openai"] } }), { dryRun: false });
  globalThis.fetch = savedFetch;
  const st = rd(slug);
  ok(res.action === "completed", "auth-dead primary completes through API fallback");
  ok(!existsSync(join(STATE_DIR, "fleet.paused.json")), "fallback success does not pause the fleet");
  ok((st.log || []).some((l) => /^FAILOVER T1: claude_cli auth-failed -> trying openai/.test(l)), "failover line is logged");
  ok(readFileSync(join(r, "app.js"), "utf8").includes("edited by fallback API"), "fallback provider's work merged to main");
  const costs = existsSync(join(STATE_DIR, "cost.jsonl")) ? readFileSync(join(STATE_DIR, "cost.jsonl"), "utf8") : "";
  ok(/"provider":"openai"/.test(costs), "cost record is attributed to fallback provider");
}

// 3. Auth failure with no fallback keeps today's fleet-pause behavior.
{
  clearPause();
  const slug = "fo-none";
  const r = repo();
  seed(slug, [task()]);
  const res = await runLoopOnce(app(slug, r, AUTH_AGENT), fleet(), { dryRun: false });
  ok(res.action === "fleet-paused" && existsSync(join(STATE_DIR, "fleet.paused.json")), "auth failure without fallback pauses the fleet");
  ok((rd(slug).backlog[0].attempts || 0) === 0, "auth pause still burns no task attempts");
}

// 4. Output failure does not advance to a fallback.
{
  clearPause();
  process.env.FLEET_KEY_OPENAI = "sk-test-fallback";
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("fallback should not be called on output failures"); };
  const slug = "fo-output";
  const r = repo();
  seed(slug, [task()]);
  const res = await runLoopOnce(app(slug, r, SILENT_AGENT), fleet({ routing: { fallback: ["openai"] } }), { dryRun: false });
  globalThis.fetch = savedFetch;
  ok(res.action === "retry", "output failure uses normal retry path");
  ok(!(rd(slug).log || []).some((l) => l.startsWith("FAILOVER")), "output failure does not log or attempt failover");
}

// 5. All chain entries auth-fail pauses with augmented message.
{
  clearPause();
  process.env.FLEET_KEY_OPENAI = "sk-test-fallback";
  const savedFetch = globalThis.fetch;
  globalThis.fetch = authOpenAI;
  const slug = "fo-all-auth";
  const r = repo();
  seed(slug, [task()]);
  const res = await runLoopOnce(app(slug, r, AUTH_AGENT), fleet({ routing: { fallback: ["openai"] } }), { dryRun: false });
  globalThis.fetch = savedFetch;
  const pause = JSON.parse(readFileSync(join(STATE_DIR, "fleet.paused.json"), "utf8"));
  ok(res.action === "fleet-paused" && /all fallback providers also failed/.test(pause.reason), "all-auth chain pauses with augmented message");
}

// 6. Next pass starts from primary again; app.provider is not mutated sticky.
{
  clearPause();
  process.env.FLEET_KEY_OPENAI = "sk-test-fallback";
  const slug = "fo-primary-again";
  const r = repo();
  const primaryApp = app(slug, r, DONE_AGENT);
  seed(slug, [task("T2")]);
  const res = await runLoopOnce(primaryApp, fleet({ routing: { fallback: ["openai"] } }), { dryRun: false });
  ok(res.action === "completed", "next pass can complete through primary");
  ok(primaryApp.provider.id === "claude_cli", "failover never mutates the app's configured provider");
  ok(!(rd(slug).log || []).some((l) => l.startsWith("FAILOVER T2")), "successful primary pass has no stale failover log");
}

console.log(`\nfailover: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

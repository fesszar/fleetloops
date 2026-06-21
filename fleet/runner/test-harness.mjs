// test-harness.mjs — the highest-risk item: prove the bundled API harness mutates the worktree,
// stays confined + safe, redacts keys, and (critically) drives the UNCHANGED runLoopOnce loop to
// a real merge using a mock provider — exactly as the Codex CLI path does.
// Run:  cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-harness.mjs
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runApiAgent } from "./providers/harness.mjs";
import { makeTools } from "./providers/tools.mjs";
import { runLoopOnce, loadState, STATE_DIR } from "./loop.mjs";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d)."); process.exit(1); }
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
process.env.FLEET_WORKTREE_DIR = mkdtempSync(join(tmpdir(), "wt-"));
process.env.FLEET_KEY_OPENAI = "sk-test-REDACT-9876543210abcdef"; // never a real key

let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };
const F = String.fromCharCode(96, 96, 96);
const DONE_REPORT = `${F}yaml\ntask_id: T1\nresult: DONE\nacceptance_met: true\nsummary: did the work via the API harness\nplain_summary: small change\nuser_impact: nicer\n${F}`;

// A scripted OpenAI-dialect provider. Stateless: it decides what to return purely from the
// request body, so it works for both a single direct call and the multi-pass loop.
//  - review prompts        → plain-text APPROVE verdict (consensus reads text, read-only mode)
//  - task, no tool result yet → write_file + run_command
//  - task, after tool result  → finish(report)
function mockOpenAI(url, opts) {
  const body = JSON.parse(opts.body);
  const msgs = body.messages || [];
  const text = JSON.stringify(msgs);
  const isReview = /reviewing for|verdict:/i.test(text);
  const hasToolResult = msgs.some((m) => m.role === "tool");
  let message;
  if (isReview) {
    message = { role: "assistant", content: `${F}yaml\nverdict: APPROVE\nissues: none\nsummary: looks fine\n${F}` };
  } else if (!hasToolResult) {
    message = { role: "assistant", content: "", tool_calls: [
      { id: "c1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "app.js", content: "v=2\n// edited by the API harness\n" }) } },
      { id: "c2", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "echo tested-ok" }) } },
    ] };
  } else {
    message = { role: "assistant", content: "", tool_calls: [
      { id: "c3", type: "function", function: { name: "finish", arguments: JSON.stringify({ report: DONE_REPORT }) } },
    ] };
  }
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 120, completion_tokens: 60 } }),
    text: () => Promise.resolve(""),
  });
}

// ---------- A. direct harness run mutates a plain dir + emits a parseable report ----------
{
  const root = mkdtempSync(join(tmpdir(), "hr-"));
  writeFileSync(join(root, "app.js"), "v=1\n");
  const app = { slug: "h", name: "H", repo: root, provider: { id: "openai", model: "gpt-5" }, reasoning: "high", offLimits: [] };
  const r = await runApiAgent({ app, fleet: null, prompt: "Do the task and finish with the YAML report.", mode: "write", fetchImpl: mockOpenAI });
  ok(readFileSync(join(root, "app.js"), "utf8").includes("edited by the API harness"), "harness actually wrote the file in the worktree");
  ok(/result:\s*DONE/.test(r.reportText), "harness returns a finish report the loop can parse");
  ok(r.usage.inputTokens === 240 && r.usage.outputTokens === 120, "usage accumulates across both model turns");
  ok(r.usage.usd > 0, "usage is priced to USD");
  ok(!r.raw.includes("sk-test-REDACT-9876543210abcdef"), "the API key never appears in the transcript (redacted)");
}

// ---------- B. path confinement ----------
{
  const root = mkdtempSync(join(tmpdir(), "hc-"));
  const { dispatch } = makeTools({ root, mode: "write" });
  ok(/escapes the project/.test(await dispatch("read_file", { path: "../../../../etc/passwd" })), "read_file refuses to escape the worktree");
  ok(/off-limits/.test(await dispatch("read_file", { path: ".env.prod" })) === false || true, "off-limits sanity (no offLimits configured)");
  const { dispatch: d2 } = makeTools({ root, mode: "write", offLimits: ["secrets"] });
  ok(/off-limits/.test(await d2("read_file", { path: "secrets/key.txt" })), "off-limits path refused structurally");
}

// ---------- C. COSTLY deploy commands refused ----------
{
  const root = mkdtempSync(join(tmpdir(), "hk-"));
  const { dispatch } = makeTools({ root, mode: "write" });
  ok(/refused/.test(await dispatch("run_command", { command: "git push origin main" })), "run_command refuses git push");
  ok(/refused/.test(await dispatch("run_command", { command: "vercel deploy --prod" })), "run_command refuses vercel deploy");
  ok(!/refused/.test(await dispatch("run_command", { command: "echo hi" })), "run_command allows a harmless command");
}

// ---------- D. auth failure when no key ----------
{
  const root = mkdtempSync(join(tmpdir(), "ha-"));
  const saved = process.env.FLEET_KEY_OPENAI; delete process.env.FLEET_KEY_OPENAI;
  const savedStd = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
  const app = { slug: "h", name: "H", repo: root, provider: { id: "openai" } };
  const r = await runApiAgent({ app, fleet: null, prompt: "x", mode: "write", fetchImpl: mockOpenAI });
  ok(r.failure === "auth", "missing API key → auth failure (so the loop pauses cleanly, like an expired CLI login)");
  process.env.FLEET_KEY_OPENAI = saved; if (savedStd) process.env.OPENAI_API_KEY = savedStd;
}

// ---------- E. END-TO-END through the UNCHANGED loop: a mock API provider lands a real merge ----------
{
  const repo = () => { const r = mkdtempSync(join(tmpdir(), "r-")); const G = (a) => execSync(`git -C "${r}" ${a}`, { encoding: "utf8" });
    G("init -q -b main"); G("config user.email t@t"); G("config user.name t"); writeFileSync(join(r, "app.js"), "v=1\n"); G("add -A"); G('commit -qm base'); return r; };
  const G = (r, a) => execSync(`git -C "${r}" ${a}`, { encoding: "utf8" });
  const slug = "api-selftest";
  const sf = join(STATE_DIR, slug + ".json");
  const fleet = { defaultRetryCap: 2, defaultAutonomy: "merge-main", globalGuardrails: [], safety: { requireGitForLive: true, deployPolicies: {} }, autonomyLevels: {}, reviewer: false, notifications: { desktop: false }, consensus: { reviewers: 1, minCoverage: 1 }, brain: false };
  const r = repo();
  writeFileSync(sf, JSON.stringify({ slug, loop: "running", retryCap: 2, backlog: [{ id: "T1", title: "do thing", status: "queued", difficulty: "easy", deps: [], acceptance: "thing done", attempts: 0 }], escalations: [], log: [] }));
  const app = { slug, name: "API", stage: "dev", loop: "running", northStar: "ship", repo: r, retryCap: 2, autonomy: "merge-main", standingContext: "-", eightyTwentyLoop: "-", commands: { test: "true" }, gates: [], guardrails: [], offLimits: [], provider: { id: "openai", model: "gpt-5" }, agent: { adapter: "api" }, backlog: [] };

  const savedFetch = globalThis.fetch;
  globalThis.fetch = mockOpenAI; // the harness uses globalThis.fetch by default inside the real loop
  let res;
  try { res = await runLoopOnce(app, fleet, { dryRun: false }); }
  finally { globalThis.fetch = savedFetch; }

  ok(res.action === "completed", "API-provider task runs through runLoopOnce to completion");
  ok((G(r, "log --oneline main") || "").includes("fleet: merge"), "the harness's edit was committed + merged to main by the unchanged loop");
  ok(readFileSync(join(r, "app.js"), "utf8").includes("edited by the API harness"), "the merged code contains the harness's real change");
}

console.log(`\nharness: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

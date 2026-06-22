#!/usr/bin/env node
// fleet.mjs — the fleet commander. Runs every app's loop once (respecting
// maxConcurrentLoops), aggregates escalations, and prints fleet status.
//
// Usage:
//   node fleet.mjs status                  # show every app + backlog at a glance
//   node fleet.mjs run [--live]            # run loops (dry-run by default)
//   node fleet.mjs run --only myapp   # one app
//   node fleet.mjs approvals               # list everything awaiting you
//   node fleet.mjs prompt myapp       # print the next prompt for one app
//   node fleet.mjs doctor                  # full health check (deps, config, repos, service)
//   node fleet.mjs onboard <slug> --repo <path> [--name "Name"]   # add a real app properly
//
// Dry-run is the default safe mode and never calls an agent or runs gates.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { platform, homedir } from "node:os";
import { loadConfig, loadState, runLoopOnce, readAllEscalations, expandHome, STATE_DIR, CONFIG_FILE } from "./loop.mjs";
import { runEvolvePass } from "./conditions.mjs";
import { acquireRunLock, releaseRunLock } from "./util.mjs";
import { addProjectToConfig } from "./project-onboard.mjs";

// Pick the right loop: exit-condition pass if the app has gates, else the classic task loop.
function appUsesConditions(app) {
  if (Array.isArray(app.exitConditions)) return true; // even empty: the planner seeds it live
  try { const s = loadState(app, loadConfig().fleet); return !!s.graduated || (Array.isArray(s.conditions) && s.conditions.length > 0); } catch { return false; }
}
const runForApp = (app, fleet, opts) => appUsesConditions(app) ? runEvolvePass(app, fleet, opts) : runLoopOnce(app, fleet, opts);

const CONFIG_PATH = CONFIG_FILE;

// Restore tool paths when invoked from a thin environment (launchd/systemd/cron).
function toolPaths() {
  const p = [];
  if (platform() === "darwin") p.push("/opt/homebrew/bin", "/opt/homebrew/sbin");
  p.push("/usr/local/bin", join(homedir(), ".local", "bin"));
  const nvm = join(homedir(), ".nvm", "versions", "node");
  try { for (const v of readdirSync(nvm)) p.push(join(nvm, v, "bin")); } catch {}
  return p;
}
process.env.PATH = [...toolPaths(), process.env.PATH || ""].join(":");

const args = process.argv.slice(2);
const cmd = args[0] || "status";
const flag = (n) => args.includes(`--${n}`);
const val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const dryRun = !flag("live"); // safe by default; pass --live to actually execute

const C = { dim: "\x1b[2m", grn: "\x1b[32m", yel: "\x1b[33m", red: "\x1b[31m", cyn: "\x1b[36m", b: "\x1b[1m", x: "\x1b[0m" };
const dot = (s) => ({ running: C.grn + "●" + C.x, paused: C.yel + "●" + C.x, blocked: C.red + "●" + C.x, idle: C.dim + "●" + C.x }[s] || "●");

async function pool(items, n, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  });
  await Promise.all(workers);
  return out;
}

function status(cfg) {
  console.log(`\n${C.b}${cfg.fleet.name}${C.x}  ${C.dim}(${cfg.apps.length} apps · max ${cfg.fleet.maxConcurrentLoops} concurrent)${C.x}\n`);
  for (const app of cfg.apps) {
    const s = loadState(app, cfg.fleet);
    const open = s.backlog.filter((t) => t.status !== "done").length;
    const human = s.backlog.filter((t) => t.status === "needs-human").length;
    const running = s.backlog.find((t) => t.status === "running");
    const gates = (s.conditions || []);
    const gateNote = gates.length ? `  ${C.dim}${gates.filter((c) => c.status === "met").length}/${gates.length} gates${C.x}` : "";
    console.log(`${dot(s.loop)} ${C.b}${app.name.padEnd(22)}${C.x} ${C.dim}${s.loop.padEnd(8)}${C.x} ${open} open${human ? `  ${C.yel}${human} need you${C.x}` : ""}${gateNote}`);
    console.log(`   ${C.dim}${running ? "▶ " + running.title : "—"}${C.x}`);
  }
  const esc = readAllEscalations();
  console.log(`\n${C.cyn}Awaiting you: ${esc.length}${C.x}  ${C.dim}(node fleet.mjs approvals)${C.x}\n`);
}

function approvals() {
  const esc = readAllEscalations();
  if (!esc.length) return console.log(`\n${C.grn}Inbox zero — no loops are waiting on you.${C.x}\n`);
  console.log(`\n${C.b}Approvals (${esc.length})${C.x}\n`);
  for (const e of esc) console.log(`${C.yel}●${C.x} ${C.b}${e.slug}${C.x} ${e.taskId} — ${e.title}\n   ${C.dim}${e.reason}${C.x}\n`);
}

async function run(cfg) {
  const only = val("only");
  const apps = cfg.apps.filter((a) => !only || a.slug === only);
  // cross-process guard: don't collide with the background service's tick
  let lock = { ok: true };
  if (!dryRun) {
    lock = acquireRunLock(STATE_DIR, "cli-run");
    if (!lock.ok) {
      console.log(`\n${C.yel}The background service is mid-pass (lock held by ${(lock.holder || {}).who || "?"} pid ${(lock.holder || {}).pid || "?"}).${C.x}`);
      console.log(`${C.dim}Try again in a minute, or watch it on the dashboard instead.${C.x}\n`);
      return;
    }
  }
  console.log(`\n${C.b}Running fleet${C.x} ${dryRun ? C.yel + "(dry-run — generating prompts, no agent calls)" + C.x : C.red + "(LIVE)" + C.x}\n`);
  let results;
  try { results = await pool(apps, cfg.fleet.maxConcurrentLoops, (app) => runForApp(app, cfg.fleet, { dryRun })); }
  finally { if (!dryRun && lock.ok) releaseRunLock(STATE_DIR); }
  for (const r of results) {
    const tag = { completed: C.grn, escalated: C.yel, "prompt-generated": C.cyn, retry: C.yel, skipped: C.dim, idle: C.dim, watching: C.grn, "worked-condition": C.cyn, "waiting-on-you": C.yel, seeded: C.grn, discovered: C.cyn, "fleet-paused": C.red }[r.action] || "";
    console.log(`${tag}${r.action}${C.x}  ${C.b}${r.slug}${C.x} ${r.condition || r.task || ""} ${r.reason ? C.dim + r.reason + C.x : ""}${r.met != null ? C.dim + ` ${r.met}/${r.total} gates` + C.x : ""}`);
  }
  if (dryRun) console.log(`\n${C.dim}Prompts written to ./state/<slug>.json log. Use 'node fleet.mjs prompt <slug>' to print one.${C.x}\n`);
}

async function printPrompt(cfg) {
  const slug = args[1];
  const app = cfg.apps.find((a) => a.slug === slug);
  if (!app) return console.log(`No app '${slug}'. Apps: ${cfg.apps.map((a) => a.slug).join(", ")}`);
  const r = await runLoopOnce(app, cfg.fleet, { dryRun: true });
  console.log("\n" + (r.prompt || `(${r.action}: ${r.reason || r.task || ""})`) + "\n");
}

// --- doctor: one command that tells the truth about whether this machine can run the fleet ---
function doctor() {
  let bad = 0, warn = 0;
  const okMark = `${C.grn}✓${C.x}`, badMark = `${C.red}✗${C.x}`, warnMark = `${C.yel}!${C.x}`;
  const out = (mark, label, note = "") => console.log(` ${mark} ${label}${note ? C.dim + "  — " + note + C.x : ""}`);
  console.log(`\n${C.b}Fleet doctor${C.x}\n`);

  // node
  const nodeV = process.versions.node;
  if (parseInt(nodeV) >= 18) out(okMark, `node ${nodeV}`);
  else { out(badMark, `node ${nodeV}`, "need 18+"); bad++; }
  // git
  const git = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (git.status === 0) out(okMark, git.stdout.trim());
  else { out(badMark, "git missing", "install git first"); bad++; }
  // agent CLIs
  for (const cli of ["codex", "claude"]) {
    const w = spawnSync("bash", ["-lc", `command -v ${cli}`], { encoding: "utf8" });
    if (w.status === 0) out(okMark, `${cli} CLI found`, w.stdout.trim());
    else { out(warnMark, `${cli} CLI not found`, "apps configured to use it can't run live"); warn++; }
  }
  // config
  let cfg = null;
  try { cfg = loadConfig(); out(okMark, `config parses (${cfg.apps.length} apps)`); }
  catch (e) { out(badMark, "fleet.config.json unreadable", String(e).slice(0, 120)); bad++; }
  // state dir writable
  try { writeFileSync(join(STATE_DIR, ".doctor-probe"), "ok"); out(okMark, `state dir writable`, STATE_DIR); }
  catch { out(badMark, "state dir NOT writable", STATE_DIR + " — likely a permissions (TCC) problem; move the install out of Downloads or grant access"); bad++; }
  // per-app repos
  if (cfg) {
    for (const a of cfg.apps) {
      const repo = expandHome(a.repo);
      if (!existsSync(repo)) { out(warnMark, `${a.slug}: repo missing`, a.repo); warn++; continue; }
      const inside = spawnSync("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
      if (inside.status !== 0 || !/true/.test(inside.stdout || "")) { out(warnMark, `${a.slug}: not a git repo`, "must be under git before live runs"); warn++; continue; }
      const head = (spawnSync("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).stdout || "").trim();
      const stranded = (spawnSync("git", ["-C", repo, "branch", "--list", "fleet/*"], { encoding: "utf8" }).stdout || "").trim();
      const notes = [];
      if (head.startsWith("fleet/")) notes.push(`parked on ${head} — switch back to your main branch`);
      if (stranded) notes.push(`${stranded.split("\n").length} fleet/* branch(es) present`);
      if (notes.length) { out(warnMark, `${a.slug}: ${notes.join("; ")}`); warn++; }
      else out(okMark, `${a.slug}: repo ok`, head);
    }
  }
  // service / port
  const portFile = join(STATE_DIR, "bridge.port");
  const port = existsSync(portFile) ? readFileSync(portFile, "utf8").trim() : (process.env.FLEET_PORT || "7777");
  const curl = spawnSync("bash", ["-lc", `curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:${port}/api/state`], { encoding: "utf8" });
  if ((curl.stdout || "").trim() === "200") out(okMark, `dashboard answering on port ${port}`);
  else { out(warnMark, `dashboard not answering on port ${port}`, "start it: node bridge-server.mjs --watch (or via the installed service)"); warn++; }

  console.log(`\n${bad ? C.red : C.grn}${C.b}${bad} blocker(s), ${warn} warning(s)${C.x}\n`);
  process.exit(bad ? 1 : 0);
}

// --- onboard: add a REAL app with detected settings (replaces hand-guessed config blocks) ---
function detectStack(repo) {
  const has = (f) => existsSync(join(repo, f));
  if (has("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
      const t = pkg.scripts && pkg.scripts.test && !/no test specified/.test(pkg.scripts.test) ? "npm test --silent" : "";
      return { stack: "node", test: t, build: pkg.scripts && pkg.scripts.build ? "npm run build" : "" };
    } catch { return { stack: "node", test: "", build: "" }; }
  }
  if (has("pyproject.toml") || has("requirements.txt")) return { stack: "python", test: has("pytest.ini") || has("tests") ? "python -m pytest -q" : "", build: "" };
  if (has("build.gradle") || has("build.gradle.kts") || has("gradlew")) return { stack: "android", test: "./gradlew testDebugUnitTest", build: "./gradlew assembleDebug" };
  if (has("Package.swift")) return { stack: "swift", test: "swift test", build: "swift build" };
  const xc = (readdirSync(repo).find((f) => f.endsWith(".xcodeproj") || f.endsWith(".xcworkspace")) || "");
  if (xc) return { stack: "ios", test: "", build: "" };
  if (has("go.mod")) return { stack: "go", test: "go test ./...", build: "go build ./..." };
  if (has("Cargo.toml")) return { stack: "rust", test: "cargo test", build: "cargo build" };
  return { stack: "unknown", test: "", build: "" };
}

// Scaffold the per-repo test-environment + certifications files so a NEW user's apps never
// start by pestering the human for tools/access. The agent fleshes these out; the engine
// runs setup.sh before gates and sources env.sh into them.
function scaffoldRepoEnv(repo, det) {
  const dir = join(repo, ".fleet");
  if (!existsSync(dir)) spawnSync("mkdir", ["-p", dir]);
  const setup = join(dir, "setup.sh");
  if (!existsSync(setup)) {
    const install = det.stack === "node" ? "npm ci || npm install"
      : det.stack === "python" ? "python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt 2>/dev/null || pip install -e . 2>/dev/null || true"
      : det.stack === "swift" ? "swift package resolve"
      : det.stack === "go" ? "go mod download"
      : det.stack === "rust" ? "cargo fetch"
      : "# add dependency install for this stack";
    writeFileSync(setup,
`#!/usr/bin/env bash
# Idempotent test-environment setup for this repo. The fleet runs it once per session before
# gates. Network + localhost are allowed. NEVER put real secrets here — seed safe fakes only.
set -e
${install}
# Copy example env to a local test env if present (safe, non-secret values only):
[ -f .env.example ] && [ ! -f .env ] && cp .env.example .env || true
# Start any local service the tests need (DB, etc.) and seed a THROWAWAY test user here.
# e.g.:  npm run db:test:up && npm run db:seed:test
`);
    spawnSync("chmod", ["+x", setup]);
  }
  const env = join(dir, "env.sh");
  if (!existsSync(env)) writeFileSync(env,
`# Sourced into every gate/probe run. SAFE LOCAL TEST values only — never real secrets.
export NODE_ENV=test
export CI=1
# export DATABASE_URL="file:./.fleet/test.db"   # uncomment/adjust for your stack
`);
  const cert = join(dir, "CERTIFICATIONS.md");
  if (!existsSync(cert)) writeFileSync(cert,
`# Human-only certifications for this app
# These genuinely require YOU (the fleet will set everything else up itself). Fill in what's
# available so the loop knows what it can prove vs. what to defer — it will NOT re-ask once noted.

- [ ] Real payment / billing verified with a real card (e.g. Stripe live checkout)
- [ ] Company/publisher identity verified (Apple / Microsoft / Google)
- [ ] App store / TestFlight / Play submission
- [ ] Production secrets rotated and stored in the real secret manager
- [ ] Production database / hosting access confirmed
`);
  // make sure .fleet test artifacts never get committed as "source"
  const gi = join(repo, ".gitignore");
  let g = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!/\.fleet\/test\.db|\.fleet\/\*\.local/.test(g)) writeFileSync(gi, g + (g.endsWith("\n") || !g ? "" : "\n") + "\n# fleet local test artifacts\n.fleet/*.local\n.fleet/test.db\n.env\n");
}

function onboard() {
  const slug = (args[1] || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const repoArg = val("repo");
  if (!slug || !repoArg) return console.log(`usage: node fleet.mjs onboard <slug> --repo <path> [--name "Display Name"] [--north-star "..."]`);
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const result = addProjectToConfig(cfg, { repo: repoArg, slug, name: val("name") || slug, northStar: val("north-star") });
  if (!result.ok) return console.log(`${C.red}${result.error}${C.x}`);
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`\n${C.grn}✓ Onboarded '${result.app.slug}'${C.x} (stack: ${result.det.stack}, test: ${result.det.test || "none detected"}, git: ${result.isGit ? "yes" : "NO — bootstrap before live"})`);
  console.log(`${C.dim}  Scaffolded .fleet/setup.sh + .fleet/env.sh (test environment) and .fleet/CERTIFICATIONS.md (human-only items). The agent fills these in on its first pass.${C.x}`);
  console.log(`${C.dim}Next: ${result.isGit ? "" : `1) put it under git, `}run 'node fleet.mjs run --only ${result.app.slug} --live' — the planner will propose its definition of done; review the gates on the dashboard.${C.x}\n`);
}

function addLoop() {
  const slug = args[1];
  const name = args.slice(2).join(" ") || slug;
  if (!slug) return console.log("usage: node fleet.mjs add <slug> <Name>   (tip: 'onboard' detects everything for a real repo)");
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  if (cfg.apps.find((a) => a.slug === slug)) return console.log(`'${slug}' already exists.`);
  const tmpl = {
    slug, name, repo: "~/path/to/repo", stage: "partial-build", loop: "paused",
    autonomy: "branch-approve", deployPolicy: "none", vcs: "unknown", needsBootstrap: true,
    northStar: "TODO — the single outcome that means v1 is done.",
    agent: { adapter: "shell", command: `cd "{{REPO}}" && codex exec -c sandbox_workspace_write.network_access=true --sandbox workspace-write -c model_reasoning_effort={{REASONING}} - < "{{PROMPT_FILE}}"` },
    triggers: ["command", "test-fail"], schedule: "—", retryCap: 3,
    commands: { install: "", build: "", test: "", deploy: "" },
    gates: ["TODO: a runnable test/build command"], guardrails: ["Never commit secrets"], offLimits: [".env"],
    standingContext: "TODO", eightyTwentyLoop: "TODO", escalateWhen: ["Any deploy/publish"],
    backlog: [], exitConditions: [],
  };
  cfg.apps.push(tmpl);
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`Added '${slug}'. Prefer 'node fleet.mjs onboard ${slug} --repo <path>' for real repos.`);
}

if (cmd === "doctor") doctor();
else {
  const cfg = loadConfig();
  if (cmd === "status") status(cfg);
  else if (cmd === "approvals") approvals();
  else if (cmd === "run") await run(cfg);
  else if (cmd === "prompt") await printPrompt(cfg);
  else if (cmd === "onboard") onboard();
  else if (cmd === "add") addLoop();
  else console.log("Commands: status | run [--only <slug>] [--live] | approvals | prompt <slug> | doctor | onboard <slug> --repo <path> | add <slug> <Name>");
}

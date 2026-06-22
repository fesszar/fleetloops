// test-bridge-run.mjs — HTTP-level live run through bridge -> loop -> git merge.
// Run: cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-bridge-run.mjs
import { execSync } from "node:child_process";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d)."); process.exit(1); }

const HERE = dirname(fileURLToPath(import.meta.url));
const SD = process.env.FLEET_STATE_DIR;
mkdirSync(SD, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "fleet-bridge-run-"));
const state = join(root, "state");
const repo = join(root, "repo");
const cfgPath = join(root, "fleet.config.json");
mkdirSync(state, { recursive: true });
mkdirSync(repo, { recursive: true });

const G = (args) => execSync(`git -C "${repo}" ${args}`, { encoding: "utf8" });
G("init -q -b main");
G("config user.email qa@example.com");
G("config user.name QA");
writeFileSync(join(repo, "app.js"), "export const value = 1;\n");
G("add -A");
G("commit -qm base");

const agent = join(root, "agent.sh");
writeFileSync(agent, `#!/usr/bin/env bash
set -e
repo="$1"
echo "bridge run complete" > "$repo/done.txt"
printf '\\n// bridge run proof\\n' >> "$repo/app.js"
cat <<'YAML'
\`\`\`yaml
task_id: T1
result: DONE
acceptance_met: true
summary: completed through bridge run
plain_summary: bridge run changed the repo
user_impact: proves live work can land safely
\`\`\`
YAML
`);
chmodSync(agent, 0o755);

writeFileSync(cfgPath, JSON.stringify({
  fleet: {
    defaultRetryCap: 2,
    defaultAutonomy: "merge-main",
    globalGuardrails: [],
    safety: { requireGitForLive: true },
    autonomyLevels: {},
    reviewer: false,
    notifications: { desktop: false },
    consensus: { reviewers: 1, minCoverage: 1 },
    brain: false,
  },
  apps: [{
    slug: "bridge-live",
    name: "Bridge Live",
    stage: "dev",
    loop: "running",
    northStar: "prove live bridge run",
    repo,
    retryCap: 2,
    autonomy: "merge-main",
    deployPolicy: "none",
    standingContext: "-",
    eightyTwentyLoop: "-",
    commands: { test: "test -f done.txt", build: "", install: "", deploy: "" },
    gates: [],
    guardrails: [],
    offLimits: [],
    agent: { adapter: "shell", command: `bash ${agent} "{{REPO}}" "{{PROMPT_FILE}}"` },
    backlog: [{ id: "T1", title: "write bridge proof", status: "queued", difficulty: "easy", deps: [], acceptance: "done.txt exists", files: "done.txt" }],
  }],
}, null, 2));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForFile(file, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(file)) return readFileSync(file, "utf8").trim();
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${file}`);
}

const child = spawn(process.execPath, ["bridge-server.mjs"], {
  cwd: HERE,
  env: { ...process.env, FLEET_CONFIG: cfgPath, FLEET_STATE_DIR: state, FLEET_WORKTREE_DIR: join(root, "worktrees"), FLEET_PORT: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (c) => { stderr += c.toString(); });

try {
  const port = await waitForFile(join(state, "bridge.port"));
  const token = await waitForFile(join(state, "bridge.token"));
  const res = await fetch(`http://127.0.0.1:${port}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ only: "bridge-live", live: true }),
  });
  const body = await res.json();
  ok(res.status === 200 && body.results?.[0]?.action === "completed", "bridge /api/run completes a live app pass");
  ok(readFileSync(join(repo, "done.txt"), "utf8").includes("bridge run complete"), "live bridge run lands the agent's file change on main");
  ok(G("log --oneline main").includes("fleet: merge"), "live bridge run commits and merges through the loop");
  ok(G("status --porcelain --untracked-files=no").trim() === "", "repo is clean after live bridge run");
} catch (e) {
  ok(false, `${String(e)} ${stderr}`.slice(0, 500));
} finally {
  child.kill("SIGTERM");
}

console.log(`\nbridge-run: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

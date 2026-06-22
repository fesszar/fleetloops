// test-bridge-project.mjs — HTTP-level coverage for adding a project through the local bridge.
// Run: cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-bridge-project.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d)."); process.exit(1); }

const HERE = dirname(fileURLToPath(import.meta.url));
const SD = process.env.FLEET_STATE_DIR;
mkdirSync(SD, { recursive: true });
const state = join(SD, "bridge-state");
const repo = join(SD, "bridge-project");
const cfgPath = join(SD, "bridge-fleet.config.json");
mkdirSync(state, { recursive: true });
mkdirSync(repo, { recursive: true });
writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
writeFileSync(cfgPath, JSON.stringify({ fleet: { defaultRetryCap: 2, notifications: { desktop: false } }, apps: [] }));

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
  env: { ...process.env, FLEET_CONFIG: cfgPath, FLEET_STATE_DIR: state, FLEET_PORT: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (c) => { stderr += c.toString(); });

try {
  const port = await waitForFile(join(state, "bridge.port"));
  const token = await waitForFile(join(state, "bridge.token"));
  const post = (body) => fetch(`http://127.0.0.1:${port}/api/project`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  const r = await post({ repo });
  const data = await r.json();
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  ok(r.status === 200 && data.ok && data.app.id === "bridge-project", "bridge POST /api/project returns the added app");
  ok(cfg.apps.length === 1 && cfg.apps[0].repo === repo && cfg.apps[0].stack === "node", "bridge project endpoint persists app config");

  const stateResponse = await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { authorization: `Bearer ${token}` } });
  const liveState = await stateResponse.json();
  ok(liveState.apps.some((a) => a.id === "bridge-project"), "bridge state reflects the newly added project");

  const dup = await post({ repo });
  const dupBody = await dup.json();
  ok(dup.status === 409 && /already/.test(dupBody.error || ""), "bridge rejects duplicate project paths with a recoverable error");
} catch (e) {
  ok(false, `${String(e)} ${stderr}`.slice(0, 500));
} finally {
  child.kill("SIGTERM");
}

console.log(`\nbridge-project: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

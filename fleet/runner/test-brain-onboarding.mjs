// test-brain-onboarding.mjs — P0-1 onboarding brain origin + async AI comprehension.
// Run: cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-brain-onboarding.mjs
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  approveOnboardingBrain,
  beginOnboardingBrainAnalysis,
  launchOnboardingApp,
  publicOnboarding,
  recoverStaleBrainAnalysis,
  saveOnboardingGates,
  writeProposedBrain,
} from "./onboarding.mjs";
import { addProjectToConfig } from "./project-onboard.mjs";
import { loadState, saveState } from "./loop.mjs";
import { proposeBrainIfNeeded, readProposed, setBrainExplainerForTests } from "./brain.mjs";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d)."); process.exit(1); }

const HERE = dirname(fileURLToPath(import.meta.url));
const SD = process.env.FLEET_STATE_DIR;
mkdirSync(SD, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeRepo(name) {
  const repo = join(SD, name);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name, scripts: { test: "node --test" } }));
  writeFileSync(join(repo, "README.md"), `# ${name}\n\nA repo for onboarding brain tests.\n`);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  spawnSync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
  spawnSync("git", ["config", "user.name", "Tests"], { cwd: repo });
  spawnSync("git", ["add", "-A"], { cwd: repo });
  spawnSync("git", ["commit", "-qm", "base"], { cwd: repo });
  return repo;
}

const deepBrain = `# Project Brain

## Product
This app helps the owner verify FleetLoops onboarding behavior with a real test repository and durable state transitions.

## Architecture
The repository is a Node project with package scripts, a README, and FleetLoops metadata under .fleet. The runner should treat package.json as the command source and project-brain.md as approved durable context.

## Conventions
Keep changes small, preserve the existing git branch, and use deterministic checks for tests. Avoid adding network-dependent behavior to onboarding tests.

## Risks
The onboarding quick summary can be stale if it permanently blocks deeper comprehension.
`;

try {
  const cfg = { fleet: { defaultRetryCap: 2, notifications: { desktop: false } }, apps: [] };
  const repo = makeRepo("brain-origin");
  const added = addProjectToConfig(cfg, { repo, onboarding: true, startPaused: true });
  const brain = writeProposedBrain(added.app, { mode: "code", brief: "Make onboarding honest." });
  const approved = approveOnboardingBrain(added.app, brain.proposed);
  const state = loadState(added.app, cfg.fleet);
  ok(approved.ok && state.brain.origin === "template" && state.brain.status === "approved", "template brain approval records origin=template");

  setBrainExplainerForTests(async () => deepBrain);
  const acted = await proposeBrainIfNeeded({ ...added.app, provider: { id: "ollama" } }, cfg.fleet, state);
  ok(acted.acted && acted.status === "pending" && state.brain.origin === "ai" && state.brain.upgradeProposed === true, "approved template brain gets one AI upgrade proposal");
  ok(readProposed(added.app).includes("Deep comprehension proposed"), "AI upgrade writes a proposed brain");
  const again = await proposeBrainIfNeeded({ ...added.app, provider: { id: "ollama" } }, cfg.fleet, state);
  ok(again.acted === false, "AI upgrade is not proposed a second time while pending");

  const aiState = { brain: { status: "approved", origin: "ai", version: 1 } };
  const aiSkip = await proposeBrainIfNeeded({ ...added.app, provider: { id: "ollama" } }, cfg.fleet, aiState);
  ok(aiSkip.acted === false, "approved origin=ai brain still skips proposal");
  setBrainExplainerForTests(null);

  const noProviderRepo = makeRepo("no-provider");
  const noProviderCfg = { fleet: { defaultRetryCap: 2 }, apps: [] };
  const noProvider = addProjectToConfig(noProviderCfg, { repo: noProviderRepo, onboarding: true, startPaused: true });
  writeProposedBrain(noProvider.app, { mode: "code" });
  const noAnalysis = beginOnboardingBrainAnalysis(noProvider.app, noProviderCfg.fleet, { mode: "code" });
  ok(noAnalysis.analyzing === false && noAnalysis.brain.origin === "template", "onboarding without an explicit provider stays on template summary");

  const stale = loadState(noProvider.app, noProviderCfg.fleet);
  stale.brain = { status: "analyzing", origin: "template", analyzeStartedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(), at: new Date(Date.now() - 11 * 60 * 1000).toISOString() };
  saveState(stale);
  const publicOb = publicOnboarding({ ...noProviderCfg, fleet: { ...noProviderCfg.fleet, onboarding: { appId: noProvider.app.slug } } });
  const recovered = loadState(noProvider.app, noProviderCfg.fleet);
  ok(publicOb.brain.analyzing === false && recovered.brain.status === "pending" && recovered.brain.origin === "template", "stale analyzing state recovers to pending template");

  const gates = saveOnboardingGates(noProvider.app, noProviderCfg.fleet, brain.gates);
  const launchReady = approveOnboardingBrain(noProvider.app, readProposed(noProvider.app));
  const launched = launchOnboardingApp(noProvider.app, noProviderCfg.fleet);
  ok(gates.ok && launchReady.ok && launched.ok, "onboarding can launch with template-only fallback brain");

  const bridgeState = join(SD, "bridge-state");
  const bridgeRepo = makeRepo("bridge-ai");
  const cfgPath = join(SD, "bridge-fleet.config.json");
  const fake = join(SD, "fake-explainer.sh");
  writeFileSync(fake, `#!/usr/bin/env bash
cat <<'BRAIN'
${deepBrain}
BRAIN
`);
  chmodSync(fake, 0o755);
  const bridgeCfg = { fleet: { defaultRetryCap: 2, notifications: { desktop: false } }, apps: [] };
  const bridgeAdded = addProjectToConfig(bridgeCfg, { repo: bridgeRepo, onboarding: true, startPaused: true, providerId: "codex" });
  bridgeAdded.app.agent.command = `${fake}`;
  bridgeCfg.fleet.onboarding = { appId: bridgeAdded.app.slug, mode: "code", completed: false, step: 2 };
  writeFileSync(cfgPath, JSON.stringify(bridgeCfg, null, 2));
  mkdirSync(bridgeState, { recursive: true });
  const child = spawn(process.execPath, ["bridge-server.mjs"], {
    cwd: HERE,
    env: { ...process.env, FLEET_CONFIG: cfgPath, FLEET_STATE_DIR: bridgeState, FLEET_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForFile(join(bridgeState, "bridge.port"));
    const token = await waitForFile(join(bridgeState, "bridge.token"));
    const res = await fetch(`http://127.0.0.1:${port}/api/onboarding/understand`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ appId: bridgeAdded.app.slug, mode: "code" }),
    });
    const body = await res.json();
    ok(res.status === 200 && body.ok && body.analyzing === true && body.brain.origin === "template", "bridge understand returns template immediately and starts AI analysis");
    const final = await waitForBrainOriginFile(join(bridgeState, `${bridgeAdded.app.slug}.json`), "ai");
    ok(final.brain.status === "pending" && final.brain.origin === "ai", "bridge async comprehension flips state to pending AI origin");
  } finally {
    child.kill("SIGTERM");
  }
} catch (e) {
  ok(false, String(e && e.stack || e).slice(0, 800));
} finally {
  setBrainExplainerForTests(null);
}

async function waitForFile(file, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(file)) return readFileSync(file, "utf8").trim();
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${file}`);
}

async function waitForBrainOrigin(app, fleet, origin, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = loadState(app, fleet);
    if (s.brain?.origin === origin) return s;
    await sleep(50);
  }
  return loadState(app, fleet);
}

async function waitForBrainOriginFile(file, origin, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(file)) {
      const s = JSON.parse(readFileSync(file, "utf8"));
      if (s.brain?.origin === origin) return s;
    }
    await sleep(50);
  }
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

console.log(`\nbrain-onboarding: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

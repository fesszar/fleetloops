#!/usr/bin/env node
// bootstrap.mjs — generate a safe repo starter kit for every app that isn't under
// git yet (needsBootstrap: true in fleet.config.json). Distilled from the shared
// guardrails / memory conventions across the fleet.
//
// It writes files into  fleet/bootstrap/<slug>/  for YOU to copy into the real repo.
// It NEVER touches your actual app folders.
//
//   node bootstrap.mjs            # generate kits for all needsBootstrap apps
//   node bootstrap.mjs myapp # force-generate one app

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const cfg = JSON.parse(readFileSync(join(ROOT, "fleet.config.json"), "utf8"));
const OUT = join(ROOT, "bootstrap");

const only = process.argv[2];
const apps = cfg.apps.filter((a) => (only ? a.slug === only : a.needsBootstrap));

function write(slug, rel, content) {
  const f = join(OUT, slug, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, content);
}

// ---- stack-aware .gitignore (secrets first, always) ----
function gitignore(app) {
  const s = (app.stack || "").toLowerCase();
  const secrets = [
    "# --- SECRETS: never commit these ---",
    ".env", ".env.*", "*.pem", "*.p8", "*.p12", "*.keystore", "*.jks",
    "**/AuthKey_*.p8", "**/GoogleService-Info.plist", "**/google-services.json",
    "**/*OAuthClient*.json", "**/serviceAccount*.json", "**/*adc*.json",
    ...(app.offLimits || []).map((p) => p.replace(/^~\/.*Application Support.*$/, "# (app-support secrets live outside the repo)")).filter((x) => !x.startsWith("#") || x.includes("app-support")),
    "",
  ];
  let stack = [];
  if (/swift|xcode|macos/.test(s)) stack = ["# Swift / Xcode", ".build/", "DerivedData/", "*.xcodeproj/xcuserdata/", "*.xcworkspace/xcuserdata/", "*.app", ".swiftpm/"];
  else if (/kotlin|android|gradle/.test(s)) stack = ["# Android / Gradle", ".gradle/", "build/", "local.properties", "*.apk", "*.aab", "app/build/", ".cxx/"];
  else if (/react native|expo/.test(s)) stack = ["# Expo / React Native / Node", "node_modules/", ".expo/", "dist/", "web-build/", "ios/Pods/", "*.log", ".DS_Store"];
  else stack = ["# Node / web", "node_modules/", "dist/", "build/", ".next/", "coverage/", "*.log", ".DS_Store"];
  return secrets.concat(stack, ["", ".DS_Store", "fleet/state/"]).join("\n") + "\n";
}

// ---- AGENTS.md: the operating manual the coding agent reads every run ----
function agentsMd(app) {
  const list = (a) => (a || []).map((x) => `- ${x}`).join("\n") || "- (none)";
  return `# AGENTS.md — operating manual for ${app.name}

> Read this before every change. It is the contract the fleet loop and any coding
> agent (Codex / Claude / etc.) must follow in this repo.

## North star
${app.northStar}

## Autonomy ceiling: ${app.autonomy || cfg.fleet.defaultAutonomy}
${app.autonomyNote || cfg.fleet.autonomyLevels[app.autonomy || cfg.fleet.defaultAutonomy]}

## Source control & deploy
- Work only on branches prefixed \`${cfg.fleet.safety.workOnBranchPrefix}\`. Never commit to main; never force-push.
- Deploy policy: **${app.deployPolicy}** — ${cfg.fleet.safety.deployPolicies[app.deployPolicy]}
- The loop never deploys, publishes, or submits to a store. Shipping is a human/CI step.

## Standing context (always true here)
${app.standingContext || "—"}

## Commands
- install: \`${app.commands?.install || "—"}\`
- build:   \`${app.commands?.build || "—"}\`
- test:    \`${app.commands?.test || "—"}\`
- deploy:  \`${app.commands?.deploy || "—"}\`  ← human/CI only

## Quality gates (must pass before a task is 'done')
${list(app.gates)}

## Guardrails — never violate
${list([...cfg.fleet.globalGuardrails, ...(app.guardrails || [])])}

## Off-limits paths (never read values from or modify)
${list(app.offLimits)}

## Escalate (stop and ask a human) when
${list(app.escalateWhen)}

## Memory
Keep a \`memory.md\` in this repo updated each session with: what changed, what was
verified, current blockers, and the active backlog. The fleet relies on it for continuity.
`;
}

// ---- SAFE_SETUP.md: how to put the repo under git WITHOUT losing work ----
function safeSetup(app) {
  return `# Safe git setup — ${app.name}

This repo is not under version control yet. Follow these steps **in order** so nothing
is lost and the fleet loop can run safely (it refuses to run live without git).

\`\`\`bash
cd "${app.repo}"

# 1. Add the ignore rules FIRST so secrets/build junk never get staged.
cp /path/to/fleet/bootstrap/${app.slug}/.gitignore .gitignore

# 2. Sanity-check what WOULD be committed — look for any secret/large file.
git init
git add -A
git status            # review carefully. If a secret shows up, add it to .gitignore and re-run.

# 3. Commit the current working state as the baseline (your rollback point).
git commit -m "baseline: import existing ${app.name} before fleet automation"

# 4. (recommended) push to a private remote for off-machine backup.
# git remote add origin <your-private-repo-url>
# git push -u origin main

# 5. Copy the operating manual in so agents read it every run.
cp /path/to/fleet/bootstrap/${app.slug}/AGENTS.md .

# 6. (optional) add the build/test CI so checks run on every push.
mkdir -p .github/workflows
cp /path/to/fleet/bootstrap/${app.slug}/.github/workflows/ci.yml .github/workflows/
\`\`\`

After this, the loop will create \`${cfg.fleet.safety.workOnBranchPrefix}<task>\` branches for
its changes, so your \`main\` is always a safe rollback. Deploy stays manual/CI — policy
for this app is **${app.deployPolicy}**.
`;
}

// ---- a build+test CI (NOT deploy) modeled on the fleet's gates ----
function ci(app) {
  const s = (app.stack || "").toLowerCase();
  const runner = /swift|xcode|macos/.test(s) ? "macos-latest" : "ubuntu-latest";
  const setup = /swift|xcode|macos/.test(s)
    ? "      # Xcode is preinstalled on macOS runners"
    : /kotlin|android|gradle/.test(s)
      ? "      - uses: actions/setup-java@v4\n        with: { distribution: temurin, java-version: '17' }"
      : "      - uses: actions/setup-node@v4\n        with: { node-version: '20' }";
  const testCmd = (app.commands?.test || "echo 'add tests'").replace(/"/g, '\\"');
  return `# CI for ${app.name} — runs build + tests on every push/PR.
# This does NOT deploy. Deploy policy for this app is "${app.deployPolicy}".
name: ci
on:
  push: { branches: ["**"] }
  pull_request: {}
jobs:
  verify:
    runs-on: ${runner}
    steps:
      - uses: actions/checkout@v4
${setup}
      - name: Install
        run: ${app.commands?.install || "echo 'no install step'"}
      - name: Test / gates
        run: ${testCmd}
      # NOTE: never put deploy/publish/store-submit steps here for this app.
`;
}

let n = 0;
for (const app of apps) {
  write(app.slug, ".gitignore", gitignore(app));
  write(app.slug, "AGENTS.md", agentsMd(app));
  write(app.slug, "SAFE_SETUP.md", safeSetup(app));
  write(app.slug, ".github/workflows/ci.yml", ci(app));
  n++;
  console.log(`bootstrap kit → bootstrap/${app.slug}/  (.gitignore, AGENTS.md, SAFE_SETUP.md, CI)`);
}
console.log(`\nGenerated ${n} kit(s). Copy each into its real repo using its SAFE_SETUP.md. No real folders were touched.`);

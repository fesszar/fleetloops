import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, chmodSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expandHome } from "./util.mjs";

const cleanString = (v) => String(v || "").trim();

export function slugify(value) {
  return cleanString(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

function uniqueSlug(cfg, base) {
  const used = new Set((cfg.apps || []).map((a) => a.slug));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function detectStack(repo) {
  const has = (f) => existsSync(join(repo, f));
  if (has("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
      const scripts = pkg.scripts || {};
      const test = scripts.test && !/no test specified/.test(scripts.test) ? "npm test --silent" : "";
      return { stack: "node", test, build: scripts.build ? "npm run build" : "" };
    } catch {
      return { stack: "node", test: "", build: "" };
    }
  }
  if (has("pyproject.toml") || has("requirements.txt")) return { stack: "python", test: has("pytest.ini") || has("tests") ? "python -m pytest -q" : "", build: "" };
  if (has("build.gradle") || has("build.gradle.kts") || has("gradlew")) return { stack: "android", test: "./gradlew testDebugUnitTest", build: "./gradlew assembleDebug" };
  if (has("Package.swift")) return { stack: "swift", test: "swift test", build: "swift build" };
  const xc = (() => { try { return readdirSync(repo).find((f) => f.endsWith(".xcodeproj") || f.endsWith(".xcworkspace")) || ""; } catch { return ""; } })();
  if (xc) return { stack: "ios", test: "", build: "" };
  if (has("go.mod")) return { stack: "go", test: "go test ./...", build: "go build ./..." };
  if (has("Cargo.toml")) return { stack: "rust", test: "cargo test", build: "cargo build" };
  return { stack: "unknown", test: "", build: "" };
}

function isGitRepo(repo) {
  const r = spawnSync("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  return r.status === 0 && /true/.test(r.stdout || "");
}

export function scaffoldRepoEnv(repo, det) {
  const dir = join(repo, ".fleet");
  mkdirSync(dir, { recursive: true });
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
# gates. Network + localhost are allowed. NEVER put real secrets here; seed safe fakes only.
set -e
${install}
[ -f .env.example ] && [ ! -f .env ] && cp .env.example .env || true
# Start any local service the tests need and seed a throwaway test user here.
`);
    chmodSync(setup, 0o755);
  }
  const env = join(dir, "env.sh");
  if (!existsSync(env)) writeFileSync(env,
`# Sourced into every gate/probe run. SAFE LOCAL TEST values only; never real secrets.
export NODE_ENV=test
export CI=1
# export DATABASE_URL="file:./.fleet/test.db"
`);
  const cert = join(dir, "CERTIFICATIONS.md");
  if (!existsSync(cert)) writeFileSync(cert,
`# Human-only certifications for this app

- [ ] Real payment / billing verified with a real card
- [ ] Company/publisher identity verified
- [ ] App store / TestFlight / Play submission
- [ ] Production secrets rotated and stored in the real secret manager
- [ ] Production database / hosting access confirmed
`);
  const gi = join(repo, ".gitignore");
  let g = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!/\.fleet\/test\.db|\.fleet\/\*\.local/.test(g)) {
    writeFileSync(gi, g + (g.endsWith("\n") || !g ? "" : "\n") + "\n# fleet local test artifacts\n.fleet/*.local\n.fleet/test.db\n.env\n");
  }
}

export function makeProjectConfig({ slug, name, repo, northStar }, det, isGit) {
  return {
    slug,
    name,
    repo,
    stage: "partial-build",
    loop: isGit ? "running" : "paused",
    autonomy: "branch-approve",
    maxAutonomy: "merge-main",
    deployPolicy: "none",
    vcs: isGit ? "git" : "none",
    needsBootstrap: !isGit,
    stack: det.stack,
    northStar: cleanString(northStar) || `Make ${name} production-ready and keep it healthy.`,
    agent: { adapter: "shell", command: `cd "{{REPO}}" && codex exec -c sandbox_workspace_write.network_access=true --sandbox workspace-write -c model_reasoning_effort={{REASONING}} - < "{{PROMPT_FILE}}"` },
    triggers: ["command", "test-fail"],
    schedule: "-",
    retryCap: 3,
    commands: { install: "", build: det.build, test: det.test, deploy: "" },
    gates: det.test ? [det.test] : [],
    guardrails: ["Never commit secrets"],
    offLimits: [".env"],
    standingContext: `Stack detected: ${det.stack}.${isGit ? "" : " This folder is not under git yet, so Fleet is paused until it is initialized."}`,
    eightyTwentyLoop: "Make the single highest-value change toward production readiness; never busywork.",
    escalateWhen: ["Any deploy/publish", "Anything irreversible"],
    backlog: [],
    exitConditions: [],
  };
}

export function addProjectToConfig(cfg, opts = {}) {
  if (!cfg || !Array.isArray(cfg.apps)) return { ok: false, status: 500, error: "config has no apps array" };
  const expanded = expandHome(cleanString(opts.repo));
  if (!expanded) return { ok: false, status: 400, error: "repo is required" };
  const repo = resolve(expanded);
  if (!existsSync(repo)) return { ok: false, status: 404, error: "project folder not found" };
  if ((cfg.apps || []).some((a) => resolve(expandHome(a.repo || "")) === repo)) {
    return { ok: false, status: 409, error: "project is already in Fleet" };
  }

  const providedSlug = cleanString(opts.slug);
  const baseSlug = slugify(providedSlug || basename(repo));
  if (providedSlug && (cfg.apps || []).some((a) => a.slug === baseSlug)) {
    return { ok: false, status: 409, error: `app '${baseSlug}' already exists` };
  }
  const slug = providedSlug ? baseSlug : uniqueSlug(cfg, baseSlug);
  const name = cleanString(opts.name) || basename(repo) || slug;
  const det = detectStack(repo);
  const git = isGitRepo(repo);
  const app = makeProjectConfig({ slug, name, repo, northStar: opts.northStar }, det, git);

  cfg.apps.push(app);
  if (git) scaffoldRepoEnv(repo, det);
  return { ok: true, status: 200, app, det, isGit: git, repo };
}

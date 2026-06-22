import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, chmodSync, copyFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { expandHome } from "./util.mjs";
import { getProvider } from "./providers/registry.mjs";

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

function normalizeProvider(opts = {}) {
  const id = cleanString(opts.providerId || opts.provider?.id);
  const provider = id ? getProvider(id) : null;
  if (id && !provider) return { error: `unknown provider '${id}'` };
  const model = cleanString(opts.providerModel || opts.model || opts.provider?.model);
  const out = {};
  if (provider) out.provider = { id: provider.id, ...(model ? { model } : {}) };
  if (model) out.model = model;
  return out;
}

function normalizePolicy(value, fallback, allowed) {
  const v = cleanString(value);
  return allowed.includes(v) ? v : fallback;
}

export function normalizeGateDraft(gates = []) {
  return (Array.isArray(gates) ? gates : [])
    .filter((g) => g && g.enabled !== false && cleanString(g.say || g.text || g.title))
    .slice(0, 30)
    .map((g, i) => {
      const prov = cleanString(g.prov || g.provenance || "").toLowerCase();
      const check = ["auto", "agent", "human"].includes(g.check) ? g.check
        : prov === "owner" ? "human"
        : prov === "shared" ? "agent"
        : prov === "self" || prov === "loop" ? "auto"
        : "agent";
      const effort = ["S", "M", "L"].includes(g.effort) ? g.effort : "M";
      return {
        id: cleanString(g.id) || `gate-${i + 1}`,
        say: cleanString(g.say || g.text || g.title).slice(0, 220),
        check,
        probe: cleanString(g.probe),
        effort,
        source: cleanString(g.source) || "onboarding",
      };
    });
}

export function makeProjectConfig({ slug, name, repo, northStar }, det, isGit, opts = {}) {
  const providerPatch = normalizeProvider(opts);
  if (providerPatch.error) throw new Error(providerPatch.error);
  const startPaused = opts.startPaused !== false;
  const gates = normalizeGateDraft(opts.gates);
  const autonomy = normalizePolicy(opts.autonomy, "branch-approve", ["propose", "branch-approve", "merge-main", "full"]);
  const deployPolicy = normalizePolicy(opts.deployPolicy, "none", ["none", "manual-web", "store-pipeline", "script", "ci-cd"]);
  const reasoning = normalizePolicy(opts.reasoning, "medium", ["low", "medium", "high"]);
  return {
    slug,
    name,
    repo,
    stage: "partial-build",
    loop: startPaused || !isGit ? "paused" : "running",
    autonomy,
    maxAutonomy: "merge-main",
    deployPolicy,
    vcs: isGit ? "git" : "none",
    needsBootstrap: !isGit,
    stack: det.stack,
    reasoning,
    ...providerPatch,
    northStar: cleanString(northStar) || `Make ${name} production-ready and keep it healthy.`,
    agent: { adapter: "shell", command: `cd "{{REPO}}" && codex exec -c sandbox_workspace_write.network_access=true --sandbox workspace-write -c model_reasoning_effort={{REASONING}} - < "{{PROMPT_FILE}}"` },
    triggers: ["command", "test-fail"],
    schedule: "-",
    retryCap: 3,
    commands: { install: "", build: det.build, test: det.test, deploy: "" },
    gates: det.test ? [det.test] : [],
    guardrails: ["Never commit secrets"],
    offLimits: [".env"],
    standingContext: cleanString(opts.standingContext) || `Stack detected: ${det.stack}.${isGit ? "" : " This folder is not under git yet, so FleetLoops is paused until it is initialized."}`,
    eightyTwentyLoop: "Make the single highest-value change toward production readiness; never busywork.",
    escalateWhen: ["Any deploy/publish", "Anything irreversible"],
    backlog: [],
    exitConditions: gates,
    onboarding: {
      createdAt: new Date().toISOString(),
      brainApproved: false,
      gatesApproved: gates.length > 0,
      startPaused,
      mode: cleanString(opts.mode) || "code",
    },
  };
}

export function addProjectToConfig(cfg, opts = {}) {
  if (!cfg || !Array.isArray(cfg.apps)) return { ok: false, status: 500, error: "config has no apps array" };
  const expanded = expandHome(cleanString(opts.repo));
  if (!expanded) return { ok: false, status: 400, error: "repo is required" };
  const repo = resolve(expanded);
  if (!existsSync(repo)) return { ok: false, status: 404, error: "project folder not found" };
  if ((cfg.apps || []).some((a) => resolve(expandHome(a.repo || "")) === repo)) {
    return { ok: false, status: 409, error: "project is already in FleetLoops" };
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
  let app;
  try {
    app = makeProjectConfig({ slug, name, repo, northStar: opts.northStar }, det, git, opts);
  } catch (e) {
    return { ok: false, status: 400, error: String(e && e.message || e) };
  }

  cfg.apps.push(app);
  if (git) scaffoldRepoEnv(repo, det);
  return { ok: true, status: 200, app, det, isGit: git, repo };
}

function writeIfMissing(file, body) {
  if (!existsSync(file)) writeFileSync(file, body);
}

function uniquePath(baseDir, slug) {
  let out = join(baseDir, slug);
  if (!existsSync(out)) return out;
  let n = 2;
  while (existsSync(`${out}-${n}`)) n++;
  return `${out}-${n}`;
}

function copySourceDocs(files, destDir) {
  const copied = [];
  if (!Array.isArray(files) || !files.length) return copied;
  mkdirSync(destDir, { recursive: true });
  for (const raw of files.slice(0, 20)) {
    const src = resolve(expandHome(cleanString(raw.path || raw)));
    if (!existsSync(src)) continue;
    const target = join(destDir, basename(src));
    try { copyFileSync(src, target); copied.push(target); } catch {}
  }
  return copied;
}

export function createScratchProject(cfg, opts = {}) {
  if (!cfg || !Array.isArray(cfg.apps)) return { ok: false, status: 500, error: "config has no apps array" };
  const name = cleanString(opts.name) || "New FleetLoops App";
  const brief = cleanString(opts.brief);
  if (brief.length < 20) return { ok: false, status: 400, error: "brief must describe what to build" };
  const workspace = resolve(expandHome(cleanString(opts.workspace || opts.parent || join(homedir(), "FleetLoops Projects"))));
  mkdirSync(workspace, { recursive: true });
  const baseSlug = slugify(cleanString(opts.slug) || name);
  const slug = uniqueSlug(cfg, baseSlug);
  const repo = uniquePath(workspace, slug);
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".fleet"), { recursive: true });

  writeIfMissing(join(repo, "PROJECT_BRIEF.md"), `# ${name}\n\n${brief}\n`);
  writeIfMissing(join(repo, "README.md"), `# ${name}\n\nThis project was created from a FleetLoops scratch brief. The first loop should turn the brief into a production app plan before implementing user-facing code.\n`);
  writeIfMissing(join(repo, ".fleet", "brain.md"), `# Scratch Project Brain Draft\n\n## Product\n${brief}\n\n## Current State\nNo production code has been generated yet. FleetLoops should first preserve this brief, identify the target stack, and propose implementation gates.\n`);
  writeIfMissing(join(repo, ".fleet", "CERTIFICATIONS.md"), `# Human-only certifications for this app\n\n- [ ] Production billing/payment behavior verified\n- [ ] Publisher identity/store submission verified\n- [ ] Production secrets configured outside this repo\n`);
  const copiedDocs = copySourceDocs(opts.files || opts.documents || [], join(repo, ".fleet", "source-docs"));

  if (spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo }).status === 0) {
    spawnSync("git", ["config", "user.email", "fleetloops@local"], { cwd: repo });
    spawnSync("git", ["config", "user.name", "FleetLoops"], { cwd: repo });
    spawnSync("git", ["add", "-A"], { cwd: repo });
    spawnSync("git", ["commit", "-qm", "Initial FleetLoops scratch brief"], { cwd: repo });
  }

  const gates = normalizeGateDraft(opts.gates).length ? opts.gates : [
    { id: "gate-1", say: "Project brief is preserved and reflected in the implementation plan", check: "human", effort: "S", source: "onboarding" },
    { id: "gate-2", say: "A runnable app scaffold exists with documented setup and test commands", check: "agent", effort: "M", source: "onboarding" },
    { id: "gate-3", say: "Core user workflow works end to end with real local state", check: "agent", effort: "L", source: "onboarding" },
  ];
  const result = addProjectToConfig(cfg, {
    ...opts,
    repo,
    slug,
    name,
    northStar: brief,
    gates,
    mode: "scratch",
    startPaused: opts.startPaused !== false,
    standingContext: `Scratch project created from owner brief. Source documents copied: ${copiedDocs.length}.`,
  });
  if (!result.ok) return result;
  return { ...result, repo, copiedDocs };
}

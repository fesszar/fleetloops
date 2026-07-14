// test-onboarding.mjs — regression coverage for the FleetLoops first-run state machine.
// Run: cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-onboarding.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  applyOnboardingAction,
  approveOnboardingBrain,
  defaultOnboardingState,
  launchOnboardingApp,
  publicOnboarding,
  saveOnboardingGates,
  writeProposedBrain,
} from "./onboarding.mjs";
import { addProjectToConfig, createScratchProject } from "./project-onboard.mjs";
import { loadState } from "./loop.mjs";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d)."); process.exit(1); }
const SD = process.env.FLEET_STATE_DIR;
mkdirSync(SD, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };

const cfg = { fleet: { defaultRetryCap: 2 }, apps: [] };
ok(defaultOnboardingState().completed === false, "default onboarding starts incomplete");
ok(publicOnboarding(cfg).completed === false && cfg.fleet.onboarding.version === "night-deck-1", "public onboarding normalizes config state");

const repo = join(SD, "existing-app");
mkdirSync(repo, { recursive: true });
writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "existing-app", scripts: { test: "node --test", build: "node -e \"console.log('build')\"" }, dependencies: { react: "latest" } }));
writeFileSync(join(repo, "README.md"), "# Existing App\n\nA real app used by onboarding tests.\n");
spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
spawnSync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
spawnSync("git", ["config", "user.name", "Tests"], { cwd: repo });
spawnSync("git", ["add", "-A"], { cwd: repo });
spawnSync("git", ["commit", "-qm", "base"], { cwd: repo });

const added = addProjectToConfig(cfg, { repo, onboarding: true, providerId: "ollama", startPaused: true });
ok(added.ok && added.app.loop === "paused", "existing-code onboarding adds project paused");
ok(added.app.provider.id === "ollama", "project onboarding persists selected provider");

const brain = writeProposedBrain(added.app, { mode: "code", brief: "Make this app production-ready." });
ok(brain.ok && brain.proposed.includes("## Architecture") && brain.facts.length > 0, "understand step writes a real project brain proposal");
ok(existsSync(join(repo, ".fleet", "project-brain.proposed.md")), "brain proposal is stored in the project .fleet folder");

const approved = approveOnboardingBrain(added.app, brain.proposed);
ok(approved.ok && existsSync(join(repo, ".fleet", "project-brain.md")), "brain approval promotes proposed brain to active brain");
ok(loadState(added.app, cfg.fleet).brain.origin === "template", "brain approval preserves template origin metadata");

const gates = saveOnboardingGates(added.app, cfg.fleet, brain.gates);
ok(gates.ok && added.app.exitConditions.length >= 3, "gate setup persists enabled Definition-of-Done gates");
ok(loadState(added.app, cfg.fleet).conditions.length === added.app.exitConditions.length, "gate setup seeds state conditions");

const launched = launchOnboardingApp(added.app, cfg.fleet);
ok(launched.ok && added.app.loop === "running" && loadState(added.app, cfg.fleet).loop === "running", "launch resumes the app only after brain and gates are approved");

const step = applyOnboardingAction(cfg, { action: "complete" });
ok(step.ok && cfg.fleet.onboarding.completed === true, "onboarding completion persists in fleet config");

const scratch = createScratchProject(cfg, { name: "Scratch App", brief: "Build a compact local task board with durable storage, onboarding, and real empty/error states.", workspace: join(SD, "scratch-root"), providerId: "ollama" });
ok(scratch.ok && existsSync(join(scratch.repo, "PROJECT_BRIEF.md")), "scratch onboarding creates a real local repository and project brief");
ok(readFileSync(join(scratch.repo, ".fleet", "brain.md"), "utf8").includes("Scratch Project Brain"), "scratch onboarding seeds a brain draft file");
ok(cfg.apps.some((a) => a.slug === scratch.app.slug && a.loop === "paused"), "scratch project is persisted paused");

console.log(`\nonboarding: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

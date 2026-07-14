// test-preflight.mjs — P0-4 preflight doctor + guided first win.
// Run: cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-preflight.mjs
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d)."); process.exit(1); }
if (!existsSync(process.env.FLEET_STATE_DIR)) mkdirSync(process.env.FLEET_STATE_DIR, { recursive: true });
process.env.FLEET_WORKTREE_DIR = mkdtempSync(join(tmpdir(), "wt-"));

const { loadState, saveState, STATE_DIR } = await import("./loop.mjs");
const { launchOnboardingApp } = await import("./onboarding.mjs");
const { chooseStarterTask, ensureStarterTask, runPreflight } = await import("./preflight.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };

function repo(name, { packageJson = { scripts: { test: "node -e \"process.exit(0)\"" } }, readme = "# App\n\nThis README is intentionally long enough for the preflight starter selection test fixture. It explains what the app is, how to run it, and how to test it. FleetLoops needs a realistic README so starter selection can fall through to other rules when appropriate.\n\nRun with npm test.\n" } = {}) {
  const r = mkdtempSync(join(tmpdir(), `${name}-`));
  const G = (a) => execSync(`git -C "${r}" ${a}`, { encoding: "utf8" });
  writeFileSync(join(r, "package.json"), JSON.stringify(packageJson));
  if (readme !== null) writeFileSync(join(r, "README.md"), readme);
  G("init -q -b main");
  G("config user.email t@t");
  G("config user.name t");
  G("add -A");
  G("commit -qm base");
  return r;
}

function app(slug, r, extra = {}) {
  return {
    slug,
    name: slug,
    repo: r,
    stack: "node",
    loop: "paused",
    stage: "partial-build",
    provider: { id: "ollama" },
    agent: { adapter: "shell", command: "unused" },
    commands: { test: "node -e \"process.exit(0)\"" },
    exitConditions: [{ id: "gate-agent", say: "Agent verifies done", check: "agent", effort: "S" }],
    ...extra,
  };
}

function fleet(extra = {}) {
  return { safety: { requireGitForLive: true }, notifications: { desktop: false }, defaultRetryCap: 2, ...extra };
}

function approveBrain(a, f) {
  const s = loadState(a, f);
  s.brain = { status: "approved", origin: "template", version: 1, at: new Date().toISOString() };
  saveState(s);
}

try {
  const healthyRepo = repo("healthy");
  const healthy = app("healthy", healthyRepo);
  const healthyReport = await runPreflight(healthy, fleet());
  ok(healthyReport.ok === true && healthyReport.checks.every((c) => c.status === "pass"), "healthy throwaway repo passes every preflight check");
  ok(loadState(healthy, fleet()).preflight?.at === healthyReport.at, "preflight report is cached in app state");

  const nonGit = mkdtempSync(join(tmpdir(), "nongit-"));
  writeFileSync(join(nonGit, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  const badApp = app("non-git", nonGit);
  const badReport = await runPreflight(badApp, fleet());
  ok(badReport.ok === false && badReport.checks.some((c) => c.id === "repo-exists" && c.status === "fail"), "non-git directory fails repo-exists and ok=false");
  ok(badReport.checks.length >= 7, "non-git report still includes the rest of the checks");

  const warnRepo = repo("warn");
  const warnApp = app("warn", warnRepo, {
    exitConditions: [{ id: "missing-bin", say: "Custom analyzer runs", check: "auto", probe: "definitely-missing-fleetloops-preflight-bin --check", effort: "S" }],
  });
  const warnReport = await runPreflight(warnApp, fleet());
  const gateWarn = warnReport.checks.find((c) => c.id === "gate-probes");
  ok(warnReport.ok === true && gateWarn?.status === "warn" && /Edit the gate command/.test(gateWarn.fix), "unspawnable gate probe warns with fix text and does not block launch");

  approveBrain(badApp, fleet());
  const refused = await launchOnboardingApp(badApp, fleet());
  ok(refused.ok === false && refused.status === 409 && /Pre-flight/.test(refused.error || ""), "launchOnboardingApp refuses fail-level preflight");
  const refusedForced = await launchOnboardingApp(badApp, fleet(), { force: true });
  ok(refusedForced.ok === false, "force never bypasses fail-level preflight");

  approveBrain(warnApp, fleet());
  const launchedWarn = await launchOnboardingApp(warnApp, fleet());
  ok(launchedWarn.ok === true && loadState(warnApp, fleet()).loop === "running", "launchOnboardingApp allows warning-only preflight");
  const warnAppForced = app("warn-force", warnRepo, {
    exitConditions: warnApp.exitConditions,
  });
  approveBrain(warnAppForced, fleet());
  const launchedForced = await launchOnboardingApp(warnAppForced, fleet(), { force: true });
  ok(launchedForced.ok === true && launchedForced.forced === true, "force bypass path still allows warning-only preflight");

  const failingGateRepo = repo("starter-gate");
  const failingGateApp = app("starter-gate", failingGateRepo, {
    exitConditions: [{ id: "small-fail", say: "Smoke test is green", check: "auto", probe: "node -e \"process.exit(1)\"", effort: "S" }],
  });
  const failingGateReport = await runPreflight(failingGateApp, fleet());
  const pickGate = chooseStarterTask(failingGateApp, failingGateReport);
  ok(/^Make "Smoke test is green" pass$/.test(pickGate.title), "starter selection first picks a failing S auto gate");
  const addedGate = ensureStarterTask(failingGateApp, fleet(), failingGateReport);
  const gateState = loadState(failingGateApp, fleet());
  ok(addedGate.added === true && gateState.backlog[0].priority === 1 && gateState.backlog[0].starter === true, "starter task lands at top with priority 1 and starter=true");

  const noTestRepo = repo("starter-no-test", { packageJson: { scripts: {} } });
  const noTestApp = app("starter-no-test", noTestRepo, { commands: { test: "" }, exitConditions: [{ id: "human", say: "Human release check", check: "human", effort: "M" }] });
  const noTestReport = await runPreflight(noTestApp, fleet());
  const pickNoTest = ensureStarterTask(noTestApp, fleet(), noTestReport).task;
  ok(/minimal smoke test/.test(pickNoTest.title) && pickNoTest.priority === 1 && pickNoTest.starter === true, "starter selection falls back to smoke-test task when no test script exists");
} catch (e) {
  ok(false, String(e && e.stack || e).slice(0, 900));
}

console.log(`\npreflight: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

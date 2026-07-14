// test-gates-draft.mjs — P0-2 agent-generated Definition-of-Done gate drafts.
// Run: cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-gates-draft.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  beginOnboardingBrainAnalysis,
  draftGatesForApp,
  draftGatesWithAgent,
  parseGateDraft,
  setGateDraftExplainerForTests,
  writeProposedBrain,
} from "./onboarding.mjs";
import { setBrainExplainerForTests } from "./brain.mjs";
import { loadState } from "./loop.mjs";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d)."); process.exit(1); }

const SD = process.env.FLEET_STATE_DIR;
mkdirSync(SD, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const repo = join(SD, "gate-draft-app");
mkdirSync(repo, { recursive: true });
writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(1)\"", build: "node -e \"console.log('build')\"" } }));
const app = {
  slug: "gate-draft-app",
  name: "Gate Draft App",
  repo,
  stack: "node",
  northStar: "Make checkout and onboarding production ready.",
  provider: { id: "codex" },
  agent: { adapter: "shell", command: "unused" },
  commands: { test: "node -e \"process.exit(1)\"", build: "node -e \"console.log('build')\"" },
};

const yaml = (body) => `\n\`\`\`yaml\ngates:\n${body}\n\`\`\`\n`;
const deepBrain = `# Project Brain

## Product
This product has enough context to draft gates from the codebase.

## Architecture
It is a Node app with package scripts and a checkout-oriented north star.

## Conventions
Use tests and code review gates that are specific to the repository.
`;

try {
  const parsed = parseGateDraft(yaml(`  - say: "Tests pass"\n    check: auto\n    probe: "npm test"\n    effort: S\n    why: "Package scripts include tests"`));
  ok(parsed.length === 1 && parsed[0].say === "Tests pass" && parsed[0].check === "auto", "parseGateDraft extracts fenced YAML gates");

  setGateDraftExplainerForTests(async () => yaml(Array.from({ length: 10 }).map((_, i) => `  - say: "Codebase-specific gate ${i + 1}"\n    check: agent\n    probe: ""\n    effort: M\n    why: "Tied to this repo ${i + 1}"`).join("\n")));
  const capped = await draftGatesWithAgent(app, {}, { mode: "code", brief: "" });
  ok(capped.filter((g) => g.source === "agent").length === 8 && capped.every((g) => g.say && g.check), "agent gates are parsed, normalized, source-tagged, and capped at 8");

  setGateDraftExplainerForTests(async () => yaml(`  - say: "Push to production"\n    check: auto\n    probe: "git push origin main"\n    effort: S\n    why: "Should never run"\n  - say: "Invalid checker"\n    check: weird\n    probe: ""\n    effort: M\n    why: "Bad enum"\n  - say: "Runnable failing test proves the harness"\n    check: auto\n    probe: "node -e \\"process.exit(1)\\""\n    effort: S\n    why: "The command starts even though it fails today"`));
  const safe = await draftGatesWithAgent(app, {}, { mode: "code", brief: "" });
  ok(!safe.some((g) => /Push to production|Invalid checker/.test(g.say)), "COSTLY probes and invalid check types are dropped");
  ok(safe.some((g) => g.check === "auto" && /Runnable failing test/.test(g.say)), "failing but runnable auto probes remain auto gates");

  setGateDraftExplainerForTests(async () => yaml(`  - say: "Run the custom analyzer"\n    check: auto\n    probe: "definitely-missing-fleetloops-binary --check"\n    effort: M\n    why: "The project mentions a custom analyzer"`));
  const downgraded = await draftGatesWithAgent(app, {}, { mode: "code", brief: "" });
  ok(downgraded.some((g) => g.check === "agent" && /wasn't runnable/.test(g.say)), "unspawnable probe is downgraded to agent gate with note");

  setGateDraftExplainerForTests(async () => yaml(`  - say: "Checkout flow is covered by tests"\n    check: agent\n    probe: ""\n    effort: M\n    why: "Checkout is the main workflow"`));
  const floored = await draftGatesWithAgent(app, {}, { mode: "code", brief: "Stripe checkout and billing must work" });
  ok(floored.some((g) => g.id === "gate-human-release"), "missing human release gate is appended");
  ok(floored.some((g) => g.id === "gate-payments-human"), "payment brief appends payments human gate");

  setGateDraftExplainerForTests(async () => "");
  const fallback = await draftGatesWithAgent(app, {}, { mode: "code", brief: "Stripe checkout and billing must work" });
  ok(same(fallback, draftGatesForApp(app, { mode: "code", brief: "Stripe checkout and billing must work" })), "empty explainer output falls back byte-identically to defaults");

  const manualApp = { ...app, provider: null, agent: { adapter: "manual" } };
  const noProvider = await draftGatesWithAgent(manualApp, {}, { mode: "code", brief: "" });
  ok(same(noProvider, draftGatesForApp(manualApp, { mode: "code", brief: "" })), "no provider falls back byte-identically to defaults");

  setBrainExplainerForTests(async () => deepBrain);
  setGateDraftExplainerForTests(async () => yaml(`  - say: "Checkout route handles empty, loading, error, and success states"\n    check: agent\n    probe: ""\n    effort: M\n    why: "Checkout is the app's north-star workflow"`));
  writeProposedBrain(app, { mode: "code", brief: "Stripe checkout and billing must work" });
  const started = beginOnboardingBrainAnalysis(app, {}, { mode: "code", brief: "Stripe checkout and billing must work" });
  ok(started.analyzing === true, "onboarding analysis starts when a provider is configured");
  const analyzed = await waitForAgentGates(app);
  ok(analyzed.brain?.origin === "ai" && analyzed.onboardingGates?.some((g) => g.source === "agent"), "async onboarding analysis stores agent-drafted gates");
} catch (e) {
  ok(false, String(e && e.stack || e).slice(0, 800));
} finally {
  setGateDraftExplainerForTests(null);
  setBrainExplainerForTests(null);
}

async function waitForAgentGates(app, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = loadState(app, {});
    if (s.onboardingGates?.some((g) => g.source === "agent")) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  return loadState(app, {});
}

console.log(`\ngates-draft: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

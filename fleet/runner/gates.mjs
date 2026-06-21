// gates.mjs — verify a task by running the app's REAL test command, PLUS fleet safety
// scans on the change itself. In dryRun nothing executes. Costly/deploy commands never run.
//
// ASYNC: test commands run via execAsync (own process group, hard timeout, group kill), so a
// 20-minute test run no longer freezes the dashboard/API and a hung dev server can't leak.
//
// Returns { results, passed, blocking, reviewFlags, noGate }:
//  - passed      : test command(s) succeeded and no hard (blocking) gate failed
//  - blocking    : hard failures (e.g. a secret in the diff) — must NOT merge
//  - reviewFlags : risky-but-not-fatal findings (destructive DB change, payment path w/o
//                  idempotency) that force human review even on auto-merge apps
//  - noGate      : the app has no runnable test command (can't auto-verify behaviour)

import { spawnSync } from "node:child_process";
import { execAsync, ensureRepoSetup, withRepoEnv } from "./util.mjs";

// Single source of truth for "this command deploys/publishes/spends money — never run it
// autonomously". Exported so the API harness (providers/harness.mjs) rejects the exact same
// set of commands inside run_command that the gate refuses to run. One regex, two enforcers.
export const COSTLY = /eas build|--auto-submit|fastlane|upload|promote|publish|notari|app ?store|testflight|--track|vercel|netlify|firebase deploy|wrangler|serverless deploy|(?:fly|flyctl) deploy|heroku|gh release|(?:npm|yarn|pnpm) run deploy|git push/i;
const GATE_TIMEOUT_MS = 1000 * 60 * 20;

function gateCommands(app) {
  const cmds = [];
  const test = (app.commands && app.commands.test || "").split("#")[0].trim();
  if (test && !COSTLY.test(test)) cmds.push({ name: "test", cmd: test });
  return cmds;
}

// Added lines (the agent's own additions) in the branch vs its base.
function addedLines(cwd, base, branch) {
  const r = spawnSync("git", ["-C", cwd, "diff", `${base}...${branch}`], { encoding: "utf8" });
  if (r.status !== 0) return "";
  return (r.stdout || "").split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
}
function changedFiles(cwd, base, branch) {
  const r = spawnSync("git", ["-C", cwd, "diff", "--name-only", `${base}...${branch}`], { encoding: "utf8" });
  return (r.status === 0 ? (r.stdout || "") : "").split("\n").map((s) => s.trim()).filter(Boolean);
}

// --- the three non-negotiable scans ---
// Precise, high-confidence provider key shapes (caught regardless of variable name).
const SECRET_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, "private key"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/sk_live_[0-9a-zA-Z]{20,}/, "Stripe live secret key"],
  [/AIza[0-9A-Za-z_\-]{35}/, "Google API key"],
  [/xox[baprs]-[0-9A-Za-z-]{10,}/, "Slack token"],
  [/gh[pousr]_[0-9A-Za-z]{30,}/, "GitHub token"],
];
// Generic "name = value" secret assignment — provider keys are caught above by shape, so here
// we only flag values that look like REAL credentials, never placeholders/examples/fixtures.
const ASSIGN = /(?:api[_-]?key|secret|token|passwd|password)\s*[:=]\s*['"]([^'"\s]{12,})['"]/i;
const PLACEHOLDER = /^(?:x{3,}|\*{3,}|\.{3,}|<.*>|\{\{?.*\}?\}|\$\{.*\}|(?:your[_-]?|my[_-]?|test[_-]?|example[_-]?|dummy[_-]?|fake[_-]?|sample[_-]?|placeholder|changeme|redacted|none|null|undefined|todo|fixme|insert[_-]?|replace[_-]?|enter[_-]?))/i;
function scanSecrets(added) {
  const hits = [];
  for (const [re, label] of SECRET_PATTERNS) if (re.test(added)) hits.push(label);
  for (const line of added.split("\n")) {
    const m = ASSIGN.exec(line);
    if (!m) continue;
    const val = m[1];
    if (PLACEHOLDER.test(val)) continue;                 // your-api-key-here, ${ENV}, xxxx…
    if (!(/[A-Za-z]/.test(val) && /[0-9]/.test(val))) continue; // real creds mix letters + digits
    hits.push("hardcoded secret assignment"); break;
  }
  return [...new Set(hits)];
}
function scanDestructiveMigration(added) {
  const re = /\b(DROP\s+TABLE|DROP\s+COLUMN|ALTER\s+TABLE\s+\S+\s+DROP|RENAME\s+COLUMN|DROP\s+DATABASE|TRUNCATE)\b/i;
  return re.test(added) ? ["destructive schema statement (DROP/RENAME/TRUNCATE) added — needs expand→migrate→contract review"] : [];
}
function scanPaymentIdempotency(cwd, base, branch) {
  const files = changedFiles(cwd, base, branch).filter((f) => /(checkout|payment|billing|charge|stripe|webhook|subscription|invoice)/i.test(f) && /\.(ts|tsx|js|jsx|mjs|py|rb|go|kt|swift)$/i.test(f));
  const flagged = [];
  for (const f of files) {
    const r = spawnSync("git", ["-C", cwd, "show", `${branch}:${f}`], { encoding: "utf8" });
    if (r.status === 0 && !/idempot/i.test(r.stdout || "")) flagged.push(f);
  }
  return flagged.length ? [`payment-related file(s) changed without an idempotency key: ${flagged.slice(0, 4).join(", ")}`] : [];
}

export async function runGates(app, { dryRun, cwd, base, branch } = {}) {
  const results = [];
  const cmds = gateCommands(app);
  let testRan = false;
  const blocking = [];

  // Make the repo testable before running gates: run its persisted .fleet/setup.sh once
  // (install deps, start local services, seed test data), then source .fleet/env.sh into
  // each gate. This is what stops the agent escalating "provide me a test environment".
  if (!dryRun && cmds.length) await ensureRepoSetup(cwd);
  for (const { name, cmd } of cmds) {
    if (dryRun) { results.push({ gate: name + ": " + cmd, status: "skipped", note: "dry-run" }); continue; }
    testRan = true;
    const r = await execAsync(withRepoEnv(cwd, cmd), { cwd, timeoutMs: GATE_TIMEOUT_MS });
    const ok = !r.timedOut && r.status === 0;
    const res = { gate: name, status: ok ? "pass" : "fail", note: (r.timedOut ? "[timed out after 20m] " : "") + (r.out || "").slice(-500) };
    results.push(res); if (!ok) blocking.push(res);
  }

  // Fleet safety scans run on the diff (live runs with a real branch only).
  const reviewFlags = [];
  if (!dryRun && base && branch) {
    const added = addedLines(cwd, base, branch);
    const secrets = scanSecrets(added);
    if (secrets.length) { const res = { gate: "secret-scan", status: "fail", note: `possible secret(s) in the diff: ${secrets.join(", ")}` }; results.push(res); blocking.push(res); }
    else results.push({ gate: "secret-scan", status: "pass" });

    const mig = scanDestructiveMigration(added);
    if (mig.length) { results.push({ gate: "migration-safety", status: "review", note: mig[0] }); reviewFlags.push(mig[0]); }

    const idem = scanPaymentIdempotency(cwd, base, branch);
    if (idem.length) { results.push({ gate: "idempotency", status: "review", note: idem[0] }); reviewFlags.push(idem[0]); }
  }

  const noGate = cmds.length === 0;
  return {
    results, blocking, reviewFlags,
    passed: !dryRun && blocking.length === 0 && testRan, // needs a real test that passed
    noGate,
  };
}

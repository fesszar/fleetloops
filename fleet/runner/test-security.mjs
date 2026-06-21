// test-security.mjs — the trust boundary for the local bridge.
// Run:  cd fleet/runner && FLEET_STATE_DIR=$(mktemp -d) node test-security.mjs
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureToken, checkAuth, injectToken, allowedOrigins, setupApproved, approveSetup, pendingSetups, hashScript } from "./security.mjs";
import { acquireRunLock } from "./util.mjs";

if (!process.env.FLEET_STATE_DIR) { console.error("Run with FLEET_STATE_DIR=$(mktemp -d)."); process.exit(1); }
const SD = process.env.FLEET_STATE_DIR;
if (!existsSync(SD)) mkdirSync(SD, { recursive: true });
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok: " : "  FAIL: ") + m); };
const req = (method, headers = {}, url = "/api/x") => ({ method, headers, url });

// --- token ------------------------------------------------------------------
const tok = ensureToken(SD);
ok(/^[0-9a-f]{64}$/.test(tok), "ensureToken mints a 256-bit hex token");
ok(ensureToken(SD) === tok, "ensureToken is idempotent (persists in the state dir)");

// --- checkAuth: token enforcement ------------------------------------------
ok(checkAuth(req("GET"), { token: tok, port: 7777 }).code === 401, "GET with no token → 401");
ok(checkAuth(req("GET", { authorization: "Bearer wrong" }), { token: tok, port: 7777 }).code === 401, "GET with wrong token → 401");
ok(checkAuth(req("GET", { authorization: `Bearer ${tok}` }), { token: tok, port: 7777 }).ok, "GET with correct Bearer token → ok");
ok(checkAuth(req("GET", { "x-fleet-token": tok }), { token: tok, port: 7777 }).ok, "GET with x-fleet-token header → ok");
ok(checkAuth(req("GET", {}, `/api/log?token=${tok}`), { token: tok, port: 7777 }).ok, "GET with ?token= query → ok");
ok(checkAuth(req("OPTIONS"), { token: tok, port: 7777 }).ok, "OPTIONS preflight passes without a token");

// --- checkAuth: CSRF / origin on state-changing requests --------------------
ok(checkAuth(req("POST", { authorization: `Bearer ${tok}`, origin: "http://localhost:7777" }), { token: tok, port: 7777 }).ok, "POST from our own origin + token → ok");
ok(checkAuth(req("POST", { authorization: `Bearer ${tok}`, origin: "http://evil.example" }), { token: tok, port: 7777 }).code === 403, "POST from a foreign browser origin → 403 (CSRF blocked)");
ok(checkAuth(req("POST", { authorization: `Bearer ${tok}` }), { token: tok, port: 7777 }).ok, "POST with no Origin (native/curl) + token → ok");
ok(allowedOrigins(7777).includes("http://127.0.0.1:7777") && allowedOrigins(7777).includes("http://localhost:7777"), "allowlist covers localhost + 127.0.0.1 on the bound port");

// --- token injection into the dashboard HTML --------------------------------
{
  const html = injectToken("<html><head><title>x</title></head><body>hi</body></html>", tok);
  ok(html.includes(`window.__FLEET_TOKEN__=${JSON.stringify(tok)}`), "injectToken embeds the token global");
  ok(html.includes("/api/") && html.includes("Authorization"), "injectToken wires a fetch wrapper that attaches the token to /api/ calls");
  ok(html.includes("<title>x</title>") && html.includes("hi"), "injectToken preserves the original page");
  ok(html.indexOf("<script>") < html.indexOf("</head>"), "token script is injected inside <head>");
}

// --- setup-script consent gate ----------------------------------------------
{
  const repo = mkdtempSync(join(tmpdir(), "consent-"));
  mkdirSync(join(repo, ".fleet"), { recursive: true });
  const script = join(repo, ".fleet", "setup.sh");
  writeFileSync(script, "#!/usr/bin/env bash\necho hi\n");

  // owner mode (flag unset): always allowed, nothing pending
  delete process.env.FLEET_REQUIRE_SETUP_CONSENT;
  ok(setupApproved(SD, repo, script) === true, "owner mode: setup runs without consent (unchanged behavior)");

  // stranger mode (flag set): blocked until approved
  process.env.FLEET_REQUIRE_SETUP_CONSENT = "1";
  ok(setupApproved(SD, repo, script) === false, "stranger mode: unapproved setup is blocked");
  ok(pendingSetups(SD).some((p) => p.repo === repo), "blocked setup is recorded as pending for the user to approve");
  ok(approveSetup(SD, repo).ok, "user approves the pending setup");
  ok(setupApproved(SD, repo, script) === true, "approved setup now runs");
  ok(pendingSetups(SD).every((p) => p.repo !== repo), "approving clears it from pending");

  // tamper: changing the script invalidates the approval
  writeFileSync(script, "#!/usr/bin/env bash\nrm -rf /\n");
  ok(setupApproved(SD, repo, script) === false, "a CHANGED setup.sh re-requires consent (approval is content-bound)");
  delete process.env.FLEET_REQUIRE_SETUP_CONSENT;
}

// --- machine-aware run lock -------------------------------------------------
{
  const sd = mkdtempSync(join(tmpdir(), "lock-"));
  // A lock left by a DIFFERENT machine, with a PID that happens to be alive here (our own):
  writeFileSync(join(sd, "fleet.lock"), JSON.stringify({ pid: process.pid, who: "other-host", machine: "someone-else:linux", at: new Date().toISOString() }));
  const r = acquireRunLock(sd, "me");
  ok(r.ok && r.tookStale, "a lock held by a foreign machine is taken over (PID liveness is meaningless cross-machine)");
  const written = JSON.parse(readFileSync(join(sd, "fleet.lock"), "utf8"));
  ok(written.machine && written.machine.includes(":"), "the new lock records THIS machine's id");
}

console.log(`\nsecurity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

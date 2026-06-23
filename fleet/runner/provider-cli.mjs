import { spawn, spawnSync } from "node:child_process";
import { platform } from "node:os";
import { getProvider } from "./providers/registry.mjs";

const clean = (v) => String(v || "").trim();
const shellQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
const stripAnsi = (v) => String(v || "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

function cliCommand(providerId) {
  const p = getProvider(providerId);
  return p && p.kind === "agentic-cli" ? p.cli : "";
}

function loginCommandFor(bin) {
  if (bin === "claude") return "claude auth login";
  return `${bin} login`;
}

function which(bin) {
  if (!bin) return "";
  try {
    const r = spawnSync("bash", ["-lc", `command -v ${shellQuote(bin)}`], { encoding: "utf8", timeout: 1500 });
    return r.status === 0 ? clean(r.stdout) : "";
  } catch {
    return "";
  }
}

function versionOf(bin) {
  if (!bin) return "";
  try {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000 });
    return clean((r.stdout || r.stderr || "").split("\n")[0]);
  } catch {
    return "";
  }
}

const unauthRe = /not\s+(logged|signed)|unauth|login required|no account|not authenticated|no active account/i;
const unusableRe = /credit balance is too low|quota|out of credits|usage limit|billing/i;
const invalidTokenRe = /401 unauthorized|token[_ ]invalidated|refresh[_ ]token[_ ]invalidated|session has ended|invalid[_ ]token|please (try )?signing? in again|please run.{0,30}login/i;

function codexDeepProbe(bin) {
  try {
    const r = spawnSync(bin, [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "-c",
      "model_reasoning_effort=low",
      "-",
    ], {
      input: "Reply exactly: READY\n",
      encoding: "utf8",
      timeout: 20000,
    });
    const text = clean(`${r.stdout || ""}\n${r.stderr || ""}`);
    if (invalidTokenRe.test(text) || unauthRe.test(text)) {
      return { authenticated: false, usable: false, detail: "Session expired - sign in again" };
    }
    if (unusableRe.test(text)) {
      return { authenticated: true, usable: false, detail: "Signed in, but account or quota is not usable" };
    }
    if (r.error && r.error.code === "ETIMEDOUT") return { authenticated: true, usable: false, detail: "signed in, but verification timed out" };
    if (r.status === 0) return { authenticated: true, usable: true, detail: "Signed in and verified" };
    return { authenticated: true, usable: false, detail: text.split("\n")[0] || "signed in, but verification failed" };
  } catch {
    return { authenticated: true, usable: false, detail: "signed in, but verification failed" };
  }
}

function codexDeviceLogin(bin) {
  try {
    const r = spawnSync(bin, ["login", "--device-auth"], { encoding: "utf8", timeout: 15000 });
    const text = stripAnsi(clean(`${r.stdout || ""}\n${r.stderr || ""}`));
    const authUrl = ((text.match(/https:\/\/\S+/) || [])[0] || "").replace(/[).,]+$/, "");
    const deviceCode = (text.match(/\b[A-Z0-9]{4}-[A-Z0-9-]{4,}\b/) || [])[0] || "";
    if (authUrl && deviceCode) {
      return {
        ok: true,
        opened: true,
        method: "device-code",
        authUrl,
        deviceCode,
        expiresInMinutes: 15,
        output: text.slice(0, 4000),
        note: "Open the sign-in page and enter the code shown in FleetLoops.",
      };
    }
    return { ok: false, error: text.split("\n")[0] || "Codex did not return a device code." };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function authProbe(bin, { deep = false } = {}) {
  if (!bin) return { authenticated: false, usable: false, detail: "not installed" };
  const commands = bin === "codex"
    ? [["login", "status"]]
    : [["auth", "status"], ["login", "status"]];
  let sawInstalled = false;
  for (const args of commands) {
    try {
      const r = spawnSync(bin, args, { encoding: "utf8", timeout: 8000 });
      const text = clean(`${r.stdout || ""}\n${r.stderr || ""}`);
      if (!text) continue;
      sawInstalled = true;
      if (invalidTokenRe.test(text) || unauthRe.test(text)) return { authenticated: false, usable: false, detail: text.split("\n")[0] || "sign in required" };
      if (bin === "claude" && args.join(" ") === "auth status") {
        try {
          const json = JSON.parse(text);
          if (json.loggedIn === true) {
            const usableCheck = spawnSync(bin, ["status"], { encoding: "utf8", timeout: 8000 });
            const usableText = clean(`${usableCheck.stdout || ""}\n${usableCheck.stderr || ""}`);
            if (invalidTokenRe.test(usableText)) return { authenticated: false, usable: false, detail: usableText.split("\n")[0] || "sign in again" };
            if (unusableRe.test(usableText)) return { authenticated: true, usable: false, detail: usableText.split("\n")[0] || "signed in, but not usable" };
            return { authenticated: true, usable: true, detail: json.email ? `Signed in as ${json.email}` : "Signed in" };
          }
          if (json.loggedIn === false) return { authenticated: false, usable: false, detail: "sign in required" };
        } catch {}
      }
      if (/logged in|signed in|authenticated/i.test(text) && r.status === 0) {
        if (deep && bin === "codex") return codexDeepProbe(bin);
        return { authenticated: true, usable: true, detail: text.split("\n")[0] || "Signed in" };
      }
      if (unusableRe.test(text)) return { authenticated: true, usable: false, detail: text.split("\n")[0] || "signed in, but not usable" };
    } catch {}
  }
  return sawInstalled
    ? { authenticated: false, usable: false, detail: "installed; sign-in status could not be verified" }
    : { authenticated: false, usable: false, detail: "sign in required" };
}

export function checkCliProvider(providerId, { deep = false, auth = true } = {}) {
  const p = getProvider(providerId);
  const bin = cliCommand(providerId);
  if (!p || !bin) return { ok: false, error: "unknown CLI provider" };
  const path = which(bin);
  const installed = !!path;
  const probe = !installed
    ? { authenticated: false, usable: false, detail: `install the ${bin} CLI` }
    : auth ? authProbe(bin, { deep })
    : { authenticated: false, usable: false, detail: "Refresh to check sign-in" };
  return {
    ok: true,
    provider: p.id,
    label: p.label,
    cli: bin,
    command: loginCommandFor(bin),
    installed,
    path,
    version: installed && auth ? versionOf(bin) : "",
    authenticated: probe.authenticated,
    usable: probe.usable === true,
    connected: installed && probe.authenticated === true && probe.usable === true,
    detail: probe.detail,
  };
}

function openTerminal(command) {
  if (platform() === "darwin") {
    const script = `tell application "Terminal"\ndo script ${JSON.stringify(command)}\nactivate\nend tell`;
    const r = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
    return r.status === 0 ? { ok: true, method: "Terminal" } : { ok: false, error: clean(r.stderr) || "Terminal did not open" };
  }
  try {
    const child = spawn("bash", ["-lc", command], { detached: true, stdio: "ignore" });
    child.unref();
    return { ok: true, method: "detached-shell" };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

export function loginCliProvider(providerId, { terminal = false } = {}) {
  const status = checkCliProvider(providerId, { auth: false });
  if (!status.ok) return status;
  if (!status.installed) {
    return { ...status, ok: false, error: `${status.label} is not installed. Install the ${status.cli} CLI, or connect with an API key instead.` };
  }
  if (status.cli === "codex" && !terminal) {
    const device = codexDeviceLogin(status.cli);
    if (device.ok) return { ...status, ...device };
  }
  const opened = openTerminal(status.command);
  if (!opened.ok) return { ...status, ok: false, error: opened.error, command: status.command };
  return { ...status, ok: true, opened: true, method: opened.method, note: `Opened the ${status.label} sign-in command. Finish sign-in, then refresh provider status.` };
}

export function handleCliProviderAction(body = {}) {
  const provider = clean(body.provider || body.providerId);
  const action = clean(body.action || "check");
  if (action === "check" || action === "refresh") return checkCliProvider(provider, { deep: body.deep === true });
  if (action === "login") return loginCliProvider(provider);
  if (action === "login-terminal") return loginCliProvider(provider, { terminal: true });
  return { ok: false, error: "unknown provider CLI action" };
}

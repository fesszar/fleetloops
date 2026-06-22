import { spawn, spawnSync } from "node:child_process";
import { platform } from "node:os";
import { getProvider } from "./providers/registry.mjs";

const clean = (v) => String(v || "").trim();
const shellQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

function cliCommand(providerId) {
  const p = getProvider(providerId);
  return p && p.kind === "agentic-cli" ? p.cli : "";
}

function which(bin) {
  if (!bin) return "";
  try {
    const r = spawnSync("bash", ["-lc", `command -v ${shellQuote(bin)}`], { encoding: "utf8" });
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

function authProbe(bin) {
  if (!bin) return { authenticated: false, usable: false, detail: "not installed" };
  const unauth = /not\s+(logged|signed)|unauth|login required|no account|not authenticated|no active account/i;
  const unusable = /credit balance is too low|quota|out of credits|usage limit|billing/i;
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
      if (unauth.test(text)) return { authenticated: false, usable: false, detail: text.split("\n")[0] || "sign in required" };
      if (bin === "claude" && args.join(" ") === "auth status") {
        try {
          const json = JSON.parse(text);
          if (json.loggedIn === true) {
            const usableCheck = spawnSync(bin, ["status"], { encoding: "utf8", timeout: 8000 });
            const usableText = clean(`${usableCheck.stdout || ""}\n${usableCheck.stderr || ""}`);
            if (unusable.test(usableText)) return { authenticated: true, usable: false, detail: usableText.split("\n")[0] || "signed in, but not usable" };
            return { authenticated: true, usable: true, detail: json.email ? `Signed in as ${json.email}` : "Signed in" };
          }
          if (json.loggedIn === false) return { authenticated: false, usable: false, detail: "sign in required" };
        } catch {}
      }
      if (/logged in|signed in|authenticated/i.test(text) && r.status === 0) {
        return { authenticated: true, usable: true, detail: text.split("\n")[0] || "Signed in" };
      }
      if (unusable.test(text)) return { authenticated: true, usable: false, detail: text.split("\n")[0] || "signed in, but not usable" };
    } catch {}
  }
  return sawInstalled
    ? { authenticated: false, usable: false, detail: "installed; sign-in status could not be verified" }
    : { authenticated: false, usable: false, detail: "sign in required" };
}

export function checkCliProvider(providerId) {
  const p = getProvider(providerId);
  const bin = cliCommand(providerId);
  if (!p || !bin) return { ok: false, error: "unknown CLI provider" };
  const path = which(bin);
  const installed = !!path;
  const probe = installed ? authProbe(bin) : { authenticated: false, usable: false, detail: `install the ${bin} CLI` };
  return {
    ok: true,
    provider: p.id,
    label: p.label,
    cli: bin,
    command: `${bin} login`,
    installed,
    path,
    version: installed ? versionOf(bin) : "",
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

export function loginCliProvider(providerId) {
  const status = checkCliProvider(providerId);
  if (!status.ok) return status;
  if (!status.installed) {
    return { ...status, ok: false, error: `${status.label} is not installed. Install ${status.cli}, then run ${status.command}.` };
  }
  const opened = openTerminal(status.command);
  if (!opened.ok) return { ...status, ok: false, error: opened.error, command: status.command };
  return { ...status, ok: true, opened: true, method: opened.method, note: `Opened Terminal for ${status.command}. Finish sign-in there, then refresh provider status.` };
}

export function handleCliProviderAction(body = {}) {
  const provider = clean(body.provider || body.providerId);
  const action = clean(body.action || "check");
  if (action === "check" || action === "refresh") return checkCliProvider(provider);
  if (action === "login") return loginCliProvider(provider);
  return { ok: false, error: "unknown provider CLI action" };
}

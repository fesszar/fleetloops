import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  LayoutGrid, Inbox, Play, Pause, Square, Plus, Trash2, ChevronUp, ChevronDown,
  Circle, GitBranch, Clock, Terminal, AlertTriangle, CheckCircle2, XCircle,
  Activity, Settings, ListChecks, ArrowLeft, ShieldAlert, Zap, Bot, Edit3, FolderGit2,
  Search, GitMerge, Rocket, Wifi, WifiOff, RefreshCw, Lock, Brain, PlugZap, BookText,
  Bell, BellOff, FileDiff, Trophy, ShieldCheck,
  Key, Wallet, Cpu, ExternalLink, Route, SlidersHorizontal, CalendarClock, BellRing, Gauge,
  Server, Check, X, CircleCheck, FolderOpen, Paperclip, WandSparkles,
} from "lucide-react";

let _audio;
function getAudio() {
  try { const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return null; _audio = _audio || new Ctx(); if (_audio.state === "suspended") _audio.resume(); return _audio; } catch { return null; }
}
function chime() {
  const ctx = getAudio(); if (!ctx) return;
  [[880, 0], [1175, 0.16]].forEach(([f, t]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
    const s = ctx.currentTime + t;
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.2, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.34);
    o.start(s); o.stop(s + 0.36);
  });
}
function notify(n) { try { if ("Notification" in window && Notification.permission === "granted") new Notification("FleetView", { body: `${n} item${n > 1 ? "s" : ""} waiting for your approval`, tag: "fleet-approvals" }); } catch {} }

/*
  FleetView — renders ONLY live state from the local bridge (GET /api/state).
  No demo data: if the bridge isn't reachable it says so, rather than showing fake apps.
  All actions (approve, pause/resume, edit backlog) write back via POST and re-pull.
*/

const API = (typeof location !== "undefined" && location.protocol === "file:") ? "http://localhost:7777" : "";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchProviders() {
  const r = await fetch(`${API}/api/providers`, { cache: "no-store" });
  const d = await r.json();
  return d.providers || [];
}

async function checkCliProviderStatus(providerId, { deep = false } = {}) {
  const r = await fetch(`${API}/api/provider-cli`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: providerId, action: "check", deep }),
  });
  const d = await r.json();
  if (!r.ok || d.ok === false) throw new Error(d.error || `Provider check failed (${r.status})`);
  return d;
}

function mergeProviderStatus(providers, status) {
  if (!status || !status.provider) return providers || [];
  return (providers || []).map((p) => {
    if (p.id !== status.provider) return p;
    return {
      ...p,
      installed: !!status.installed,
      authenticated: !!status.authenticated,
      usable: !!status.usable,
      connected: !!status.connected,
      command: status.command || p.command,
      path: status.path || p.path,
      version: status.version || p.version,
      cli: status.cli || p.cli,
      detail: status.detail || p.detail,
    };
  });
}

function deepCheckConnectedCliProviders(providers, setProviders) {
  const targets = (providers || []).filter((p) => p.kind === "agentic-cli" && p.connected);
  for (const p of targets) {
    checkCliProviderStatus(p.id, { deep: true })
      .then((checked) => setProviders((prev) => mergeProviderStatus(prev, checked)))
      .catch(() => {});
  }
}

async function pollProviderReady(providerId, onProviders, { attempts = 8, delayMs = 3000 } = {}) {
  let latest = null;
  for (let i = 0; i < attempts; i += 1) {
    const providers = await fetchProviders();
    onProviders?.(providers);
    latest = providers.find((p) => p.id === providerId) || null;
    if (latest && latest.auth === "none-local") return latest;
    if (latest?.connected && latest.kind === "agentic-cli") {
      const checked = await checkCliProviderStatus(providerId, { deep: true });
      const merged = mergeProviderStatus(providers, checked);
      onProviders?.(merged);
      latest = merged.find((p) => p.id === providerId) || latest;
      if (latest.connected) return latest;
    } else if (latest?.connected) {
      return latest;
    }
    await delay(delayMs);
  }
  return latest;
}

function useRefreshOnFocus(refresh) {
  useEffect(() => {
    const run = () => refresh?.();
    const onVisibility = () => { if (!document.hidden) run(); };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);
}

const c = {
  bg: "#0A0F1C", bgGrad: "#0C1322", panel: "#111A2C", panel2: "#0E1626", raised: "#172339",
  console: "#070C16", line: "rgba(255,255,255,.075)", lineSoft: "rgba(255,255,255,.045)",
  text: "#EAF0FB", sub: "#AAB6CC", muted: "#8693AB", brand: "#5B6CFF", brandDeep: "#4C5AE0",
  working: "#5CC8FF", needs: "#FFC34D", done: "#54E0A6", idle: "#9BA8BE", gold: "#FFCE73", err: "#FF8A9B",
};
const ONBOARDING_STEPS = ["Connect", "Add project", "Understand", "Define done", "Launch"];
const font = {
  display: '"Space Grotesk", "Inter", system-ui, sans-serif',
  body: '"IBM Plex Sans", Inter, system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
};
const NIGHT_CSS = `
  :root { color-scheme: dark; }
  .fleet-night { min-height: 100vh; background: radial-gradient(1300px 640px at 80% -10%, ${c.bgGrad}, ${c.bg} 62%); color: ${c.text}; font-family: ${font.body}; letter-spacing: 0; }
  .fleet-night * { letter-spacing: 0; }
  .fleet-night .font-display { font-family: ${font.display}; }
  .fleet-night .font-mono { font-family: ${font.mono}; }
  .fleet-night .bg-slate-950 { background-color: ${c.bg} !important; }
  .fleet-night .bg-slate-900 { background-color: ${c.panel} !important; }
  .fleet-night .bg-slate-800 { background-color: ${c.raised} !important; }
  .fleet-night .border-slate-800 { border-color: ${c.line} !important; }
  .fleet-night .border-slate-700 { border-color: rgba(255,255,255,.12) !important; }
  .fleet-night .text-slate-100, .fleet-night .text-slate-200 { color: ${c.text} !important; }
  .fleet-night .text-slate-300 { color: ${c.sub} !important; }
  .fleet-night .text-slate-400 { color: ${c.muted} !important; }
  .fleet-night .text-slate-500 { color: #718096 !important; }
  .fleet-night .rounded-xl { border-radius: 12px !important; }
  .fleet-night .rounded-2xl { border-radius: 18px !important; }
  .fleet-night input, .fleet-night textarea, .fleet-night select { background: ${c.console} !important; color: ${c.text}; border-color: ${c.line}; }
  .fleet-night input::placeholder, .fleet-night textarea::placeholder { color: ${c.muted}; }
  .fleet-night button { outline-color: ${c.brand}; }
  .fleet-night .night-sidebar { width: 272px; background: rgba(8,12,22,.68) !important; backdrop-filter: blur(10px); }
  .fleet-night .night-panel { background: linear-gradient(180deg, rgba(17,26,44,.98), rgba(14,22,38,.98)); border: 1px solid ${c.line}; box-shadow: 0 24px 80px rgba(0,0,0,.28); }
  .fleet-night .night-card { background: ${c.panel}; border: 1px solid ${c.line}; box-shadow: 0 16px 44px rgba(0,0,0,.18); }
  .fleet-night .night-card:hover { border-color: rgba(255,255,255,.15); }
  .fleet-night .night-console { background: ${c.console}; border: 1px solid ${c.lineSoft}; font-family: ${font.mono}; }
  .fleet-night .night-active { background: linear-gradient(90deg, rgba(91,108,255,.16), transparent) !important; border-color: ${c.line} !important; color: ${c.text} !important; }
  .fleet-night .night-drawer { position: fixed; inset: 0; z-index: 40; display: flex; justify-content: flex-end; background: rgba(3,7,18,.58); backdrop-filter: blur(5px); }
  .fleet-night .night-drawer-inner { width: min(920px, calc(100vw - 24px)); height: calc(100vh - 24px); margin: 12px; overflow: hidden; border-radius: 18px; background: ${c.panel2}; border: 1px solid ${c.line}; box-shadow: 0 32px 100px rgba(0,0,0,.55); }
  @media (max-width: 860px) {
    .fleet-night { display: block; }
    .fleet-night .night-sidebar { width: 100%; height: auto; position: relative; }
    .fleet-night .night-sidebar-apps { max-height: 170px; }
    .fleet-night .night-drawer-inner { width: calc(100vw - 16px); height: calc(100vh - 16px); margin: 8px; border-radius: 14px; }
  }
`;

const LOOP_STATES = {
  running: { label: "Running", dot: "bg-emerald-500", chip: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" },
  paused: { label: "Paused", dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-300 border-amber-500/30" },
  blocked: { label: "Blocked", dot: "bg-rose-500", chip: "bg-rose-500/10 text-rose-300 border-rose-500/30" },
  idle: { label: "Idle", dot: "bg-slate-500", chip: "bg-slate-500/10 text-slate-300 border-slate-500/30" },
};
const TASK_STATES = {
  queued: { label: "Queued", chip: "bg-slate-700 text-slate-300 border-slate-600" },
  running: { label: "Running", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  blocked: { label: "Blocked", chip: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  review: { label: "In review", chip: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" },
  "needs-human": { label: "Needs human", chip: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  done: { label: "Done", chip: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
};
const DIFF = {
  trivial: "bg-slate-700 text-slate-300", medium: "bg-sky-500/15 text-sky-300",
  hard: "bg-orange-500/15 text-orange-300", "needs-human-decision": "bg-violet-500/15 text-violet-300",
};
const AUTONOMY_META = {
  "merge-main": { label: "Auto-merge", icon: GitMerge, cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", hint: "Lands code on main once gates pass. Hands-off." },
  "branch-approve": { label: "Approve to merge", icon: GitBranch, cls: "bg-sky-500/10 text-sky-300 border-sky-500/30", hint: "Commits to a branch + runs gates; you approve the merge." },
  propose: { label: "Propose only", icon: Lock, cls: "bg-amber-500/10 text-amber-300 border-amber-500/30", hint: "Proposes diffs only. Never merges or ships." },
  full: { label: "Full auto", icon: Rocket, cls: "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30", hint: "Self-drives incl. non-prod deploys." },
};
const DEPLOY_META = {
  "ci-cd": { label: "CI ships it", hint: "Deploys via your CI/CD — the loop never deploys directly" },
  script: { label: "You ship it", hint: "Deploy script is human-run — the loop escalates instead of shipping" },
  "store-pipeline": { label: "App Store", hint: "App Store / TestFlight / Play — releasing is always human-approved" },
  "manual-web": { label: "You upload it", hint: "Manual bundle upload — the loop escalates instead of shipping" },
  none: { label: "No deploys", hint: "This app has no deploy step yet" },
};
const STAGE_LABEL = {
  live: "Live with users", shipping: "Shipping", "feature-complete": "Feature-complete",
  "partial-build": "In development", dev: "In development",
};
const PHASE_LABEL = {
  working: null, // the card already shows what it's working on
  watching: { text: "All gates green — auditing for anything new", cls: "text-emerald-400" },
  "waiting-on-you": { text: "Paused on your sign-off — see Approvals", cls: "text-violet-300" },
  "budget-paused": { text: "Daily work limit reached — resumes tomorrow", cls: "text-amber-300" },
};
// Translate raw engine log lines into sentences a human wants to read. Raw line stays in the tooltip.
function humanizeLog(msg) {
  const rules = [
    [/^DONE (\S+): merged (\S+) → (\S+)(.*)/, (m) => `✅ Finished ${m[1]} — merged into ${m[3]}`],
    [/^DONE (\S+): (.*)/, (m) => `✅ Finished ${m[1]}: ${m[2]}`],
    [/^MERGED (\S+): merged (\S+) → (\S+)/, (m) => `✅ You approved ${m[1]} — it's now in ${m[3]}`],
    [/^ESCALATE (\S+): (.*)/, (m) => `🙋 Needs you — ${m[1]}: ${m[2]}`],
    [/^REVIEW (\S+): (.*)/, (m) => `👀 Ready for your review — ${m[1]}`],
    [/^RETRY (\S+) \(attempt (\d+)\)/, (m) => `🔁 Retrying ${m[1]} (attempt ${m[2]})`],
    [/^REVISE (\S+) \(attempt (\d+)\): (.*)/, (m) => `🔍 Reviewers asked for changes on ${m[1]} — retrying`],
    [/^GATE-MET (\S+): (.*)/, (m) => `🟢 Gate passed: ${m[1]}`],
    [/^GATE-ADD (\S+): (.*)/, (m) => `➕ New gate added: ${m[2]}`],
    [/^GATE-REJECT (\S+): (.*)/, (m) => `↩️ You sent ${m[1]} back for another attempt`],
    [/^BRAIN: (.*)/, (m) => `🧠 ${m[1]}`],
    [/^SUGGEST: (.*)/, (m) => `💡 ${m[1]}`],
    [/^EVOLVE: (watching|waiting-on-you|budget-paused) \((\d+)\/(\d+) gates green\)/, (m) => m[1] === "watching" ? `🟢 ${m[2]}/${m[3]} gates green — watching for regressions` : m[1] === "waiting-on-you" ? `🙋 ${m[2]}/${m[3]} gates green — the rest wait on you` : `⏸ Daily limit reached (${m[2]}/${m[3]} gates green)`],
    [/^EVOLVE (\S+): done.*/, (m) => `✅ Gate work landed: ${m[1]}`],
    [/^EVOLVE (\S+): (queued|review|needs-human).*/, (m) => m[2] === "review" ? `👀 Gate ${m[1]} — work ready for review` : m[2] === "needs-human" ? `🙋 Gate ${m[1]} — needs your input` : `🔁 Gate ${m[1]} — will retry`],
    [/^ANSWERED (\S+).*/, (m) => `💬 You answered ${m[1]} — the agent will act on it`],
    [/^RECONCILE: pulled (\d+) new task/, (m) => `📥 ${m[1]} new task(s) added from the plan`],
    [/^WORKTREE (\S+): (\S+).*/, (m) => `🛠 Working on ${m[1]} in a safe isolated copy`],
    [/^INFRA-RETRY (\S+) \((\d)\/3\): (.*)/, (m) => `⚠️ Environment hiccup on ${m[1]} — auto-retrying (${m[2]}/3): ${m[3]}`],
    [/^AUTH-PAUSE.*/, () => `🔑 Agent login/quota problem — open Agents & keys to reconnect`],
    [/^RECOVERED (\S+).*/, (m) => `🩹 Recovered ${m[1]} after an interruption — requeued`],
    [/^SKIP (\S+): (.*)/, (m) => `✅ ${m[1]} was already done: ${m[2]}`],
    [/^SKIP-WITH-WORK (\S+).*/, (m) => `👀 ${m[1]}: agent says it's done but left changes — review them`],
    [/^GRADUATE: (.*)/, () => `🎓 Backlog complete — switching to the definition-of-done checklist`],
    [/^AUTONOMY: (.*)/, (m) => `🏅 ${m[1]}`],
    [/^AUTO-APPROVED (\S+): (.*)\(your standing rule: (.*)\)/, (m) => `🤖✓ Autopilot signed ${m[1]} for you (your rule: ${m[3].trim()})`],
    [/^SENT-BACK (\S+).*/, (m) => `↩️ You sent ${m[1]} back with instructions`],
    [/^PROMPT (\S+).*/, (m) => `📝 Prompt prepared for ${m[1]} (dry-run)`],
    [/^EXPLAINED (\S+).*/, (m) => `📖 Wrote a plain-language brief for ${m[1]}`],
    [/^GATE-MERGE (\S+): (.*)/, (m) => `✅ Merged gate work for ${m[1]}`],
    [/^NO-RESULT (\S+).*/, (m) => `🔁 ${m[1]}: the agent's answer didn't come through — retrying`],
    [/^MERGE-FAILED (\S+): (.*)/, (m) => `⚠️ Couldn't merge ${m[1]} automatically — kept safe for you`],
    [/^REJECTED (\S+).*/, (m) => `🗑 You rejected ${m[1]}`],
  ];
  for (const [re, fn] of rules) { const m = re.exec(msg); if (m) return fn(m); }
  return msg;
}
function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
const ACT_KIND = { ok: "border-emerald-500", info: "border-slate-500", warn: "border-amber-500", err: "border-rose-500" };
let _id = 1000; const nid = (p) => `${p}${++_id}`;

function Chip({ className = "", children, title }) {
  return <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border whitespace-nowrap ${className}`}>{children}</span>;
}
function Bar({ value, tone = "bg-indigo-500" }) {
  return <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden"><div className={`h-full ${tone} rounded-full transition-all`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}
function IconBtn({ onClick, title, className = "", children, disabled }) {
  return <button onClick={onClick} title={title} disabled={disabled} className={`inline-flex items-center justify-center rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${className}`}>{children}</button>;
}
// The "definition of done" checklist — exit conditions (gates) for an app. Auto gates close
// themselves; agent/human gates show a ✓/✗ for your sign-off. You can add a gate in plain English.
function GateChecklist({ app, post }) {
  const conds = app.conditions || [];
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [showAll, setShowAll] = useState(false);
  if (!conds.length) return null;
  const met = conds.filter((c) => c.status === "met").length;
  const pct = Math.round((met / conds.length) * 100);
  const mark = (c) => c.status === "met" ? { i: "✓", cl: "text-emerald-400", say: "done" }
    : c.status === "regressed" ? { i: "↻", cl: "text-amber-400", say: "broke again — being redone" }
    : c.status === "stuck" ? { i: "⚠", cl: "text-red-400", say: "stuck — will auto-retry" + (c.retryAfter ? "" : "") }
    : (c.signoff && c.signoff.branch) ? { i: "⧗", cl: "text-cyan-400", say: "work done — waiting on your ✓" }
    : { i: "◻", cl: "text-slate-600", say: "not done yet" };
  const needsYou = (c) => c.status !== "met" && c.check !== "auto" && (c.signoff || c.check === "human");
  // keep cards compact: show unmet/active gates first, cap the visible list at 5
  const ordered = [...conds].sort((a, b) => (a.status === "met" ? 1 : 0) - (b.status === "met" ? 1 : 0));
  const visible = showAll ? ordered : ordered.slice(0, 5);
  const hidden = conds.length - visible.length;
  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span className="font-medium text-slate-300" title="The checklist that defines 'truly ready for public use'. The loop works gate by gate until everything is green, then keeps auditing for new problems.">Definition of done — {met} of {conds.length} green</span><span>{pct}%</span>
      </div>
      <Bar value={pct} tone="bg-emerald-500" />
      <div className="mt-2 space-y-1.5">
        {visible.map((c) => { const m = mark(c); return (
          <div key={c.id} className="text-xs">
            <div className="flex items-start gap-2">
              <span className={`${m.cl} mt-0.5 shrink-0`} title={m.say}>{m.i}</span>
              <span className={`flex-1 min-w-0 line-clamp-2 ${c.status === "met" ? "text-slate-500 line-through" : "text-slate-300"}`} title={`${c.say}${c.evidence ? "\n\nEvidence: " + c.evidence : ""}`}>{c.say}</span>
              <span className="flex gap-1 shrink-0">
                {needsYou(c) && <>
                  <button onClick={() => post("condition", { slug: app.id, action: "signoff", id: c.id })} aria-label={`Mark gate met: ${c.say}`} title="I checked it — mark this gate as met" className="px-1.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 focus-visible:ring-2 focus-visible:ring-emerald-400 outline-none">✓</button>
                  <button onClick={() => post("condition", { slug: app.id, action: "reject", id: c.id })} aria-label={`Send gate back: ${c.say}`} title="Not good enough yet — send it back for another attempt" className="px-1.5 rounded bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-slate-400 outline-none">✗</button>
                </>}
                {c.status === "stuck" && (
                  <button onClick={() => post("condition", { slug: app.id, action: "reject", id: c.id })} title="Clear the stuck state and retry this gate right now with a fresh attempt" className="px-1.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 text-[10px]">Retry now</button>
                )}
              </span>
            </div>
            <div className="pl-5 text-[10px] text-slate-600">
              {c.check === "auto" ? "checks itself" : c.check === "human" ? "only you can confirm" : "agent works it, you confirm"}
              {c.source === "loop" ? " · found by the loop" : ""}
              {c.status === "stuck" && c.retryAfter ? ` · auto-retries ${timeAgo(c.retryAfter).includes("ago") ? "soon" : timeAgo(c.retryAfter)}` : ""}
            </div>
          </div>
        ); })}
        {hidden > 0 && <button onClick={() => setShowAll(true)} className="text-[11px] text-indigo-400 hover:text-indigo-300">Show all {conds.length} gates ({hidden} more)</button>}
        {showAll && conds.length > 5 && <button onClick={() => setShowAll(false)} className="text-[11px] text-slate-500 hover:text-slate-300">Collapse</button>}
      </div>
      {(app.suggestions || []).map((g) => (
        <div key={g.id} className="mt-2 flex items-start gap-2 text-xs rounded-lg border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
          <span className="text-amber-300">＋</span>
          <span className="text-slate-300"><span className="text-amber-300/90">Suggested gate:</span> {g.say}{g.why ? <span className="text-slate-500"> — {g.why}</span> : null}</span>
          <span className="flex gap-1 shrink-0 ml-auto">
            <button onClick={() => post("condition", { slug: app.id, action: "accept", id: g.id })} className="px-1.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25">Add</button>
            <button onClick={() => post("condition", { slug: app.id, action: "dismiss", id: g.id })} className="px-1.5 rounded bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700">Dismiss</button>
          </span>
        </div>
      ))}
      {adding ? (
        <div className="mt-2 flex gap-1">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { post("condition", { slug: app.id, action: "add", condition: { say: text.trim(), check: "agent", effort: "M" } }); setText(""); setAdding(false); } }}
            placeholder="Add a gate in plain English…" className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-indigo-500" />
          <button onClick={() => { if (text.trim()) { post("condition", { slug: app.id, action: "add", condition: { say: text.trim(), check: "agent", effort: "M" } }); setText(""); setAdding(false); } }} className="px-2 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-xs">Add</button>
        </div>
      ) : <button onClick={() => setAdding(true)} className="mt-2 text-[11px] text-indigo-400 hover:text-indigo-300">+ add a gate</button>}
    </div>
  );
}
function AutonomyChip({ a, withLabel }) {
  const m = AUTONOMY_META[a] || AUTONOMY_META["branch-approve"]; const Icon = m.icon;
  return <Chip title={m.hint} className={m.cls}><Icon className="w-3 h-3" />{withLabel ? m.label : ""}</Chip>;
}

export default function FleetView() {
  const [apps, setApps] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [onboarding, setOnboarding] = useState(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [fleetPause, setFleetPause] = useState(null);
  const [fleetConfig, setFleetConfig] = useState(null);
  const [lastPass, setLastPass] = useState(null);
  const [current, setCurrent] = useState(null);
  const [connected, setConnected] = useState(null); // null=connecting, true, false
  const [view, setView] = useState("overview");
  const [activeAppId, setActiveAppId] = useState(null);
  const [appTab, setAppTab] = useState("now");
  const [toast, setToast] = useState(null);
  const [query, setQuery] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [soundOn, setSoundOn] = useState(() => { try { return localStorage.getItem("fleetSound") !== "off"; } catch { return true; } });
  const [actionBusy, setActionBusy] = useState(null);
  const prevApprovals = useRef(null);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  // Alert (chime + desktop notification) when the number of items waiting on you rises.
  useEffect(() => {
    const n = approvals.length;
    if (prevApprovals.current !== null && n > prevApprovals.current) { if (soundOn) chime(); notify(n); }
    prevApprovals.current = n;
  }, [approvals.length, soundOn]);

  // Unlock browser audio on the first click anywhere, so later auto-alerts can play.
  useEffect(() => {
    const unlock = () => { getAudio(); window.removeEventListener("pointerdown", unlock); };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const toggleSound = () => {
    const next = !soundOn; setSoundOn(next);
    try { localStorage.setItem("fleetSound", next ? "on" : "off"); } catch {}
    chime(); // always play a test chime so you can hear it works
    flash(next ? "Sound on — you'll hear a chime when something needs you" : "Sound muted");
    if (next) { try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch {} }
  };
  const activeApp = apps.find((a) => a.id === activeAppId) || null;

  const pull = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/state`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setApps(data.apps || []);
      setApprovals(data.approvals || []);
      setMilestones(data.milestones || []);
      setOnboarding(data.onboarding || null);
      if (data.onboarding && data.onboarding.completed === false) setOnboardingOpen(true);
      setFleetConfig(data.fleet || null);
      setFleetPause(data.fleetPause || null);
      setLastPass(data.lastPass || null);
      setCurrent(data.current || null);
      setConnected(true); setUpdatedAt(new Date());
    } catch { setConnected(false); }
  }, []);
  useEffect(() => { pull(); const t = setInterval(pull, 6000); return () => clearInterval(t); }, [pull]);
  const postJson = (path, body) => fetch(`${API}/api/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.ok === false) throw new Error(data.error || data.note || `Request failed (${r.status})`);
    return data;
  });
  const post = (path, body) => postJson(path, body).then(pull).catch((e) => flash(String(e.message || e)));

  const stats = useMemo(() => ({
    running: apps.filter((a) => a.loop === "running").length,
    blocked: apps.filter((a) => a.loop === "blocked").length,
    pending: approvals.length,
    doneTasks: apps.reduce((s, a) => s + a.tasks.filter((t) => t.status === "done").length, 0),
    totalTasks: apps.reduce((s, a) => s + a.tasks.length, 0),
    gatesMet: apps.reduce((s, a) => s + (a.conditions || []).filter((c) => c.status === "met").length, 0),
    gatesTotal: apps.reduce((s, a) => s + (a.conditions || []).length, 0),
  }), [apps, approvals]);

  const filtered = useMemo(() => apps.filter((a) => !query || (a.name + a.purpose + a.stack).toLowerCase().includes(query.toLowerCase())), [apps, query]);

  const toggleLoop = (id) => { const a = apps.find((x) => x.id === id); const next = a.loop === "running" ? "pause" : "resume"; post("loop", { slug: id, action: next }); flash(`${a.name}: ${next === "pause" ? "paused" : "resumed"}`); };
  const runAll = () => { post("loop", { slug: "*", action: "resume" }); flash("All eligible loops started"); };
  const pauseAll = () => { post("loop", { slug: "*", action: "pause" }); flash("All loops paused"); };
  const runNow = async () => {
    if (actionBusy) return;
    setActionBusy("run");
    flash("Running one fleet pass now");
    try {
      const d = await postJson("run", { live: true });
      const summary = (d.results || []).map((r) => `${r.slug}: ${r.action}`).join(", ");
      flash(summary ? `Run finished: ${summary}` : "Run finished");
      await pull();
    } catch (e) { flash(String(e.message || e)); }
    finally { setActionBusy(null); }
  };
  const restartService = async () => {
    if (actionBusy) return;
    setActionBusy("restart");
    flash("Restarting FleetLoops service");
    const nativeRestart = typeof window !== "undefined" ? window.webkit?.messageHandlers?.fleetRestartService : null;
    if (nativeRestart) {
      try {
        nativeRestart.postMessage({});
        setConnected(null);
        setTimeout(() => { pull().finally(() => setActionBusy(null)); }, 3500);
        return;
      } catch {}
    }
    try { await postJson("system", { action: "restart-service" }); }
    catch (e) { flash(String(e.message || e)); setActionBusy(null); return; }
    setConnected(null);
    setTimeout(() => { pull().finally(() => setActionBusy(null)); }, 3500);
  };
  const addTask = (appId) => post("task", { slug: appId, action: "add", task: { id: nid("T"), title: "New task", status: "queued", difficulty: "medium", deps: [], ac: "Define acceptance criteria", files: "—" } });
  const deleteTask = (appId, tid) => {
    const app = apps.find((x) => x.id === appId);
    const task = app?.tasks.find((x) => x.id === tid);
    const label = task?.title || tid;
    if (typeof window !== "undefined" && !window.confirm(`Delete "${label}"? This removes the task from the queue and cannot be undone.`)) return;
    post("task", { slug: appId, action: "delete", taskId: tid });
    flash("Task deleted");
  };
  const updateTask = (appId, tid, patch) => post("task", { slug: appId, action: "update", taskId: tid, patch });
  const moveTask = (appId, tid, dir) => post("task", { slug: appId, action: "move", taskId: tid, dir });
  const resolveApproval = async (item, decision, answer) => {
    try {
      const r = await fetch(`${API}/api/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ appId: item.appId, taskId: item.taskId, decision, answer }) });
      const d = await r.json();
      flash(d.note || (decision === "reject" ? "Rejected" : "Approved"));
    } catch { flash("Action failed — is the service running?"); }
    pull();
  };
  const openApp = (id) => { setActiveAppId(id); setAppTab("now"); };
  const addProjectFromNative = () => {
    const handler = typeof window !== "undefined" ? window.webkit?.messageHandlers?.fleetAddProject : null;
    if (handler) {
      handler.postMessage({});
      flash("Choose a project folder in the macOS prompt");
    } else {
      flash("Use Fleet menu bar → Add Project… in the macOS app");
    }
  };

  if (connected === false && apps.length === 0) return <Disconnected onRetry={pull} onRestartService={restartService} actionBusy={actionBusy} />;
  if (connected === null && apps.length === 0) return <Connecting />;

  return (
    <div className="fleet-night min-h-screen w-full flex text-[13px]">
      <style>{NIGHT_CSS}</style>
      <aside className="night-sidebar shrink-0 border-r border-slate-800 bg-slate-900 flex flex-col sticky top-0 h-screen">
        <div className="px-4 pt-3 pb-2 border-b border-slate-800">
          <div className="flex gap-1.5 mb-3" aria-hidden="true">
            {["#FF5F57", "#FEBC2E", "#28C840"].map((x) => <span key={x} className="w-3 h-3 rounded-full" style={{ background: x }} />)}
          </div>
          <div className="flex items-center gap-2">
          <Boxesish />
          <div><div className="font-display font-bold tracking-tight text-[17px]">FleetLoops</div><div className="font-mono text-[10px] text-slate-500">{apps.length} APPS</div></div>
          <button onClick={toggleSound} title={soundOn ? "Approval sounds on — click to mute" : "Muted — click to enable sounds + alerts"} className="ml-auto text-slate-400 hover:text-slate-200">{soundOn ? <Bell className="w-4 h-4 text-indigo-400" /> : <BellOff className="w-4 h-4" />}</button>
          <span title={connected ? "Live" : "Reconnecting"}>{connected ? <Wifi className="w-4 h-4 text-emerald-400" /> : <WifiOff className="w-4 h-4 text-amber-500" />}</span>
          </div>
        </div>
        <div className="p-2">
          <div className="relative"><Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter apps" className="w-full bg-slate-800 rounded-lg pl-8 pr-2 py-1.5 text-xs border border-slate-700 focus:border-indigo-500 focus:outline-none" /></div>
        </div>
        <nav className="px-2 space-y-0.5">
          <SideItem active={view === "overview"} onClick={() => setView("overview")} icon={LayoutGrid} label="Fleet Overview" />
          <SideItem active={view === "approvals"} onClick={() => setView("approvals")} icon={Inbox} label="Approvals" badge={approvals.length} />
          <SideItem active={view === "trust"} onClick={() => setView("trust")} icon={ShieldCheck} label="Trust &amp; autopilot" />
          <SideItem active={view === "providers"} onClick={() => setView("providers")} icon={SlidersHorizontal} label="Settings" />
          <SideItem active={view === "cost"} onClick={() => setView("cost")} icon={Wallet} label="Cost" />
        </nav>
        <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Apps ({filtered.length})</div>
        <div className="night-sidebar-apps px-2 pb-3 space-y-0.5 overflow-y-auto">
          {filtered.map((a) => (
            <button key={a.id} onClick={() => openApp(a.id)} className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors ${activeAppId === a.id ? "night-active text-indigo-300" : "hover:bg-slate-800 text-slate-300"}`}>
              <span className={`w-2 h-2 rounded-full ${LOOP_STATES[a.loop]?.dot || "bg-slate-500"}`} /><span className="truncate">{a.name}</span>
            </button>
          ))}
        </div>
        <div className="mt-auto p-3 border-t border-slate-800 flex gap-2">
          <button onClick={runAll} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500"><Play className="w-3.5 h-3.5" /> Run all</button>
          <button onClick={pauseAll} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"><Pause className="w-3.5 h-3.5" /> Pause all</button>
        </div>
        <div className="px-3 pb-3">
          <button onClick={() => { postJson("onboarding", { action: "reset" }).then((d) => { setOnboarding(d.onboarding); setOnboardingOpen(true); pull(); }).catch((e) => flash(String(e.message || e))); }} className="w-full text-[11px] text-slate-500 hover:text-slate-300 text-left">Restart onboarding…</button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        {view === "overview" && <Overview stats={stats} apps={filtered} onToggle={toggleLoop} onOpen={openApp} connected={connected} updatedAt={updatedAt} onRefresh={pull} post={post} fleetPause={fleetPause} lastPass={lastPass} current={current} milestones={milestones} onGoApprovals={() => setView("approvals")} onResume={() => { post("loop", { slug: "*", action: "resume" }); flash("Resumed — the fleet picks up on the next tick"); }} onboardingIncomplete={onboarding && onboarding.completed === false} onOpenOnboarding={() => setOnboardingOpen(true)} onRunNow={runNow} onRestartService={restartService} actionBusy={actionBusy} />}
        {view === "approvals" && <Approvals approvals={approvals} apps={apps} onResolve={resolveApproval} onOpen={openApp} />}
        {view === "trust" && <TrustPanel flash={flash} />}
        {view === "providers" && <SettingsPanel apps={apps} fleet={fleetConfig} flash={flash} pull={pull} setFleetConfig={setFleetConfig} />}
        {view === "cost" && <CostPanel />}
      </main>

      {activeApp && <AppDrawer app={activeApp} tab={appTab} setTab={setAppTab} post={post} onClose={() => setActiveAppId(null)} onToggle={toggleLoop} onStop={() => { post("loop", { slug: activeApp.id, action: "stop" }); flash(`${activeApp.name}: stopped`); }} onAddTask={addTask} onDeleteTask={deleteTask} onUpdateTask={updateTask} onMoveTask={moveTask} />}
      {onboardingOpen && onboarding && onboarding.completed === false && (
        <OnboardingModal
          onboarding={onboarding}
          apps={apps}
          postJson={postJson}
          pull={pull}
          flash={flash}
          onClose={() => setOnboardingOpen(false)}
          onDone={() => { setOnboardingOpen(false); setView("overview"); pull(); }}
        />
      )}
      {toast && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-white text-slate-900 text-sm px-4 py-2 rounded-lg shadow-lg z-50 font-medium">{toast}</div>}
    </div>
  );
}

function Boxesish() {
  return <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-950/40" aria-hidden="true">
    <div className="grid grid-cols-2 gap-0.5">
      <span className="w-2.5 h-2.5 rounded-[3px] bg-white/95" />
      <span className="w-2.5 h-2.5 rounded-[3px] bg-white/65" />
      <span className="w-2.5 h-2.5 rounded-[3px] bg-white/65" />
      <span className="w-2.5 h-2.5 rounded-[3px] border border-white/90 relative"><span className="absolute left-1/2 top-0.5 bottom-0.5 w-px bg-white/90 -translate-x-1/2" /><span className="absolute top-1/2 left-0.5 right-0.5 h-px bg-white/90 -translate-y-1/2" /></span>
    </div>
  </div>;
}

function Connecting() {
  return <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center gap-3"><div className="w-5 h-5 border-2 border-slate-700 border-t-indigo-500 rounded-full animate-spin" />Connecting to the fleet service…</div>;
}
function Disconnected({ onRetry, onRestartService, actionBusy }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <PlugZap className="w-12 h-12 mx-auto mb-4 text-amber-500" />
        <div className="text-lg font-semibold">Fleet service isn't running</div>
        <p className="text-sm text-slate-400 mt-2">FleetLoops only shows real loop state. Reopen the app or use the FleetLoops menu bar item to restart the service, then retry.</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button onClick={onRestartService} disabled={!!actionBusy} className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"><RefreshCw className="w-4 h-4" />Restart service</button>
          <button onClick={onRetry} className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"><Wifi className="w-4 h-4" />Retry</button>
        </div>
      </div>
    </div>
  );
}

function SideItem({ active, onClick, icon: Icon, label, badge }) {
  return <button onClick={onClick} className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${active ? "night-active text-indigo-300 font-medium" : "hover:bg-slate-800 text-slate-300"}`}><Icon className="w-4 h-4" /><span>{label}</span>{badge > 0 && <span className="ml-auto text-[11px] bg-rose-500 text-white rounded-full px-1.5 py-0.5">{badge}</span>}</button>;
}

function Overview({ stats, apps, onToggle, onOpen, connected, updatedAt, onRefresh, post, fleetPause, lastPass, current, milestones, onGoApprovals, onResume, onboardingIncomplete, onOpenOnboarding, onRunNow, onRestartService, actionBusy }) {
  // HEARTBEAT v2: per-app completions, plus what the tick is doing right now. A single app's
  // real agent run can take an hour — that's "working", not "stalled". Alarm ONLY when nothing
  // has completed recently AND nothing is in flight (or one app has hogged >95 min).
  const stepAge = lastPass ? (Date.now() - Date.parse(lastPass.at)) / 60000 : null;
  const curAge = current ? (Date.now() - Date.parse(current.since)) / 60000 : null;
  const stalled = connected && !current && stepAge !== null && stepAge > 40;
  const hogging = connected && current && curAge > 95;
  return (
    <>
      <Header title="Fleet Overview" subtitle="Every app, what it's doing right now, and what's waiting on you" right={
        <div className="flex items-center gap-3">
          {current && <span className="text-[11px] text-emerald-400/90 inline-flex items-center gap-1" title={`since ${current.since}`}><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />working: {current.app} · {Math.max(1, Math.round(curAge))} min</span>}
          {!current && lastPass && <span className={`text-[11px] ${stepAge > 40 ? "text-amber-400" : "text-slate-500"}`} title={lastPass.at}>last step: {lastPass.app} {timeAgo(lastPass.at)}{lastPass.live ? "" : " (dry-run)"}</span>}
          <button onClick={onRunNow} disabled={!!actionBusy} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"><Play className="w-3.5 h-3.5" />{actionBusy === "run" ? "Running" : "Run now"}</button>
          <button onClick={onRestartService} disabled={!!actionBusy} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40"><RefreshCw className="w-3.5 h-3.5" />Restart service</button>
          <LiveTag connected={connected} updatedAt={updatedAt} onRefresh={onRefresh} />
        </div>
      } />
      <div className="p-4 sm:p-6 overflow-y-auto">
        {onboardingIncomplete && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-3.5" role="status">
            <WandSparkles className="w-5 h-5 text-indigo-300 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <div className="font-semibold text-indigo-100">Finish first-run setup before live work starts</div>
              <div className="text-indigo-100/75 mt-0.5">Connect an agent, add or create a project, approve its brain, define done gates, then launch.</div>
            </div>
            <button onClick={onOpenOnboarding} className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-500 text-white hover:bg-indigo-400">Open setup</button>
          </div>
        )}
        {(stalled || hogging) && !fleetPause && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5" role="alert">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <div className="font-semibold text-amber-200">{hogging ? `One pass has been working on ${current.app} for ${Math.round(curAge)} minutes` : `Nothing has finished ${stepAge === null ? "since the service started" : `in ${Math.round(stepAge)} minutes`} and nothing is running`}</div>
              <div className="text-amber-200/80 mt-0.5">{hogging ? "Long runs can be legitimate, but past ~95 minutes the safest recovery is an app-controlled service restart." : "The scheduler looks wedged. Restart the service from here; interrupted work is recovered automatically."}</div>
            </div>
            <button onClick={onRestartService} disabled={!!actionBusy} className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 hover:bg-amber-300 disabled:opacity-40">Restart service</button>
          </div>
        )}
        {fleetPause && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5" role="alert">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <div className="font-semibold text-amber-200">The whole fleet is paused</div>
              <div className="text-amber-200/80 mt-0.5">{fleetPause.reason || "Paused"} {fleetPause.at && <span className="text-amber-200/50">· {timeAgo(fleetPause.at)}</span>}</div>
            </div>
            <button onClick={onResume} className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-400 text-slate-900 hover:bg-amber-300">I fixed it — resume</button>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat icon={Zap} label="Working right now" sub={current ? `on ${current.app} · ${Math.max(1, Math.round((Date.now() - Date.parse(current.since)) / 60000))} min` : lastPass ? `idle between passes · last: ${lastPass.app}` : "starting up"} value={stats.running} tone="text-emerald-400" />
          <Stat icon={Inbox} label="Need your attention" sub="decisions + reviews — click to open" value={stats.pending} tone="text-violet-400" onClick={onGoApprovals} />
          <Stat icon={ShieldCheck} label="Definition-of-done gates" sub="proven ready, fleet-wide" value={stats.gatesTotal ? `${stats.gatesMet}/${stats.gatesTotal}` : "—"} tone="text-emerald-400" />
          <Stat icon={ListChecks} label="Tasks completed" sub="of everything planned so far" value={`${stats.doneTasks}/${stats.totalTasks}`} tone="text-indigo-400" />
        </div>
        {apps.length === 0 ? <EmptyPanel icon={FolderGit2} title="No projects in FleetLoops yet" body={onboardingIncomplete ? "Use the setup flow to connect an agent and add your first project. The dashboard stays empty until a real project is persisted." : "Add a real project to start the loop. FleetLoops does not show demo apps."} /> : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {apps.map((a) => {
              const total = a.tasks.length, done = a.tasks.filter((t) => t.status === "done").length;
              const human = a.tasks.filter((t) => t.status === "needs-human").length;
              const review = a.tasks.filter((t) => t.status === "review").length;
              const pct = total ? Math.round((done / total) * 100) : 0;
              const current = a.tasks.find((t) => t.status === "running");
              const s = LOOP_STATES[a.loop] || LOOP_STATES.idle;
              const ready = a.tasks.some((t) => t.status === "queued" && (t.deps || []).every((d) => (a.tasks.find((x) => x.id === d) || {}).status === "done"));
              const allDone = a.tasks.length > 0 && a.tasks.every((t) => t.status === "done");
              // derived, human label: distinguishes actually-working from idle/up-to-date
              let dl = s, dlabel = s.label;
              if (a.loop === "running") {
                if (current) { dlabel = "Working"; dl = LOOP_STATES.running; }
                else if (allDone) { dlabel = "Production-ready"; dl = { dot: "bg-blue-500", chip: "bg-blue-500/10 text-blue-300 border-blue-500/30" }; }
                else if (ready) { dlabel = "Ready — next run picks up"; dl = LOOP_STATES.running; }
                else if (human > 0) { dlabel = "Waiting on you"; dl = { dot: "bg-violet-500", chip: "bg-violet-500/10 text-violet-300 border-violet-500/30" }; }
                else { dlabel = "Idle"; dl = LOOP_STATES.idle; }
              }
              return (
                <div key={a.id} className="night-card rounded-xl p-4 hover:border-slate-700 transition-colors flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <button onClick={() => onOpen(a.id)} className="text-left"><div className="font-semibold tracking-tight hover:text-indigo-300">{a.name}</div><div className="text-xs text-slate-400 mt-0.5">{a.purpose}</div></button>
                    <Chip className={dl.chip}><span className={`w-1.5 h-1.5 rounded-full ${dl.dot} ${dlabel === "Working" ? "animate-pulse" : ""}`} />{dlabel}</Chip>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <AutonomyChip a={a.autonomy} withLabel />
                    {a.autonomyEarned > 0 && <Chip title="This app earned a higher autonomy level through a streak of clean, approved merges" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30">🏅 promoted</Chip>}
                    <Chip title={(DEPLOY_META[a.deployPolicy] || DEPLOY_META.none).hint} className="bg-slate-800 text-slate-400 border-slate-700"><Rocket className="w-3 h-3" />{(DEPLOY_META[a.deployPolicy] || DEPLOY_META.none).label}</Chip>
                    {a.adapter === "manual" && <Chip title="Loop only generates prompts — not calling an agent yet" className="bg-slate-800 text-slate-500 border-slate-700">manual</Chip>}
                  </div>
                  <div className="mt-3 text-xs text-slate-400 flex items-center gap-1.5 truncate">
                    {(() => {
                      if (current) return <><span className={`w-1.5 h-1.5 rounded-full ${LOOP_STATES.running.dot} animate-pulse`} />Working: {current.title}</>;
                      const nextT = a.tasks.find((t) => t.status === "queued" && (t.deps || []).every((d) => (a.tasks.find((x) => x.id === d) || {}).status === "done"));
                      if (nextT) return <><Circle className="w-3 h-3 text-indigo-400" />Next up: {nextT.title}</>;
                      if (allDone) return <><CheckCircle2 className="w-3 h-3 text-blue-400" />Production-ready — every gate signed off ✓</>;
                      if (human > 0) return <><Inbox className="w-3 h-3 text-violet-400" />Waiting on your decision</>;
                      return <><Circle className="w-3 h-3" />No ready work (blocked/paused)</>;
                    })()}
                  </div>
                  {/* ONE primary progress signal: gates when the app has them (they ARE the
                      definition of done); otherwise the backlog bar with distance-to-graduation. */}
                  {(a.conditions || []).length > 0 ? (
                    total > 0 && <div className="mt-2 text-[11px] text-slate-500">Backlog: {done} of {total} tasks done{total - done > 0 ? ` · ${total - done} left` : " · all done"}</div>
                  ) : (
                    <>
                      <div className="mt-3"><div className="flex justify-between text-xs text-slate-400 mb-1"><span>{done} of {total} tasks done</span><span>{pct}%</span></div><Bar value={pct} /></div>
                      {total > 0 && (
                        <div className="mt-2 text-[11px] text-slate-500" title="When every backlog task is finished, the planner proposes a definition-of-done checklist (gates) and keeps auditing this app — like ExampleApp's card.">
                          🎓 {total - done === 0 ? "Graduating to the definition-of-done checklist…" : `${total - done} task${total - done === 1 ? "" : "s"} to graduation (then gates + continuous audits take over)`}
                        </div>
                      )}
                    </>
                  )}
                  {a.loopPhase && PHASE_LABEL[a.loopPhase] && (
                    <div className={`mt-2 text-xs ${PHASE_LABEL[a.loopPhase].cls}`}>{PHASE_LABEL[a.loopPhase].text}</div>
                  )}
                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                    <span>{STAGE_LABEL[a.stage] || a.stage}</span>
                    {review > 0 && <Chip className="ml-auto bg-cyan-500/10 text-cyan-300 border-cyan-500/30">{review} ready for review</Chip>}
                    {human > 0 && <Chip className={`${review ? "" : "ml-auto"} bg-violet-500/10 text-violet-300 border-violet-500/30`}>{human} need you</Chip>}
                  </div>
                  <GateChecklist app={a} post={post} />
                  <CardStream app={a} />
                  <div className="mt-4 flex gap-2">
                    {a.loop === "blocked" ? (
                      <button onClick={() => { post("loop", { slug: a.id, action: "resume" }); }} title="This app was parked on a big decision. If that's been resolved, unblock it and the loop starts working it again on the next pass." className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/10"><Play className="w-3.5 h-3.5" />Unblock &amp; resume</button>
                    ) : (
                      <button onClick={() => onToggle(a.id)} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800">{a.loop === "running" ? <><Pause className="w-3.5 h-3.5" />Pause</> : <><Play className="w-3.5 h-3.5" />Resume</>}</button>
                    )}
                    <button onClick={() => onOpen(a.id)} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-lg bg-white text-slate-900 hover:bg-slate-200">Open</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {/* Recent wins — outcomes inline, replacing the old standalone Milestones page */}
        {(milestones || []).length > 0 && (
          <div className="mt-8">
            <div className="text-sm font-semibold text-slate-300 mb-2">Recent wins <span className="text-slate-500 font-normal">· {milestones.length} finished so far</span></div>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2">
              {milestones.slice(-6).reverse().map((x, i) => (
                <button key={i} onClick={() => onOpen(x.appId)} className="flex items-start gap-2.5 text-left bg-slate-900 rounded-xl border border-slate-800 hover:border-slate-700 p-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-xs text-slate-200 line-clamp-2">{x.plainSummary || x.title}</span>
                    <span className="block text-[10px] text-slate-500 mt-0.5">{x.appName}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const APPROVAL_ICON = {
  decision: { icon: Edit3, tone: "text-violet-300 bg-violet-500/10" }, review: { icon: ListChecks, tone: "text-cyan-300 bg-cyan-500/10" },
  merge: { icon: GitMerge, tone: "text-emerald-300 bg-emerald-500/10" }, destructive: { icon: ShieldAlert, tone: "text-rose-300 bg-rose-500/10" },
};
function Approvals({ approvals, apps, onResolve, onOpen }) {
  return (
    <>
      <Header title="Approvals" subtitle="The fleet handles everything else — these are the only things waiting on you" />
      <div className="p-6 overflow-y-auto">
        {approvals.length === 0 ? (
          <div className="text-center py-20 text-slate-500"><CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-500" /><div className="font-medium text-slate-300">Inbox zero</div><div className="text-sm">Nothing needs you — the fleet keeps working on its own.</div></div>
        ) : (
          <div className="space-y-3 max-w-3xl">
            {approvals.map((a) => <ApprovalCard key={a.id} a={a} app={apps.find((x) => x.id === a.appId)} onResolve={onResolve} onOpen={onOpen} />)}
          </div>
        )}
      </div>
    </>
  );
}

function WhatHappens({ rows }) {
  return (
    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-2">
      <div className="text-xs font-semibold text-slate-300">What happens when you click</div>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2 text-xs">
          <span className={`shrink-0 mt-0.5 font-medium ${r.tone}`}>{r.btn}</span>
          <div className="text-slate-400"><span className="text-slate-300">{r.does}</span>{r.ex && <div className="text-slate-500 mt-0.5">Example: {r.ex}</div>}</div>
        </div>
      ))}
    </div>
  );
}

// TRUST & AUTOPILOT — auto-approval rules keyed on CATEGORIES OF WORK (what you actually
// trust), learned from your decision history. Hard floors are listed in the panel and
// enforced server-side: live apps, human-only gates, safety flags, and reviewer objections
// are NEVER auto-approved — a rule only replaces your signature when everything else passed.
function TrustPanel({ flash }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => fetch(`${API}/api/trust`, { cache: "no-store" }).then((r) => r.json()).then(setData).catch(() => setData({ rules: [], categories: [] })), []);
  useEffect(() => { load(); }, [load]);
  const setRule = (action, key) => fetch(`${API}/api/trust`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, key }) }).then(() => { flash(action === "enable" ? "Autopilot ON for this kind of work" : "Back to manual approval"); load(); });
  if (!data) return <div className="p-10 text-slate-500">Loading…</div>;
  const ruleOn = (k) => (data.rules || []).some((r) => r.enabled && r.key === k);
  const cats = [...(data.categories || [])].sort((a, b) => (b.approves + b.autos) - (a.approves + a.autos));
  const pretty = (k) => k.split("-").join(" ");
  return (
    <>
      <Header title="Trust &amp; autopilot" subtitle="Teach the fleet which kinds of work no longer need your signature" />
      <div className="p-6 overflow-y-auto max-w-3xl">
        <div className="mb-5 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
          <div className="font-semibold text-slate-200 mb-1">How this works</div>
          Every decision you make is remembered by the <span className="text-slate-100">kind of work</span> it was — an accessibility audit, a design-contract check — not the button you clicked. Turn autopilot on for a category and the fleet signs those for you <span className="text-slate-100">after</span> tests pass and all AI reviewers approve.
          <div className="mt-2 text-xs text-slate-500">Never auto-approved, no matter what: live apps with real users · gates only you can confirm (payments, store identity) · anything flagged for secrets/migrations/payment safety · anything a reviewer objected to. Every autopilot action is logged and notified — and you can switch any category back to manual here, anytime.</div>
        </div>
        {cats.length === 0 && <div className="text-slate-500 text-sm py-10 text-center">No decision history yet. As you approve things in Approvals, the kinds of work you approve show up here with an autopilot toggle.</div>}
        <div className="space-y-2">
          {cats.map((c) => {
            const on = ruleOn(c.key);
            const suggested = !on && c.approves >= 3 && c.rejects === 0;
            return (
              <div key={c.key} className={`flex items-center gap-3 rounded-xl border p-3.5 ${on ? "border-emerald-500/30 bg-emerald-500/5" : suggested ? "border-indigo-500/30 bg-indigo-500/5" : "border-slate-800 bg-slate-900"}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-100 capitalize">{pretty(c.key)}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    you approved ×{c.approves}{c.autos ? ` · autopilot ×${c.autos}` : ""}{c.rejects ? ` · rejected ×${c.rejects}` : ""}{c.sendBacks ? ` · sent back ×${c.sendBacks}` : ""} · {c.apps.length} app{c.apps.length === 1 ? "" : "s"}{c.last ? ` · last ${timeAgo(c.last)}` : ""}
                    {suggested && <span className="text-indigo-300"> · looks routine — consider autopilot</span>}
                  </div>
                </div>
                {on ? (
                  <button onClick={() => setRule("disable", c.key)} className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25" title="Autopilot is ON — click to go back to manual approval">Autopilot ON · turn off</button>
                ) : (
                  <button onClick={() => setRule("enable", c.key)} className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800" title="The fleet will sign this kind of work for you (after tests + reviewers pass)">Turn autopilot on</button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function SettingsPanel({ apps, fleet, flash, pull, setFleetConfig }) {
  const [tab, setTab] = useState("agents");
  const tabs = [
    { id: "agents", label: "Agents & keys", icon: Key },
    { id: "routing", label: "Routing", icon: Route },
    { id: "limits", label: "Spend & limits", icon: Gauge },
    { id: "schedule", label: "Schedule", icon: CalendarClock },
    { id: "notifications", label: "Notifications", icon: BellRing },
  ];
  return (
    <>
      <Header title="Settings" subtitle="Agent access, per-app routing, spend caps, scheduler controls, and notifications" />
      <div className="p-6 overflow-y-auto max-w-5xl">
        <div className="flex flex-wrap gap-1 border-b border-slate-800 mb-5">
          {tabs.map((t) => <Tab key={t.id} active={tab === t.id} onClick={() => setTab(t.id)} icon={t.icon} label={t.label} />)}
        </div>
        {tab === "agents" && <ProvidersPanel flash={flash} embedded />}
        {tab === "routing" && <RoutingSettings apps={apps} fleet={fleet} flash={flash} pull={pull} setFleetConfig={setFleetConfig} />}
        {tab === "limits" && <FleetLimits fleet={fleet} flash={flash} setFleetConfig={setFleetConfig} />}
        {tab === "schedule" && <FleetSchedule fleet={fleet} flash={flash} setFleetConfig={setFleetConfig} />}
        {tab === "notifications" && <FleetNotifications fleet={fleet} flash={flash} setFleetConfig={setFleetConfig} />}
      </div>
    </>
  );
}

function saveFleetConfig(patch, flash, setFleetConfig) {
  return fetch(`${API}/api/fleet-config`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) })
    .then((r) => r.json())
    .then((d) => {
      if (!d.ok) throw new Error(d.error || "save failed");
      setFleetConfig?.(d.fleet);
      flash("Settings saved");
      return d.fleet;
    })
    .catch((e) => { flash(String(e.message || e)); throw e; });
}

function RoutingSettings({ apps, fleet, flash, pull, setFleetConfig }) {
  const [providers, setProviders] = useState(null);
  const [draft, setDraft] = useState({});
  const [fleetRoute, setFleetRoute] = useState(fleet?.routing || { routine: "ollama", standard: "codex", risky: "openai", fallback: ["codex", "openai", "anthropic"] });
  useEffect(() => { fetch(`${API}/api/providers`, { cache: "no-store" }).then((r) => r.json()).then((d) => setProviders(d.providers || [])).catch(() => setProviders([])); }, []);
  useEffect(() => { if (fleet?.routing) setFleetRoute(fleet.routing); }, [fleet]);
  useEffect(() => {
    const next = {};
    for (const app of apps) next[app.id] = {
      providerId: app.config?.providerId || "",
      providerModel: app.config?.providerModel || app.model || "",
      reasoning: app.config?.reasoning || app.reasoning || "medium",
      dailyUsd: app.config?.budget?.dailyUsd || "",
      monthlyUsd: app.config?.budget?.monthlyUsd || "",
    };
    setDraft(next);
  }, [apps]);
  if (!providers) return <div className="p-10 text-slate-500">Loading routing…</div>;
  const providerById = Object.fromEntries(providers.map((p) => [p.id, p]));
  const update = (id, patch) => setDraft((d) => ({ ...d, [id]: { ...(d[id] || {}), ...patch } }));
  const saveFleetRouting = () => saveFleetConfig({ routing: fleetRoute }, flash, setFleetConfig);
  const save = (app) => {
    const d = draft[app.id] || {};
    return fetch(`${API}/api/app-config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: app.id, providerId: d.providerId, providerModel: d.providerModel, reasoning: d.reasoning, budget: { dailyUsd: d.dailyUsd, monthlyUsd: d.monthlyUsd } }),
    }).then((r) => r.json()).then((out) => {
      if (!out.ok) throw new Error(out.error || "save failed");
      flash(`${app.name}: routing saved`);
      pull();
    }).catch((e) => flash(`${app.name}: ${String(e.message || e)}`));
  };
  return (
    <div className="space-y-3">
      <Section title="Route by difficulty" hint="Routine gates can use a cheap/local provider; risky work gets the strongest provider. Fallback chain is used when a provider is unavailable.">
        <div className="grid md:grid-cols-3 gap-3">
          {[
            ["routine", "Routine gates"],
            ["standard", "Standard work"],
            ["risky", "Hard / risky"],
          ].map(([key, label]) => <label key={key} className="text-xs text-slate-500">{label}
            <select value={fleetRoute[key] || ""} onChange={(e) => setFleetRoute((r) => ({ ...r, [key]: e.target.value }))} className="mt-1 w-full rounded-lg px-2 py-2 text-sm">
              {providers.map((p) => <option key={p.id} value={p.id}>{p.label}{p.connected || p.auth === "none-local" ? "" : " (not connected)"}</option>)}
            </select>
          </label>)}
        </div>
        <label className="block text-xs text-slate-500 mt-3">Fallback chain
          <input value={(fleetRoute.fallback || []).join(", ")} onChange={(e) => setFleetRoute((r) => ({ ...r, fallback: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }))} className="mt-1 w-full rounded-lg px-2 py-2 text-sm font-mono" />
        </label>
        <button onClick={saveFleetRouting} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"><Check className="w-4 h-4" />Save difficulty routing</button>
      </Section>
      {apps.length === 0 && <EmptyPanel icon={Route} title="No apps to route yet" body="Add a project from the macOS menu bar first. Routing appears here as soon as the bridge has a real app config." />}
      {apps.map((app) => {
        const d = draft[app.id] || {};
        const selected = providerById[d.providerId] || null;
        return (
          <div key={app.id} className="night-card rounded-xl p-4">
            <div className="flex items-start gap-4 flex-wrap">
              <div className="min-w-56 flex-1">
                <div className="font-medium text-slate-100">{app.name}</div>
                <div className="text-xs text-slate-500 mt-0.5 truncate">{app.repo}</div>
              </div>
              <label className="text-xs text-slate-500 min-w-48">Provider
                <select value={d.providerId} onChange={(e) => {
                  const p = providerById[e.target.value];
                  update(app.id, { providerId: e.target.value, providerModel: p?.defaultModel || d.providerModel || "" });
                }} className="mt-1 w-full rounded-lg px-2 py-2 text-sm">
                  <option value="">Use legacy app adapter</option>
                  {providers.map((p) => <option key={p.id} value={p.id}>{p.label}{p.connected ? "" : " (not connected)"}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-500 min-w-48">Model
                {selected?.models?.length ? (
                  <select value={d.providerModel || selected.defaultModel || ""} onChange={(e) => update(app.id, { providerModel: e.target.value })} className="mt-1 w-full rounded-lg px-2 py-2 text-sm">
                    {selected.defaultModel && <option value={selected.defaultModel}>{selected.defaultModel} (default)</option>}
                    {selected.models.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input value={d.providerModel || ""} onChange={(e) => update(app.id, { providerModel: e.target.value })} placeholder={selected?.defaultModel || "provider default"} className="mt-1 w-full rounded-lg px-2 py-2 text-sm" />
                )}
              </label>
              <label className="text-xs text-slate-500 min-w-36">Reasoning
                <select value={d.reasoning || "medium"} onChange={(e) => update(app.id, { reasoning: e.target.value })} className="mt-1 w-full rounded-lg px-2 py-2 text-sm">
                  <option value="low">Fast</option><option value="medium">Balanced</option><option value="high">Deep</option>
                </select>
              </label>
            </div>
            <div className="grid sm:grid-cols-3 gap-3 mt-3 items-end">
              <label className="text-xs text-slate-500">Daily API cap
                <input type="number" min="0" step="0.01" value={d.dailyUsd} onChange={(e) => update(app.id, { dailyUsd: e.target.value })} placeholder="No cap" className="mt-1 w-full rounded-lg px-2 py-2 text-sm" />
              </label>
              <label className="text-xs text-slate-500">Monthly API cap
                <input type="number" min="0" step="0.01" value={d.monthlyUsd} onChange={(e) => update(app.id, { monthlyUsd: e.target.value })} placeholder="No cap" className="mt-1 w-full rounded-lg px-2 py-2 text-sm" />
              </label>
              <div className="flex items-center gap-3">
                <button onClick={() => save(app)} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"><Check className="w-3.5 h-3.5" />Save route</button>
                {selected && !selected.connected && selected.auth !== "none-local" && <span className="text-xs text-amber-300">Connect this provider in Agents & keys before live runs.</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FleetLimits({ fleet, flash, setFleetConfig }) {
  const [draft, setDraft] = useState(() => fleet || {});
  useEffect(() => { if (fleet) setDraft(fleet); }, [fleet]);
  if (!draft) return <div className="p-10 text-slate-500">Loading limits…</div>;
  const patch = (p) => setDraft((d) => ({ ...d, ...p }));
  const save = () => saveFleetConfig(draft, flash, setFleetConfig);
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Section title="Parallel app limit" hint="How many apps can work at the same time. Scheduler restart applies this value.">
        <RangeField label="Concurrent apps" value={draft.maxConcurrentLoops || 3} min="1" max="12" onChange={(v) => patch({ maxConcurrentLoops: Number(v) })} />
        <div className="grid grid-cols-2 gap-3 mt-3">
          <NumberField label="Sweep minutes" value={draft.intervalMinutes} onChange={(v) => patch({ intervalMinutes: v })} min="1" />
          <NumberField label="Max unattended hours" value={draft.maxUnattendedHours} onChange={(v) => patch({ maxUnattendedHours: v })} min="1" />
        </div>
      </Section>
      <Section title="Fleet API spend cap" hint="Raw-API providers only. Live scheduled work pauses when the cap is reached; CLI subscriptions are not metered here.">
        <RangeField label="Daily USD cap" value={draft.budget?.dailyUsd || 0} min="0" max="500" onChange={(v) => patch({ budget: { ...(draft.budget || {}), dailyUsd: Number(v) } })} suffix="$" />
        <RangeField label="Warn early" value={draft.budget?.alertPct || 80} min="10" max="100" onChange={(v) => patch({ budget: { ...(draft.budget || {}), alertPct: Number(v) } })} suffix="%" />
        <div className="mt-3">
          <NumberField label="Monthly USD cap" value={draft.budget?.monthlyUsd || ""} onChange={(v) => patch({ budget: { ...(draft.budget || {}), monthlyUsd: v } })} min="0" step="0.01" />
        </div>
      </Section>
      <div className="lg:col-span-2"><button onClick={save} className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"><Check className="w-4 h-4" />Save limits</button></div>
    </div>
  );
}

function RangeField({ label, value, min, max, onChange, suffix = "" }) {
  return <label className="block text-xs text-slate-500">{label}<div className="mt-1 flex items-center gap-3"><input type="range" min={min} max={max} value={value ?? 0} onChange={(e) => onChange(e.target.value)} className="flex-1" /><span className="font-mono text-sm text-slate-200 min-w-12 text-right">{suffix === "$" ? `$${value || 0}` : `${value || 0}${suffix}`}</span></div></label>;
}

function FleetSchedule({ fleet, flash, setFleetConfig }) {
  const [quiet, setQuiet] = useState(fleet?.quietHours || { enabled: false, start: "22:00", end: "07:00" });
  const [drain, setDrain] = useState(fleet?.schedule?.overnightDrain || { enabled: false, start: "22:30", end: "06:30" });
  useEffect(() => { if (fleet?.quietHours) setQuiet(fleet.quietHours); if (fleet?.schedule?.overnightDrain) setDrain(fleet.schedule.overnightDrain); }, [fleet]);
  const save = () => saveFleetConfig({ quietHours: quiet, schedule: { overnightDrain: drain } }, flash, setFleetConfig);
  return (
    <div className="max-w-3xl space-y-4">
      <Section title="Drain backlog overnight" hint="When enabled, scheduled live sweeps run only inside this local-time window. Manual Run buttons still work.">
        <div className="flex items-center justify-between gap-4">
          <div><div className="text-sm font-medium text-slate-100">Overnight backlog drain</div><div className="text-xs text-slate-500 mt-0.5">Use this when you want the fleet to work after hours and review in the morning.</div></div>
          <ToggleSwitch on={drain.enabled} onClick={() => setDrain((q) => ({ ...q, enabled: !q.enabled }))} />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <label className="text-xs text-slate-500">Start<input type="time" value={drain.start} onChange={(e) => setDrain((q) => ({ ...q, start: e.target.value }))} className="mt-1 w-full rounded-lg px-2 py-2 text-sm" /></label>
          <label className="text-xs text-slate-500">End<input type="time" value={drain.end} onChange={(e) => setDrain((q) => ({ ...q, end: e.target.value }))} className="mt-1 w-full rounded-lg px-2 py-2 text-sm" /></label>
        </div>
      </Section>
      <Section title="Quiet hours" hint="When enabled, the bridge skips scheduled sweeps during this local-time window. Manual Run buttons still work.">
        <div className="flex items-center justify-between gap-4">
          <div><div className="text-sm font-medium text-slate-100">Skip scheduled loops overnight</div><div className="text-xs text-slate-500 mt-0.5">Use this when you want morning review batches without unattended overnight changes.</div></div>
          <ToggleSwitch on={quiet.enabled} onClick={() => setQuiet((q) => ({ ...q, enabled: !q.enabled }))} />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <label className="text-xs text-slate-500">Start<input type="time" value={quiet.start} onChange={(e) => setQuiet((q) => ({ ...q, start: e.target.value }))} className="mt-1 w-full rounded-lg px-2 py-2 text-sm" /></label>
          <label className="text-xs text-slate-500">End<input type="time" value={quiet.end} onChange={(e) => setQuiet((q) => ({ ...q, end: e.target.value }))} className="mt-1 w-full rounded-lg px-2 py-2 text-sm" /></label>
        </div>
      </Section>
      <button onClick={save} className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"><Check className="w-4 h-4" />Save schedule</button>
    </div>
  );
}

function FleetNotifications({ fleet, flash, setFleetConfig }) {
  const [draft, setDraft] = useState(fleet?.notifications || { desktop: true, email: false, mobile: false, webhook: "", categories: { needs: true, review: true, stuck: true, cap: true, win: true } });
  useEffect(() => { if (fleet?.notifications) setDraft(fleet.notifications); }, [fleet]);
  const save = () => saveFleetConfig({ notifications: draft }, flash, setFleetConfig);
  const cats = [
    ["needs", "Needs decision"],
    ["review", "Review ready"],
    ["stuck", "Stuck"],
    ["cap", "Spend threshold"],
    ["win", "Graduated / win"],
  ];
  const setCat = (key) => setDraft((d) => ({ ...d, categories: { ...(d.categories || {}), [key]: !(d.categories || {})[key] } }));
  return (
    <div className="max-w-3xl space-y-4">
      <Section title="Channels" hint="Desktop is live today. Email and mobile preferences are persisted for integrations without faking delivery.">
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            ["desktop", "Desktop"],
            ["email", "Email"],
            ["mobile", "Mobile"],
          ].map(([key, label]) => <div key={key} className="rounded-lg border border-slate-800 bg-slate-950 p-3 flex items-center justify-between"><span className="text-sm text-slate-200">{label}</span><ToggleSwitch on={key === "desktop" ? draft.desktop !== false : !!draft[key]} onClick={() => setDraft((d) => ({ ...d, [key]: key === "desktop" ? d.desktop === false : !d[key] }))} /></div>)}
        </div>
      </Section>
      <Section title="Events" hint="Choose which events should notify you. Color is always paired with an event name and icon in the app.">
        <div className="space-y-2">{cats.map(([key, label]) => <div key={key} className="rounded-lg border border-slate-800 bg-slate-950 p-3 flex items-center justify-between"><span className="text-sm text-slate-200">{label}</span><ToggleSwitch on={(draft.categories || {})[key] !== false} onClick={() => setCat(key)} /></div>)}</div>
      </Section>
      <Section title="Webhook" hint="Optional. If set, the runner posts notification JSON to this URL.">
        <input value={draft.webhook || ""} onChange={(e) => setDraft((d) => ({ ...d, webhook: e.target.value }))} placeholder="https://…" className="w-full rounded-lg px-2.5 py-2 text-sm" />
      </Section>
      <button onClick={save} className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"><Check className="w-4 h-4" />Save notifications</button>
    </div>
  );
}

function NumberField({ label, value, onChange, ...props }) {
  return <label className="text-xs text-slate-500">{label}<input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg px-2 py-2 text-sm" {...props} /></label>;
}

function ToggleSwitch({ on, onClick }) {
  return <button type="button" role="switch" aria-checked={!!on} onClick={onClick} className={`relative w-11 h-6 rounded-full border transition-colors ${on ? "bg-indigo-600 border-indigo-500" : "bg-slate-800 border-slate-700"}`}><span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} /></button>;
}

function EmptyPanel({ icon: Icon, title, body }) {
  return <div className="text-center py-16 text-slate-500 night-card rounded-xl"><Icon className="w-10 h-10 mx-auto mb-3 text-slate-600" /><div className="font-medium text-slate-300">{title}</div><div className="text-sm mt-1 max-w-md mx-auto">{body}</div></div>;
}

// PROVIDERS & KEYS — connect a coding agent. Either a CLI you've signed into (Codex/Claude), or
// a raw API key you bring (OpenAI/Anthropic/DeepSeek/Gemini/OpenRouter) or a local model (Ollama).
// Keys are verified, then stored in the macOS Keychain — never written to a config/state file.
function ProvidersPanel({ flash, embedded = false }) {
  const [data, setData] = useState(null);
  const [pending, setPending] = useState([]);
  const load = useCallback(() => {
    fetchProviders().then((providers) => {
      setData(providers);
      deepCheckConnectedCliProviders(providers, setData);
    }).catch(() => setData([]));
    fetch(`${API}/api/setup-consent`, { cache: "no-store" }).then((r) => r.json()).then((d) => setPending(d.pending || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useRefreshOnFocus(load);
  if (!data) return <div className="p-10 text-slate-500">Loading providers…</div>;
  const clis = data.filter((p) => p.kind === "agentic-cli");
  const apis = data.filter((p) => p.kind === "api");
  const body = (
      <div className={`${embedded ? "" : "p-6 overflow-y-auto max-w-3xl"} space-y-6`}>
        {pending.length > 0 && <SetupConsent pending={pending} flash={flash} reload={load} />}
        <div>
          <div className="text-sm font-semibold text-slate-300 mb-2">Coding agents (sign in with the CLI)</div>
          <div className="grid sm:grid-cols-2 gap-3">{clis.map((p) => <CliCard key={p.id} p={p} flash={flash} reload={load} setProviders={setData} />)}</div>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-300 mb-1">Bring your own API key</div>
          <p className="text-xs text-slate-500 mb-3">Keys live in your Mac's Keychain — never in a file, never sent anywhere but the provider. You pay the provider directly.</p>
          <div className="space-y-2">{apis.map((p) => <ApiKeyCard key={p.id} p={p} flash={flash} reload={load} />)}</div>
        </div>
      </div>
  );
  if (embedded) return body;
  return <><Header title="Providers &amp; keys" subtitle="Connect a coding agent — a CLI you've signed into, or an API key you bring" />{body}</>;
}
function CliCard({ p, flash, reload, setProviders }) {
  const [auth, setAuth] = useState(null);
  const statusText = providerStatusText(p);
  const cliName = providerCliName(p);
  const statusTone = p.connected ? "text-emerald-300" : p.installed ? "text-amber-300" : "text-slate-400";
  const dotTone = p.connected ? "bg-emerald-400" : p.installed ? "bg-amber-400" : "bg-slate-600";
  const refresh = async () => {
    await reload?.();
    if (!p.installed) return;
    try {
      const checked = await checkCliProviderStatus(p.id, { deep: true });
      setProviders?.((prev) => mergeProviderStatus(prev, checked));
      flash(`${p.label}: ${checked.detail || (checked.connected ? "connected" : "not ready")}`);
    } catch (e) {
      flash(String(e.message || e));
    }
  };
  const login = () => {
    if (!p.installed) {
      flash(`${p.label} is not installed yet. Install the ${cliName} CLI, then refresh provider status.`);
      return;
    }
    fetch(`${API}/api/provider-cli`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: p.id, action: "login" }) })
    .then((r) => r.json()).then(async (d) => {
      if (!d.ok) throw new Error(d.error || "login failed");
      if (d.authUrl && d.deviceCode) {
        setAuth(d);
        try { window.open(d.authUrl, "_blank", "noopener"); } catch {}
      }
      flash(d.note || `Opened ${d.command}`);
      reload?.();
      const ready = await pollProviderReady(p.id, setProviders || null);
      if (ready?.connected) flash(`${p.label} connected`);
      else if (ready?.detail) flash(`${p.label}: ${ready.detail}`);
      reload?.();
    })
    .catch((e) => flash(String(e.message || e)));
  };
  return (
    <div className={`rounded-xl border p-3.5 ${p.connected ? "border-emerald-500/30 bg-emerald-500/5" : "border-slate-800 bg-slate-900"}`}>
      <div className="flex items-center gap-2">
        <Cpu className="w-4 h-4 text-slate-400" />
        <span className="font-medium text-slate-200">{p.label}</span>
        <span className={`ml-auto inline-flex items-center gap-1 text-[11px] ${statusTone}`}><span className={`w-1.5 h-1.5 rounded-full ${dotTone}`} />{statusText}</span>
      </div>
      <div className="text-xs text-slate-500 mt-1.5">{p.detail || p.blurb}</div>
      {!p.installed && <div className="text-xs text-slate-400 mt-1">Install the <span className="font-mono">{cliName}</span> CLI so FleetLoops can find it on PATH, then press Refresh.</div>}
      {p.installed && !p.connected && <div className="text-xs text-slate-400 mt-1">Finish sign-in or fix the account status, then press Refresh. FleetLoops will not treat an installed-but-unready CLI as connected.</div>}
      <div className="mt-3 flex gap-2">
        <button onClick={login} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500">{p.connected ? "Sign in again" : p.installed ? "Open sign-in" : "Install first"}</button>
        <button onClick={refresh} className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">Refresh</button>
      </div>
      <CliAuthBox auth={auth} onRefresh={refresh} onClear={() => setAuth(null)} />
    </div>
  );
}
function CliAuthBox({ auth, onRefresh, onClear }) {
  if (!auth?.authUrl || !auth?.deviceCode) return null;
  return (
    <div className="mt-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs font-semibold text-indigo-100">Browser sign-in</div>
      <div className="text-xs text-indigo-100/75 mt-1">Open the sign-in page, enter this one-time code, then check the connection.</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="font-mono text-base tracking-wider text-white bg-slate-950 border border-slate-700 rounded px-2 py-1">{auth.deviceCode}</code>
        <a href={auth.authUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"><ExternalLink className="w-3.5 h-3.5" />Open browser</a>
        <button onClick={onRefresh} className="text-xs px-3 py-1.5 rounded-lg border border-indigo-500/40 text-indigo-100 hover:bg-indigo-500/10">Check connection</button>
        <button onClick={onClear} className="text-xs px-2 py-1.5 rounded-lg text-slate-400 hover:text-slate-200">Dismiss</button>
      </div>
    </div>
  );
}
function ApiKeyCard({ p, flash, reload }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  if (p.auth === "none-local") {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3.5 flex items-center gap-2">
        <Cpu className="w-4 h-4 text-slate-400" /><span className="font-medium text-slate-200">{p.label}</span>
        <span className="text-xs text-slate-500 ml-1">{p.blurb}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-emerald-300"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Ready</span>
      </div>
    );
  }
  const save = () => {
    if (!key.trim()) return;
    setBusy(true); setMsg(null);
    fetch(`${API}/api/provider-key`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: p.id, action: "save", key: key.trim() }) })
      .then((r) => r.json()).then((d) => {
        if (d.ok) { setMsg({ ok: true, text: `✓ Connected. ${d.count || 0} models available.` }); setKey(""); flash(`${p.label} connected`); reload(); }
        else setMsg({ ok: false, text: d.error || "That key didn't work — check for a typo or make a new one." });
      }).catch(() => setMsg({ ok: false, text: "Couldn't reach the service." })).finally(() => setBusy(false));
  };
  const remove = () => {
    if (typeof window !== "undefined" && !window.confirm(`Remove the saved ${p.label} key from Keychain?`)) return;
    fetch(`${API}/api/provider-key`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: p.id, action: "delete" }) }).then(() => { flash(`${p.label} key removed`); reload(); });
  };
  return (
    <div className={`rounded-xl border p-3.5 ${p.connected ? "border-emerald-500/30 bg-emerald-500/5" : "border-slate-800 bg-slate-900"}`}>
      <div className="flex items-center gap-2">
        <Key className="w-4 h-4 text-slate-400" /><span className="font-medium text-slate-200">{p.label}</span>
        <span className={`ml-auto inline-flex items-center gap-1 text-[11px] ${p.connected ? "text-emerald-300" : "text-slate-400"}`}><span className={`w-1.5 h-1.5 rounded-full ${p.connected ? "bg-emerald-400" : "bg-slate-600"}`} />{p.connected ? "Key saved" : "No key yet"}</span>
      </div>
      <div className="mt-2 flex gap-2">
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={p.connected ? "Replace key…" : "Paste your API key…"} className="flex-1 text-sm text-slate-200 bg-slate-950 rounded-lg px-2.5 py-1.5 border border-slate-700 focus:border-indigo-500 focus:outline-none font-mono" />
        <button onClick={save} disabled={busy || !key.trim()} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-30">{busy ? "Verifying…" : "Save & verify"}</button>
        {p.connected && <button onClick={remove} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800" title="Remove this key">Remove</button>}
      </div>
      {msg && <div className={`text-xs mt-1.5 ${msg.ok ? "text-emerald-400" : "text-rose-400"}`}>{msg.text}</div>}
      {p.keysUrl && <a href={p.keysUrl} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 mt-1.5">Where do I get a key? <ExternalLink className="w-3 h-3" /></a>}
    </div>
  );
}
function SetupConsent({ pending, flash, reload }) {
  const approve = (repo) => fetch(`${API}/api/setup-consent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo }) }).then(() => { flash("Setup approved"); reload(); });
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="text-sm font-semibold text-amber-200 mb-1">A project wants to run its setup script</div>
      <p className="text-xs text-amber-200/80 mb-2">Before Fleet runs a project's <span className="font-mono">.fleet/setup.sh</span> (which installs its dependencies), it asks you once. Approve only projects you trust.</p>
      <div className="space-y-1.5">
        {pending.map((p) => (
          <div key={p.repo} className="flex items-center gap-2 text-xs">
            <span className="font-mono text-slate-300 truncate flex-1" title={p.repo}>{p.repo}</span>
            <button onClick={() => approve(p.repo)} className="shrink-0 px-2.5 py-1 rounded-md bg-amber-500 text-slate-900 font-medium hover:bg-amber-400">Approve setup</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// COST — what raw-API providers have billed this month, split by app / provider / phase.
// Subscription CLIs (Codex, Claude Code) have no per-token bill, so they don't appear here.
function CostPanel() {
  const [d, setD] = useState(null);
  useEffect(() => { fetch(`${API}/api/cost`, { cache: "no-store" }).then((r) => r.json()).then(setD).catch(() => setD({ monthUsd: 0, byApp: {}, byProvider: {}, byPhase: {} })); }, []);
  if (!d) return <div className="p-10 text-slate-500">Loading…</div>;
  const usd = (n) => `$${(n || 0).toFixed(2)}`;
  const rows = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(0.01, ...Object.values(d.byApp || {}), ...Object.values(d.byProvider || {}), ...Object.values(d.byPhase || {}));
  const Bars = ({ title, obj }) => {
    const r = rows(obj); if (!r.length) return null;
    return (
      <Section title={title}>
        <div className="space-y-2">{r.map(([k, v]) => (
          <div key={k}>
            <div className="flex justify-between text-xs text-slate-400 mb-1"><span className="capitalize">{k}</span><span>{usd(v)}</span></div>
            <Bar value={(v / max) * 100} tone="bg-emerald-500" />
          </div>
        ))}</div>
      </Section>
    );
  };
  return (
    <>
      <Header title="Cost" subtitle="What your API providers billed this month — CLI subscriptions aren't metered here" />
      <div className="p-6 overflow-y-auto max-w-3xl space-y-5">
        <div className="grid sm:grid-cols-2 gap-3">
        <div className="night-card rounded-xl p-5">
          <div className="text-xs text-slate-400">Today</div>
          <div className="text-3xl font-semibold text-cyan-300 mt-1">{usd(d.todayUsd)}</div>
        </div>
        <div className="night-card rounded-xl p-5">
          <div className="text-xs text-slate-400">This month</div>
          <div className="text-3xl font-semibold text-emerald-400 mt-1">{usd(d.monthUsd)}</div>
        </div>
        </div>
        {d.monthUsd === 0 ? (
          <div className="text-center py-12 text-slate-500"><Wallet className="w-10 h-10 mx-auto mb-3 text-slate-600" /><div className="font-medium text-slate-300">No spend yet</div><div className="text-sm">When an app runs on a raw-API provider, its usage and cost show up here. Subscription CLIs (Codex, Claude) aren't billed per token.</div></div>
        ) : (
          <><Bars title="By app" obj={d.byApp} /><Bars title="By provider" obj={d.byProvider} /><Bars title="By phase" obj={d.byPhase} /></>
        )}
      </div>
    </>
  );
}

function OnboardingModal({ onboarding, apps, postJson, pull, flash, onClose, onDone }) {
  const [step, setStep] = useState(Math.max(0, Math.min(4, onboarding.step || 0)));
  const [providers, setProviders] = useState([]);
  const [cliAuth, setCliAuth] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [providerId, setProviderId] = useState(onboarding.providerId || "");
  const [mode, setMode] = useState(onboarding.mode || "code");
  const [repoPath, setRepoPath] = useState(onboarding.projectDraft?.repo || "");
  const [projectName, setProjectName] = useState(onboarding.projectDraft?.name || "");
  const [scratchName, setScratchName] = useState(onboarding.projectDraft?.name || "New FleetLoops App");
  const [scratchBrief, setScratchBrief] = useState(onboarding.projectDraft?.brief || "");
  const [workspace, setWorkspace] = useState(onboarding.projectDraft?.workspace || "~/FleetLoops Projects");
  const [documents, setDocuments] = useState(onboarding.projectDraft?.documents || []);
  const [appId, setAppId] = useState(onboarding.appId || "");
  const [understanding, setUnderstanding] = useState(null);
  const [brainText, setBrainText] = useState("");
  const [brainDirty, setBrainDirty] = useState(false);
  const [deepText, setDeepText] = useState("");
  const [deepReady, setDeepReady] = useState(false);
  const [brainApproved, setBrainApproved] = useState(!!onboarding.brainApproved);
  const [gates, setGates] = useState([]);
  const [gatesSaved, setGatesSaved] = useState(!!onboarding.gatesApproved);
  const [mergePolicy, setMergePolicy] = useState(onboarding.mergePolicy || "approve");
  const [shipPolicy, setShipPolicy] = useState(onboarding.shipPolicy || "manual");
  const activeApp = apps.find((a) => a.id === appId) || null;

  const loadProviders = useCallback(() => fetchProviders().then((rows) => {
    setProviders(rows);
    deepCheckConnectedCliProviders(rows, setProviders);
  }).catch(() => setProviders([])), []);
  useEffect(() => { loadProviders(); }, [loadProviders]);
  useRefreshOnFocus(loadProviders);
  useEffect(() => { setStep(Math.max(0, Math.min(4, onboarding.step || 0))); }, [onboarding.step]);
  useEffect(() => {
    if (step !== 2 || !appId || !onboarding?.brain) return;
    const b = onboarding.brain;
    setUnderstanding((prev) => prev ? { ...prev, brain: b, analyzing: !!b.analyzing } : prev);
    if (b.status === "pending" && b.origin === "ai") {
      fetch(`${API}/api/brain?appId=${encodeURIComponent(appId)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!d.proposed) return;
          setUnderstanding((prev) => prev ? { ...prev, brain: b, analyzing: false, updatedAt: new Date().toISOString() } : { brain: b, analyzing: false, updatedAt: new Date().toISOString() });
          if (brainDirty) { setDeepText(d.proposed); setDeepReady(true); }
          else { setBrainText(d.proposed); setDeepReady(false); }
        })
        .catch(() => {});
    }
  }, [step, appId, onboarding?.brain?.status, onboarding?.brain?.origin, onboarding?.brain?.analyzing, brainDirty]);
  useEffect(() => {
    const oldProject = window.fleetNativeProjectPicked;
    const oldDocs = window.fleetNativeDocumentsPicked;
    window.fleetNativeProjectPicked = (path) => { if (path) setRepoPath(path); };
    window.fleetNativeDocumentsPicked = (paths) => { if (Array.isArray(paths)) setDocuments((d) => [...d, ...paths.map((p) => ({ path: p }))]); };
    return () => { window.fleetNativeProjectPicked = oldProject; window.fleetNativeDocumentsPicked = oldDocs; };
  }, []);

  const selectedProvider = providers.find((p) => p.id === providerId) || null;
  const providerReady = !!selectedProvider && (selectedProvider.connected || selectedProvider.auth === "none-local");
  const canContinue = step === 0 ? providerReady
    : step === 1 ? !!appId || (mode === "code" ? !!repoPath.trim() : scratchBrief.trim().length >= 20 && !!workspace.trim())
    : step === 2 ? brainApproved
    : step === 3 ? gatesSaved
    : true;
  const run = async (fn) => {
    setBusy(true); setError("");
    try { return await fn(); }
    catch (e) { const msg = String(e.message || e); setError(msg); flash(msg); return null; }
    finally { setBusy(false); }
  };
  const saveStep = async (next) => {
    setStep(next);
    const d = await postJson("onboarding", { action: "save-step", step: next });
    if (d.onboarding) pull();
  };
  const pickProject = () => {
    const handler = window.webkit?.messageHandlers?.fleetPickProject || window.webkit?.messageHandlers?.fleetAddProject;
    if (handler) handler.postMessage({ onboarding: true });
    else flash("Paste the absolute project folder path below.");
  };
  const pickDocuments = () => {
    const handler = window.webkit?.messageHandlers?.fleetPickDocuments;
    if (handler) handler.postMessage({});
    else flash("Native document picker is available in the macOS app. You can continue without attachments.");
  };
  const connectCli = (id) => run(async () => {
    const d = await postJson("provider-cli", { provider: id, action: "login" });
    if (d.authUrl && d.deviceCode) {
      setCliAuth((prev) => ({ ...prev, [id]: d }));
      try { window.open(d.authUrl, "_blank", "noopener"); } catch {}
    }
    flash(d.note || `Opened ${d.command}`);
    await loadProviders();
    const ready = await pollProviderReady(id, setProviders);
    if (ready?.connected) {
      setProviderId(id);
      await postJson("onboarding", { action: "set-provider", providerId: id });
      await pull();
      flash(`${ready.label} connected`);
    }
    else if (ready?.detail) flash(`${ready.label || "CLI"}: ${ready.detail}`);
  });
  const refreshCliProvider = (id) => run(async () => {
    await loadProviders();
    const checked = await checkCliProviderStatus(id, { deep: true });
    setProviders((prev) => mergeProviderStatus(prev, checked));
    if (checked.connected) {
      setProviderId(id);
      await postJson("onboarding", { action: "set-provider", providerId: id });
      await pull();
    }
    flash(`${checked.label || "CLI"}: ${checked.detail || (checked.connected ? "connected" : "not ready")}`);
  });
  const chooseProvider = (id) => run(async () => {
    setProviderId(id);
    await postJson("onboarding", { action: "set-provider", providerId: id });
    await pull();
  });
  const createProject = () => run(async () => {
    if (appId) return { app: { id: appId } };
    const body = mode === "code"
      ? { repo: repoPath.trim(), name: projectName.trim(), onboarding: true, startPaused: true, providerId }
      : { name: scratchName.trim(), brief: scratchBrief.trim(), workspace: workspace.trim(), files: documents, providerId, startPaused: true };
    const d = await postJson(mode === "code" ? "project" : "scratch-project", body);
    setAppId(d.app.id);
    setProjectName(d.app.name || projectName);
    flash(`${d.app.name || "Project"} added paused for brain review`);
    await pull();
    return d;
  });
  const study = () => run(async () => {
    const id = appId || (await createProject())?.app?.id;
    if (!id) return null;
    const d = await postJson("onboarding/understand", { appId: id, mode, brief: mode === "scratch" ? scratchBrief : "", documents });
    setUnderstanding(d);
    setBrainText(d.proposed || "");
    setBrainDirty(false);
    setDeepText("");
    setDeepReady(false);
    setGates(d.gates || []);
    setBrainApproved(false);
    setGatesSaved(false);
    flash("Project brain drafted from real local context");
    await pull();
    return d;
  });
  const approveBrain = () => run(async () => {
    if (!appId) throw new Error("Add a project first.");
    const d = await postJson("onboarding/brain", { appId, editedText: brainText });
    setBrainApproved(true);
    if (d.onboarding) setStep(Math.max(step, 3));
    flash("Project brain approved");
    await pull();
  });
  const saveGates = () => run(async () => {
    if (!appId) throw new Error("Add a project first.");
    const enabled = gates.filter((g) => g.enabled !== false && (g.say || g.text || "").trim());
    if (!enabled.length) throw new Error("Keep at least one Definition-of-Done gate.");
    const d = await postJson("onboarding/gates", { appId, gates: enabled, mergePolicy, shipPolicy });
    setGates(d.gates || enabled);
    setGatesSaved(true);
    flash("Definition-of-Done gates saved");
    await pull();
  });
  const launch = () => run(async () => {
    if (!appId) throw new Error("Add a project first.");
    await postJson("onboarding/launch", { appId });
    flash("FleetLoops is running this project");
    await pull();
    onDone();
  });
  const next = () => run(async () => {
    if (step === 0) { await postJson("onboarding", { action: "set-provider", providerId }); await saveStep(1); }
    else if (step === 1) { await createProject(); await saveStep(2); }
    else if (step === 2) { if (!brainApproved) throw new Error("Approve the project brain first."); await saveStep(3); }
    else if (step === 3) { if (!gatesSaved) await saveGates(); await saveStep(4); }
    else await launch();
  });
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="FleetLoops setup">
      <div className="night-panel rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-800 flex items-start gap-3">
          <Boxesish />
          <div className="min-w-0 flex-1">
            <div className="font-display text-xl font-bold">FleetLoops setup</div>
            <div className="text-xs text-slate-500">Connect an agent, create a project, approve its brain, define done, then launch.</div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 flex items-center justify-center" title="Close setup"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 pt-4">
          <div className="grid grid-cols-5 gap-2">
            {ONBOARDING_STEPS.map((s, i) => <button key={s} onClick={() => i <= step && setStep(i)} className={`h-1.5 rounded-full ${i <= step ? "bg-indigo-500" : "bg-slate-800"}`} title={s} aria-label={s} />)}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-slate-500">{ONBOARDING_STEPS.map((s, i) => <span key={s} className={i === step ? "text-slate-200" : ""}>{s}</span>)}</div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {onboarding.oldFleet?.detected && !onboarding.migration?.choice && <MigrationPrompt onboarding={onboarding} postJson={postJson} pull={pull} flash={flash} />}
          {error && <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-200 p-3 text-sm" role="alert">{error}</div>}
          {step === 0 && <StepConnect providers={providers} providerId={providerId} selectedProvider={selectedProvider} chooseProvider={chooseProvider} connectCli={connectCli} refreshCliProvider={refreshCliProvider} loadProviders={loadProviders} flash={flash} cliAuth={cliAuth} setCliAuth={setCliAuth} />}
          {step === 1 && <StepAdd mode={mode} setMode={setMode} repoPath={repoPath} setRepoPath={setRepoPath} projectName={projectName} setProjectName={setProjectName} scratchName={scratchName} setScratchName={setScratchName} scratchBrief={scratchBrief} setScratchBrief={setScratchBrief} workspace={workspace} setWorkspace={setWorkspace} documents={documents} setDocuments={setDocuments} pickProject={pickProject} pickDocuments={pickDocuments} appId={appId} activeApp={activeApp} createProject={createProject} busy={busy} />}
          {step === 2 && <StepUnderstand appId={appId} app={activeApp} understanding={understanding} onboardingBrain={onboarding.brain} brainText={brainText} setBrainText={(v) => { setBrainDirty(true); setBrainText(v); }} brainDirty={brainDirty} deepReady={deepReady} onUseDeep={() => { setBrainText(deepText); setBrainDirty(false); setDeepReady(false); }} onKeepEdits={() => setDeepReady(false)} brainApproved={brainApproved} study={study} approveBrain={approveBrain} busy={busy} />}
          {step === 3 && <StepDone gates={gates} setGates={setGates} mergePolicy={mergePolicy} setMergePolicy={setMergePolicy} shipPolicy={shipPolicy} setShipPolicy={setShipPolicy} saveGates={saveGates} gatesSaved={gatesSaved} busy={busy} />}
          {step === 4 && <StepLaunch app={activeApp} launch={launch} busy={busy} />}
        </div>
        <div className="px-5 py-4 border-t border-slate-800 flex items-center gap-2">
          <button onClick={step === 0 ? onClose : back} disabled={busy} className="text-sm px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40">{step === 0 ? "Cancel" : "Back"}</button>
          <div className="ml-auto text-[11px] text-slate-500">{busy ? "Working…" : canContinue ? "" : requiredHint(step)}</div>
          <button onClick={next} disabled={busy || !canContinue} className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-30">{step === 4 ? "Go to deck" : "Continue"}</button>
        </div>
      </div>
    </div>
  );
}

function requiredHint(step) {
  return step === 0 ? "Choose one ready CLI or verified API key"
    : step === 1 ? "Add an existing folder or write a scratch brief"
    : step === 2 ? "Approve the project brain"
    : step === 3 ? "Save at least one gate"
    : "";
}

function MigrationPrompt({ onboarding, postJson, pull, flash }) {
  const act = (action) => postJson("onboarding", { action }).then((d) => { flash(action === "import-existing" ? "Old Fleet projects imported paused" : "Starting fresh"); pull(); return d; }).catch((e) => flash(String(e.message || e)));
  return (
    <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
      <div className="flex-1 text-sm">
        <div className="font-semibold text-amber-100">Existing Fleet data found</div>
        <div className="text-amber-100/75 mt-0.5">FleetLoops will not silently reuse old Fleet projects. Import them paused, or start with a clean FleetLoops setup.</div>
        <div className="font-mono text-[11px] text-amber-100/50 mt-1">{onboarding.oldFleet.path}</div>
      </div>
      <button onClick={() => act("import-existing")} className="text-xs px-3 py-1.5 rounded-lg bg-amber-400 text-slate-900 font-medium hover:bg-amber-300">Import paused</button>
      <button onClick={() => act("start-fresh")} className="text-xs px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-100 hover:bg-amber-500/10">Start fresh</button>
    </div>
  );
}

function StepConnect({ providers, providerId, selectedProvider, chooseProvider, connectCli, refreshCliProvider, loadProviders, flash, cliAuth, setCliAuth }) {
  const clis = providers.filter((p) => p.kind === "agentic-cli");
  const apis = providers.filter((p) => p.kind === "api");
  const chooseReadyProvider = (p) => {
    if (p.connected || p.auth === "none-local") chooseProvider(p.id);
    else if (p.kind === "agentic-cli" && !p.installed) flash(`${p.label} is not installed yet. Install the ${providerCliName(p)} CLI, then refresh.`);
    else if (p.kind === "agentic-cli") flash(`${p.label} is not ready: ${p.detail || "sign in required"}`);
    else flash(`${p.label} needs a verified API key first.`);
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-sm text-indigo-100">
        Choose exactly one way to run the agent: a signed-in CLI subscription, or a verified API key. You do not need both.
      </div>
      <div className="grid lg:grid-cols-[.95fr_1.05fr] gap-4">
      <Section title="Option A: Sign in with a CLI" hint="Use this when you want FleetLoops to run Codex or Claude Code through the subscription CLI already installed on this Mac.">
        <div className="space-y-2">
          {clis.map((p) => <PathCard key={p.id} active={providerId === p.id} icon={Cpu} title={p.label} meta={providerStatusText(p)} good={p.connected} onClick={() => chooseReadyProvider(p)}>
            <div className="text-xs text-slate-500 mt-2">{p.detail || p.blurb}</div>
            {!p.installed && <div className="text-xs text-amber-300/80 mt-1">Install the CLI first or use an API key instead. FleetLoops will not select a missing CLI.</div>}
            {p.installed && !p.connected && <div className="text-xs text-amber-300/80 mt-1">Finish sign-in or fix the account issue, then refresh. This CLI is not selectable yet.</div>}
            <div className="flex gap-2 mt-3">
              <button onClick={(e) => { e.stopPropagation(); connectCli(p.id); }} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500">{p.connected ? "Sign in again" : p.installed ? "Open sign-in" : "Install first"}</button>
              <button onClick={(e) => { e.stopPropagation(); p.kind === "agentic-cli" ? refreshCliProvider(p.id) : (loadProviders(), flash("Provider status refreshed")); }} className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">Refresh</button>
            </div>
            <CliAuthBox auth={cliAuth?.[p.id]} onRefresh={(e) => { e?.stopPropagation?.(); refreshCliProvider(p.id); }} onClear={(e) => { e?.stopPropagation?.(); setCliAuth((prev) => ({ ...prev, [p.id]: null })); }} />
          </PathCard>)}
        </div>
      </Section>
      <Section title="Option B: Bring one API key" hint="Use this when you want FleetLoops to call a provider API directly. Keys are verified, then stored in the macOS Keychain.">
        <div className="space-y-2">
          {apis.map((p) => p.auth === "none-local"
            ? <PathCard key={p.id} active={providerId === p.id} icon={Server} title={p.label} meta="Local endpoint" good onClick={() => chooseReadyProvider(p)} />
            : <div key={p.id} onClick={() => chooseReadyProvider(p)} className={`rounded-xl border p-3 cursor-pointer ${providerId === p.id ? "border-indigo-500 bg-indigo-600/10" : "border-slate-800 bg-slate-950 hover:border-slate-700"}`}>
                <ApiKeyCard p={p} flash={flash} reload={loadProviders} />
              </div>)}
        </div>
        {selectedProvider && <div className="text-xs text-slate-500 mt-3">Selected: <span className="text-slate-300">{selectedProvider.label}</span> · {selectedProvider.connected || selectedProvider.auth === "none-local" ? "ready" : "connect it before continuing"}</div>}
      </Section>
      </div>
    </div>
  );
}

function providerStatusText(p) {
  if (p.connected) return "Ready";
  if (p.kind === "agentic-cli" && !p.installed) return "Not installed";
  if (p.kind === "agentic-cli" && p.authenticated && !p.usable) return "Account issue";
  if (p.kind === "agentic-cli") return "Sign in required";
  return p.detail || "Not ready";
}

function providerCliName(p) {
  if (p?.cli) return p.cli;
  if (p?.id === "claude_cli") return "claude";
  if (p?.id === "codex") return "codex";
  return String(p?.command || "CLI").split(/\s+/)[0] || "CLI";
}

function PathCard({ active, icon: Icon, title, meta, good, onClick, children }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick?.(event);
        }
      }}
      className={`w-full text-left rounded-xl border p-3 transition-colors cursor-pointer ${active ? "border-indigo-500 bg-indigo-600/10" : "border-slate-800 bg-slate-950 hover:border-slate-700"}`}
    >
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-400" />
        <span className="font-medium text-slate-100">{title}</span>
        <span className={`ml-auto text-[11px] ${good ? "text-emerald-300" : "text-amber-300"}`}>{meta}</span>
      </div>
      {children}
    </div>
  );
}

function StepAdd({ mode, setMode, repoPath, setRepoPath, projectName, setProjectName, scratchName, setScratchName, scratchBrief, setScratchBrief, workspace, setWorkspace, documents, setDocuments, pickProject, pickDocuments, appId, activeApp, createProject, busy }) {
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <PathCard active={mode === "code"} icon={FolderGit2} title="Existing code" meta="study a real folder" good={mode === "code"} onClick={() => setMode("code")} />
        <PathCard active={mode === "scratch"} icon={WandSparkles} title="A new idea" meta="create a repo from a brief" good={mode === "scratch"} onClick={() => setMode("scratch")} />
      </div>
      {appId && activeApp ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="font-medium text-emerald-200">{activeApp.name} added paused</div>
          <div className="text-xs text-emerald-100/70 mt-1 font-mono truncate">{activeApp.repo}</div>
        </div>
      ) : mode === "code" ? (
        <Section title="Choose the project folder" hint="FleetLoops detects the stack, writes config, and keeps the app paused until brain and gates are approved.">
          <div className="grid sm:grid-cols-[1fr_auto] gap-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Project path</span>
              <input value={repoPath} onChange={(e) => setRepoPath(e.target.value)} placeholder="/absolute/path/to/project" className="mt-1 w-full rounded-lg px-3 py-2 text-sm font-mono" />
            </label>
            <button onClick={pickProject} className="self-end inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700"><FolderOpen className="w-4 h-4" />Choose folder</button>
          </div>
          <label className="mt-3 block">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Display name</span>
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Optional display name" className="mt-1 w-full rounded-lg px-3 py-2 text-sm" />
          </label>
          <p className="text-xs text-amber-300/80 mt-2">Avoid project folders inside Downloads for long-running background access.</p>
          <button disabled={busy || !repoPath.trim()} onClick={createProject} className="mt-3 text-sm font-medium px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-30">Add paused project</button>
        </Section>
      ) : (
        <Section title="Describe the app to create" hint="FleetLoops creates a local git repo with the brief, source docs, brain draft, and gate seeds.">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">App name</span>
              <input value={scratchName} onChange={(e) => setScratchName(e.target.value)} placeholder="App name" className="mt-1 w-full rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Workspace</span>
              <input value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="/path/to/workspace" className="mt-1 w-full rounded-lg px-3 py-2 text-sm font-mono" />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Product brief</span>
            <textarea value={scratchBrief} onChange={(e) => setScratchBrief(e.target.value)} rows={7} placeholder="What should this app do, who is it for, and what would make v1 useful?" className="mt-1 w-full rounded-lg px-3 py-2 text-sm" />
          </label>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button onClick={pickDocuments} className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"><Paperclip className="w-4 h-4" />Attach docs</button>
            {documents.map((d, i) => <Chip key={i} className="bg-slate-800 text-slate-400 border-slate-700 font-mono">{basenameSafe(d.path || d)}</Chip>)}
          </div>
          <button disabled={busy || scratchBrief.trim().length < 20 || !workspace.trim()} onClick={createProject} className="mt-3 text-sm font-medium px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-30">Create paused repo</button>
        </Section>
      )}
    </div>
  );
}

function basenameSafe(path) {
  return String(path || "").split("/").filter(Boolean).pop() || "document";
}

function StepUnderstand({ appId, app, understanding, onboardingBrain, brainText, setBrainText, brainDirty, deepReady, onUseDeep, onKeepEdits, brainApproved, study, approveBrain, busy }) {
  const brain = understanding?.brain || onboardingBrain || {};
  const origin = brain.origin || "template";
  const analyzing = !!(understanding?.analyzing || brain.analyzing);
  const failed = !!brain.failed;
  return (
    <div className="grid lg:grid-cols-[.9fr_1.1fr] gap-4">
      <Section title="Project understanding" hint="This is generated from the real local repo or scratch brief and saved as a proposed project brain.">
        {!appId ? <EmptyPanel icon={FolderGit2} title="Add a project first" body="The brain review is tied to a real project config." /> : (
          <>
            <div className="text-sm text-slate-300">{app?.name || appId}</div>
            <div className="text-xs text-slate-500 font-mono truncate mt-1">{app?.repo || ""}</div>
            <button disabled={busy} onClick={study} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"><Brain className="w-4 h-4" />{understanding ? "Re-study" : "Study project"}</button>
            {brainText && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Chip className={origin === "ai" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-amber-500/10 text-amber-300 border-amber-500/30"}>
                  {origin === "ai" ? "Deep AI analysis" : "Quick local summary"}
                </Chip>
                {analyzing && <Chip className="bg-indigo-500/10 text-indigo-300 border-indigo-500/30">studying codebase</Chip>}
              </div>
            )}
            {understanding?.facts?.length > 0 && (
              <div className="mt-4 space-y-2">
                {understanding.facts.map((f, i) => <div key={i} className="rounded-lg bg-slate-950 border border-slate-800 p-2.5"><div className="text-[11px] uppercase text-slate-500">{f.label}</div><div className="text-sm text-slate-300 mt-0.5">{f.value}</div></div>)}
              </div>
            )}
          </>
        )}
      </Section>
      <Section title="Brain draft" hint="Review, edit if needed, then approve. Live work cannot start until this is approved.">
        {brainText ? (
          <>
            {analyzing && (
              <div className="mb-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-sm text-indigo-100" role="status">
                FleetLoops is studying your codebase in depth. You can review this quick summary meanwhile; it will update when the deep analysis is ready.
              </div>
            )}
            {!analyzing && origin === "ai" && (
              <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100" role="status">
                Updated — deep analysis complete.
              </div>
            )}
            {failed && (
              <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                Deep analysis did not complete. You can continue with this summary and re-run analysis later.
              </div>
            )}
            {!analyzing && origin === "template" && !failed && (
              <div className="mb-3 rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-slate-300">
                This is a quick local summary. A deeper AI analysis will be proposed after launch when a provider can study the repo.
              </div>
            )}
            {deepReady && (
              <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100 flex items-center gap-2">
                <span className="flex-1">Deep analysis is ready.</span>
                <button onClick={onUseDeep} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400">View it</button>
                <button onClick={onKeepEdits} className="text-xs px-2.5 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-100 hover:bg-emerald-500/10">Keep my edits</button>
              </div>
            )}
            <textarea value={brainText} onChange={(e) => setBrainText(e.target.value)} rows={20} className="w-full rounded-lg px-3 py-2 text-xs font-mono" />
            {brainDirty && <div className="mt-1 text-[11px] text-slate-500">Your edits are preserved if a deeper analysis finishes in the background.</div>}
            <button disabled={busy || brainText.trim().length < 100 || brainApproved} onClick={approveBrain} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"><CheckCircle2 className="w-4 h-4" />{brainApproved ? "Brain approved" : "Looks right — approve"}</button>
          </>
        ) : <EmptyPanel icon={Brain} title="No brain draft yet" body="Click Study project to generate a proposed project brain from real local context." />}
      </Section>
    </div>
  );
}

function StepDone({ gates, setGates, mergePolicy, setMergePolicy, shipPolicy, setShipPolicy, saveGates, gatesSaved, busy }) {
  const updateGate = (i, patch) => setGates((gs) => gs.map((g, idx) => idx === i ? { ...g, ...patch } : g));
  const addGate = () => setGates((gs) => [...gs, { id: `gate-${gs.length + 1}`, say: "", check: "agent", effort: "M", enabled: true, source: "you" }]);
  return (
    <div className="grid lg:grid-cols-[1.15fr_.85fr] gap-4">
      <Section title="Definition of Done" hint="Keep, drop, or edit the gates before the loop starts. Who proves the gate is part of the contract.">
        <div className="space-y-2">
          {gates.map((g, i) => <div key={g.id || i} className={`rounded-xl border p-3 ${g.enabled === false ? "border-slate-800 bg-slate-950 opacity-60" : "border-slate-800 bg-slate-950"}`}>
            <div className="flex items-start gap-2">
              <button onClick={() => updateGate(i, { enabled: g.enabled === false })} className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 ${g.enabled === false ? "border-slate-700 text-slate-600" : "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"}`}>{g.enabled === false ? "" : "✓"}</button>
              <input value={g.say || ""} onChange={(e) => updateGate(i, { say: e.target.value })} placeholder="Gate in plain English" className="flex-1 rounded-lg px-2 py-1.5 text-sm" />
            </div>
            <div className="mt-2 grid sm:grid-cols-3 gap-2 pl-8">
              <select value={g.check || "agent"} onChange={(e) => updateGate(i, { check: e.target.value })} className="rounded-lg px-2 py-1.5 text-xs">
                <option value="auto">Loop proves</option>
                <option value="agent">Agent works, you confirm</option>
                <option value="human">Only you confirm</option>
              </select>
              <select value={g.effort || "M"} onChange={(e) => updateGate(i, { effort: e.target.value })} className="rounded-lg px-2 py-1.5 text-xs">
                <option value="S">Small</option><option value="M">Medium</option><option value="L">Large</option>
              </select>
              <input value={g.probe || ""} onChange={(e) => updateGate(i, { probe: e.target.value })} placeholder="Optional probe command" className="rounded-lg px-2 py-1.5 text-xs font-mono" />
            </div>
          </div>)}
          <button onClick={addGate} className="text-xs px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">Add gate</button>
        </div>
      </Section>
      <Section title="Policies" hint="Approve-to-merge is safest for public release. Shipping is always human-owned unless you later change it.">
        <PolicyPick title="Merge policy" value={mergePolicy} setValue={setMergePolicy} options={[["approve", "Approve before merge"], ["auto", "Auto-merge when safe"]]} />
        <div className="mt-4" />
        <PolicyPick title="Ship policy" value={shipPolicy} setValue={setShipPolicy} options={[["manual", "You ship"], ["ci", "CI pipeline"], ["store", "App Store pipeline"]]} />
        <button disabled={busy || !gates.some((g) => g.enabled !== false && (g.say || "").trim())} onClick={saveGates} className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"><Check className="w-4 h-4" />{gatesSaved ? "Saved" : "Save gates"}</button>
      </Section>
    </div>
  );
}

function PolicyPick({ title, value, setValue, options }) {
  return <div><div className="text-xs font-semibold text-slate-400 mb-2">{title}</div><div className="space-y-2">{options.map(([id, label]) => <button key={id} onClick={() => setValue(id)} className={`w-full text-left rounded-lg border px-3 py-2 text-sm ${value === id ? "border-indigo-500 bg-indigo-600/10 text-slate-100" : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700"}`}>{label}</button>)}</div></div>;
}

function StepLaunch({ app, launch, busy }) {
  return (
    <div className="max-w-2xl mx-auto text-center py-10">
      <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center mx-auto"><Rocket className="w-7 h-7" /></div>
      <div className="font-display text-2xl font-bold mt-4">Ready to launch the loop</div>
      <p className="text-sm text-slate-400 mt-2">The project brain and Definition-of-Done gates are saved. FleetLoops will resume this app and begin work from the approved context.</p>
      {app && <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3 text-left"><div className="text-sm font-medium">{app.name}</div><div className="text-xs text-slate-500 font-mono truncate mt-1">{app.repo}</div></div>}
      <button disabled={busy} onClick={launch} className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"><Rocket className="w-4 h-4" />Start first loop</button>
    </div>
  );
}

// BRAIN REVIEW — the owner verifies the fleet's deep comprehension of an app before it's
// trusted. Approve as-is, edit then approve, or ask for a re-analysis with notes. Every run
// reads the approved brain, so this is the foundation of "deeply contextual" work.
function BrainReviewCard({ a }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch(`${API}/api/brain?appId=${a.appId}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { setData(d); setText(d.proposed || ""); }).catch(() => setData({ proposed: "" })); }, [a.appId]);
  const post = (action, extra) => { setBusy(true); return fetch(`${API}/api/brain`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: a.appId, action, ...extra }) }).then((r) => r.json()).finally(() => setBusy(false)); };
  return (
    <div className="bg-slate-900 rounded-xl border border-indigo-500/30 p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-indigo-500/15 text-indigo-300"><Brain className="w-4 h-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{a.title}</span>
            <Chip className="bg-indigo-500/10 text-indigo-300 border-indigo-500/30">project understanding</Chip>
            {data && <span className="text-[11px] text-slate-500 ml-auto">v{data.version}</span>}
          </div>
          <p className="text-sm text-slate-300 mt-2">The fleet studied <span className="font-medium">{a.appName}</span> and wrote how it understands the codebase — architecture, conventions, risky paths, gotchas. <span className="text-indigo-300">Every future run reads this</span>, so it's what makes the work feel like it's been here for years. Approve it, fix anything that's wrong, or ask for a deeper re-analysis.</p>
          {!data ? <div className="text-slate-500 text-sm mt-3">Loading the comprehension…</div> : (
            <>
              {editing ? (
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={18} className="mt-3 w-full text-xs font-mono text-slate-200 bg-slate-950 rounded-lg px-3 py-2 border border-slate-700 focus:border-indigo-500 focus:outline-none" />
              ) : (
                <pre className="mt-3 text-xs text-slate-300 whitespace-pre-wrap bg-slate-950 rounded-lg p-3 border border-slate-800 overflow-auto" style={{ maxHeight: "46vh" }}>{data.proposed || "(empty)"}</pre>
              )}
              <div className="mt-3 flex gap-2 flex-wrap items-center">
                <button disabled={busy} onClick={() => post("approve", editing ? { editedText: text } : {})} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"><CheckCircle2 className="w-3.5 h-3.5" />{editing ? "Save my edits & approve" : "Approve — this is accurate"}</button>
                {!editing && <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300"><Edit3 className="w-3.5 h-3.5" />Edit it myself</button>}
                <RefineBrain busy={busy} onRefine={(notes) => post("refine", { notes })} />
              </div>
              <p className="text-[11px] text-slate-500 mt-2">“Ask for a re-analysis” sends your notes back to the fleet — it revises its understanding and brings you a new version to approve.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
function RefineBrain({ onRefine, busy }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  if (!open) return <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/10"><RefreshCw className="w-3.5 h-3.5" />Ask for a re-analysis</button>;
  return (
    <div className="w-full mt-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
      <label className="text-xs text-amber-200/90 font-medium">What did it get wrong or miss?
        <textarea autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="e.g. The payments flow actually goes through the worker queue, not the API directly. The design system is Tailwind + shadcn, not MUI." className="mt-1 w-full text-sm text-slate-200 bg-slate-900 rounded-lg px-2.5 py-2 border border-slate-700 focus:border-amber-500 focus:outline-none" />
      </label>
      <div className="mt-2 flex gap-2"><button disabled={busy || !notes.trim()} onClick={() => onRefine(notes)} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500 text-slate-900 hover:bg-amber-400 disabled:opacity-40">Send for re-analysis</button><button onClick={() => setOpen(false)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800">Cancel</button></div>
    </div>
  );
}

function ApprovalCard({ a, app, onResolve, onOpen }) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [revising, setRevising] = useState(false);
  const [detail, setDetail] = useState(null);
  if (a.kind === "brain") return <BrainReviewCard a={a} />;
  const meta = APPROVAL_ICON[a.type] || APPROVAL_ICON.decision; const Icon = meta.icon;
  const isCode = a.kind === "code" || !!a.branch;
  const isDecision = !isCode;
  const brief = a.brief; // plain-language explainer for decisions

  const expand = () => {
    const next = !open; setOpen(next);
    if (next && !detail) fetch(`${API}/api/approval?appId=${a.appId}&taskId=${a.taskId}`, { cache: "no-store" }).then((r) => r.json()).then(setDetail).catch(() => {});
  };

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.tone}`}><Icon className="w-4 h-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{a.title}</span>
            <Chip className={isCode ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-violet-500/10 text-violet-300 border-violet-500/30"}>{isCode ? "finished work — review it" : "the agent has a question"}</Chip>
            {a.raised && <span className="text-[11px] text-slate-500 ml-auto" title={a.raised}>{timeAgo(a.raised)}</span>}
          </div>
          <button onClick={() => onOpen(a.appId)} className="text-xs text-indigo-400 hover:underline mt-0.5">{a.appName} · {a.taskId}</button>

          {/* Plain-language headline */}
          {isCode ? (
            <div className="mt-2">
              <p className="text-sm text-slate-100 font-medium">{a.plainSummary || `The agent finished: ${a.title}`}</p>
              {a.userImpact && !/nothing/i.test(a.userImpact) && <p className="text-sm text-slate-300 mt-1"><span className="text-emerald-400/90">What users will notice:</span> {a.userImpact}</p>}
              <p className="text-xs text-slate-400 mt-1.5">It's saved on a safe copy (branch <span className="font-mono">{a.branch}</span>) — nothing changes for your users until you approve. {a.gate && <span className={a.gate.passed ? "text-emerald-400" : "text-amber-400"}>{a.gate.passed === true ? "Automated tests passed ✓" : a.gate.passed === false ? "Automated tests failed ✗ — look closely." : "No automated test here — your review is the check."}</span>}</p>
              {a.review && a.review.ran && a.review.verdict && (
                <div className={`mt-2 rounded-lg border px-2.5 py-1.5 text-xs ${a.review.verdict === "APPROVE" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300" : "border-amber-500/30 bg-amber-500/5 text-amber-300"}`}>
                  <span className="font-medium">🔍 A second AI reviewer {a.review.verdict === "APPROVE" ? "approved this change" : "still wants changes"}.</span>
                  {a.review.summary && <span className="text-slate-300"> {a.review.summary}</span>}
                  {a.review.verdict !== "APPROVE" && a.review.issues && <div className="text-slate-400 mt-0.5">What it flagged: {a.review.issues}</div>}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2">
              {brief ? <p className="text-sm text-slate-200">{brief.what}</p> : <>
                <p className="text-sm text-slate-200">The agent paused on this task and needs your input before it can continue.</p>
                {a.detail && <p className="text-sm text-slate-400 mt-1"><span className="text-slate-500">What it reported:</span> {a.detail}</p>}
              </>}
              {brief?.why && <p className="text-sm text-slate-400 mt-1.5"><span className="text-amber-400/90">Why this needs you:</span> {brief.why}</p>}
              {brief?.recommendation && !brief.recommendation.startsWith("<") && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-2">
                  <span className="text-indigo-300 text-xs font-semibold shrink-0 mt-0.5">💡 Recommended:</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-200">{brief.recommendation}</p>
                    <button onClick={() => setAnswer(`Yes — do your recommended option: ${brief.recommendation}`)} className="mt-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-500">Agree — use this answer</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Options for decisions — always visible, plain language */}
          {isDecision && brief?.options?.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="text-xs font-semibold text-slate-300">Your options</div>
              {brief.options.map((o, i) => (
                <button key={i} onClick={() => setAnswer(o.label)} className={`w-full text-left rounded-lg border p-2.5 transition-colors ${answer === o.label ? "border-indigo-500 bg-indigo-600/10" : "border-slate-700 hover:bg-slate-800"}`}>
                  <div className="text-sm font-medium text-slate-200">{o.label}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{o.meaning}</div>
                </button>
              ))}
            </div>
          )}

          <button onClick={expand} className="mt-3 text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1">{open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}{open ? "Hide details" : isCode ? "See exactly what changed" : "More background"}</button>

          {open && (
            <div className="mt-2 text-xs text-slate-300 space-y-2 bg-slate-950 rounded-lg p-3 border border-slate-800">
              {!detail && <div className="text-slate-500">Loading…</div>}
              {detail && isCode && detail.diff && (
                <>
                  <div className="text-slate-400"><span className="text-slate-500">What it was meant to do:</span> {a.acceptance}</div>
                  {detail.diff.stat && <div><div className="text-slate-500 mb-1">Files changed:</div><pre className="font-mono text-[11px] text-slate-300 whitespace-pre-wrap">{detail.diff.stat}</pre></div>}
                  {detail.diff.patch && <div><div className="text-slate-500 mb-1">The actual change (green = added, red = removed):</div><pre className="font-mono text-[11px] text-slate-300 whitespace-pre-wrap overflow-auto" style={{ maxHeight: "40vh" }}>{detail.diff.patch}</pre></div>}
                </>
              )}
              {detail && isDecision && (
                <>
                  {brief?.howToAnswer && <div className="text-slate-300"><span className="text-slate-500">How to answer:</span> {brief.howToAnswer}</div>}
                  {detail.app?.northStar && <div className="text-slate-400"><span className="text-slate-500">What this app is for:</span> {detail.app.northStar}</div>}
                  {detail.app?.guardrails?.length > 0 && <div className="text-slate-400"><span className="text-slate-500">Safety rules in force:</span> {detail.app.guardrails.slice(0, 3).join(" · ")}</div>}
                </>
              )}
            </div>
          )}

          {/* Plain-language: what each button does */}
          {isCode
            ? <WhatHappens rows={[
                { btn: "Approve & merge", tone: "text-emerald-400", does: "Folds the agent's change into your app's main code (on your computer). Your users see nothing change — going live is a separate step you control.", ex: "The agent fixed a crash on the safe copy → approving adds that fix to your real code." },
                { btn: "Send back to improve", tone: "text-amber-400", does: "Keeps the task but discards this attempt — your instructions become the agent's marching orders and it redoes the work with fresh attempts.", ex: "The reviewer flagged a weakness → send it back quoting the critique; the next version must address it." },
                { btn: "Reject & discard", tone: "text-rose-400", does: "Throws the change away and deletes the safe copy. Your app goes back to exactly how it was.", ex: "You don't want this at all → discard, and it's as if it never happened." },
              ]} />
            : <WhatHappens rows={[
                { btn: "Submit decision", tone: "text-indigo-400",
                  does: (brief?.options || []).find((o) => o.label === answer)
                    ? `Codex will do exactly this on its next run: ${(brief.options.find((o) => o.label === answer)).meaning}`
                    : (brief?.ifApprove || "Whatever you type becomes Codex's instruction — it builds exactly that on its next run, then reports back here."),
                  ex: brief?.options?.length ? "Pick an option above and this line updates to show precisely what that choice does." : null },
                { btn: "Reject", tone: "text-rose-400", does: "Sets this task aside — the loop stops working on it and won't ask again until you re-open it (change its status from the app's backlog).", ex: "Not ready to decide → reject for now; find it later in the app's Backlog tab." },
              ]} />}

          {/* Answer box for decisions */}
          {isDecision && (
            <div className="mt-3">
              <label className="text-xs text-slate-500">Your answer {brief?.options?.length ? "(pick an option above, or type your own)" : ""}
                <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} placeholder={brief?.howToAnswer || "Type your decision in plain words…"} className="mt-1 w-full text-sm text-slate-200 bg-slate-800 rounded-lg px-2.5 py-2 border border-slate-700 focus:border-indigo-500 focus:outline-none" /></label>
            </div>
          )}

          {/* Send-back composer for finished work: keep the task, redo with your instructions */}
          {isCode && revising && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
              <label className="text-xs text-amber-200/90 font-medium">What should the agent do differently?
                <textarea autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} className="mt-1 w-full text-sm text-slate-200 bg-slate-900 rounded-lg px-2.5 py-2 border border-slate-700 focus:border-amber-500 focus:outline-none" />
              </label>
              <div className="mt-2 flex gap-2">
                <button onClick={() => { onResolve(a, "revise", answer); setRevising(false); }} disabled={!answer.trim()} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500 text-slate-900 hover:bg-amber-400 disabled:opacity-30">Send back with these instructions</button>
                <button onClick={() => setRevising(false)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800">Cancel</button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">The current attempt is discarded, your text becomes the agent's authoritative instruction, and it gets a fresh set of attempts.</p>
            </div>
          )}
          <div className="mt-3 flex gap-2 flex-wrap items-center">
            {isCode ? (
              <>
                <button onClick={() => onResolve(a, "approve")} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500"><GitMerge className="w-3.5 h-3.5" />Approve &amp; merge</button>
                <button onClick={() => { setRevising(true); if (!answer.trim() && a.review && a.review.issues) setAnswer(`Fix the reviewer's objections: ${a.review.issues}`); }} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/10" title="Not good enough yet, but worth redoing — send it back with your instructions"><Edit3 className="w-3.5 h-3.5" />Send back to improve</button>
                <button onClick={() => onResolve(a, "reject")} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-rose-500/40 hover:bg-rose-500/10 text-rose-300"><Trash2 className="w-3.5 h-3.5" />Reject &amp; discard</button>
              </>
            ) : (
              <>
                <button onClick={() => onResolve(a, "approve", answer)} disabled={!answer.trim()} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-30"><CheckCircle2 className="w-3.5 h-3.5" />Submit decision</button>
                <button onClick={() => onResolve(a, "reject")} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300"><XCircle className="w-3.5 h-3.5" />Reject</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AppDrawer({ app, tab, setTab, post, onClose, onToggle, onStop, onAddTask, onDeleteTask, onUpdateTask, onMoveTask }) {
  const s = LOOP_STATES[app.loop] || LOOP_STATES.idle;
  const done = app.tasks.filter((t) => t.status === "done").length;
  const total = app.tasks.length;
  const gates = app.conditions || [];
  const gatesMet = gates.filter((g) => g.status === "met").length;
  const reviewTasks = app.tasks.filter((t) => t.status === "review" || t.branch);
  const tabs = [
    { id: "now", label: "Now", icon: Activity },
    { id: "gates", label: `Gates${gates.length ? ` ${gatesMet}/${gates.length}` : ""}`, icon: ShieldCheck },
    { id: "runs", label: "Runs", icon: ListChecks },
    { id: "diff", label: `Diff${reviewTasks.length ? ` ${reviewTasks.length}` : ""}`, icon: FileDiff },
    { id: "brain", label: "Brain", icon: Brain },
  ];
  return (
    <div className="night-drawer" role="dialog" aria-modal="true" aria-label={`${app.name} cockpit`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="night-drawer-inner flex flex-col">
        <div className="border-b border-slate-800 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1 mb-2"><ArrowLeft className="w-3.5 h-3.5" /> Fleet deck</button>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display text-2xl font-bold tracking-tight">{app.name}</h2>
                <Chip className={s.chip}><span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}</Chip>
                <AutonomyChip a={app.autonomy} withLabel />
                <Chip className="bg-slate-800 text-slate-400 border-slate-700"><Cpu className="w-3 h-3" />{app.config?.providerLabel || app.adapter || "agent"}{app.config?.providerModel ? ` · ${app.config.providerModel}` : ""}</Chip>
              </div>
              <p className="text-sm text-slate-400 mt-1 max-w-3xl">{app.purpose || app.stack || "No purpose recorded yet."}</p>
              <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 min-w-0"><FolderGit2 className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{app.repo}</span></div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => onToggle(app.id)} className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-700 hover:bg-slate-800">{app.loop === "running" ? <><Pause className="w-4 h-4" />Pause</> : <><Play className="w-4 h-4" />Run</>}</button>
              <button onClick={onStop} className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300"><Square className="w-4 h-4" />Stop</button>
              <IconBtn onClick={onClose} title="Close" className="w-10 h-10"><X className="w-4 h-4" /></IconBtn>
            </div>
          </div>
          <div className="flex gap-1 mt-4 overflow-x-auto">
            {tabs.map((t) => <Tab key={t.id} active={tab === t.id} onClick={() => setTab(t.id)} icon={t.icon} label={t.label} />)}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "now" && <AppNow app={app} done={done} total={total} gatesMet={gatesMet} gatesTotal={gates.length} />}
          {tab === "gates" && (gates.length ? <div className="max-w-3xl night-card rounded-xl p-4"><GateChecklist app={app} post={post} /></div> : <EmptyPanel icon={ShieldCheck} title="No gates yet" body="This app is still in backlog mode. When tasks finish, the planner proposes a definition-of-done checklist here." />)}
          {tab === "runs" && <RunHistory app={app} />}
          {tab === "diff" && <DiffTab app={app} reviewTasks={reviewTasks} />}
          {tab === "brain" && <BrainTab app={app} />}
        </div>
      </div>
    </div>
  );
}

function AppNow({ app, done, total, gatesMet, gatesTotal }) {
  const running = app.tasks.find((t) => t.status === "running");
  const next = app.tasks.find((t) => t.status === "queued" && (t.deps || []).every((d) => (app.tasks.find((x) => x.id === d) || {}).status === "done"));
  const human = app.tasks.filter((t) => t.status === "needs-human").length;
  const review = app.tasks.filter((t) => t.status === "review" || t.branch).length;
  return (
    <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-4">
      <div className="space-y-4">
        <div className="grid sm:grid-cols-4 gap-3">
          <Stat icon={ListChecks} label="Tasks" value={`${done}/${total}`} sub="finished so far" tone="text-indigo-400" />
          <Stat icon={ShieldCheck} label="Gates" value={gatesTotal ? `${gatesMet}/${gatesTotal}` : "—"} sub="definition of done" tone="text-emerald-400" />
          <Stat icon={Inbox} label="Need you" value={human + review} sub="decisions + reviews" tone="text-violet-400" />
          <Stat icon={Brain} label="Reasoning" value={app.reasoning || "medium"} sub={app.config?.providerModel || app.model || "provider default"} tone="text-cyan-400" />
        </div>
        <Section title="Current work" hint="Only live state from this app's backlog and loop log.">
          {running ? <WorkSummary icon={Zap} title={`Working: ${running.title}`} body={running.ac || running.summary || "The loop is executing this task now."} /> :
            next ? <WorkSummary icon={Circle} title={`Next up: ${next.title}`} body={next.ac || "Queued for the next sweep."} /> :
            human ? <WorkSummary icon={Inbox} title="Waiting on your answer" body="Open Approvals from the sidebar to unblock this app." /> :
            <WorkSummary icon={CircleCheck} title={total && done === total ? "Backlog complete" : "No ready work"} body={total && done === total ? "This app is ready for gate/audit mode." : "Queued tasks are blocked, paused, or not present yet."} />}
        </Section>
        <ActivityFeed app={app} />
      </div>
      <div className="space-y-4">
        <Section title="Loop policy" hint="The guardrails this app runs under.">
          <div className="flex flex-wrap gap-2"><AutonomyChip a={app.autonomy} withLabel /><Chip title={(DEPLOY_META[app.deployPolicy] || DEPLOY_META.none).hint} className="bg-slate-800 text-slate-400 border-slate-700"><Rocket className="w-3 h-3" />{(DEPLOY_META[app.deployPolicy] || DEPLOY_META.none).label}</Chip>{app.config?.providerLabel && <Chip className="bg-slate-800 text-slate-400 border-slate-700"><Server className="w-3 h-3" />{app.config.providerLabel}</Chip>}</div>
          <div className="mt-3 text-xs text-slate-500">Stack: {app.stack || "not recorded"} · Retry cap: {app.config?.retryCap ?? app.retryCap ?? "default"}</div>
        </Section>
        <Section title="Live stream" hint="Raw agent output appears here during a run.">
          <Stream app={app} />
        </Section>
      </div>
    </div>
  );
}

function WorkSummary({ icon: Icon, title, body }) {
  return <div className="flex items-start gap-3"><div className="w-9 h-9 rounded-lg bg-indigo-500/15 text-indigo-300 flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></div><div><div className="text-sm font-medium text-slate-100">{title}</div><div className="text-sm text-slate-400 mt-1">{body}</div></div></div>;
}

const RUN_STATUS_META = {
  review: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  merged: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  "sent-back": "bg-amber-500/10 text-amber-300 border-amber-500/30",
  stuck: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  working: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
};

function RunHistory({ app }) {
  const [data, setData] = useState(null);
  useEffect(() => { fetch(`${API}/api/runs?appId=${app.id}`, { cache: "no-store" }).then((r) => r.json()).then(setData).catch(() => setData({ runs: [] })); }, [app.id]);
  if (!data) return <div className="text-slate-500">Loading runs…</div>;
  const runs = data.runs || [];
  if (!runs.length) return <EmptyPanel icon={ListChecks} title="No runs recorded yet" body="Runs appear here after the loop works a task, submits a review branch, asks a question, or merges work." />;
  return (
    <div className="max-w-3xl space-y-2">
      {runs.map((r) => (
        <div key={r.id} className="night-card rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-400"><ListChecks className="w-4 h-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-medium text-slate-100">{r.title || r.id}</div>
                <Chip className={RUN_STATUS_META[r.status] || RUN_STATUS_META.working}>{r.status}</Chip>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                <span className="font-mono">{r.id}</span>
                {r.branch && <span className="font-mono">branch: {r.branch}</span>}
                {r.duration && <span>{r.duration}</span>}
                {r.costUsd > 0 && <span>${r.costUsd.toFixed(2)}</span>}
              </div>
              {r.summary && <div className="text-sm text-slate-400 mt-2">{r.summary}</div>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DiffTab({ app, reviewTasks }) {
  const [selected, setSelected] = useState(reviewTasks[0]?.id || "");
  const [detail, setDetail] = useState(null);
  useEffect(() => { setSelected(reviewTasks[0]?.id || ""); }, [app.id, reviewTasks.length]);
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    fetch(`${API}/api/run-diff?appId=${app.id}&runId=${selected}`, { cache: "no-store" }).then((r) => r.json()).then(setDetail).catch(() => setDetail({ error: "Could not load diff." }));
  }, [app.id, selected]);
  if (!reviewTasks.length) return <EmptyPanel icon={FileDiff} title="No review branch yet" body="When the agent finishes code on a safe branch, the changed files and patch appear here from the real repository diff." />;
  const files = parseUnifiedDiff(detail?.diff?.patch || "");
  return (
    <div className="grid lg:grid-cols-[260px_1fr] gap-4">
      <div className="space-y-2">{reviewTasks.map((t) => <button key={t.id} onClick={() => setSelected(t.id)} className={`w-full text-left rounded-xl border p-3 ${selected === t.id ? "border-indigo-500 bg-indigo-600/10" : "border-slate-800 bg-slate-900 hover:border-slate-700"}`}><div className="text-sm font-medium">{t.title}</div><div className="text-[11px] text-slate-500 mt-1">{t.branch || t.status}</div></button>)}</div>
      <div className="night-console rounded-xl p-4 min-h-80">
        {!detail && <div className="text-slate-500">Loading diff…</div>}
        {detail?.error && <div className="text-rose-400">{detail.error}</div>}
        {detail && !detail.error && !detail.diff && <div className="text-slate-500">This review item has no branch diff available yet.</div>}
        {detail?.diff?.stat && <><div className="text-xs text-slate-500 mb-2">Files changed</div><pre className="text-xs text-slate-300 whitespace-pre-wrap mb-4">{detail.diff.stat}</pre></>}
        {detail?.diff?.patch && files.length > 0 && <StructuredDiff files={files} />}
        {detail?.diff?.patch && !files.length && <pre className="text-[11px] text-slate-300 whitespace-pre-wrap overflow-auto" style={{ maxHeight: "62vh" }}>{detail.diff.patch}</pre>}
      </div>
    </div>
  );
}

function parseUnifiedDiff(patch) {
  const files = [];
  let file = null, hunk = null;
  for (const line of String(patch || "").split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (file) files.push(file);
      const m = / b\/(.+)$/.exec(line);
      file = { path: m ? m[1] : line.replace("diff --git ", ""), add: 0, del: 0, hunks: [] };
      hunk = null;
    } else if (file && line.startsWith("@@")) {
      hunk = { h: line, lines: [] };
      file.hunks.push(hunk);
    } else if (file && hunk && line.startsWith("+") && !line.startsWith("+++")) {
      hunk.lines.push({ type: "add", text: line });
      file.add++;
    } else if (file && hunk && line.startsWith("-") && !line.startsWith("---")) {
      hunk.lines.push({ type: "del", text: line });
      file.del++;
    } else if (file && hunk) {
      hunk.lines.push({ type: "ctx", text: line });
    }
  }
  if (file) files.push(file);
  return files;
}

function StructuredDiff({ files }) {
  return <div className="space-y-3">{files.map((f) => <DiffFile key={f.path} file={f} />)}</div>;
}

function DiffFile({ file }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full px-3 py-2 flex items-center gap-2 text-left border-b border-slate-800">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronUp className="w-3.5 h-3.5 text-slate-500" />}
        <span className="font-mono text-xs text-slate-200 truncate flex-1">{file.path}</span>
        <span className="font-mono text-[11px] text-emerald-300">+{file.add}</span>
        <span className="font-mono text-[11px] text-rose-300">-{file.del}</span>
      </button>
      {open && <div className="overflow-x-auto">
        {file.hunks.map((h, i) => (
          <div key={i}>
            <div className="px-3 py-1.5 text-[11px] font-mono text-cyan-300 bg-cyan-500/10">{h.h}</div>
            {h.lines.map((l, j) => <div key={j} className={`px-3 py-0.5 text-[11px] font-mono whitespace-pre ${l.type === "add" ? "bg-emerald-500/10 text-emerald-200" : l.type === "del" ? "bg-rose-500/10 text-rose-200" : "text-slate-400"}`}>{l.text || " "}</div>)}
          </div>
        ))}
      </div>}
    </div>
  );
}

function BrainTab({ app }) {
  const [data, setData] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetch(`${API}/api/brain?appId=${app.id}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { setData(d); setText(d.proposed || d.active || ""); }).catch(() => setData({ proposed: "", active: "" })), [app.id]);
  useEffect(() => {
    load();
    fetch(`${API}/api/brain-timeline?appId=${app.id}`, { cache: "no-store" }).then((r) => r.json()).then((d) => setTimeline(d.entries || [])).catch(() => setTimeline([]));
  }, [app.id, load]);
  const postBrain = (action, extra = {}) => {
    setBusy(true);
    fetch(`${API}/api/brain`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: app.id, action, ...extra }) })
      .then(() => load()).finally(() => setBusy(false));
  };
  if (!data) return <div className="text-slate-500">Loading project brain…</div>;
  const body = data.proposed || data.active || "";
  return (
    <div className="grid lg:grid-cols-[1.1fr_.9fr] gap-4 max-w-6xl">
      <Section title="Project brain" hint="The approved understanding is injected into every future run. Proposed updates wait for your review.">
        <div className="flex items-center gap-2 flex-wrap mb-3"><Chip className="bg-indigo-500/10 text-indigo-300 border-indigo-500/30">status: {data.status || "none"}</Chip><Chip className="bg-slate-800 text-slate-400 border-slate-700">v{data.version || 0}</Chip>{data.proposed && <Chip className="bg-amber-500/10 text-amber-300 border-amber-500/30">review proposed update</Chip>}</div>
        {body ? <textarea value={text} onChange={(e) => setText(e.target.value)} rows={18} className="w-full text-xs font-mono rounded-lg px-3 py-2" /> : <EmptyPanel icon={Brain} title="No brain written yet" body="The next live agent pass studies the project and proposes a brain here for review before it becomes trusted context." />}
        {body && <div className="mt-3 flex gap-2 flex-wrap"><button disabled={busy || text.trim().length < 100} onClick={() => postBrain("approve", { editedText: text })} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"><CheckCircle2 className="w-4 h-4" />Approve brain</button></div>}
      </Section>
      <div className="space-y-4">
        <Section title="Brain timeline" hint="Learnings, decisions, constraints, and gate evidence derived from real state.">
          {timeline.length ? <div className="space-y-2">{timeline.map((e, i) => <div key={i} className="rounded-lg border border-slate-800 bg-slate-950 p-2.5"><div className="flex items-center gap-2"><Chip className={e.tag === "constraint" ? "bg-amber-500/10 text-amber-300 border-amber-500/30" : e.tag === "decision" ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/30" : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"}>{e.tag}</Chip>{e.when && <span className="text-[11px] text-slate-500 font-mono">{e.when}</span>}</div><div className="text-sm text-slate-300 mt-1">{e.text}</div></div>)}</div> : <EmptyPanel icon={Brain} title="No timeline entries yet" body="Approving the brain, adding gates, and completing runs creates timeline entries here." />}
        </Section>
        <Section title="Ask for re-analysis" hint="Your notes are saved in state; the fleet revises its understanding on the next pass.">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="What did the current understanding miss or get wrong?" className="w-full text-sm rounded-lg px-3 py-2" />
          <button disabled={busy || !notes.trim()} onClick={() => postBrain("refine", { notes })} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"><RefreshCw className="w-4 h-4" />Request re-analysis</button>
        </Section>
      </div>
    </div>
  );
}

function AppDetail({ app, tab, setTab, post, onBack, onToggle, onStop, onAddTask, onDeleteTask, onUpdateTask, onMoveTask }) {
  const s = LOOP_STATES[app.loop] || LOOP_STATES.idle;
  return (
    <>
      <div className="border-b border-slate-800 bg-slate-900 px-6 py-4">
        <button onClick={onBack} className="text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1 mb-2"><ArrowLeft className="w-3.5 h-3.5" /> Fleet</button>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap"><h1 className="text-xl font-semibold tracking-tight">{app.name}</h1><Chip className={s.chip}><span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}</Chip><AutonomyChip a={app.autonomy} withLabel /><Chip title={(DEPLOY_META[app.deployPolicy] || DEPLOY_META.none).hint} className="bg-slate-800 text-slate-400 border-slate-700"><Rocket className="w-3 h-3" />{(DEPLOY_META[app.deployPolicy] || DEPLOY_META.none).label}</Chip><Chip title="How hard the agent thinks on this app (cost/speed dial)" className="bg-slate-800 text-slate-400 border-slate-700"><Brain className="w-3 h-3" />{app.reasoning}</Chip></div>
            <div className="text-sm text-slate-400 mt-1">{app.purpose}</div>
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5"><FolderGit2 className="w-3.5 h-3.5" />{app.repo} · {app.stack}</div>
          </div>
          <div className="flex gap-2">
            {app.loop === "blocked" ? (
              <button onClick={() => onToggle(app.id)} title="This app was parked on a big decision. If it's resolved, unblock it — the loop picks it up on the next pass." className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/10"><Play className="w-4 h-4" />Unblock &amp; resume</button>
            ) : (
              <button onClick={() => onToggle(app.id)} className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-700 hover:bg-slate-800">{app.loop === "running" ? <><Pause className="w-4 h-4" />Pause</> : <><Play className="w-4 h-4" />Run</>}</button>
            )}
            <button onClick={onStop} className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300"><Square className="w-4 h-4" />Stop</button>
          </div>
        </div>
        <div className="flex gap-1 mt-4">
          <Tab active={tab === "backlog"} onClick={() => setTab("backlog")} icon={ListChecks} label={`Tasks (${app.tasks.length})`} />
          <Tab active={tab === "gates"} onClick={() => setTab("gates")} icon={ShieldCheck} label={`Definition of done${(app.conditions || []).length ? ` (${(app.conditions || []).filter((c) => c.status === "met").length}/${(app.conditions || []).length})` : ""}`} />
          <Tab active={tab === "stream"} onClick={() => setTab("stream")} icon={Terminal} label="Live stream" />
          <Tab active={tab === "activity"} onClick={() => setTab("activity")} icon={Activity} label="Activity" />
          <Tab active={tab === "settings"} onClick={() => setTab("settings")} icon={Settings} label="Settings" />
        </div>
      </div>
      <div className="p-6 overflow-y-auto">
        {tab === "backlog" && <Backlog app={app} onAddTask={onAddTask} onDeleteTask={onDeleteTask} onUpdateTask={onUpdateTask} onMoveTask={onMoveTask} />}
        {tab === "gates" && (
          <div className="max-w-3xl">
            {(app.conditions || []).length ? (
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-4"><GateChecklist app={app} post={post} /></div>
            ) : (
              <div className="text-sm text-slate-400 bg-slate-900 rounded-xl border border-slate-800 p-5">
                <div className="font-medium text-slate-200 mb-1">No gates yet — this app is in backlog mode.</div>
                When its remaining tasks finish, it graduates: the planner reads the codebase and proposes a definition-of-done checklist here (tests, security, UX, performance…), then keeps auditing for new problems until everything stays green.
              </div>
            )}
          </div>
        )}
        {tab === "stream" && <Stream app={app} />}
        {tab === "activity" && <ActivityFeed app={app} />}
        {tab === "settings" && <LoopConfig app={app} />}
      </div>
    </>
  );
}

function Backlog({ app, onAddTask, onDeleteTask, onUpdateTask, onMoveTask }) {
  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-400">The loop pulls from the top. Reorder to set priority; edit acceptance criteria to define "done".</p>
        <button onClick={() => onAddTask(app.id)} className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"><Plus className="w-4 h-4" />Add task</button>
      </div>
      <div className="space-y-2">
        {app.tasks.map((t, i) => (
          <div key={t.id} className="bg-slate-900 rounded-xl border border-slate-800 p-3">
            <div className="flex items-start gap-3">
              <div className="flex flex-col">
                <IconBtn onClick={() => onMoveTask(app.id, t.id, -1)} title="Move up" className="w-6 h-6" disabled={i === 0}><ChevronUp className="w-3.5 h-3.5" /></IconBtn>
                <IconBtn onClick={() => onMoveTask(app.id, t.id, 1)} title="Move down" className="w-6 h-6 mt-1" disabled={i === app.tasks.length - 1}><ChevronDown className="w-3.5 h-3.5" /></IconBtn>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap"><span className="text-xs font-mono text-slate-500">{t.id}</span>
                  <input defaultValue={t.title} key={t.title} onBlur={(e) => e.target.value !== t.title && onUpdateTask(app.id, t.id, { title: e.target.value })} className="font-medium text-sm bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none flex-1 min-w-40" /></div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <select value={t.status} onChange={(e) => onUpdateTask(app.id, t.id, { status: e.target.value })} className={`text-[11px] rounded-md border px-2 py-0.5 font-medium cursor-pointer bg-slate-800 ${TASK_STATES[t.status]?.chip || ""}`}>{Object.keys(TASK_STATES).map((k) => <option key={k} value={k}>{TASK_STATES[k].label}</option>)}</select>
                  <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${DIFF[t.difficulty] || "bg-slate-700 text-slate-300"}`}>{t.difficulty === "needs-human-decision" ? "your decision" : t.difficulty}</span>
                  {t.deps.length > 0 && <Chip className="bg-slate-800 text-slate-400 border-slate-700">needs {t.deps.join(", ")}</Chip>}
                  {t.attempts > 0 && <Chip className="bg-slate-800 text-slate-500 border-slate-700">{t.attempts} attempt{t.attempts > 1 ? "s" : ""}</Chip>}
                  {t.notBefore && Date.parse(t.notBefore) > Date.now() && <Chip className="bg-amber-500/10 text-amber-300 border-amber-500/30" title={t.notBefore}>auto-retries in ~{Math.max(1, Math.round((Date.parse(t.notBefore) - Date.now()) / 60000))} min</Chip>}
                </div>
                {/* recovery row: explain what went wrong + one-click fixes (no terminal needed) */}
                {(t.lastFailure || t.status === "blocked" || t.status === "needs-human") && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5">
                    <div className="flex-1 min-w-0 text-xs">
                      {t.status === "needs-human" && <span className="text-violet-300">Waiting for your answer — it's in <span className="font-medium">Approvals</span>.</span>}
                      {t.status === "blocked" && <span className="text-slate-400">Set aside (you rejected it, or it kept failing). It won't run again until you re-queue it.</span>}
                      {t.lastFailure && <div className="text-slate-500 line-clamp-2 mt-0.5" title={t.lastFailure}>Last problem: {t.lastFailure}</div>}
                      {t.humanDecision && <div className="text-emerald-400/70 line-clamp-1 mt-0.5" title={t.humanDecision}>Your standing instruction: {t.humanDecision}</div>}
                    </div>
                    {(t.status === "blocked" || (t.lastFailure && t.status === "queued")) && (
                      <button onClick={() => onUpdateTask(app.id, t.id, { status: "queued", notBefore: null })} className="shrink-0 text-[11px] font-medium px-2 py-1 rounded-md bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30" title="Put it back in the queue — the loop tries again on the next pass">{t.status === "blocked" ? "Re-queue" : "Retry now"}</button>
                    )}
                  </div>
                )}
                <div className="mt-2 grid sm:grid-cols-2 gap-2">
                  <label className="text-xs text-slate-500">Acceptance criteria<input defaultValue={t.ac} key={t.ac} onBlur={(e) => e.target.value !== t.ac && onUpdateTask(app.id, t.id, { ac: e.target.value })} className="mt-0.5 w-full text-sm text-slate-200 bg-slate-800 rounded-lg px-2 py-1.5 border border-slate-700 focus:border-indigo-500 focus:outline-none" /></label>
                  <label className="text-xs text-slate-500">Files likely touched<input defaultValue={t.files} key={t.files} onBlur={(e) => e.target.value !== t.files && onUpdateTask(app.id, t.id, { files: e.target.value })} className="mt-0.5 w-full text-sm text-slate-200 bg-slate-800 rounded-lg px-2 py-1.5 border border-slate-700 focus:border-indigo-500 focus:outline-none" /></label>
                </div>
              </div>
              <IconBtn onClick={() => onDeleteTask(app.id, t.id)} title="Delete" className="w-8 h-8 text-rose-400 hover:bg-rose-500/10 border-rose-500/30"><Trash2 className="w-4 h-4" /></IconBtn>
            </div>
          </div>
        ))}
        {app.tasks.length === 0 && <div className="text-sm text-slate-500 py-10 text-center">Backlog empty — loop will idle until you add work.</div>}
      </div>
    </div>
  );
}

// Settings: ONLY real, honest facts about how this loop is configured — the fake Triggers
// grid (the engine never read it) is gone. The loop runs on the service schedule, period.
function LoopConfig({ app }) {
  const m = AUTONOMY_META[app.autonomy] || AUTONOMY_META["branch-approve"];
  const [reasoning, setReasoning] = useState(app.reasoning || "medium");
  const [model, setModel] = useState(app.model || "");
  const [saved, setSaved] = useState("");
  useEffect(() => { setReasoning(app.reasoning || "medium"); setModel(app.model || ""); }, [app.id, app.reasoning, app.model]);
  const dirty = reasoning !== (app.reasoning || "medium") || model !== (app.model || "");
  const save = () => fetch(`${API}/api/app-config`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: app.id, reasoning, model }) })
    .then((r) => r.json()).then(() => { setSaved("Saved — takes effect on the next sweep"); setTimeout(() => setSaved(""), 3000); }).catch(() => setSaved("Save failed"));
  const REASONS = [
    { v: "low", label: "Fast", hint: "Quickest, cheapest — simple changes" },
    { v: "medium", label: "Balanced", hint: "Default — good for most work" },
    { v: "high", label: "Deep", hint: "Strongest reasoning — hard problems (slower)" },
  ];
  return (
    <div className="max-w-2xl space-y-5">
      <Section title="Agent strength & model" hint="How hard this app's agent thinks, and which model it uses. Changes apply on the next sweep — no restart.">
        <div className="text-xs text-slate-400 mb-1.5">Reasoning strength</div>
        <div className="grid grid-cols-3 gap-2">
          {REASONS.map((r) => (
            <button key={r.v} onClick={() => setReasoning(r.v)} className={`text-left rounded-lg border p-2.5 transition-colors ${reasoning === r.v ? "border-indigo-500 bg-indigo-600/10" : "border-slate-700 hover:bg-slate-800"}`}>
              <div className="text-sm font-medium text-slate-200">{r.label}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{r.hint}</div>
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-400 mt-3 mb-1">Model <span className="text-slate-600">(blank = the agent's default; e.g. gpt-5-codex, o3)</span></div>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="default" className="w-full text-sm text-slate-200 bg-slate-800 rounded-lg px-2.5 py-1.5 border border-slate-700 focus:border-indigo-500 focus:outline-none" />
        <div className="mt-3 flex items-center gap-3">
          <button onClick={save} disabled={!dirty} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-30">Save</button>
          {saved && <span className="text-xs text-emerald-400">{saved}</span>}
        </div>
      </Section>
      <Section title="How this loop runs" hint="The background service sweeps every app on its cycle whenever the loop is running. Pause/resume from the card or header. Sweep interval & how many apps run in parallel are fleet-wide (set when the service starts).">
        <div className="flex items-center gap-2 flex-wrap"><AutonomyChip a={app.autonomy} withLabel /><Chip title="How hard the agent thinks (cost/speed dial)" className="bg-slate-800 text-slate-400 border-slate-700"><Brain className="w-3 h-3" />reasoning: {app.reasoning}</Chip>{app.model && <Chip className="bg-slate-800 text-slate-400 border-slate-700">model: {app.model}</Chip>}</div>
        <div className="mt-2 text-sm text-slate-400">{m.hint}</div>
        <div className="mt-1 text-xs text-slate-500">Shipping: {(DEPLOY_META[app.deployPolicy] || DEPLOY_META.none).label} — {(DEPLOY_META[app.deployPolicy] || DEPLOY_META.none).hint}</div>
      </Section>
      <Section title="Shared rulebooks (skills)" hint="Reusable playbooks injected into this loop's prompt as hard rules. Add more in fleet/skills/.">
        <div className="flex flex-wrap gap-2">{app.skills && app.skills.length ? app.skills.map((s, i) => <Chip key={i} className="bg-indigo-500/10 text-indigo-300 border-indigo-500/30"><BookText className="w-3 h-3" />{s}</Chip>) : <span className="text-sm text-slate-500">None. Reference a doc from fleet/skills/ via this app's "skills" list.</span>}</div>
      </Section>
      <Section title="Guardrails" hint="Hard rules the agent must never break.">
        <ul className="space-y-1.5">{app.guardrails.map((g, i) => <li key={i} className="flex items-center gap-2 text-sm text-slate-200 bg-rose-500/5 border border-rose-500/20 rounded-lg px-3 py-2"><ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />{g}</li>)}</ul>
      </Section>
      <Section title="Off-limits paths" hint="Files the loop is forbidden to touch.">
        <div className="flex flex-wrap gap-2">{app.offLimits.length ? app.offLimits.map((p, i) => <Chip key={i} className="bg-slate-800 text-slate-400 border-slate-700 font-mono">{p}</Chip>) : <span className="text-sm text-slate-500">None set.</span>}</div>
      </Section>
    </div>
  );
}

function CardStream({ app }) {
  const [lines, setLines] = useState([]);
  useEffect(() => {
    if (app.loop !== "running") { setLines([]); return; }
    let alive = true;
    const tick = () => fetch(`${API}/api/log?slug=${app.id}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (alive) { const L = (d.log || "").trim().split("\n").filter(Boolean); setLines(L.slice(-3)); } }).catch(() => {});
    tick(); const t = setInterval(tick, 4000); return () => { alive = false; clearInterval(t); };
  }, [app.id, app.loop]);
  if (!lines.length) return null;
  return (
    <div className="mt-3 rounded-lg bg-slate-950 border border-slate-800 p-2">
      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Agent working now — raw output</div>
      <pre className="text-[10px] leading-snug text-slate-400 whitespace-pre-wrap font-mono max-h-16 overflow-hidden">{lines.join("\n")}</pre>
    </div>
  );
}

function Stream({ app }) {
  const [log, setLog] = useState("");
  const [live, setLive] = useState(false);
  useEffect(() => {
    let alive = true;
    const tick = () => fetch(`${API}/api/log?slug=${app.id}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (alive) { setLog(d.log || ""); setLive(true); } }).catch(() => { if (alive) setLive(false); });
    tick(); const t = setInterval(tick, 2500); return () => { alive = false; clearInterval(t); };
  }, [app.id]);
  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-2 text-xs text-slate-400"><span className={`w-2 h-2 rounded-full ${live ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />Live Codex output for {app.name} · refreshes every 2.5s</div>
      <pre className="text-[11px] leading-relaxed text-slate-300 bg-slate-950 border border-slate-800 rounded-xl p-4 overflow-auto whitespace-pre-wrap" style={{ maxHeight: "65vh" }}>{log || "No agent run captured yet.\nWhen a loop runs Codex on this app, its live output (file reads, edits, reasoning, the result block) streams here."}</pre>
    </div>
  );
}

function ActivityFeed({ app }) {
  if (!app.activity || app.activity.length === 0) return <div className="text-sm text-slate-500 max-w-2xl">No loop activity yet. Runs will appear here as they happen.</div>;
  return (
    <div className="max-w-2xl">
      <p className="text-xs text-slate-500 mb-3">Newest first. Hover any line to see the raw engine log entry.</p>
      <div className="relative pl-5"><div className="absolute left-1.5 top-1 bottom-1 w-px bg-slate-800" />
      {app.activity.map((e, i) => (
        <div key={i} className="relative pb-4"><div className={`absolute -left-3.5 top-1 w-2.5 h-2.5 rounded-full bg-slate-950 border-2 ${ACT_KIND[e.kind] || ACT_KIND.info}`} />
          <div className="text-sm text-slate-200" title={e.msg}>{humanizeLog(e.msg)}</div></div>
      ))}
    </div></div>
  );
}

function Header({ title, subtitle, right }) {
  return (
    <div className="border-b border-slate-800 bg-slate-900 px-4 sm:px-6 py-3 min-h-16 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight leading-tight">{title}</h1>
        {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
      </div>
      {right && <div className="shrink-0 flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}
function LiveTag({ connected, updatedAt, onRefresh }) {
  return <button onClick={onRefresh} className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200"><span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-amber-500"}`} />{connected ? "Live" : "Reconnecting"}{updatedAt && <span className="text-slate-600">· {updatedAt.toLocaleTimeString()}</span>}<RefreshCw className="w-3.5 h-3.5" /></button>;
}
function Stat({ icon: Icon, label, sub, value, tone, onClick }) {
  const Tag = onClick ? "button" : "div";
  return <Tag onClick={onClick} className={`night-card rounded-xl p-4 text-left ${onClick ? "hover:border-slate-600 cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none" : ""}`}>
    <div className="flex items-center justify-between"><span className="text-xs text-slate-400">{label}</span><Icon className={`w-4 h-4 ${tone}`} /></div>
    <div className={`text-2xl font-semibold mt-1 ${tone}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
  </Tag>;
}
function Tab({ active, onClick, icon: Icon, label }) {
  return <button onClick={onClick} className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg transition-colors ${active ? "bg-white text-slate-900" : "text-slate-400 hover:bg-slate-800"}`}><Icon className="w-4 h-4" />{label}</button>;
}
function Section({ title, hint, children }) {
  return <div className="night-card rounded-xl p-4"><div className="font-medium text-sm">{title}</div>{hint && <div className="text-xs text-slate-500 mt-0.5 mb-3">{hint}</div>}{children}</div>;
}

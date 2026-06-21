import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  LayoutGrid, Inbox, Play, Pause, Square, Plus, Trash2, ChevronUp, ChevronDown,
  Circle, GitBranch, Clock, Terminal, AlertTriangle, CheckCircle2, XCircle,
  Activity, Settings, ListChecks, ArrowLeft, ShieldAlert, Zap, Bot, Edit3, FolderGit2,
  Search, GitMerge, Rocket, Wifi, WifiOff, RefreshCw, Lock, Brain, PlugZap, BookText,
  Bell, BellOff, FileDiff, Trophy, ShieldCheck,
  Key, Wallet, Cpu, ExternalLink,
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
    [/^AUTH-PAUSE.*/, () => `🔑 Agent login/quota problem — fleet paused itself (run codex login)`],
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
  return <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${className}`}>{children}</span>;
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
  const [fleetPause, setFleetPause] = useState(null);
  const [lastPass, setLastPass] = useState(null);
  const [current, setCurrent] = useState(null);
  const [connected, setConnected] = useState(null); // null=connecting, true, false
  const [view, setView] = useState("overview");
  const [activeAppId, setActiveAppId] = useState(null);
  const [appTab, setAppTab] = useState("backlog");
  const [toast, setToast] = useState(null);
  const [query, setQuery] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [soundOn, setSoundOn] = useState(() => { try { return localStorage.getItem("fleetSound") !== "off"; } catch { return true; } });
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
      setFleetPause(data.fleetPause || null);
      setLastPass(data.lastPass || null);
      setCurrent(data.current || null);
      setConnected(true); setUpdatedAt(new Date());
    } catch { setConnected(false); }
  }, []);
  useEffect(() => { pull(); const t = setInterval(pull, 6000); return () => clearInterval(t); }, [pull]);
  const post = (path, body) => fetch(`${API}/api/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(pull).catch(() => {});

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
  const addTask = (appId) => post("task", { slug: appId, action: "add", task: { id: nid("T"), title: "New task", status: "queued", difficulty: "medium", deps: [], ac: "Define acceptance criteria", files: "—" } });
  const deleteTask = (appId, tid) => post("task", { slug: appId, action: "delete", taskId: tid });
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
  const openApp = (id) => { setActiveAppId(id); setAppTab("backlog"); setView("app"); };

  if (connected === false && apps.length === 0) return <Disconnected onRetry={pull} />;
  if (connected === null && apps.length === 0) return <Connecting />;

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex font-sans text-[13px]">
      <aside className="w-60 shrink-0 border-r border-slate-800 bg-slate-900 flex flex-col">
        <div className="px-4 h-14 flex items-center gap-2 border-b border-slate-800">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center"><Bot className="w-4 h-4 text-white" /></div>
          <div className="font-semibold tracking-tight">FleetView</div>
          <button onClick={toggleSound} title={soundOn ? "Approval sounds on — click to mute" : "Muted — click to enable sounds + alerts"} className="ml-auto text-slate-400 hover:text-slate-200">{soundOn ? <Bell className="w-4 h-4 text-indigo-400" /> : <BellOff className="w-4 h-4" />}</button>
          <span title={connected ? "Live" : "Reconnecting"}>{connected ? <Wifi className="w-4 h-4 text-emerald-400" /> : <WifiOff className="w-4 h-4 text-amber-500" />}</span>
        </div>
        <div className="p-2">
          <div className="relative"><Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter apps" className="w-full bg-slate-800 rounded-lg pl-8 pr-2 py-1.5 text-xs border border-slate-700 focus:border-indigo-500 focus:outline-none" /></div>
        </div>
        <nav className="px-2 space-y-0.5">
          <SideItem active={view === "overview"} onClick={() => setView("overview")} icon={LayoutGrid} label="Fleet Overview" />
          <SideItem active={view === "approvals"} onClick={() => setView("approvals")} icon={Inbox} label="Approvals" badge={approvals.length} />
          <SideItem active={view === "trust"} onClick={() => setView("trust")} icon={ShieldCheck} label="Trust &amp; autopilot" />
          <SideItem active={view === "providers"} onClick={() => setView("providers")} icon={Key} label="Providers &amp; keys" />
          <SideItem active={view === "cost"} onClick={() => setView("cost")} icon={Wallet} label="Cost" />
        </nav>
        <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Apps ({filtered.length})</div>
        <div className="px-2 pb-3 space-y-0.5 overflow-y-auto">
          {filtered.map((a) => (
            <button key={a.id} onClick={() => openApp(a.id)} className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors ${view === "app" && activeAppId === a.id ? "bg-indigo-600/20 text-indigo-300" : "hover:bg-slate-800 text-slate-300"}`}>
              <span className={`w-2 h-2 rounded-full ${LOOP_STATES[a.loop]?.dot || "bg-slate-500"}`} /><span className="truncate">{a.name}</span>
            </button>
          ))}
        </div>
        <div className="mt-auto p-3 border-t border-slate-800 flex gap-2">
          <button onClick={runAll} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500"><Play className="w-3.5 h-3.5" /> Run all</button>
          <button onClick={pauseAll} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"><Pause className="w-3.5 h-3.5" /> Pause all</button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        {view === "overview" && connected && apps.length === 0
          ? <Onboarding onProviders={() => setView("providers")} />
          : view === "overview" && <Overview stats={stats} apps={filtered} onToggle={toggleLoop} onOpen={openApp} connected={connected} updatedAt={updatedAt} onRefresh={pull} post={post} fleetPause={fleetPause} lastPass={lastPass} current={current} milestones={milestones} onGoApprovals={() => setView("approvals")} onResume={() => { post("loop", { slug: "*", action: "resume" }); flash("Resumed — the fleet picks up on the next tick"); }} />}
        {view === "approvals" && <Approvals approvals={approvals} apps={apps} onResolve={resolveApproval} onOpen={openApp} />}
        {view === "trust" && <TrustPanel flash={flash} />}
        {view === "providers" && <ProvidersPanel flash={flash} />}
        {view === "cost" && <CostPanel />}
        {view === "app" && activeApp && <AppDetail app={activeApp} tab={appTab} setTab={setAppTab} post={post} onBack={() => setView("overview")} onToggle={toggleLoop} onStop={() => { post("loop", { slug: activeApp.id, action: "stop" }); flash(`${activeApp.name}: stopped`); }} onAddTask={addTask} onDeleteTask={deleteTask} onUpdateTask={updateTask} onMoveTask={moveTask} />}
        {view === "app" && !activeApp && <div className="p-10 text-slate-500">App not found.</div>}
      </main>

      {toast && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-white text-slate-900 text-sm px-4 py-2 rounded-lg shadow-lg z-50 font-medium">{toast}</div>}
    </div>
  );
}

function Connecting() {
  return <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center gap-3"><div className="w-5 h-5 border-2 border-slate-700 border-t-indigo-500 rounded-full animate-spin" />Connecting to the fleet service…</div>;
}
function Disconnected({ onRetry }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <PlugZap className="w-12 h-12 mx-auto mb-4 text-amber-500" />
        <div className="text-lg font-semibold">Fleet service isn't running</div>
        <p className="text-sm text-slate-400 mt-2">This dashboard only shows real loop state — there's no demo data. Start the local service, then reload.</p>
        <pre className="text-left text-xs bg-slate-900 border border-slate-800 rounded-lg p-3 mt-4 overflow-x-auto">cd fleet/runner && npm run serve:watch</pre>
        <button onClick={onRetry} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"><RefreshCw className="w-4 h-4" />Retry</button>
      </div>
    </div>
  );
}

function SideItem({ active, onClick, icon: Icon, label, badge }) {
  return <button onClick={onClick} className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${active ? "bg-indigo-600/20 text-indigo-300 font-medium" : "hover:bg-slate-800 text-slate-300"}`}><Icon className="w-4 h-4" /><span>{label}</span>{badge > 0 && <span className="ml-auto text-[11px] bg-rose-500 text-white rounded-full px-1.5 py-0.5">{badge}</span>}</button>;
}

function Overview({ stats, apps, onToggle, onOpen, connected, updatedAt, onRefresh, post, fleetPause, lastPass, current, milestones, onGoApprovals, onResume }) {
  // HEARTBEAT v2: per-app completions, plus what the tick is doing right now. A single app's
  // real agent run can take an hour — that's "working", not "stalled". Alarm ONLY when nothing
  // has completed recently AND nothing is in flight (or one app has hogged >95 min).
  const stepAge = lastPass ? (Date.now() - Date.parse(lastPass.at)) / 60000 : null;
  const curAge = current ? (Date.now() - Date.parse(current.since)) / 60000 : null;
  const stalled = connected && !current && (stepAge === null || stepAge > 40);
  const hogging = connected && current && curAge > 95;
  return (
    <>
      <Header title="Fleet Overview" subtitle="Every app, what it's doing right now, and what's waiting on you" right={
        <div className="flex items-center gap-3">
          {current && <span className="text-[11px] text-emerald-400/90 inline-flex items-center gap-1" title={`since ${current.since}`}><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />working: {current.app} · {Math.max(1, Math.round(curAge))} min</span>}
          {!current && lastPass && <span className={`text-[11px] ${stepAge > 40 ? "text-amber-400" : "text-slate-500"}`} title={lastPass.at}>last step: {lastPass.app} {timeAgo(lastPass.at)}{lastPass.live ? "" : " (dry-run)"}</span>}
          <LiveTag connected={connected} updatedAt={updatedAt} onRefresh={onRefresh} />
        </div>
      } />
      <div className="p-6 overflow-y-auto">
        {(stalled || hogging) && !fleetPause && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5" role="alert">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <div className="font-semibold text-amber-200">{hogging ? `One pass has been working on ${current.app} for ${Math.round(curAge)} minutes` : `Nothing has finished ${stepAge === null ? "since the service started" : `in ${Math.round(stepAge)} minutes`} and nothing is running`}</div>
              <div className="text-amber-200/80 mt-0.5">{hogging ? "Long runs can be legitimate, but past ~95 minutes it's usually wedged — a service restart (double-click Fleet) safely recovers it." : "The scheduler looks wedged. Double-click Fleet on your Desktop to restart it safely — the engine recovers interrupted work automatically."}</div>
            </div>
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
        {apps.length === 0 ? <div className="text-slate-500 text-sm py-16 text-center">No apps match.</div> : (
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
                <div key={a.id} className="bg-slate-900 rounded-xl border border-slate-800 p-4 hover:border-slate-700 transition-colors flex flex-col">
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

// PROVIDERS & KEYS — connect a coding agent. Either a CLI you've signed into (Codex/Claude), or
// a raw API key you bring (OpenAI/Anthropic/DeepSeek/Gemini/OpenRouter) or a local model (Ollama).
// Keys are verified, then stored in the macOS Keychain — never written to a config/state file.
function ProvidersPanel({ flash }) {
  const [data, setData] = useState(null);
  const [pending, setPending] = useState([]);
  const load = useCallback(() => {
    fetch(`${API}/api/providers`, { cache: "no-store" }).then((r) => r.json()).then((d) => setData(d.providers || [])).catch(() => setData([]));
    fetch(`${API}/api/setup-consent`, { cache: "no-store" }).then((r) => r.json()).then((d) => setPending(d.pending || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="p-10 text-slate-500">Loading providers…</div>;
  const clis = data.filter((p) => p.kind === "agentic-cli");
  const apis = data.filter((p) => p.kind === "api");
  return (
    <>
      <Header title="Providers &amp; keys" subtitle="Connect a coding agent — a CLI you've signed into, or an API key you bring" />
      <div className="p-6 overflow-y-auto max-w-3xl space-y-6">
        {pending.length > 0 && <SetupConsent pending={pending} flash={flash} reload={load} />}
        <div>
          <div className="text-sm font-semibold text-slate-300 mb-2">Coding agents (sign in with the CLI)</div>
          <div className="grid sm:grid-cols-2 gap-3">{clis.map((p) => <CliCard key={p.id} p={p} />)}</div>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-300 mb-1">Bring your own API key</div>
          <p className="text-xs text-slate-500 mb-3">Keys live in your Mac's Keychain — never in a file, never sent anywhere but the provider. You pay the provider directly.</p>
          <div className="space-y-2">{apis.map((p) => <ApiKeyCard key={p.id} p={p} flash={flash} reload={load} />)}</div>
        </div>
      </div>
    </>
  );
}
function CliCard({ p }) {
  return (
    <div className={`rounded-xl border p-3.5 ${p.connected ? "border-emerald-500/30 bg-emerald-500/5" : "border-slate-800 bg-slate-900"}`}>
      <div className="flex items-center gap-2">
        <Cpu className="w-4 h-4 text-slate-400" />
        <span className="font-medium text-slate-200">{p.label}</span>
        <span className={`ml-auto inline-flex items-center gap-1 text-[11px] ${p.connected ? "text-emerald-300" : "text-amber-300"}`}><span className={`w-1.5 h-1.5 rounded-full ${p.connected ? "bg-emerald-400" : "bg-amber-400"}`} />{p.connected ? "Connected" : "Not installed"}</span>
      </div>
      <div className="text-xs text-slate-500 mt-1.5">{p.blurb || p.detail}</div>
      {!p.connected && <div className="text-xs text-slate-400 mt-1">Install the <span className="font-mono">{p.id === "codex" ? "codex" : "claude"}</span> CLI and sign in, then press refresh.</div>}
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
  const remove = () => fetch(`${API}/api/provider-key`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: p.id, action: "delete" }) }).then(() => { flash(`${p.label} key removed`); reload(); });
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
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
          <div className="text-xs text-slate-400">This month</div>
          <div className="text-3xl font-semibold text-emerald-400 mt-1">{usd(d.monthUsd)}</div>
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

// ONBOARDING — the first-run welcome shown when no projects exist yet. Two honest steps:
// connect a coding agent (live status from /api/providers), then add your first project (the
// folder pick is a native menu action, so we point the user to it). Keeps the show-real-state law.
function Onboarding({ onProviders }) {
  const [providers, setProviders] = useState(null);
  useEffect(() => { fetch(`${API}/api/providers`, { cache: "no-store" }).then((r) => r.json()).then((d) => setProviders(d.providers || [])).catch(() => setProviders([])); }, []);
  const anyAgent = (providers || []).some((p) => p.connected);
  return (
    <>
      <Header title="Welcome to Fleet" subtitle="Your projects, working on themselves" />
      <div className="p-6 overflow-y-auto max-w-2xl">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-indigo-600 flex items-center justify-center"><Bot className="w-6 h-6 text-white" /></div>
            <div>
              <div className="text-lg font-semibold">Let's get your fleet working</div>
              <div className="text-sm text-slate-400">Two quick steps. Fleet studies each project, then works it toward "done" on its own — pausing only when it truly needs you.</div>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <div className={`rounded-xl border p-4 ${anyAgent ? "border-emerald-500/30 bg-emerald-500/5" : "border-slate-700 bg-slate-950"}`}>
              <div className="flex items-center gap-2">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${anyAgent ? "bg-emerald-500 text-white" : "bg-slate-700 text-slate-300"}`}>{anyAgent ? "✓" : "1"}</span>
                <span className="font-medium text-slate-200">Connect a coding agent</span>
                {providers && <span className={`ml-auto text-[11px] ${anyAgent ? "text-emerald-300" : "text-slate-500"}`}>{anyAgent ? "connected" : "not connected yet"}</span>}
              </div>
              <p className="text-sm text-slate-400 mt-2">Sign in with the Codex or Claude CLI, or paste an API key (OpenAI, Anthropic, DeepSeek, Gemini, OpenRouter) — or point Fleet at a local model. Without one, Fleet can read your code but can't work on it.</p>
              <button onClick={onProviders} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"><Key className="w-4 h-4" />{anyAgent ? "Manage providers" : "Connect an agent"}</button>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-950 p-4">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-slate-700 text-slate-300">2</span>
                <span className="font-medium text-slate-200">Add your first project</span>
              </div>
              <p className="text-sm text-slate-400 mt-2">Click the Fleet icon in your menu bar → <span className="text-slate-200 font-medium">Add Project…</span> and choose a folder that holds your code. Fleet always works on a private copy first, so nothing is ever at risk.</p>
              <p className="text-xs text-slate-500 mt-2">Tip: keep projects out of Downloads — macOS restricts background access there.</p>
            </div>
          </div>

          <p className="text-xs text-slate-500 mt-5">Once a project is added, Fleet studies it and shows you how it understands the codebase — you approve that before any work begins.</p>
        </div>
      </div>
    </>
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
  return <div className="border-b border-slate-800 bg-slate-900 px-6 h-14 flex items-center justify-between"><div className="min-w-0"><h1 className="text-lg font-semibold tracking-tight">{title}</h1>{subtitle && <div className="text-[11px] text-slate-500 -mt-0.5 truncate">{subtitle}</div>}</div><div className="shrink-0">{right}</div></div>;
}
function LiveTag({ connected, updatedAt, onRefresh }) {
  return <button onClick={onRefresh} className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200"><span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-amber-500"}`} />{connected ? "Live" : "Reconnecting"}{updatedAt && <span className="text-slate-600">· {updatedAt.toLocaleTimeString()}</span>}<RefreshCw className="w-3.5 h-3.5" /></button>;
}
function Stat({ icon: Icon, label, sub, value, tone, onClick }) {
  const Tag = onClick ? "button" : "div";
  return <Tag onClick={onClick} className={`bg-slate-900 rounded-xl border border-slate-800 p-4 text-left ${onClick ? "hover:border-slate-600 cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none" : ""}`}>
    <div className="flex items-center justify-between"><span className="text-xs text-slate-400">{label}</span><Icon className={`w-4 h-4 ${tone}`} /></div>
    <div className={`text-2xl font-semibold mt-1 ${tone}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
  </Tag>;
}
function Tab({ active, onClick, icon: Icon, label }) {
  return <button onClick={onClick} className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg transition-colors ${active ? "bg-white text-slate-900" : "text-slate-400 hover:bg-slate-800"}`}><Icon className="w-4 h-4" />{label}</button>;
}
function Section({ title, hint, children }) {
  return <div className="bg-slate-900 rounded-xl border border-slate-800 p-4"><div className="font-medium text-sm">{title}</div>{hint && <div className="text-xs text-slate-500 mt-0.5 mb-3">{hint}</div>}{children}</div>;
}

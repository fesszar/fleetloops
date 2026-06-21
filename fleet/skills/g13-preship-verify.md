# G13 — Pre-ship verification (verify, do NOT deploy)
**WHEN:** a task reaches "ready to ship / build / release / submit."
**DO:**
- Run read-only pre-ship gates: typecheck, lint, tests, secret-scan, env-var diff, build.
- Analyze blast radius (what this change can break) and contract hygiene.
- Then **ESCALATE the ship**, attaching a post-deploy checklist as acceptance criteria: health endpoint, smoke test, error-rate/latency check.
**DON'T:** deploy, restart, rsync/ssh, run `eas submit`/release scripts, or roll back. The loop/operator/CI ships; you produce a green, verified diff and hand off.
**WHY:** the agent's job is a verified change; shipping is a human-gated, escalated step (loop guardrail).

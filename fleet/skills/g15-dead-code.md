# G15 — Dead-code / dependency removal
**WHEN:** removal **is** the assigned task, or a direct, necessary consequence of it — never opportunistic.
**DO:**
- Trace every reference before deleting; remove in reverse-dependency order.
- Drop the dependency *and* its `@types`/lockfile entry; grep for ghosts afterward.
- Defer any DB drop to G12 (escalate it).
**DON'T:** clean up unrelated dead code mid-task (violates the loop's smallest-change rule); expand a focused change into a cross-layer purge — if it grows, stop and escalate.
**WHY:** dead code misleads, but unscoped removal is exactly the sprawl the loop forbids.

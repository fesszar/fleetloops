# G6 — Defensive seed / bootstrap data
**WHEN:** seed/bootstrap/default rows, first-run init, enabling sync.
**DO:**
- Make seeding idempotent by keying on stable identity (one row per `entityType+entityId`) or a one-time `seeded` flag.
- Handle both the missing and the already-exists case explicitly; create the default instead of crashing.
- Seed the outbox so the first sync ships the defaults.
**DON'T:** rely on a random primary key + `INSERT OR IGNORE` for idempotency (a fresh UUID never collides, so it dedupes nothing); wipe or duplicate user rows on re-run.
**WHY:** seeding must be safe to run more than once.

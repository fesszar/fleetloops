# G12 — Database schema-change safety
**WHEN:** migration, `ALTER`/`ADD`/`DROP`/`RENAME` column, any DB structure change.
**DO:**
- Use **expand → migrate → contract**, each a separately-deployable phase: add additively + dual-write → backfill as its own step → switch reads, then drop the old structure.
- Keep migration files immutable: one new file per change.
- Ship a reversible plan.
**DON'T:** rename/drop in a single step (data loss, no rollback); edit an already-applied migration; **execute destructive or production data ops yourself** — emit the plan + impact + rollback and **ESCALATE** (no human is in the run to confirm mid-flight).
**WHY:** additive, phased changes are the only zero-downtime, rollback-safe path.

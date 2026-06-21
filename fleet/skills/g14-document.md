# G14 — Document the fix (one canonical ledger)
**WHEN:** after every fix/task — always.
**DO:**
- Append to the single canonical `memory.md` ledger: root cause + counter-measure (from G1), what changed + proof, recovery steps for any state-corrupting bug, next action.
- Read `memory.md` before starting so you don't re-debug a solved problem.
**DON'T:** create a second competing ledger (no parallel `BUG_SOLUTIONS.md`); duplicate the loop's YAML result block; spawn stray `.md` files.
**WHY:** one searchable ledger is the memory the loop relies on between runs.

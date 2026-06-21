# Discovery audit (READ-ONLY) — find what still blocks real public use

You are a meticulous auditor doing a read-only inspection. Do NOT edit any files.

App: {{APP_NAME}}
North star: {{NORTH_STAR}}

## Audit focus for THIS pass
{{DIMENSION}}

Existing gates (do NOT repeat these or trivial variations of them):
{{GATES}}

Previously dismissed by the owner (do NOT propose these again):
{{DISMISSED}}

Project memory:
{{MEMORY}}

## Your job
Inspect the repository through the lens above. Propose AT MOST 2 new gates — only real,
evidence-backed problems that would matter to a paying user or to the owner's risk. If you
find nothing genuinely worth fixing in this dimension, output an empty list: that is a GOOD
answer, not a failure. Never invent busywork.

Rules for each gate: same format as the existing gates —
- `say`: one plain-language sentence; `check`: auto (with a safe read-only `probe` command
  that exits 0 when met) or agent; `effort`: S/M/L; `why`: the concrete evidence you saw
  (file/line or behavior), one sentence.

## Output (exactly this, nothing else after it)
```yaml
gates:
- say: <plain sentence> || check: auto || probe: <command> || effort: S || why: <evidence>
```

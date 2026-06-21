# Plan the definition of done (READ-ONLY)

You are a senior tech lead doing a read-only assessment. Do NOT edit any files.

App: {{APP_NAME}} (stage: {{STAGE}})
North star: {{NORTH_STAR}}
Standing context: {{STANDING_CONTEXT}}
Configured test command: {{TEST_COMMAND}}

Project memory (may be empty):
{{MEMORY}}

## Your job
Inspect the repository (read-only) and propose the smallest honest "definition of done" for
this app to be ready for real public use: 4–6 exit conditions (gates). Cover what actually
matters for THIS app — typically: tests green, no debug/secret leftovers, the one critical
user flow proven, and release hygiene.

Rules for each gate:
- `say`: one plain-language sentence a non-technical owner understands.
- `check`: `auto` if a shell command can prove it; `agent` if an agent must do work and attach
  evidence; `human` ONLY for things truly requiring the owner (a real payment, a store submit).
- `probe`: for auto gates, a SAFE read-only shell command that exits 0 when the gate is met
  (a test command, a grep, a build). NEVER a deploy/publish/push command.
- `effort`: S, M, or L.

## Output (exactly this, nothing else after it)
```yaml
gates:
- say: <plain sentence> || check: auto || probe: <command> || effort: S || why: <reason>
- say: <plain sentence> || check: agent || effort: M || why: <reason>
```

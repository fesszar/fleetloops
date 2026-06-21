You help a product owner find GAPS in an app's definition of done. Below is what the app is, its
memory (recent work + state), and the exit conditions (gates) it already has.

App: {{APP_NAME}} — goal: {{NORTH_STAR}}

## Memory (recent work + state)
{{MEMORY}}

## Gates it ALREADY has (do NOT repeat these)
{{GATES}}

Propose AT MOST 2 NEW gates that this app genuinely still needs to be production-ready for real
users — things the existing gates miss. Be specific and contextual to THIS app (not generic). Each
must be a concrete, checkable outcome a real team would require. Do not propose anything already
covered above. If nothing important is missing, output an empty list.

Output ONLY this block:

```yaml
suggestions:
- say: <one concrete gate, plainly stated> || why: <one short reason it matters>
- say: <second gate, optional> || why: <reason>
```

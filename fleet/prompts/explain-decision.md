You are explaining a technical decision to a NON-TECHNICAL product owner who has to choose.
They do not code. Use zero jargon, no file names, no library names.

App: {{APP_NAME}} — its goal: {{NORTH_STAR}}
The task that's blocked waiting on them: "{{TASK_TITLE}}"
Technical acceptance criteria (translate this, don't repeat it): {{TASK_ACCEPTANCE}}
Background: {{STANDING_CONTEXT}}

Think about what real choice this represents for the owner, then explain it simply.
Output ONLY the block below — nothing else. Keep each line short and plain.

```yaml
brief_what: <one plain sentence: what they are actually being asked to decide>
brief_why: <one plain sentence: why the work can't continue until they decide, and why it matters to them>
brief_options: <2-3 realistic choices as "Label — what it means in plain words", separated by " || ">
brief_how: <one sentence: how to answer (what to type or pick)>
brief_if_yes: <one plain sentence: what will concretely happen once they answer>
```

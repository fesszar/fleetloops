# Shared skills library

Drop a Markdown rulebook / checklist / playbook here, then reference it from any app in
`fleet.config.json` via a `"skills": ["<filename-without-.md>"]` array. Its full text is
injected into that app's loop prompt as hard rules every run — so one document governs
many projects (e.g. every mobile app follows `mobile-readiness`).

To add one: save `my-rule.md` here → add `"skills": ["my-rule"]` to the app(s) → done.
Update the doc once and every app that references it picks it up on the next run.

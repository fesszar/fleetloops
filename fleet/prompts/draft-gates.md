You are helping FleetLoops define what "done" means for one software project.

## Project
Name: {{APP_NAME}}
Stack: {{STACK}}
Mode: {{MODE}}
North star: {{NORTH_STAR}}

## Current Brain
{{BRAIN}}

## Detected Scripts And Commands
{{SCRIPTS}}

## Task
Propose 4-8 Definition-of-Done gates for this specific codebase.

A gate must be one of:

- `auto`: a single non-interactive shell command, runnable from the repository root. Exit 0 means the gate passes.
- `agent`: verifiable by a coding agent working in the repository.
- `human`: only for work that genuinely requires the owner, such as real payments, real deployment, app-store submission, legal review, or production account identity.

Prefer `auto` wherever a command can prove the result. Use `agent` for code review, UX flow, accessibility, or data behavior that cannot be proven by one existing command. Use `human` sparingly.

Auto probes must never push, publish, deploy, notarize, upload to a store, submit builds, run paid API calls, or mutate production services. Do not use commands in these categories: `git push`, deploy/publish/release commands, app-store/TestFlight/upload/promote/notarize commands, Vercel/Netlify/Firebase/Wrangler/Serverless/Fly/Heroku deploys, `gh release`, or package deploy scripts.

Return only this fenced YAML shape:

```yaml
gates:
  - say: "plain-language statement of done"
    check: auto|agent|human
    probe: "command"
    effort: S|M|L
    why: "one sentence tying this gate to THIS codebase"
```

# Fleet — an autonomous coding-agent fleet for macOS

Fleet points a coding agent at your projects and drives each one toward "done" on its own — reading the code, making changes on an isolated copy, proving them with the project's own tests, and pausing only when it genuinely needs you. It runs as a menu-bar app on macOS, backed by a zero-dependency Node engine.

Built by **Gideon Awolesi**. MIT-licensed.

> Status: research preview. The engine and dashboard are complete and covered by 195 passing tests; the macOS shell compiles and runs. Notarized distribution requires your own Apple Developer ID (see below).

## What it does

- **Works your backlog autonomously.** For each project it picks the next task, runs an agent inside an isolated git worktree, commits the result, runs your tests, and either merges (per your autonomy setting) or asks you to approve.
- **Brings any agent.** Use the Codex or Claude CLI you're signed into, **or** bring a raw API key — OpenAI, Anthropic, DeepSeek, Gemini, OpenRouter — **or** a local model via Ollama/LM Studio. A bundled agentic harness gives raw chat APIs the same file/command tools and safety as an agentic CLI.
- **Understands each project deeply.** It studies the codebase and writes up how it understands the architecture, conventions and risky paths; you approve that "project brain" before any work begins, and every run reads it.
- **Keeps you in control.** Multi-perspective AI review must pass before a merge; a definition-of-done checklist gates "ready"; an autonomy ladder earns more independence through clean streaks; and category-based autopilot lets you stop signing off on the kinds of work you trust.
- **Safe by construction.** It never deploys, publishes, or pushes on its own. Real payments, identity verification, and production secret rotation always escalate to a human. The local control bridge binds to loopback only and requires a per-install token; API keys live in the macOS Keychain, never on disk.

## Architecture

```
fleet/
├── runner/            zero-dependency Node engine (the loop, gates, consensus, autonomy, brain)
│   └── providers/     multi-provider layer: registry, agentic harness, OpenAI/Anthropic codecs
├── prompts/           the task + review prompts
├── web/               the dashboard (React, bundled to a self-contained app.js)
├── skills/            reusable playbooks injected into the agent's prompt as hard rules
├── config/            fleet.default.json — the de-personalized starting config (no apps)
├── install/           launchd/systemd service installers
└── apps/macos/        the native Swift menu-bar app (engine supervisor + WKWebView dashboard)
FleetView.jsx          dashboard source
```

The engine is **runtime-agnostic at one seam** (`adapters.mjs`): an agentic CLI runs unchanged, while a raw API routes through the in-process harness (`providers/harness.mjs`) that reads/writes files and runs commands on the agent's behalf, leaving the worktree mutated exactly as a CLI would — so the commit → gate → review → merge pipeline is identical for both.

## Run the engine (developer)

```bash
cd fleet/runner
npm run serve:watch        # starts the local bridge + scheduler at http://127.0.0.1:7777
```

Run the test suite (no network, no dependencies):

```bash
cd fleet/runner
for t in test-providers test-harness test-security test-config test-loop test-conditions test-integration; do
  FLEET_STATE_DIR=$(mktemp -d) node $t.mjs
done
```

Rebuild the dashboard bundle after editing `FleetView.jsx`:

```bash
bash fleet/web/build.sh
```

## Build the macOS app

```bash
cd fleet/apps/macos
swift run                  # dev: menu-bar app + engine
# or a signed, notarized build (needs your Apple Developer ID):
export DEVELOPER_ID="Developer ID Application: Your Name (TEAMID)"
export NOTARY_PROFILE="fleet-notary"
./build-app.sh             # → build/Fleet.app and build/Fleet.dmg
```

See `fleet/apps/macos/README.md` for the full native architecture (engine supervisor, Keychain, security-scoped folder bookmarks, login item, notifications) and the entitlements rationale.

## Security model (summary)

- Loopback-only bridge with a per-install bearer token and origin/CSRF checks.
- API keys stored in the macOS Keychain; never written to config or state; redacted from all logs.
- The agent never deploys/publishes/pushes; a single deploy denylist gates both the test gate and the harness's `run_command`.
- A project's `setup.sh` runs only after explicit user consent (content-hashed) when consent mode is enabled.

## License

MIT © 2026 Gideon Awolesi

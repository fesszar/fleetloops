# FleetLoops Redesign Gap Audit and End-to-End Fix Plan

Date: 2026-06-22

## Source Examined

The supplied `dsfbvnb.zip` contains two files:

- `FleetView.jsx` — 1,750 lines. This is the product redesign shell.
- `fleet-design-system.html` — 482 lines. This is the visual/design-system contract.

The shipped app currently uses the repo `FleetView.jsx`, not the zip file directly. The current app includes some live wiring for providers, keys, cost, app routing, approvals, brain review, and project add, but it does not implement the redesign's first-run/product workflow. The biggest visible failure is not styling; it is missing product state and native flow.

## Immediate Product Findings

### P0 — First launch bypasses onboarding whenever old local state exists

Expected from redesign:

- The user should enter a guided first-run flow before being dropped into the fleet deck.
- The flow must connect an agent, add or create a project, show the project brain/understanding, define done gates, and then launch.
- Design source: `/tmp/fleetloops-redesign-audit/FleetView.jsx:1058` through `/tmp/fleetloops-redesign-audit/FleetView.jsx:1350`.

Actual shipped behavior:

- Current React shows onboarding only when `apps.length === 0`: `FleetView.jsx:411`.
- Current Swift auto-opens the dashboard based on `RepoAccess.grantedPaths.isEmpty`, not product onboarding state: `fleet/apps/macos/Sources/Fleet/AppDelegate.swift:34`.
- The packaged app uses `~/Library/Application Support/Fleet/fleet.config.json`, so an existing creator/tester machine opens old apps immediately.

Fix:

- Add a real `fleet.onboarding` state object in config/state and expose it through `/api/state`.
- Make first-run logic depend on `fleet.onboarding.completed`, `fleet.onboarding.version`, and `fleet.onboarding.dismissedForExistingUser`, not `apps.length`.
- Rename the product/app namespace to FleetLoops or intentionally migrate old Fleet data with a clear choice. Do not silently reuse `~/Library/Application Support/Fleet` for a public FleetLoops install.

### P0 — Full onboarding wizard from the redesign is missing

Expected source inventory:

- Modal shell + stepper: `FleetView.jsx:1058-1112`
- Step 1, connect agent: `FleetView.jsx:1114-1154`
- Step 2, existing code vs new idea: `FleetView.jsx:1170-1231`
- Step 3, confirm understanding / project brain: `FleetView.jsx:1233-1274`
- Step 4, define done gates and policies: `FleetView.jsx:1276-1336`
- Step 5, launch: `FleetView.jsx:1337-1350`

Actual shipped behavior:

- Current onboarding is a two-card empty state only: `FleetView.jsx:1027-1074`.
- It disappears as soon as any app exists.
- It does not support a modal stepper, CLI/API path choice, code-vs-scratch mode, document attach, brain review, gate editing, policy selection, or launch confirmation.

Fix:

- Replace the two-card empty state with the redesign modal.
- Keep the existing live provider/key APIs, but integrate them into Step 1.
- Integrate native folder picker and a new scratch-project flow into Step 2.
- Make Step 3 block on a real project-brain/comprehension response.
- Make Step 4 persist gates and policies before any live loop starts.

### P0 — Connecting Codex/Claude is not an actionable flow

Expected from redesign:

- StepConnect offers "Sign in with a CLI" and "Bring an API key": `FleetView.jsx:1114-1154`.
- Settings shows Codex and Claude as subscription CLI contracts with connected state and model defaults: `FleetView.jsx:772-816`.
- Design-system billing distinction: `fleet-design-system.html:405-409`.

Actual shipped behavior:

- Current CLI cards only say "Install the codex/claude CLI and sign in, then press refresh": `FleetView.jsx:911-921`.
- There is no "Sign in" action for Codex or Claude from onboarding.
- The menu bar "Providers" action just opens the dashboard; it does not deep-link to onboarding/settings.

Fix:

- Add `POST /api/provider-cli` actions:
  - `check`: locate CLI, report installed/authenticated/needs-login.
  - `login`: open Terminal running `codex login` or `claude login`, or show a copyable command if Terminal launch fails.
  - `refresh`: re-check provider status.
- Add a Swift bridge message for opening Terminal/login commands when macOS native handling is better than runner subprocess handling.
- Persist provider preference chosen during onboarding into the project config.

### P0 — Project brain is not an onboarding gate

Expected from redesign:

- The understanding review is a first-class onboarding step: `FleetView.jsx:1233-1274`.
- The "brain" is the emotional payoff before work begins.

Actual shipped behavior:

- Brain review exists only after opening an app drawer or approval card: `FleetView.jsx:1398-1424`.
- Current onboarding text says the brain happens later but does not run or show it: `FleetView.jsx:1069`.
- `/api/brain` can read/approve/refine existing brain state, but there is no onboarding endpoint that creates a project and runs comprehension immediately.

Fix:

- Add `POST /api/onboarding/understand` that runs the read-only comprehension pass for the selected project/brief.
- Store the result in onboarding draft state and as proposed brain state for the app.
- Step 3 must show loading, success, partial, error, and retry states.
- Step 3 actions:
  - `Looks right — approve`
  - `Correct something`
  - `Re-study with my notes`

### P0 — Definition-of-done gate setup is not part of project creation

Expected from redesign:

- StepDone lets the user keep/drop/add gates and choose merge/ship policy: `FleetView.jsx:1276-1336`.
- Design system makes "who proves a gate" the product signature: `fleet-design-system.html:399-403`.

Actual shipped behavior:

- Project add writes config with empty `exitConditions` and maybe a test command as `gates`: `fleet/runner/project-onboard.mjs:99-123`.
- The planner later proposes gates in the loop, so the user does not get the redesign's upfront control.
- Current `GateChecklist` exists after the fact, not in onboarding.

Fix:

- Extend `addProjectToConfig` to accept onboarding gates with prover metadata:
  - `loop` / `shared` / `owner`
  - `enabled`
  - `source`
  - `status`
- Persist gates into `exitConditions` or a new normalized `conditionsSeed` that `ensureConditions` consumes without losing provenance.
- Add `POST /api/onboarding/gates` to save edits before launch.

### P1 — "New idea / scratch project" mode is unimplemented

Expected from redesign:

- StepAdd supports `Existing code` and `A new idea`: `FleetView.jsx:1177-1227`.
- Scratch mode accepts a plain-language brief and optional documents.

Actual shipped behavior:

- `POST /api/project` requires an existing folder: `fleet/runner/project-onboard.mjs:126-128`.
- Native bridge only opens folder picker.
- No repo scaffold, brief storage, source-doc import, or generated project plan exists.

Fix:

- Add `POST /api/scratch-project`:
  - Creates a new local git repo under a chosen workspace.
  - Writes `PROJECT_BRIEF.md`, `.fleet/brain.md` draft, `.fleet/CERTIFICATIONS.md`, and `.fleet/source-docs/`.
  - Seeds gates from the brief.
  - Starts paused until brain and gates are approved.
- Add native file/document picker support for optional PDFs/markdown/Figma exports/sketch files.

### P1 — App cockpit partially matches visually but not semantically

Expected from redesign:

- Drawer with Now, Gates, Runs, Diff, Brain: `FleetView.jsx:1387-1544`.
- Now tab has bootstrapping checklist and compact metrics: `FleetView.jsx:1440-1464`.
- Runs tab is run history, not backlog editing: `FleetView.jsx:1489-1513`.
- Diff view uses structured files/hunks: `FleetView.jsx:1576-1614`.
- Brain tab is a timeline of learned decisions/constraints, not only a textarea: `FleetView.jsx:1523-1539`.

Actual shipped behavior:

- Current drawer has the right tab names: `FleetView.jsx:1284-1330`.
- The Runs tab is currently backlog management: `FleetView.jsx:1327`.
- Diff is raw patch text from the approval route, not the structured visual diff from the design: `FleetView.jsx:1375-1395`.
- Brain tab is useful but closer to an editor than the design's timeline + approval moment: `FleetView.jsx:1398-1424`.

Fix:

- Split `Runs` from `Backlog`.
- Add run-history state to the runner and `/api/runs?appId=`.
- Add structured diff parsing for file/hunk/line rows.
- Add brain timeline entries for learnings, decisions, constraints, and owner notes.

### P1 — Settings feature coverage is uneven

Expected from redesign:

- Agents & keys with subscription-vs-metered warnings: `FleetView.jsx:772-872`.
- Routing by difficulty and fallback chain: `FleetView.jsx:874-939`.
- Spend cap sliders, parallel app limits, alert threshold: `FleetView.jsx:941-971`.
- Schedule: overnight backlog drain and quiet hours: `FleetView.jsx:973-1006`.
- Notification channels and categories: `FleetView.jsx:1008-1048`.

Actual shipped behavior:

- API keys are wired and real: `FleetView.jsx:882-960`, `/api/provider-key`.
- Per-app routing is real but lower fidelity: `FleetView.jsx:714-799`.
- Limits exist but are numeric fields, not the full design's cap/parallel/alert behavior: `FleetView.jsx:801-824`.
- Schedule only implements quiet-hour skip, not "drain backlog overnight": `FleetView.jsx:827-846`.
- Notifications support desktop/webhook, not per-category desktop/email/mobile channels: `FleetView.jsx:848-861`.

Fix:

- Implement the settings tabs to the design's structure while keeping current live APIs.
- Extend fleet config for:
  - `budget.alertPct`
  - `schedule.overnightDrain.enabled/start/end`
  - `notifications.channels.desktop/email/mobile`
  - notification category toggles: `needs`, `review`, `stuck`, `cap`, `win`
  - routing strategy: difficulty tiers and fallback chain

### P1 — Design-system contract is not formalized as reusable tokens/components

Expected from design system:

- Exact palette: `fleet-design-system.html:174-199`, `fleet-design-system.html:417-445`.
- Typography: Space Grotesk, IBM Plex Sans, IBM Plex Mono; telemetry in mono: `fleet-design-system.html:207-228`.
- 4px spacing scale and radii: `fleet-design-system.html:231-263`.
- Motion and reduced-motion behavior: `fleet-design-system.html:265-275`.
- Component anatomy and accessibility: `fleet-design-system.html:283-459`.

Actual shipped behavior:

- Current `NIGHT_CSS` approximates the palette and fonts, but component styling is scattered through JSX and Tailwind classes.
- There is no token file, component contract test, or screenshot parity test against the design.

Fix:

- Create `fleet/web/design-tokens.mjs` or `fleet/web/tokens.css`.
- Move repeated primitives into reusable React components:
  - `Button`
  - `StatusPill`
  - `PolicyChip`
  - `GateRow`
  - `KpiCard`
  - `Console`
  - `DiffViewer`
  - `ModalStepper`
  - `Drawer`
- Add a visual contract test that renders the critical states and compares screenshots.

## End-to-End Implementation Plan

### Phase 0 — Protect user data and restore clean product namespace

1. Decide product identity:
   - App display name: `FleetLoops`
   - Bundle id: `com.fleetloops.app`
   - Support dir: `~/Library/Application Support/FleetLoops`
   - Keychain service: `com.fleetloops.app.providerkey`
2. Add a one-time migration prompt for existing `Fleet` data:
   - `Start fresh`
   - `Import existing Fleet projects`
   - `Open old Fleet data read-only`
3. Add a menu item: `Restart onboarding…`.
4. Add tests proving a clean install cannot show old apps unless the user chooses import.

Acceptance:

- Downloaded DMG on a machine with old `Application Support/Fleet` does not silently open old apps.
- Existing data is not deleted.
- User can intentionally import or start fresh.

### Phase 1 — Add real onboarding state and API

Add to config:

```json
{
  "fleet": {
    "onboarding": {
      "version": "night-deck-1",
      "completed": false,
      "step": 0,
      "mode": null,
      "providerId": null,
      "projectDraft": null,
      "brainApproved": false,
      "gatesApproved": false
    }
  }
}
```

Add routes:

- `GET /api/onboarding`
- `POST /api/onboarding` with actions `reset`, `save-step`, `complete`, `dismiss-existing`
- Include onboarding summary in `/api/state`.

Acceptance:

- Onboarding opens when `completed === false`, regardless of `apps.length`.
- Closing/dismissing is explicit and reversible from the menu/settings.
- Step state survives app relaunch.

### Phase 2 — Implement redesign onboarding modal against live state

Replace current `Onboarding` with the design stepper:

- `StepConnect`
- `StepAdd`
- `StepUnderstand`
- `StepDone`
- `StepLaunch`

Make every step real:

- Step 1 reads `/api/providers`, saves selected provider path, triggers CLI login or API key save.
- Step 2 calls native folder/document pickers or scratch-project creation.
- Step 3 calls `/api/onboarding/understand`.
- Step 4 saves gates and policies.
- Step 5 starts the first loop only after approvals are persisted.

Acceptance:

- The first screen a new user sees is the modal stepper, not a populated old-app deck.
- The "Continue" button is disabled until each step has real data.
- Bad provider keys, missing CLI, duplicate repo, non-git repo, brain failure, and gate validation errors all show recoverable messages.

### Phase 3 — Provider connection and CLI login

Add provider CLI actions:

- Detect installed command (`codex`, `claude`).
- Detect likely auth state with a cheap non-mutating command.
- Open Terminal for login when unauthenticated.
- Refresh status after login.

Keep API key handling:

- `/api/provider-key` stays real and Keychain-backed.
- Add key delete/replace confirmation.
- Show model catalog and billing contract after verification.

Acceptance:

- A user can connect Codex CLI from inside onboarding.
- A user can paste and verify OpenAI/Anthropic/DeepSeek/Gemini/OpenRouter keys.
- Provider status survives relaunch.

### Phase 4 — Existing-code project creation with brain-first flow

Extend `POST /api/project` to accept:

- `providerId`
- `providerModel`
- `reasoning`
- `northStar`
- `autonomy`
- `deployPolicy`
- `gates`
- `startPaused`

After folder selection:

1. Detect stack and git status.
2. Create app config paused.
3. Run read-only comprehension.
4. Show understanding review.
5. Save approved brain.
6. Save gates and policies.
7. Start loop only after explicit launch.

Acceptance:

- New projects do not start live work before the user sees and approves the brain/gates.
- Non-git folders are paused with a clear recovery path.
- Duplicate project paths are blocked before side effects.

### Phase 5 — Scratch/new-idea project creation

Add scratch flow:

- Native destination folder picker.
- Optional source document picker.
- `POST /api/scratch-project`.
- Create git repo and starter files from the brief.
- Seed brain and gates from brief.
- Launch paused until Step 3/4 approvals.

Acceptance:

- User can start with no code.
- No scratch data is fake: generated repo, brief, source docs, gates, and brain are persisted.

### Phase 6 — Cockpit parity

Implement design-accurate app drawer behavior:

- `Now`: bootstrapping checklist, current work, raw console, pause/open folder.
- `Gates`: provenance-aware gate rows and legend.
- `Runs`: actual run history, not backlog.
- `Diff`: structured diff viewer.
- `Brain`: timeline plus editor/re-analysis.

Add endpoints:

- `GET /api/runs?appId=`
- `GET /api/run-diff?appId=&runId=`
- `GET /api/brain-timeline?appId=`

Acceptance:

- Runs tab shows historical runs from state/logs.
- Diff tab renders files/hunks/lines, not only raw patch text.
- Brain tab shows both approved text and timeline facts.

### Phase 7 — Settings parity

Extend live settings:

- Difficulty routing.
- Fallback chain.
- Fleet spend caps and alert threshold.
- Parallel app limit.
- Overnight drain schedule.
- Per-category notification channels.

Acceptance:

- Every design tab control persists through `/api/fleet-config` or `/api/app-config`.
- UI never displays hardcoded provider rows when real state exists.
- Empty states explain what to do next.

### Phase 8 — Design-system extraction and visual QA

Create explicit design primitives from `fleet-design-system.html`:

- Tokens
- Buttons
- Pills/chips
- Gate row
- KPI card
- Console
- Diff viewer
- Modal
- Drawer
- Tabs
- Toggles

Add screenshot fixtures:

- Clean first-run onboarding, each step.
- Existing data migration prompt.
- Provider connected and not connected.
- Existing-code project brain review.
- Scratch project brief.
- Gate setup.
- App cockpit tabs.
- Settings tabs.
- Mobile/narrow window states.

Acceptance:

- Browser and WKWebView screenshots match the supplied redesign structure.
- No layout clipping at 1100x760, 1440x900, and 390px mobile-width browser QA.

### Phase 9 — Release and regression gates

Required automated checks:

- Runner unit suite.
- Bridge onboarding integration tests.
- Provider-key tests.
- Project creation tests.
- Scratch-project tests.
- Brain/gate approval tests.
- Web build.
- Swift release build.
- Signed/notarized DMG.
- Clean-install app launch using isolated support dir.
- Existing-data migration launch using a seeded old Fleet support dir.
- GitHub Actions green.

Manual checks:

- Install DMG on a clean macOS user.
- Verify first screen is onboarding.
- Connect Codex CLI or paste a test provider key.
- Add a real temporary repo.
- Approve brain.
- Edit gates.
- Launch first loop.
- Quit/relaunch and verify step/progress persists.

Ship criteria:

- A fresh public install cannot open straight into the creator's old apps.
- A returning user can intentionally continue/import old data.
- Every visible onboarding control is functional.
- The released DMG contains the redesigned workflow, not just the dashboard skin.

## Implementation Order

1. Product namespace and data migration guard.
2. Onboarding state API and tests.
3. Full React onboarding modal using real provider/project state.
4. Native bridges for login, folder, and document selection.
5. Brain-first project add flow.
6. Gate/policy persistence.
7. Scratch-project flow.
8. Cockpit/settings parity.
9. Visual QA and native WKWebView screenshots.
10. Rebuild, sign, notarize, release `v0.2.0`.

## Non-Negotiables

- Do not import the redesign's hardcoded app arrays as real product data.
- Do not start live work before agent connection, brain approval, and gate approval.
- Do not silently reuse old local Fleet config in a public FleetLoops install.
- Do not call this fixed until the packaged DMG has been opened from a clean app-support state and screenshots prove the onboarding flow appears.

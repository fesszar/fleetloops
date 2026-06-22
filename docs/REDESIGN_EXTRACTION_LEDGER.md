# FleetLoops `dsfbvnb.zip` Extraction Ledger

Date: 2026-06-22

This is the exhaustive extraction inventory for the supplied redesign bundle. It is separate from `REDESIGN_FIX_PLAN.md`, which is the implementation plan derived from this inventory.

## Bundle Contents

`dsfbvnb.zip` contains exactly two files:

- `FleetView.jsx` — 1,750 lines.
- `fleet-design-system.html` — 482 lines.

Temporary extraction path used during audit:

- `/tmp/fleetloops-redesign-audit/FleetView.jsx`
- `/tmp/fleetloops-redesign-audit/fleet-design-system.html`

## `FleetView.jsx` Top-Level Inventory

Every top-level declaration in the supplied React file is accounted for below.

| Lines | Declaration | Extracted Meaning |
|---:|---|---|
| 1-11 | imports | React hooks, Lucide icon set, and Recharts area chart primitives. Current repo build does not use Recharts, so cost-chart parity needs either dependency support or an equivalent no-dependency chart. |
| 13-19 | product thesis comment | "Night deck" design: loop works each app toward provable Definition of Done; user only touches gates; color always pairs with icon and word. |
| 20-26 | `c` | Core color tokens: near-black blue surface, brand/action colors, semantic status hues, error/gold. |
| 27-31 | `font` | Typeface roles: Space Grotesk display, IBM Plex Sans body, IBM Plex Mono telemetry. |
| 34-39 | `STAGE` | Maturity lifecycle: `dev`, `shipping`, `feature`, `live`, each with label/color/icon. |
| 41-47 | `STATUS` | Activity state: `working`, `ready`, `waiting`, `idle`, `born`; separate from lifecycle stage. |
| 49-52 | `MERGE` | Merge policy chips: `auto` and `approve`. |
| 54-58 | `PROV` | Gate provenance model: `self` loop proves, `shared` agent works/user confirms, `owner` only user confirms. This is the signature product pattern. |
| 60 | `G` | Gate factory with `text`, `prov`, `state`, `found`; states are `done`, `confirm`, `proving`, `todo`. |
| 61-131 | `apps` | Static design-fixture app dataset showing all intended states: scratch/bootstrapping, ready, waiting, live, shipping, promoted, owner gates, review counts, need-you counts, API spend, raw console lines. Must not be shipped as data, but the state shapes are a spec. |
| 133-140 | `recentWins` | Overview "Recent wins" strip structure with `gate` and `app`. |
| 143-267 | `FleetView` | Main app shell: sidebar, nav, app list, run/pause all controls, overview/approvals/trust/settings/cost views, onboarding modal trigger, app cockpit drawer trigger. Uses local fixture state in the design file. |
| 270-273 | `Boxesish` | Inline product mark: 2x2 grid with plus-like final cell. Current shipped app uses generic Bot icon, so brand mark is a mismatch. |
| 276-332 | `Overview` | Fleet overview screen: header, live/held heartbeat, elapsed time, Add project CTA, KPI strip, app grid, Recent wins. |
| 334-347 | `Kpi` | Clickable KPI card pattern with icon, mono big value, label, note, optional action. |
| 349-440 | `AppCard` | Standard app card: stage/status/policy/provider/spend chips, current work, backlog bar, Definition-of-Done gate accordion, raw console, Pause/Open actions. |
| 442-496 | `EarlyAppCard` | Bootstrapping/scratch app card: "From your idea" tag, setup checklist, progress bar, raw console, gates draft note. |
| 498-508 | `WorkLine` | Current-work summary states: waiting on decision, no ready work, next up. |
| 510-530 | `GateRow` | Core gate row with state icon, provenance line, confirm/not-yet buttons for human-signable states. |
| 532-546 | `RawConsole` | Recessed raw-output preview with live beacon, mono text, error coloring, bottom fade. |
| 549-634 | `Approvals` | Approval inbox with tabs, question card, review card, recommendation/what-happens explainer, decision textarea, approve/send-back/reject actions, expandable diff. |
| 636-650 | `Hd` | Approval card header component with icon container, pill, title, timestamp. |
| 652-654 | `Verdict` | AI reviewer verdict line with tag and `REVISE` label. |
| 655-670 | `Explainer` | "What happens when you click" component mapping each action to outcome and optional example. |
| 673-720 | `Trust` | Trust/autopilot screen: explanatory rule card, hard floors, category rows with approval/send-back stats and autopilot toggle. |
| 723-753 | `Settings` | Settings screen wrapper with tabs: Agents & keys, Routing, Spend & limits, Schedule, Notifications. |
| 756-770 | `MODELS` | Static model/pricing catalogues for Codex, Claude, OpenAI, Anthropic, DeepSeek. Some names/prices are design placeholders and need live registry reconciliation. |
| 772-834 | `AgentsKeys` | Provider settings: CLI subscription cards, API-key providers, Anthropic-overrides-Claude warning, Local/Ollama ready row. |
| 836-872 | `KeyRow` | API key card: connected/not connected status, paste key input, Save & verify, connected model chips, Remove key, "Where do I get a key?" link. |
| 874-930 | `Routing` | Routing screen: route by difficulty, fallback chain, per-app provider/model assignment, metered/subscription indicator. |
| 932-939 | `RouteChip` | Small routing chip with uppercase label and model. |
| 941-971 | `Limits` | Spend/limit controls: daily spend cap slider, parallel apps slider, warn-early threshold slider. |
| 973-1006 | `Schedule` | Schedule controls: drain backlog overnight, quiet hours, start/end times. |
| 1008-1043 | `Notifications` | Notification settings: event categories and desktop/email/mobile channels. |
| 1045-1046 | `SectionLabel` | Settings section label primitive. |
| 1048-1056 | `Toggle` | Switch primitive with `role="switch"` and `aria-checked`. |
| 1058-1112 | `Onboarding` | Full modal stepper shell with four named steps plus final launch state; persistent modal header, progress bars, back/cancel/continue footer. |
| 1114-1154 | `StepConnect` | Step 1: choose CLI subscription or API key, Codex/Claude sign-in rows, API-key input, Keychain helper text. |
| 1155-1168 | `PathCard` | Two-option connection card used in StepConnect. |
| 1170-1231 | `StepAdd` | Step 2: choose existing code or new idea; existing-code folder chooser; scratch-project brief textarea; optional document attachments. |
| 1233-1274 | `StepUnderstand` | Step 3: project-brain/understanding review for code or scratch mode, with facts table and "Correct something" action. |
| 1276-1323 | `StepDone` | Step 4: Definition-of-Done gate setup, keep/drop gates, add gate, merge policy, ship policy. |
| 1324-1335 | `PolicyPick` | Small selectable policy group. |
| 1337-1350 | `StepLaunch` | Final onboarding state: "The loop is running" / "The fleet is building it", Go to deck CTA. |
| 1355-1361 | `sampleRuns` | Run-history fixture shape: id, title, timestamp, status, branch, duration, cost. |
| 1363-1369 | `RUN_STATUS` | Run status chips: review, merged, sent back, stuck. |
| 1371-1375 | `sampleBrain` | Brain timeline fixture shape: tag, timestamp, text. |
| 1377-1385 | `sampleDiff` | Structured diff fixture: file path, add/delete counts, hunks, lines typed as add/del/context. |
| 1387-1544 | `AppDrawer` | Single-app cockpit drawer: header chips, tabs Now/Gates/Runs/Diff/Brain, bootstrapping view, metrics, raw output, gate list, run history, structured diff, brain timeline. |
| 1545-1546 | `Field` | Uppercase mono field label primitive. |
| 1548-1554 | `Mini` | Small metric card primitive. |
| 1555-1560 | `Console` | Full console well primitive. |
| 1561-1567 | `Empty` | Empty state primitive with icon and text. |
| 1568-1574 | `Legend` | Gate provenance legend from `PROV`. |
| 1577-1581 | `DiffView` | Structured diff viewer wrapper. |
| 1583-1614 | `DiffFile` | Collapsible file diff with hunk header, add/delete/context row tinting, horizontal scroll. |
| 1616-1670 | `Cost` | Cost screen: month total, area chart, per-app spend bars, provider color coding, subscription-CLI note. |
| 1673-1681 | `StatusPill` | Activity pill with optional beacon dot. |
| 1682-1688 | `Chip` | Policy/stage/provider chip primitive. |
| 1689-1695 | `CountPill` | Tappable outlined count pill. |
| 1696-1702 | `Bar` | Progress bar with gradient fill and `.6s` transition. |
| 1703-1707 | `IconBtn` | 32px icon button with label/title. |
| 1709 | `cardBase` | Base card surface: panel, border, 14px radius. |
| 1710-1711 | `primaryBtn` | Brand-deep primary button. |
| 1712 | `primaryBtnGreen` | Green approval button. |
| 1713-1714 | `whiteBtn` | Neutral white/open button. |
| 1715-1716 | `ghostBtn` | Secondary/ghost button. |
| 1717-1718 | `miniBtn` | Small confirmation button. |
| 1719-1720 | `linkStyle` | Inline link-button style. |
| 1722-1750 | `CSS` | Font imports, selection color, focus-visible ring, card/nav hover, gate hover, link hover, beacon/pulse/fade/slideup animations, range input styling, placeholder color, reduced-motion override. |

## Intended Navigation and Screens

From `FleetView.jsx:160-166`:

- `Fleet Overview`
- `Approvals`
- `Trust & autopilot`
- `Settings`
- `Cost`

Overlay surfaces:

- Onboarding modal: `FleetView.jsx:1058-1350`
- App cockpit drawer: `FleetView.jsx:1387-1544`

Sidebar controls:

- Notifications icon
- Online/Wifi status
- Filter apps input
- Add project icon button
- App list
- Run all
- Pause all

## Data Shapes Implied by the Design

### App

Derived from `apps` fixture lines 61-131:

- `id`
- `name`
- `stage`
- `status`
- `merge`
- `ship`
- `phase`
- `desc`
- `born`
- `provider`
- `model`
- `spend`
- `setup`
- `dod`
- `dodTotal`
- `dodGreen`
- `raw`
- `work`
- `next`
- `backDone`
- `backTotal`
- `toGrad`
- `paused`
- `needYou`
- `review`
- `promoted`

### Gate

Derived from `G` and `PROV` lines 54-60:

- `text`
- `prov`: `self` / `shared` / `owner`
- `state`: `done` / `confirm` / `proving` / `todo`
- `found`

### Onboarding Draft

Derived from lines 1058-1350:

- `step`
- `path`: `cli` / `key`
- `mode`: `code` / `scratch`
- `folder`
- `brief`
- `files`
- `understandingFacts`
- `gates`
- `mergePolicy`
- `shipPolicy`

### Run

Derived from `sampleRuns` lines 1355-1361:

- `id`
- `title`
- `when`
- `status`
- `branch`
- `dur`
- `cost`

### Brain Timeline Entry

Derived from `sampleBrain` lines 1371-1375:

- `tag`
- `when`
- `text`

### Diff

Derived from `sampleDiff` and `DiffFile` lines 1377-1385 and 1583-1614:

- `path`
- `add`
- `del`
- `hunks`
- `hunks[].h`
- `hunks[].lines[]`
- line tuple type: `add`, `del`, `ctx`

## Feature Inventory From the React Design

### Overview

- Live/held heartbeat.
- Elapsed timer.
- Add Project CTA.
- Four KPI cards:
  - Working right now.
  - Need your attention.
  - Definition-of-done gates.
  - Tasks completed.
- App cards in responsive grid.
- Recent wins strip.
- App card supports:
  - Lifecycle stage label.
  - Activity status pill.
  - Merge policy chip.
  - Promoted chip.
  - Ship policy chip.
  - Provider/model/spend metadata.
  - Current work line.
  - Backlog progress bar.
  - Need-you count pill.
  - Definition-of-Done accordion.
  - Raw output console.
  - Pause/Open actions.
- Early/scratch app card supports:
  - "From your idea" tag.
  - Setup checklist.
  - Setup progress bar.
  - Gates draft note.

### Approvals

- Tabs: All, Questions, Reviews.
- Question card:
  - "the agent has a question" pill.
  - App/task metadata.
  - What it reported.
  - More background expand.
  - "What happens when you click."
  - Decision textarea.
  - Submit decision.
  - Reject.
- Review card:
  - "finished work — review it" pill.
  - Plain summary.
  - Safe branch explanation.
  - Second-AI reviewer verdicts.
  - Expandable diff.
  - "What happens when you click."
  - Approve & merge.
  - Send back to improve.
  - Reject & discard.

### Trust & Autopilot

- Explains category-level trust, not button-level trust.
- Lists never-auto-approved floors:
  - Live apps with real users.
  - Owner-only gates.
  - Secrets/migrations/payment safety.
  - Reviewer objections.
- Category rows include:
  - Category name.
  - Approved count.
  - Sent-back count.
  - App count.
  - Last action age.
  - Recommendation signal.
  - Toggle autopilot on/off.

### Settings

Tabs:

- Agents & keys.
- Routing.
- Spend & limits.
- Schedule.
- Notifications.

Agents & keys:

- Footgun warning when Anthropic API key overrides Claude subscription.
- CLI subscription cards for Codex and Claude Code.
- API key cards for OpenAI, Anthropic, DeepSeek, Gemini, OpenRouter.
- Local Ollama/LM Studio ready row.
- API key save/verify input.
- Connected model chips.
- Remove key.
- "Where do I get a key?"

Routing:

- Route by difficulty.
- Routine gates -> cheap model.
- Standard work -> standard model.
- Hard/risky -> flagship model.
- Fallback chain for rate limits.
- Per-app assignment rows.
- Metered/subscription indicators.

Spend & limits:

- Daily spend cap slider.
- Parallel apps slider.
- Warn-me-early threshold slider.

Schedule:

- Drain backlog overnight.
- Quiet hours.
- Time range display.

Notifications:

- Event toggles:
  - Needs decision.
  - Review ready.
  - Stuck.
  - Spend threshold.
  - Graduated/win.
- Channel toggles:
  - Desktop.
  - Email.
  - Mobile.

### Onboarding

Modal-level features:

- Centered overlay.
- Close button.
- Brand mark.
- Stepper bars.
- Back/Cancel/Continue footer.
- Disabled Continue until required data exists.
- Final "READY" state.

Steps:

1. Connect an agent.
   - CLI subscription path.
   - API-key path.
   - Codex sign-in row.
   - Claude sign-in row.
   - API key paste + save & verify.
   - Keychain reassurance.
2. Add a project.
   - Existing code mode.
   - New idea/scratch mode.
   - Folder chooser.
   - Drag folder affordance.
   - Downloads folder warning.
   - Brief textarea.
   - Optional documents.
3. Confirm understanding.
   - Code facts or scratch facts.
   - Facts table.
   - Correct something action.
4. Define done.
   - Drafted gates.
   - Toggle gates on/off.
   - Provenance labels.
   - Add gate.
   - Merge policy.
   - Ship policy.
5. Launch.
   - Loop running/building message.
   - Go to deck.

### App Cockpit Drawer

Header:

- App name.
- Lifecycle stage.
- Activity status.
- Merge policy.
- Promoted chip.
- Ship policy.
- Provider/model chip.
- Close button.

Tabs:

- Now.
- Gates.
- Runs.
- Diff.
- Brain.

Now:

- Bootstrapping checklist for new/scratch apps.
- Metrics for existing apps:
  - Tasks done.
  - Gates green.
  - To graduation.
  - Spend/run.
- Raw output console.
- Pause this app.
- Open folder.

Gates:

- Definition-of-Done progress.
- Gate rows.
- Provenance legend.
- Show fewer/all.
- Add gate.

Runs:

- Run history cards.
- Status chip.
- Run ID, branch, duration, cost.
- View diff.
- Open in Approvals for review/stuck.

Diff:

- Latest run branch metadata.
- Structured diff viewer.

Brain:

- Explanation that the app's learnings/decisions are saved and read before every run.
- Timeline entries with tags:
  - decision.
  - constraint.
  - learning.

### Cost

- Month total.
- "Spend this month" area chart.
- Per-app spend bars.
- Provider-colored rows.
- Subscription CLI note.

## `fleet-design-system.html` Section Inventory

Every major section in the design-system file is accounted for below.

| Lines | Section | Extracted Rules |
|---:|---|---|
| 150-152 | Header | Product/design-system framing: "Night deck"; autonomous-agent cockpit; calm command over dashboard noise; color carries meaning; telemetry mono; key signature is who proves each gate. |
| 156-166 | TOC | Color, Type, Space & form, Motion, Components, Patterns, Tokens, Accessibility. |
| 170-205 | Color | Near-black blue base; semantic palette; status color always ships with icon and word; tinted-fill rule. |
| 174-181 | Brand/surfaces | Brand `#5B6CFF`, brand deep `#4C5AE0`, background `#0A0F1C`, panel `#111A2C`, raised `#172339`, console `#070C16`. |
| 184-189 | Text | Text `#EAF0FB`, sub `#AAB6CC`, muted `#8693AB`, all with stated contrast ratios. |
| 191-199 | Status signals | Working `#5CC8FF`, needs-you `#FFC34D`, done `#54E0A6`, idle `#9BA8BE`, gold `#FFCE73`, error `#FF8A9B`; each has defined semantic ownership. |
| 207-229 | Typography | Space Grotesk display, IBM Plex Sans body/UI, IBM Plex Mono telemetry; every number, ID, path, price, telemetry readout is mono. |
| 218-228 | Type scale | Display 50/700, H1 26/700, H2 21/700, card title 18/700, body 14/400, label 13.5/600, mono big 34/600, mono label 11/500. |
| 231-263 | Space/form | 4px base; radii climb with component size; quiet elevation via border first, shadow only on lift/overlays. |
| 236-245 | Spacing | `s1=4`, `s2=8`, `s3=12`, `s4=16`, `s5=20`, `s6=24`, `s8=32`. |
| 247-253 | Radius | `sm=8`, `md=10`, `lg=14`, `xl=18`, pill `999`. |
| 256-262 | Elevation | Resting border only, hover soft lift, overlay large shadow. |
| 265-275 | Motion | Beacon means alive, pulse means active proving step, fast `.18s`, mid `.28s`, bar fill `.6s`, all disabled under reduced motion. |
| 279-383 | Components | Buttons, status pill, stage label, policy chips, count pills, toggles, progress bars, gate rows, KPI cards, console, diff lines. |
| 283-297 | Buttons | Primary brand-deep, green only for Approve & merge, white for neutral Open, ghost for secondary/destructive; 11x16 padding, 10 radius, 13.5/600, >=40px target, focus ring. |
| 300-319 | Status/chips | Activity and maturity are separate axes; policy chips encode merge/ship policy; count pills are outlined and jump to queues. |
| 321-340 | Toggles/bars | Toggle uses `role="switch"`; progress bars have explicit numbers; backlog progress brand, Definition-of-Done done-green. |
| 342-359 | Gate row | Signature component; state icons; provenance labels; confirm buttons only when human can sign off. |
| 361-382 | KPI/console/diff | Console is darkest recessed surface; error lines use error hue; diff header working-blue; add/remove row tints and mono. |
| 385-410 | Patterns | Lifecycle, who proves a gate, and two billing contracts are the three repeating product relationships. |
| 390-397 | Lifecycle | In development -> Shipping -> Feature-complete -> Live with users -> continuous audits. |
| 399-403 | Who proves a gate | Loop proves what it can; shared gates agent works/user confirms; owner-only gates are human-only. Autopilot can only sign first two. |
| 405-409 | Billing contracts | Codex/Claude subscription CLIs are flat-cost and never metered; API keys are pay-per-token, Keychain-stored, surfaced in Cost. |
| 413-447 | Tokens | Copy-ready CSS custom properties and JSON token map. |
| 417-432 | CSS tokens | Full token set for surfaces, text, brand/status, type, radius, motion. |
| 434-446 | JSON tokens | Same token set in JSON with spacing array. |
| 449-460 | Accessibility | Contrast, not color alone, visible focus, reduced motion, semantic tab/switch/nav/KPI markup, target sizes. |

## Design-System Non-Negotiables Extracted

- Status meaning cannot be color-only; it needs icon and word.
- Activity status and lifecycle stage are separate axes.
- Gate provenance is a first-class product concept.
- Every number/path/price/run ID/branch/timestamp/telemetry value is mono.
- Definition-of-Done progress uses done-green, not generic brand.
- Backlog/progress uses brand.
- "Approve & merge" is the only green primary action.
- Destructive actions are ghost buttons with error hue.
- Tabs must be real tablists.
- Toggles must use `role="switch"` and `aria-checked`.
- KPI strip should be `aria-live`.
- Reduced motion disables beacon, pulse, slide, fade.
- The onboarding modal uses the largest radius tier (`18px`) and overlay shadow.

## Where Current v0.1.0 Is Closest

These design concepts are partially present in the current repo:

- Night palette approximation.
- Sidebar and top-level nav labels.
- Provider key API/keychain-backed flow.
- Cost totals from real cost ledger.
- Trust/autopilot with real server rules.
- App drawer tabs named Now/Gates/Runs/Diff/Brain.
- Brain editor/approval route.
- Gate checklist with live state.
- Approval cards using real approvals.

## Where Current v0.1.0 Is Materially Missing

These are not just polish gaps; they are product-surface gaps against the zip:

- Full onboarding modal and stepper.
- Onboarding state independent of `apps.length`.
- Clean public install namespace separate from old creator `Fleet` state.
- CLI sign-in actions for Codex/Claude.
- Existing-code vs scratch-project mode.
- Document attachment flow.
- Brain review as an onboarding gate.
- Definition-of-Done setup before launch.
- Merge/ship policy selection during onboarding.
- Scratch project repo creation.
- Early app bootstrapping card backed by real setup state.
- Runs tab as run history instead of backlog editor.
- Structured diff viewer with file/hunk/line rows.
- Brain timeline.
- Difficulty routing strategy.
- Fallback chain.
- Parallel app slider.
- Warn-early spend threshold.
- Overnight backlog drain.
- Notification event/category/channel toggles.
- Recharts-like cost trend or equivalent visual chart.
- Boxesish brand mark.
- Formal token/component contract tests.

## Implementation Implication

The redesign cannot be implemented by copying `FleetView.jsx` from the zip into the repo, because the zip uses fixture arrays and local state. The correct implementation is to:

1. Preserve the design-system tokens, component shapes, information architecture, and workflows.
2. Replace fixture state with bridge-backed state and new bridge endpoints.
3. Add native macOS affordances where the design assumes real OS behavior: folder picker, document picker, CLI login launch, clean-install data namespace, open folder.
4. Add tests and screenshot QA for every extracted screen/state above.

# Production Readiness Bar

An app is NOT done when it builds or renders. It is done when a real user can install/open
it, complete every core task, recover from errors, and trust it — and when it provably meets
this app's own design, accessibility, and quality contracts. Until every gate below passes,
there is always more work to do.

## Priority order — what's most valuable first
When choosing what to do (or judging if the assigned task is the right one), use this order:
1. Anything BROKEN that blocks a core user flow, or a red CI / failing test.
2. The gate that blocks the most users from completing the core flow (usually UX/usability, then accessibility).
3. Remaining failing checks, then the lower-traffic gates.
4. Polish only after all of the above pass with evidence.
Never spend a run on cosmetic tidying while a higher item is open.

## How to work a readiness task
1. First, FIND this repo's own standards and enforce them — do not invent your own:
   - Design: `DESIGN.md`, `design.md`, design tokens, `*-contract*`, a `design:verify` / `design:enforce` script.
   - Memory/ledger: `memory.md` (read it for current state + known issues; update it when done).
   - Agent rules: `AGENTS.md`.
   - CI: `.github/workflows/*` — these checks are the source of truth for "green".
2. Verify with real evidence (test output, a screenshot, a CI run) — never claim a gate passed without proof.
3. If you find problems, FIX the smallest set that makes the gate pass; if it needs a human
   decision or a credential, `result: ESCALATE` with a plain-language explanation.
4. Update `memory.md` with what you verified and what's left.

## The gates (every app must pass all of them before real users)

### 1. Build & automated tests green (CI/CD)
- The repo's full test suite passes locally AND on GitHub Actions for the branch.
- Never merge with a red pipeline. If CI is the deploy path, let CI deploy — do not deploy by hand.

### 2. Visual QA — every screen
- Open every screen/route and confirm: nothing overflows, is cut off, overlaps, or mis-aligns;
  spacing/typography are consistent; dark/light and small/large sizes look right.
- Capture screenshots as evidence. No "renders" hand-waving.

### 3. Design-contract compliance
- The UI matches this repo's DESIGN.md / tokens / component contracts exactly (radii, color,
  spacing, states). Run the app's own design checker if one exists; fix every drift.

### 4. Accessibility — WCAG 2.1 AA
- Color contrast ≥ 4.5:1 (text) / 3:1 (large text & UI). All controls have labels/names.
- Full keyboard navigation + visible focus order; no keyboard traps. Touch targets ≥ 44px.
- Screen-reader announces meaningful content and state changes.

### 5. UX & usability
- Every core user flow completes end-to-end with real data (not seeded/demo).
- Every screen handles empty, loading, partial, error, and success states.
- No dead ends, no no-op buttons; every action gives feedback within ~100ms.
- First-run/onboarding makes the value obvious; recovery from failure is possible.

### 6. Trust & content
- No fake/demo data presented as real. No secrets in the bundle or logs.
- Copy is clear and user-facing (not internal/dev wording). Legal/store text is accurate.

## Evidence & not repeating work
- Save proof (screenshots, logs) to `.fleet/evidence/` in the repo and record in `memory.md` what
  passed and when. The next run reads `memory.md` first and `result: SKIP`s (with that citation)
  any gate already proven on unchanged code — do NOT re-open/re-check unchanged surfaces.
- A re-audit covers ONLY what changed since the last green audit (use `git diff` + `memory.md`),
  never the whole app from scratch.

## Definition of "real-user-ready"
All six gates pass with evidence, CI is green, and `memory.md` records the proof. Once an app is
fully proven and unchanged, the loop should SKIP its readiness tasks (citing memory.md) rather
than burn tokens re-checking — it is done until the next real change.

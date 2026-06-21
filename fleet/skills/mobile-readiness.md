# Mobile App Readiness Playbook

Use this document as a drop-in operating rulebook for any production mobile app. It is intentionally generic enough for any app, but concrete enough to prevent the same categories of failures that show up during real App Store / Play Store releases.

The bar is not "the app renders." The bar is: a real user can install the release build, complete the core workflows, recover from failure states, understand the value, trust the product, and find the app in the stores.

---

## 0. Non-Negotiable Operating Rules

- Do not call a feature done until it works end to end with real data.
- Do not trust config files alone; inspect the final native artifacts.
- Do not trust build success alone; run the release binary on simulator/emulator or device.
- Do not rely on memory or chat history; every recurring issue must become a documented rule or automated check.
- Do not let store metadata, screenshots, or ASO copy be overwritten by generic automation.
- Do not send real transactional emails, SMS, push notifications, or payments during QA unless the recipient/account is explicitly controlled.
- Do not ship native-module dependency changes without native rebuilds and runtime checks.
- Do not assume in-app locales, App Store metadata locales, Play metadata locales, screenshot locales, and custom product page/custom listing locales are the same matrix.
- Do not submit a store build until App Store / Play policy-sensitive details have been checked against current primary docs.

---

## 1. Required Project Memory

Every mobile project must keep a `memory.md` or equivalent release ledger at the repo root.

### Required sections

```md
# Project Memory

## Last Updated
[Date, time, timezone]

## Current State
[What is live, what is pending, what was just verified]

## Architectural Decisions
| Decision | Reasoning | Date |
|----------|-----------|------|

## What's Done
- [Feature]: [Specific proof]

## What's In Progress
- [Feature]: [Current blocker or next proof]

## Known Issues
- [Issue]: [Impact, severity, next action]

## Last Test Run
- Date:
- Tests passed:
- Manual verification:
- Known risks:

## Next Session Should
- [Concrete next action]
```

### Rules

- Read `memory.md` before release work.
- Update it after any build, store submission, app review status change, native dependency change, backend deployment, payment/product change, or major UI workflow change.
- Record failures honestly. A known risk hidden from memory becomes a future release blocker.
- Convert repeated manual fixes into automated validation commands.

---

## 2. Product Definition and Workflow Proof

Before implementation, define the 3-7 core workflows the app exists to support.

Example workflow template:

```md
## Workflow: [Name]
Goal: [What the user is trying to accomplish]
Entry points: [Where it starts]
Steps:
1. [Step]
2. [Step]
3. [Step]
Success proof: [What confirms completion]
Failure paths: [Network failure, auth expired, validation error, empty data]
Data touched: [Local DB, API, file storage, payments, notifications]
Screens touched: [List]
Release validation: [Simulator/device test]
```

### Readiness rule

Every release candidate must prove the critical workflow chain, not just isolated screens.

For business/productivity apps, a minimum workflow matrix should include:

- First install -> splash -> onboarding -> account path.
- Login/signup -> auth restore after cold start.
- Main object creation -> detail view -> edit -> delete/undo or recovery.
- File/media generation -> preview inside app -> share/export/send.
- Payment/subscription/paywall -> purchase/restore/cancel-state handling.
- Offline/degraded path -> reconnect -> sync/refresh.
- Settings changes -> app restart -> persistence.
- Logout -> login as another user -> no data bleed.

---

## 3. Production UI Contract

A screen is complete only if all five UI states are deliberately handled.

### Five states

- Empty: helpful explanation and first action.
- Loading: skeleton/spinner plus context if slow.
- Partial: null/missing/sparse data handled without `undefined`, broken images, or layout collapse.
- Error: human message, no stack traces, clear recovery path.
- Success: realistic data volume, mutations update the UI immediately.

### UI checklist

- Every button does real logic or is removed.
- Every async action disables duplicate submission.
- Every destructive action has confirmation or undo.
- Every form validates critical fields on blur and submit.
- Every mutation updates or invalidates affected views.
- Every list handles 0, 1, many, and very many items.
- Every long string truncates, wraps, or scrolls intentionally.
- Every modal has close behavior, back behavior, focus/escape behavior, and accessible labels.
- Every primary workflow is usable on the smallest supported device.

### Anti-patterns to ban

- Inline dropdowns that expand pages unpredictably.
- Per-screen custom picker implementations.
- Hardcoded demo arrays in production components.
- Generic alerts with raw error messages.
- Success toasts when only part of a save succeeded.
- Store screenshots that show only splash/login/title art instead of the app in use.

---

## 4. Design System Readiness

A production app needs a working design system, not just nice screens.

### Foundations

- Color tokens: background, surface, elevated, border, text primary/secondary/muted/inverse, primary, success, warning, danger, overlay.
- Typography tokens: display, title, body, label, caption, numeric styles.
- Spacing scale: xs, sm, md, lg, xl, section, screen.
- Radius scale: sm, md, lg, xl, pill.
- Shadow/elevation tokens per platform.
- Icon sizing/tone system.
- Motion rules: transition duration, reduced-motion behavior, loading shimmer policy.
- Responsive rules: phone, large phone, tablet/foldable, landscape.

### Shared components required

- Button with variants, loading, disabled, destructive, full-width.
- Input with label, helper, error, disabled, secure, multiline.
- Select/picker with bounded modal/bottom sheet, search when needed, selected state, empty state, long text handling.
- Date/time picker wrapper.
- Modal/dialog shell.
- Confirmation dialog.
- Empty state.
- Loading state.
- Error/retry state.
- Toast/alert provider.
- Card/list row primitives.
- Status badge.
- Search bar/filter chips.
- Offline/degraded banner.
- Paywall/pricing card if monetized.

### Design system validation

- Search for duplicate local component patterns:

```sh
rg -n "Modal|Picker|Dropdown|Select|Button|TextInput|Alert.alert" app src mobile components
```

- If a pattern appears in many screens, make it a shared primitive.
- Visual-test at least one long-language locale and one RTL locale.
- Verify font scaling/accessibility text sizes if supported.

---

## 5. Splash Screen and Launch Readiness

### Requirements

- Splash is branded, fast, and not a fake loading screen.
- App never lands on a blank screen after splash.
- Auth/session restoration has timeout and fallback.
- Critical native modules load before dependent screens render.
- Startup logs include release/build/environment.
- App handles no network on cold start.
- App handles corrupted/old local DB schema.
- App handles stale cached auth tokens.

### Validation

- Fresh install cold start.
- Force quit -> relaunch.
- Airplane mode -> launch.
- Upgrade from previous production build -> launch.
- Clear cache/local DB -> launch.
- Log scan for fatal/native module issues.

Example log scans:

```sh
adb logcat -d | rg -i "FATAL EXCEPTION|AndroidRuntime|Invariant Violation|TurboModuleRegistry|NativeModule|SQLite|NullPointerException"
```

For iOS, inspect Xcode/simulator runtime logs for native module and redbox signatures.

---

## 6. Onboarding Readiness

Onboarding is a workflow, not a slideshow.

### Required checks

- Works on first install with no account.
- Explains value before asking for heavy permissions or payment.
- Does not require account creation unless the product truly needs it.
- Can be skipped, resumed, or restarted intentionally.
- Saves progress safely.
- Handles failed remote config/load.
- Handles locale switching and RTL.
- Does not trap users in a dead end.
- Routes users into the relevant first task.
- Measures completion/dropoff events without collecting unnecessary data.

### Permission timing

Ask for permissions only at the moment of need.

Bad: ask for camera/photos/notifications during generic onboarding.
Good: ask for camera when importing a document, notifications when enabling reminders.

---

## 7. Authentication and Account Readiness

### Identity contract

Define canonical identity forms clearly:

- App local user ID.
- Backend user ID.
- JWT subject.
- Database record ID.
- Payment provider app user ID.
- Analytics/Sentry user ID.
- Sync ownership key.

Rules:

- Normalize IDs only at API/database boundaries.
- Preserve stable backend ID for payment/entitlement systems.
- Never let guest data bleed into authenticated accounts unless explicitly imported.
- Never let one authenticated user see another user's local or remote data.

### Email/password account creation

- Use deferred account creation where possible.
- Pending signup can send verification email.
- Do not create active user rows, refresh tokens, sync state, or device-linked state until email verification is redeemed.
- Login before verification should return a typed error such as `EMAIL_NOT_VERIFIED`.
- Rate-limit signup and verification resend.
- Verification links expire.

### Session validation

- Login.
- Logout.
- Logout all devices.
- Token refresh.
- Expired refresh token.
- Delete account.
- Sign in on two devices.
- Sign in as user A, logout, sign in as user B.
- Cold start after token expiry.

---

## 8. Local Data, Offline, and Sync Readiness

### Local storage rules

- Partition local databases by auth scope: `guest`, `user_<id>`, or equivalent.
- Close old DB handles when auth scope changes.
- Clear query caches on logout and account switch.
- Run migrations sequentially and idempotently.
- Avoid giant multi-statement native DB bootstrap calls on mobile.
- Add recovery for corrupted DB/migration failure.
- Never render stale data as if it belongs to the current user.

### Sync rules

- Define ownership for every synced entity.
- Treat singleton entities as user-scoped, not global `id=1` records.
- Pull should resolve current singleton state by authenticated user, not stale oplog IDs.
- Push must be idempotent.
- Duplicate operation IDs should not corrupt state.
- Rejected operations should not loop forever.
- Pull cursor and push acknowledgement semantics must be separate.
- Malformed JSON returns typed `400`, not `500`.
- Conflict policy is documented: last-write-wins, server-wins, merge, or manual conflict UI.

### Offline validation

- Create/edit/delete while offline.
- Restart offline.
- Reconnect and sync.
- Conflict from another device.
- Login/logout offline.
- Storage upload queued or fails gracefully.

---

## 9. Backend and API Readiness

### API contract

- Every endpoint has typed success and typed errors.
- JSON parse failures return `400 InvalidJson`.
- Auth failures return `401` or `403`, not generic `500`.
- Ownership failures return `403`.
- Missing/deleted resources return `404` or `410` consistently.
- Rate limits are applied to auth, email, uploads, and expensive AI actions.
- Idempotency keys exist for payments, sync ops, sends, and critical mutations.
- Binary responses use web-compatible body types (`ArrayBuffer`, stream, Blob-compatible), not runtime-specific assumptions.

### Backend validation

- Build/typecheck.
- Unit tests for core logic.
- Route tests for happy path and error path.
- Auth/ownership negative tests.
- Malformed body tests.
- Provider outage tests.
- Load/timeout behavior for slow external services.

---

## 10. File, Media, PDF, and Document Readiness

### Storage rules

- File operations are authenticated.
- File ownership is checked server-side.
- MIME and size are validated before upload and before use.
- Deleted parent records block file access.
- Storage provider is recorded with object key.
- Provider fallback is implemented when availability matters.
- All-provider failure returns typed `503 StorageUnavailable`.
- Signed URLs are not shown to users if in-app preview is expected.

### In-app preview rules

- Prefer authenticated backend byte fetch -> local app cache -> native renderer.
- Do not open browser/custom tabs when the requirement is in-app preview.
- Do not expose raw S3/Supabase/Cloudinary URLs in user-facing UI.
- Use platform-specific renderers when needed; validate both iOS and Android.
- Adding preview native modules requires pod install/native rebuild/simulator validation.

### Document validation

- Generate file.
- Preview file in app.
- Share/export file.
- Upload file.
- Download remote file to cache.
- Reopen file after app restart.
- Reopen file after upgrade.
- Fail storage provider and confirm recovery/error UX.

---

## 11. Transactional Email, SMS, Push, and Notifications

### Safety rules

- Never test with real customer contacts unless explicitly approved.
- Use owned safe test recipients such as `qa+timestamp@yourdomain.com`.
- Make send actions idempotent when double-tapped or retried.
- Provider failures produce actionable UI.
- Attachments are generated and verified before send.
- Delivery provider events/logs are checked.
- Unsolicited verification emails are rate-limited and do not create active accounts.

### Notification rules

- Ask notification permission only after explaining value.
- Deep links open the correct screen.
- Scheduled reminders survive app restart where platform permits.
- Android exact alarm usage has a real user-facing use case and Play declaration if needed.
- Notification copy is localized.

---

## 12. Payments, Subscriptions, and Entitlements

### Product catalog contract

Maintain one canonical product matrix:

```md
| Platform | Product ID | Type | Duration | Price | Store status | RevenueCat offering/package | Backend entitlement |
|----------|------------|------|----------|-------|--------------|-----------------------------|--------------------|
```

Rules:

- Product IDs match across app code, RevenueCat, App Store, Play Store, backend, and analytics.
- Lifetime products are non-consumable/non-subscription as appropriate, not misclassified as subscriptions.
- Weekly/monthly/yearly/lifetime packages are all present if the UI advertises them.
- Store products are approved/live before claiming purchase readiness.
- Sandbox purchase tested on real device where emulator cannot support billing.
- Restore purchases tested.
- Downgrade/cancel/expired states tested.
- Backend/webhooks are authoritative for entitlements where possible.
- Mobile can optimistically unlock only when reconciliation is safe.

### Validation

- Load paywall on iOS simulator/device.
- Load paywall on Android emulator, classify emulator billing unavailability as dev-only noise.
- Test real sandbox purchase on physical devices.
- Test restore.
- Test expired/cancelled entitlement.
- Confirm backend premium state matches purchase provider state.
- Confirm Sentry/logging does not expose payment details.

---

## 13. Privacy, Security, and Compliance

### Required privacy inventory

For every SDK and feature, list:

- Data collected.
- Whether it leaves the device.
- Purpose.
- Retention.
- User deletion path.
- Third parties/processors.
- Whether it is linked to identity.
- Whether it is used for tracking/ads.
- Store disclosure category.

### Store requirements to verify

- Privacy policy URL works publicly.
- Privacy policy is linked inside the app.
- Account deletion path exists if accounts exist.
- App Store privacy labels match actual app and SDK behavior.
- Google Play Data Safety matches actual app and SDK behavior.
- iOS purpose strings exist only for real permissions and accurately describe use.
- Android manifest permissions exist only for real flows.
- Sensitive permissions have policy declarations and in-app justifications.
- Secrets are not in repo, app bundle, logs, screenshots, or chat.
- Exposed keys are rotated immediately.

### Security gates

- Secret scan.
- Dependency audit.
- Auth ownership negative tests.
- File ownership negative tests.
- TLS-only endpoints.
- No raw tokens in logs.
- No PII in crash breadcrumbs beyond intentional user ID/email policy.
- Rate-limit auth, verification, upload, send, AI, and payment-sensitive routes.

---

## 14. Localization and Internationalization Readiness

### Separate locale matrices

Maintain distinct matrices for:

- App UI locales.
- Native binary localization declarations.
- App Store metadata locales.
- Google Play metadata locales.
- App Store screenshot locales.
- Play screenshot locales.
- App Store custom product page locales.
- Play custom store listing locales.
- Support/legal page locales if applicable.

### App UI rules

- Locale files have schema parity.
- Placeholders match across languages.
- No empty strings.
- No review markers/TODOs.
- Launch-critical strings get linguistic QA, not just schema validation.
- Bottom tabs use dedicated short labels.
- Long titles/body copy wrap or truncate intentionally.
- RTL works for Arabic/Hebrew, including mixed LTR tokens.
- Currency/date/number formatting follows locale and business settings.

### Store localization rules

- App Store metadata locales are not necessarily the same as in-app locales.
- Unsupported store locales are documented as in-app only.
- Localized keywords matter for search in supported countries/regions.
- Store localization can only be managed when app status is editable.
- Screenshots for a language may be required before making it primary or before CPP review.

### Validation examples

```sh
npm run i18n:validate
npm run store:validate
rg -n "TODO|FIXME|lorem|undefined|null" locales store
```

Visual checks:

- English.
- Long German/Dutch/Finnish strings.
- Arabic/Hebrew RTL.
- Japanese/Korean/Chinese compact scripts.
- Thai/Vietnamese line breaks.

---

## 15. ASO and Store Listing Readiness

ASO is part of product readiness, not a final copywriting pass.

### Source of truth

Keep store metadata in repo:

```md
store/listings.localizations.json
store/ASO_LAYERS.md
store/aso.layers.json
store/screenshots/...
```

Rules:

- Validate field lengths before pushing.
- Never overwrite ASO copy with generic machine translation.
- Track default listings separately from custom product pages/custom store listings.
- Mark each store surface as `automated`, `manual-console`, or `API-readonly`.
- Store screenshots must match locale, device size, and app state.
- Segment pages/listings target specific high-intent searches.
- Review prompts are driven by real success events, not random popups.

### ASO layers

- Default layer: broad app discovery.
- Segment layer: persona/use-case pages such as freelancer, small business, country-specific compliance, industry-specific workflow.
- Screenshot layer: localized visual proof of core value.
- Review layer: ask after real successful moments.
- Conversion layer: paywall/store copy consistency.

### App Store field examples to validate

- App name: 2-30 characters.
- Subtitle: up to 30 characters.
- Keywords: platform limit applies; validate before push.
- Privacy policy URL required.
- Bundle ID must match Xcode/native project.

### Play Store examples to validate

- Title length.
- Short description length.
- Full description length.
- Target API requirement.
- Data Safety.
- App signing/upload key.
- Device catalog changes.
- Warnings for native symbols, mapping files, device support, permissions.

---

## 16. Screenshots, Icons, Splash, and Store Assets

### App icon

- Unique silhouette.
- Works at tiny sizes.
- No transparent background where platform forbids it.
- Adaptive Android icon checked against masks.
- iOS icon has no alpha.
- Brand matches in-app design.

### Splash

- Uses same brand system as app.
- Does not hide slow startup indefinitely.
- Looks correct in light/dark if supported.
- Tested on small/large devices.

### Screenshots

- Show the app in use, not just title art/login/splash.
- Use realistic but safe data.
- Localized text matches store locale.
- No alpha when the store rejects it.
- File extension matches actual file type.
- Dimensions match target device/display class.
- Required screenshot sets are complete before review.
- Custom product pages have all required screenshot display types.

### Asset validation

```sh
file path/to/screenshot
sips -g pixelWidth -g pixelHeight -g hasAlpha path/to/screenshot
```

Also verify upload processing status through store API/console, not just local files.

---

## 17. Native Build and Artifact Readiness

### iOS

- Bundle ID matches App Store Connect.
- Marketing version and build number are correct in the uploaded artifact/store, not just source.
- Native modules are installed through CocoaPods.
- Privacy purpose strings match real features.
- App Groups, Associated Domains, Push, Sign in with Apple, iCloud, etc. are configured only if used.
- TestFlight build uploads and reaches valid processing state.
- Simulator launch checks for redbox/native module errors.

Native dependency rule:

```sh
cd ios && pod install
```

Then rebuild and run the native app.

### Android

- Package name is final.
- Version code increments.
- Final merged manifest is audited.
- Final AAB/APK is inspected, not just config.
- Target SDK meets current Play requirement.
- Min SDK and features do not unnecessarily exclude devices.
- Sensitive permissions are justified or removed.
- Store build excludes dev-only modules.
- Release build includes all required ABIs.
- R8/ProGuard mapping generated when minified.
- Native debug symbols generated/uploaded if native code exists.
- Play App Signing/upload key workflow is documented.

Example release validation:

```sh
cd android
./gradlew :app:assembleRelease :app:bundleRelease
```

Inspect artifact:

```sh
apkanalyzer manifest permissions app-release.apk
unzip -l app-release.aab | rg "mapping|debugsymbols|lib/"
```

---

## 18. Dev, Staging, Production Environment Readiness

### Environment rules

- Clear separation between dev/staging/prod API URLs.
- Build-time env vars are documented.
- Runtime env exposure is intentional; public vars contain no secrets.
- Store builds use production backend unless explicitly internal/test.
- Test users and seed data are safe.
- Feature flags have default values and remote-config failure behavior.
- Sentry/analytics environment and release tags are correct.

### Side-effect rules

Automation must default to dry-run for:

- Store publishing.
- Production deploys.
- Email/SMS/push sends.
- Payment/product changes.
- Database migrations/destructive scripts.
- Review submission.

If not dry-run, require explicit flags and log target app/account/version.

---

## 19. Observability Readiness

### Required telemetry

- Release version.
- Build number/version code.
- Platform/OS/device class.
- Environment.
- User ID policy.
- App area/subsystem tag.
- Network/API error category.
- Provider error category.
- Breadcrumbs for core workflow steps.
- PII-safe logging policy.

### Must-have monitored areas

- Startup.
- Auth/session refresh.
- Sync.
- Local database.
- Payments/purchases.
- File upload/download/preview.
- Transactional email/send.
- Push notifications/deep links.
- Onboarding completion.
- Paywall conversion.
- Store-review prompt events.

### Validation

- Trigger one controlled mobile error.
- Trigger one controlled backend error.
- Confirm Sentry/logging receives release, environment, user, and area tags.
- Confirm no secret/token/raw PII leaks.

---

## 20. Accessibility Readiness

### Required checks

- All interactive elements have roles/labels.
- Disabled/loading state is conveyed visually and semantically.
- Images have alt text or are marked decorative.
- Form inputs have labels, not just placeholders.
- Error messages are near fields and announced when possible.
- Modals trap focus and return focus where platform supports it.
- Dynamic content changes are announced where appropriate.
- Color is not the only signal.
- Contrast meets WCAG AA where applicable.
- Text scaling does not break core screens.
- Touch targets are large enough.

### Validation

- VoiceOver pass for iOS onboarding, paywall, main workflow, settings.
- TalkBack pass for Android onboarding, paywall, main workflow, settings.
- Keyboard/external keyboard pass where relevant.

---

## 21. Performance Readiness

### Startup

- Splash-to-interactive time measured.
- No repeated duplicate API calls on launch.
- Database migrations do not block indefinitely.
- Heavy work deferred after first render.

### Runtime

- Long lists virtualized.
- Images resized and cached appropriately.
- PDF/media preview does not block UI thread.
- Network requests have timeout and retry policy.
- Expensive analytics/computation memoized.
- Offline queue does not grow unbounded.

### Validation

- Cold start profile.
- Scroll/jank check on list-heavy screens.
- Memory check after opening/closing modals/previews repeatedly.
- Low-end Android emulator/device pass.

---

## 22. Legal, Support, and Web Dependencies

A mobile app is not store-ready if its required web surfaces are broken.

### Required URLs

- Privacy policy.
- Terms/EULA if custom.
- Support/contact.
- Account deletion instructions or flow.
- Marketing URL if listed.
- Data deletion/privacy choices if applicable.
- Subscription management/help if monetized.

### Validation

```sh
curl -fsSL -L https://example.com/privacy >/dev/null
curl -fsSL -L https://example.com/support >/dev/null
curl -fsSL -L https://example.com/account-deletion >/dev/null
```

Also verify the links from inside the app.

---

## 23. Store Submission Readiness

### App Store

- App record exists.
- Bundle ID matches native app.
- App name/subtitle/keywords/description/promotional text validated.
- Privacy policy URL present.
- App privacy answers accurate for app and third-party SDKs.
- Age rating complete.
- App Review notes include demo credentials if needed.
- Screenshots complete for required device classes.
- Custom product pages complete if used.
- In-app purchases approved/ready if paywall references them.
- TestFlight build processed as valid.
- Review submission uses the intended build.

### Google Play

- Package name final.
- App signing/upload key configured.
- AAB uploaded to internal testing first.
- Target API meets current requirement.
- Data Safety complete and accurate.
- Privacy policy URL present.
- Store listing localized.
- Screenshots localized where intended.
- Device catalog warnings reviewed.
- Permission declarations reviewed.
- Mapping/deobfuscation file available if using R8.
- Native debug symbols available if native code exists.
- Internal test install works.

---

## 24. Release Candidate Validation Matrix

A release candidate is not ready until this matrix is complete.

```md
| Area | iOS | Android | Backend | Store | Status | Evidence |
|------|-----|---------|---------|-------|--------|----------|
| Fresh install launch | | | | | | |
| Upgrade from previous version | | | | | | |
| Onboarding | | | | | | |
| Login/signup/restore | | | | | | |
| Core create workflow | | | | | | |
| Core edit/delete workflow | | | | | | |
| File/media/PDF preview | | | | | | |
| Send/share/export | | | | | | |
| Payment/subscription/restore | | | | | | |
| Offline/reconnect/sync | | | | | | |
| Settings persistence | | | | | | |
| Logout/account switch | | | | | | |
| Localization LTR long text | | | | | | |
| Localization RTL | | | | | | |
| Accessibility smoke | | | | | | |
| Crash/error logging | | | | | | |
| Store metadata/localization | | | | | | |
| Screenshots/assets | | | | | | |
| Privacy/legal URLs | | | | | | |
```

Evidence must be concrete: command output, build ID, screenshot path, store API result, Sentry issue/test event, or manual workflow notes.

---

## 25. Suggested Validation Commands

Adapt these to the stack.

### Mobile app checks

```sh
npm run lint
npm run typecheck
npm run lint:strict
npm run i18n:validate
npm run store:validate
```

### Backend checks

```sh
npm run build
npm test
```

### Android release checks

```sh
cd android
./gradlew :app:assembleRelease :app:bundleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
adb logcat -d | rg -i "FATAL EXCEPTION|AndroidRuntime|Invariant Violation|NativeModule|SQLite|Billing|RevenueCat"
```

### iOS checks

```sh
cd ios
pod install
```

Then build/run using Xcode, XcodeBuildMCP, or CI and inspect runtime logs.

### Store asset checks

```sh
file store/screenshots/**/*
sips -g pixelWidth -g pixelHeight -g hasAlpha store/screenshots/**/*.{png,jpg,jpeg}
```

### URL checks

```sh
curl -fsSL -L https://example.com/privacy >/dev/null
curl -fsSL -L https://example.com/support >/dev/null
curl -fsSL -L https://example.com/account-deletion >/dev/null
```

### Secret checks

```sh
gitleaks detect --source .
trufflehog filesystem .
```

---

## 26. Failure Patterns and Durable Rules

### Native module missing at runtime

- Symptom: iOS/Android redbox says native module cannot be found.
- Root cause: JS dependency changed but native pods/prebuild/binary not rebuilt.
- Rule: Native dependency change requires pod install/prebuild and native runtime launch.
- Proof: simulator/emulator launch without redbox.

### Store build succeeds but app crashes

- Symptom: hosted build passes; runtime fails on app launch or feature screen.
- Root cause: build validation did not run final binary.
- Rule: Install and run the final release artifact.
- Proof: release APK/IPA/TestFlight app completes core workflow.

### Store warning about unsupported devices

- Symptom: Play says device support dropped.
- Root cause: manifest permissions/features/ABI/minSdk changed.
- Rule: Inspect final manifest/AAB and Play Device Catalog before accepting.
- Proof: final artifact permissions/features/ABIs match intended support.

### Store warning about symbols/mapping

- Symptom: Play asks for deobfuscation/native debug symbols.
- Root cause: release build not configured to produce/upload metadata.
- Rule: Generate R8 mapping and native symbol metadata for store builds.
- Proof: AAB contains mapping/symbol metadata or uploads completed.

### In-app preview opens browser/signed URL

- Symptom: user sees storage URL or leaves app.
- Root cause: preview used remote signed URL directly.
- Rule: authenticated byte fetch -> local cache -> in-app renderer.
- Proof: preview stays in app and logs contain no exposed signed URL.

### Inline dropdown makes page huge

- Symptom: settings/profile page stretches after opening a selector.
- Root cause: select UI rendered inline instead of bounded modal.
- Rule: selectors with multiple options use shared bounded picker.
- Proof: visual check on settings and forms.

### App localization passes schema but looks broken

- Symptom: tabs overflow or copy looks awkward.
- Root cause: structural validation without visual/linguistic QA.
- Rule: separate short chrome labels and long body translations; visually test key locales.
- Proof: screenshots for long LTR and RTL locales.

### Email verification spam or ghost account

- Symptom: someone receives verification email but no intentional signup; account state exists too early.
- Root cause: active account created before email ownership proven.
- Rule: deferred account creation; pending signup only until verification.
- Proof: no active user/token before verification redemption.

### Purchase catalog incomplete

- Symptom: only one plan appears; lifetime missing/misclassified.
- Root cause: app, store, RevenueCat, and backend product matrices drifted.
- Rule: product catalog is a release gate.
- Proof: all packages load in sandbox and entitlement state matches backend.

### Storage provider outage breaks core flow

- Symptom: uploads/previews/emails fail with generic 500.
- Root cause: single provider assumption.
- Rule: provider fallback and typed `StorageUnavailable`.
- Proof: primary provider disabled, fallback or clear 503 works.

---

## 27. Agent Instruction Block for Future App Chats

Paste this into future app-building chats before implementation:

```md
You are building a production mobile app. Follow `APP_READINESS.md` strictly.

Before coding:
- Define the core workflows.
- Identify real data sources and external services.
- Create/update `memory.md`.
- Define store, privacy, localization, and monetization requirements early.

During coding:
- Use shared design-system primitives.
- Handle empty/loading/partial/error/success states.
- Never use hardcoded demo data in production components.
- Make every async action recoverable and observable.
- Add native modules only with native rebuild validation.

Before release:
- Run automated checks.
- Run iOS simulator/native build.
- Run Android release artifact install.
- Validate ASO/store metadata from source of truth.
- Validate screenshots/assets.
- Validate privacy/legal URLs.
- Validate purchase catalog if monetized.
- Update `memory.md` with exact evidence and known risks.

Never say "ready" unless the release candidate has evidence for the workflows, store metadata, native artifacts, privacy requirements, and runtime logs.
```

---

## 28. Final Readiness Verdict Template

Use this exact format when reporting readiness:

```md
## Verdict
[Ready / Ready for TestFlight / Ready for Internal Testing / Not Ready]

## What was verified
- [Command/workflow + result]

## What was not verified
- [Risk + why]

## Store status
- iOS:
- Android:

## Runtime status
- iOS:
- Android:
- Backend:

## Known risks
- [Risk + owner + next action]

## Next action
1. [Most important]
2. [Second]
3. [Third]
```

If anything is unverified, say so plainly. Confidence comes from evidence, not optimism.

---

## 29. Primary Store References to Re-check Before Submission

Store requirements change. Before every serious submission, re-check primary sources.

- Apple App Store Connect app information and metadata.
- Apple App Store localization rules.
- Apple App Review Guidelines, especially metadata, screenshots, privacy, IAP, and security.
- Apple App Privacy details.
- Google Play target API requirement.
- Google Play Data Safety and privacy policy requirements.
- Google Play App Signing and upload key requirements.
- Current SDK/vendor release notes for Expo/React Native/native dependencies if applicable.

Do not rely on a stale checklist for policy-sensitive submission details.

---

## 30. Agent Operating Protocol

This playbook is both a checklist and an operating contract. When pasted into a future app chat, the agent must:

1. Treat these rules as the definition of readiness, not optional advice.
2. Determine task mode first:
   - Build: implementing or changing app behavior.
   - Audit: reviewing existing readiness.
   - Release: preparing an internal, beta, or production release.
   - Triage: diagnosing a bug, crash, rejected build, or failed workflow.
3. Complete the Project Intake Template before making product, store, payment, privacy, or architecture assumptions.
4. Mark every readiness area as one of:
   - `Verified`: evidence exists.
   - `Partial`: some evidence exists, but gaps remain.
   - `Blocked`: cannot verify without missing access, credentials, device, account, or user decision.
   - `N/A`: genuinely not applicable, with reason.
   - `Unknown`: not inspected yet.
5. Never convert `Unknown`, `Blocked`, or `Partial` into `Verified` by assumption.
6. If the app is not mobile, adapt mobile-specific checks to the platform and mark native/store sections as `N/A` with reason.
7. If evidence cannot be produced, report the gap plainly and do not claim readiness.

### Instruction precedence

If this playbook conflicts with user instructions, project-specific rules, CI rules, store policy, security policy, or current platform documentation:

1. Current law, security, and privacy requirements win.
2. Current store/platform/vendor primary documentation wins.
3. Project-specific release rules win.
4. Explicit user approvals or constraints win.
5. This playbook fills remaining gaps.

If a conflict affects safety, production side effects, payment, privacy, or release readiness, stop and report the conflict before proceeding.

### Small task rule

For narrow implementation tasks, do not run the entire release checklist unless the user asks for release readiness. Instead:

- Apply the Feature Readiness Card to the touched area.
- Verify affected workflows and states.
- Update memory with known risks.
- Report broader release gaps separately as risks, not as blockers to the small task unless they directly affect it.

---

## 31. Project Intake Template

Before coding, auditing, or release work, complete this:

```md
## Project Intake

App name:
Platform(s): [iOS / Android / Web / Desktop / Backend / Other]
Framework/runtime:
Package/bundle IDs:
Current version/build:
Target release type: [dev / internal / beta / production]
Primary users:
Primary workflow:
Secondary workflows:
Authentication model:
Data sources:
Local storage:
Backend/API:
File/media storage:
Payments/subscriptions:
Notifications/email/SMS:
Analytics/crash reporting:
Supported locales:
Target countries/regions:
Store surfaces:
Privacy/legal URLs:
Known constraints:
Known risks:
Access available:
Access missing:
```

If a required field is unknown, ask the user or mark it `Unknown`. Do not invent product, store, payment, privacy, or release details.

---

## 32. Stop Conditions

Stop and ask the user before proceeding if any of the following are true:

- A production deploy, store submission, payment/product change, email/SMS/push send, database migration, or destructive script would be executed.
- Required credentials, devices, store access, backend access, or test accounts are missing.
- Real customer data, real payment methods, real recipients, or production notifications may be touched.
- The app uses policy-sensitive capabilities and current primary docs have not been checked.
- A release artifact cannot be installed and launched.
- The workflow depends on a backend/API/data source that does not exist.
- A required feature would need hardcoded demo data to appear functional.
- The agent cannot verify a critical claim but the user asks whether the app is ready.
- There is a mismatch between app code, backend, store metadata, product catalog, or privacy disclosures.

When blocked, report:

```md
## Blocked
Reason:
Risk if ignored:
Decision needed:
Safe next step:
```

---

## 33. Feature Readiness Card Template

For every feature changed or added:

```md
## Feature: [Name]

User goal:
Entry points:
Real data source:
Local state:
Remote state:
External services:
Primary actions:
Destructive actions:
Empty state:
Loading state:
Partial state:
Error state:
Success state:
Offline/degraded behavior:
Validation rules:
Security/ownership rules:
Analytics/logging:
Accessibility notes:
Tests required:
Manual workflow proof:
Known risks:
Verdict: [Verified / Partial / Blocked / N/A]
```

---

## 34. Manual Workflow Proof Format

For each release-blocking workflow, record:

```md
## Workflow Proof: [Workflow name]
Build: [version/build/versionCode]
Platform/device/OS:
Account/test data used:
Preconditions:
Steps executed:
1. ...
Expected result:
Actual result:
Failure path tested:
Evidence:
- Screenshot/video/log path:
- API/store/backend record:
- Sentry/log query:
Result: Pass / Fail / Partial
Tester:
Date/time/timezone:
```

A workflow is not proven by saying it was checked. It needs reproducible steps and evidence.

---

## 35. Evidence Log Template

Every readiness claim must point to evidence.

```md
| Date/time | Area | Evidence type | Evidence | Result | Risk |
|-----------|------|---------------|----------|--------|------|
| | Core workflow | Manual workflow | | Pass/Fail/Partial | |
| | iOS runtime | Simulator/device log | | Pass/Fail/Partial | |
| | Android runtime | Emulator/device log | | Pass/Fail/Partial | |
| | Backend | Test command/API response | | Pass/Fail/Partial | |
| | Store metadata | Store API/console result | | Pass/Fail/Partial | |
| | Privacy/security | Scan/doc review | | Pass/Fail/Partial | |
```

Acceptable evidence includes command output, artifact path, build ID, store version ID, screenshot path, crash-report test event, API response, manual workflow notes, or linked primary documentation.

---

## 36. N/A Rules

A section may be marked `N/A` only with a reason.

Examples:

- Payments: `N/A - app has no paid products, subscriptions, purchases, or premium entitlements.`
- Push notifications: `N/A - app does not request notification permission or send pushes.`
- App Store: `N/A - Android-only release.`
- Native artifacts: `N/A - web-only app.`
- RTL localization: `N/A - no RTL locales supported in this release.`

Do not use `N/A` for areas that are merely uninspected, inaccessible, or inconvenient to verify. Those are `Unknown` or `Blocked`.

---

## 37. Severity Levels

- `P0`: Blocks release or risks data loss, privacy breach, payment failure, account bleed, app crash, or store rejection.
- `P1`: Blocks a core workflow for a meaningful user segment.
- `P2`: Degrades usability, trust, accessibility, localization, or recovery but has a workaround.
- `P3`: Polish, maintainability, or future hardening.

Every known issue must include severity, user impact, owner, and next action.

---

## 38. Readiness Scoring Rubric

Use this score only after evidence has been collected. Unknown areas score `0`.

| Area | Weight | Score |
|------|--------|-------|
| Core workflows | 20 | 0-20 |
| Runtime stability | 15 | 0-15 |
| Data/auth/sync correctness | 15 | 0-15 |
| UI states/accessibility | 10 | 0-10 |
| Backend/API/error handling | 10 | 0-10 |
| Payments/entitlements, if applicable | 10 | 0-10 |
| Privacy/security/compliance | 10 | 0-10 |
| Store assets/metadata/localization | 5 | 0-5 |
| Observability/supportability | 5 | 0-5 |

### Automatic Not Ready

The app is `Not Ready` regardless of score if any P0 blocker exists:

- App cannot launch from the release artifact.
- Core workflow cannot be completed.
- Auth/account switch leaks data.
- Payment UI advertises products that cannot be purchased/restored.
- Privacy/store disclosures are known to be inaccurate.
- Production data, secrets, or customer communications are unsafe.
- Store submission requirements are unverified or contradicted by current primary docs.
- Crash or data-loss risk is known and unresolved.

### Verdict thresholds

- `90-100`: Ready, if no P0 blockers.
- `75-89`: Ready for limited beta/internal testing.
- `50-74`: Not ready; major gaps remain.
- `<50`: Not ready; foundational readiness missing.

---

## 39. Required CI Release Gates

A release candidate is blocked unless these pass in CI or are manually recorded with exact command output.

### JavaScript / shared app

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run i18n:validate
npm run store:validate
```

### Backend

```sh
cd backend
npm ci
npm run build
npm test
```

### Android

```sh
cd mobile/android
./gradlew clean :app:testReleaseUnitTest :app:lintVitalRelease :app:assembleRelease :app:bundleRelease
apkanalyzer manifest permissions app/build/outputs/apk/release/app-release.apk
apkanalyzer manifest target-sdk app/build/outputs/apk/release/app-release.apk
unzip -l app/build/outputs/bundle/release/app-release.aab | rg "BUNDLE-METADATA|mapping|debugsymbols|lib/"
```

### iOS

```sh
cd mobile/ios
pod install
xcodebuild -workspace App.xcworkspace -scheme App -configuration Release -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15 Pro' clean build
xcodebuild -workspace App.xcworkspace -scheme App -configuration Release -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15 Pro' test
```

Each gate must have: command, environment, artifact/build ID, pass/fail result, and log location. Adapt paths and package names to the stack, but do not omit equivalent gates. If a command is not applicable, document why and record replacement evidence.

---

## 40. Upgrade, Downgrade, Migration, and Rollback Readiness

Required paths:

- Fresh install of the new build.
- Upgrade from the latest production build to the release candidate.
- Upgrade from at least one older supported build with known schema differences.
- Upgrade while logged out.
- Upgrade while logged in with synced data.
- Upgrade with pending offline mutations.
- Upgrade with cached files/media/PDFs.
- Upgrade with expired auth tokens.
- App restart after migration.
- Reinstall without data restore.
- OS-level app data restore if supported.

Downgrade policy:

- Define whether downgrading is supported.
- If unsupported, the older app must fail safely and not corrupt local data.
- If supported, migrations must be backward-compatible or reversible.
- Store rollback procedure must be documented for both App Store and Play.

Evidence required:

- Previous build number/version code installed.
- New build number/version code installed over it.
- Migration logs checked.
- Core workflow completed after upgrade.
- Local DB/schema version before and after recorded.
- No fatal crash or data ownership bleed after upgrade.

Before production rollout:

- Confirm staged/phased rollout percentage.
- Confirm halt rollout procedure.
- Confirm previous build remains available or rollback path is understood.
- Confirm server compatibility with old and new clients.
- Confirm feature flags can disable risky new flows without app update.
- Confirm minimum supported app version policy.
- Confirm forced-upgrade messaging if old clients must be blocked.
- Confirm Play internal/closed test and TestFlight smoke results are attached.

After rollout starts:

- Monitor crashes, ANRs, startup failures, purchase failures, auth failures, sync failures, and support contacts.
- Define stop thresholds, such as crash-free sessions below target, ANR spike, payment failure spike, or backend 5xx spike.

---

## 41. Crash and Runtime Log Release Gates

A release candidate is blocked by any untriaged occurrence of the following.

### Android blockers

- `FATAL EXCEPTION`
- `AndroidRuntime`
- `SIGSEGV`
- `ANR`
- `NullPointerException`
- `SQLiteException`
- `TurboModuleRegistry`
- `NativeModule`
- `Invariant Violation`
- uncaught RevenueCat/billing exceptions
- uncaught file/PDF/storage exceptions

Required command:

```sh
adb logcat -c
adb install -r path/to/release.apk
adb shell monkey -p com.example.app 1
adb logcat -d > /tmp/android-release.log
rg -i "FATAL EXCEPTION|AndroidRuntime|SIGSEGV|ANR|NullPointerException|SQLiteException|TurboModuleRegistry|NativeModule|Invariant Violation|RevenueCat|Billing|SQLite|FileSystem|PDF" /tmp/android-release.log
```

### iOS blockers

- redbox/native module failures
- uncaught Objective-C/Swift exceptions
- watchdog termination
- crash reports in `DiagnosticReports`
- missing native module signatures
- file/PDF/storage renderer failures

Required evidence:

- Simulator/device log file path.
- Crash reporter/Sentry release checked.
- No new unresolved crash issue for the candidate build.
- One controlled test error confirmed observability tags are present and PII-safe.

---

## 42. External Service Failure Gates

Validate controlled failure or sandbox equivalent for:

- Backend unavailable / 5xx.
- Slow backend timeout.
- Auth expired / refresh failure.
- Storage provider unavailable.
- Payment provider unavailable.
- Product catalog empty or partially loaded.
- Email/SMS/push provider failure.
- Remote config unavailable.
- Analytics/Sentry unavailable.
- Network offline during mutation.
- Network reconnect after queued mutation.

Each failure must show user-facing recovery, typed logs, and no false success state.

---

## 43. Store Submission State Machines and Evidence

### App Store review-submission state machine

- If a review submission already exists, do not recreate the app version or create a duplicate submission.
- Inspect the existing `reviewSubmissions` object.
- Confirm it is `READY_FOR_REVIEW`.
- Confirm the intended build is attached.
- Submit by updating that submission to `submitted: true` when using direct API automation.
- Tooling must handle already-staged versions. A version in a non-editable or already-staged state is not automatically a reason to create a new version.
- Record App Store version id, build id, review submission id, submission state, and submitted timestamp in memory.

### App Store IAP/subscription submission state

- App Store products in `READY_TO_SUBMIT` are not purchase-ready, even if RevenueCat/offering configuration lists them.
- Subscriptions and non-consumable/lifetime IAPs may require separate submission flows.
- Verify and record the correct App Store Connect submission object for each product:
  - `subscriptionSubmissions` for subscriptions.
  - `inAppPurchaseSubmissions` for non-subscription IAPs.
- RevenueCat offering presence is not proof of store availability. StoreKit/Play Billing hydration must be verified from app runtime.

### Google Play API/auth evidence

- Android Publisher automation must prove it uses credentials with `https://www.googleapis.com/auth/androidpublisher` scope.
- Do not assume the default local `gcloud` ADC access token has the required scope.
- Record credential source type, package name, edit id, track, version code, and committed track status.

### Store evidence required in readiness verdicts

- App Store version id.
- App Store build id.
- App Store review submission id/state.
- App Store IAP/subscription submission states.
- Play package/version code.
- Play edit id / committed track state.
- Store metadata validation command/result.
- Screenshot upload/processing verification.

---

## 44. Expanded Store Asset and ASO Gates

### ASO release gate

Before any store publish or review submission:

- Run the repo store metadata validator.
- Confirm pushed store metadata matches the repo source of truth.
- Confirm default listings and segment listings/custom product pages are not overwritten by generic generated copy.
- Record validator command, locale count, and pushed store surfaces in memory.

### Play custom listing limitation

- Google Play custom store listings must be treated as manual-console work unless current primary docs/API prove write support.
- Keep segment definitions in repo even when default listings are automated.
- For each store surface, record whether it is writable by API, console-only, or read-only.
- Do not imply automation coverage for console-only surfaces.

### Screenshot source and export rules

- Maintain editable screenshot source files or a reproducible screenshot generation/export workflow.
- Store-uploaded flattened images alone are not enough for future localization.
- If screenshot compositions use raster app screenshots inside editable marketing frames, document whether only marketing copy is localized or the in-app UI is localized too.
- Do not claim localized screenshot completion when visible in-app UI remains in another language unless that limitation is explicitly accepted and logged.
- Full-resolution export must be verified. Preview-sized MCP/browser/design-tool screenshots are not acceptable final store assets.
- App Store custom product pages must have required screenshot display types for that page, not just screenshots somewhere on the app version.
- Record exact display types uploaded, such as `APP_IPHONE_65`, `APP_IPHONE_67`, or `APP_IPAD_PRO_3GEN_129`, and verify each set through App Store Connect.

### Store text vs screenshot localization

- Store text localization and screenshot localization are separate readiness gates.
- A locale with translated title/description but no localized screenshots is incomplete unless explicitly accepted as a staged rollout risk.
- Do not expand store metadata locales faster than screenshot and support/legal localization coverage unless the gap is recorded in memory.

---

## 45. Additional Failure Patterns

### Screenshot extension does not match actual file type

- Symptom: Store screenshot upload fails or processing rejects assets even though dimensions look correct.
- Root cause: Files named `.jpg`/`.jpeg` are actually PNG or another encoded format.
- Rule: Validate file signatures with `file`, not filename extension, before upload.
- Proof: Store API/console accepts and processes the uploaded screenshot set.

### Paywall fallback hides a broken product catalog

- Symptom: Only one plan appears, or plans show fallback prices even when native store products are missing.
- Root cause: UI renders fallback cards instead of treating missing store packages as a degraded purchase state.
- Rule: Do not render a package as purchasable unless native store runtime hydration succeeded.
- Proof: All advertised packages appear from StoreKit/Play Billing runtime, and missing packages produce an explicit unavailable/degraded state.

---

## 46. Expanded Accessibility and Performance Gates

### Required accessibility device settings

- Large text / dynamic type.
- Bold text.
- Reduce motion.
- Increased contrast if platform supports it.
- VoiceOver on iOS.
- TalkBack on Android.
- RTL language.
- Smallest supported viewport.

Evidence must include at least one screenshot or screen recording for large text and RTL on a core workflow.

### Required performance thresholds

Define release thresholds before testing:

- Cold start to interactive: `[target]`.
- Warm start to interactive: `[target]`.
- Main list scroll FPS/jank threshold: `[target]`.
- Max memory after 10-minute core workflow: `[target]`.
- Max PDF/media preview open time: `[target]`.
- Max API timeout/retry duration: `[target]`.
- Offline queue upper bound: `[target]`.

A release with unknown performance numbers is not performance-validated.

---

## 47. Current Primary-Doc Check Report

Store and platform requirements change. Before every serious submission, check current primary sources and record the date checked.

Required report format:

```md
| Requirement | Primary source checked | Date checked | Impact |
|-------------|------------------------|--------------|--------|
| App Store metadata/privacy/IAP/review | | | |
| Google Play target API/Data Safety/signing/permissions | | | |
| SDK/runtime release notes | | | |
| Payment provider release notes, if applicable | | | |
```

Current examples to re-check before release:

- Google Play target API requirements are date-sensitive. For example, Google states that from August 31, 2025, new apps and updates must target Android 15 / API 35, except Wear OS and Android Automotive OS apps, which must target Android 14 / API 34.
- Apple App Store review, privacy, metadata, screenshots, IAP/subscription, and custom product page requirements must be checked from Apple primary docs before submission.
- Payment provider product approval and runtime hydration requirements must be checked from the provider/store dashboards, not assumed from app code.

Do not rely on a stale checklist for policy-sensitive submission details.

---

## 48. Strengthened Agent Instruction Block

Paste this into future app-building chats before implementation:

```md
You are building or auditing a production app. Use the pasted readiness playbook as the operating contract.

Your operating sequence is:

1. Determine task mode: Build, Audit, Release, or Triage.
2. Complete the Project Intake Template.
3. Define the core workflows before implementation.
4. Identify real data sources, external services, store surfaces, privacy requirements, and monetization requirements.
5. Create or update `memory.md` if filesystem access exists. If not, maintain a "Session Memory" section in your response.
6. For every feature changed, complete a Feature Readiness Card.
7. Handle empty, loading, partial, error, and success states.
8. Do not use hardcoded demo data in production components.
9. Do not perform production side effects without explicit user approval.
10. Stop when a Stop Condition is triggered.
11. Before claiming readiness, provide concrete evidence: commands, workflow notes, artifact IDs, screenshots, logs, store status, or API responses.
12. Score readiness with the rubric.
13. Report Unknown, Partial, Blocked, and N/A honestly.

Never say "ready" unless the release candidate has evidence for workflows, runtime behavior, native/store artifacts where applicable, privacy requirements, observability, and recovery paths.
```

---

## 49. Second-Pass Critical Gap Closure

A second-pass multi-agent review found that the earlier playbook had the right categories, but some rules were still too generic to prevent the exact failures seen in ExampleApp.

Use sections 49 through 57 as hard addenda. They are intentionally specific because these are the kinds of gaps that look harmless in a checklist and then become release blockers, App Review issues, Play warnings, broken purchases, broken sync, or user trust incidents.

## 50. Privacy, Store Compliance, and Account Deletion Gates

### iOS privacy manifest gate

Before every App Store submission:

- Confirm the app target bundles a valid `PrivacyInfo.xcprivacy` when the app or SDKs collect data or use Required Reason APIs.
- Inventory every Required Reason API category used by app code and third-party SDKs.
- Confirm every listed third-party SDK that requires a privacy manifest includes one in the final app bundle.
- Confirm collected data types in `PrivacyInfo.xcprivacy` match App Store privacy answers and the public privacy policy.
- Inspect the archived `.ipa` or Xcode archive output, not only source files.
- Treat App Store Connect privacy-manifest validation emails as release blockers until resolved.

### Account deletion contract

If the app allows account creation:

- Provide an in-app path to initiate account deletion.
- Provide a public web path for deletion requests when distributing on Google Play.
- Re-authenticate or otherwise verify account ownership before deletion.
- Delete or anonymize backend user records, refresh tokens, devices, sync state, local scoped databases, uploaded files, generated documents, analytics identifiers, and support-linked profile data unless retention is legally required.
- Clearly disclose retained data, retention reason, retention period, and deletion timeline.
- Cancel or explain active subscriptions without pretending store-managed subscriptions are deleted by app-account deletion.
- Verify user A deletion cannot delete or expose user B data.
- Verify deleted users cannot refresh tokens, sync, access files, or restore stale local data after reinstall.

### Data deletion URL requirements

- The account deletion URL is public, non-geofenced, and does not require installing the app.
- The URL lets users request deletion of the app account and associated data.
- The URL explains what data is deleted, what may be retained, why it is retained, and how long retention lasts.
- The same URL is entered in Play Console Data Safety where required.

### Permission declaration matrix

Maintain this matrix for every release:

| Platform | Permission/API | Source artifact | User-facing feature | Prompt timing | Store declaration needed | Evidence |
|----------|----------------|-----------------|---------------------|---------------|--------------------------|----------|
| iOS | `NSCameraUsageDescription` | `Info.plist` / archive | | Just-in-time | App privacy / review notes if sensitive | |
| iOS | Photos / files access | `Info.plist` / archive | | Just-in-time | App privacy labels | |
| iOS | Tracking / IDFA | binary + SDK inventory | | ATT prompt only if tracking | App Tracking Transparency + privacy labels | |
| Android | `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` | merged manifest / AAB | | Just-in-time | Photo and Video Permissions declaration if broad access | |
| Android | `POST_NOTIFICATIONS` | merged manifest / AAB | | After value explanation | Data Safety if data leaves device | |
| Android | SMS / Call Log / Accessibility / Exact Alarm / `QUERY_ALL_PACKAGES` | merged manifest / AAB | | Just-in-time | Play permission declaration or removal | |

Rules:

- Remove broad photo/video permissions unless the app has a qualifying core use case; use the system photo picker for one-time or infrequent access.
- Do not request sensitive permissions for unimplemented, hidden, analytics, advertising, or third-party purposes.
- Verify the final merged Android manifest and final iOS archive, not only Expo/config source.

### Secrets and environment inventory

Maintain a release-blocking secrets inventory:

| Secret/env var | Environment | Owner | Where stored | Runtime exposure | Rotation date | Required for release |
|----------------|-------------|-------|--------------|------------------|---------------|----------------------|
| | dev/staging/prod | | CI/store/backend/local | server-only/public-build-time | | yes/no |

Rules:

- Public mobile build variables must be explicitly marked public and must not grant privileged access.
- Service-account JSON, App Store Connect keys, Play Publisher keys, signing keys, webhook secrets, database credentials, JWT secrets, email provider keys, AI provider keys, and payment provider secrets must never be committed, bundled, logged, screenshotted, or pasted into review notes.
- Secret scans must cover repo files, generated native projects, built AAB/APK/IPA artifacts, source maps, logs, and release notes.
- Missing required production secrets are release blockers, not runtime TODOs.
- Any exposed secret must be rotated before the next submission.

### AI and external data processing readiness

If the app uses AI, ML, OCR, document extraction, translation, analytics enrichment, fraud scoring, or any external data processor:

- List provider, feature, data sent, data returned, purpose, legal basis/consent model, retention, training use, region, subprocessors, and deletion path.
- Confirm prompts, documents, images, invoices, contacts, emails, payment data, and identifiers are not sent to AI providers unless disclosed and necessary.
- Confirm provider settings disable training on customer data where available and required.
- Redact secrets, tokens, payment data, and unnecessary PII before model calls.
- Rate-limit AI endpoints and make expensive actions idempotent.
- Provide user-visible disclosure where AI materially processes or generates user content.
- If generative AI content is user-facing, provide in-app reporting/flagging and a moderation/review path.
- Reflect AI data sharing in App Store privacy answers, Google Play Data Safety, and the public privacy policy.
- Add test evidence for provider outage, timeout, unsafe output handling, deletion request propagation, and logging redaction.

### App Review notes packet

Before App Store submission, prepare review notes with:

- Review contact name, phone, and email.
- Demo account credentials or fully featured demo mode details.
- Required test steps for the primary workflow.
- Explanation of non-obvious features, generated files, sync, offline behavior, and region-specific compliance features.
- In-app purchase product IDs, expected paywall location, restore path, and sandbox test notes.
- Permission explanations tied to user-facing actions.
- Backend availability confirmation and any required test data.
- Known reviewer limitations, such as emulator billing unavailability or controlled email-send recipients.
- Links to privacy policy, terms, account deletion, and support pages.

### Developer account and merchant verification

Before submission:

- Apple Developer Program membership is active.
- App Store Connect agreements, tax, banking, and paid-app/IAP contracts are active if monetized.
- App Review contact info is current.
- Play Console developer identity verification is complete.
- Play public developer email/phone/address requirements are satisfied for the account type and region.
- Play payments profile and merchant verification are complete if monetized.
- Package name registration, app signing, upload key access, and recovery contacts are documented.
- Account owner and release managers have current access, and no submission depends on a single unavailable person.

### Policy signoff table

Complete this table before every external review submission:

| Policy area | Platform | Current source checked | Date checked | Applies? | Required action | Evidence | Owner |
|-------------|----------|------------------------|--------------|----------|-----------------|----------|-------|
| Privacy manifest / Required Reason APIs | Apple | | | yes/no | | | |
| App privacy labels | Apple | | | yes/no | | | |
| Account deletion | Apple / Google | | | yes/no | | | |
| Data Safety | Google | | | yes/no | | | |
| Sensitive permissions | Google | | | yes/no | | | |
| Photo/video permissions | Google | | | yes/no | | | |
| AI-generated content | Google | | | yes/no | | | |
| IAP/subscriptions | Apple / Google | | | yes/no | | | |
| Developer account verification | Google | | | yes/no | | | |
| Review notes/demo account | Apple | | | yes/no | | | |

A blank evidence cell is a release blocker.

## 51. Auth, Identity, and Deferred Account Hard Lessons

### Auth bootstrap integrity

- On cold start, never trust a locally cached user object as canonical until it has been reconciled against the backend session endpoint.
- The token owner returned by `/me` must decide the active local DB scope, payment identity, sync ownership key, Sentry user, and query-cache namespace.
- If the cached user differs from the canonical backend user, repair local auth state, switch to the canonical user-scoped database, and clear/invalidate stale query caches.
- Verification, resend, profile-email-change, and signup email paths must emit structured masked audit logs with endpoint, method, outcome, userId when known, IP, user-agent, origin, and referer.
- Repeated signup against an existing pending/unverified email must never overwrite stored credentials; it may only refresh verification state subject to cooldown/rate limits.

### Deferred account creation

- Do not create real remote accounts simply because a user opens the app, tests a demo, or previews a workflow.
- Local/demo users must stay local until the user explicitly chooses an account-creating action.
- Email verification must only be sent after explicit user intent and must be traceable in audit logs.
- Any unexpected verification email must be diagnosable from backend logs without exposing full email addresses in normal logs.

## 52. Sync, Local Persistence, and Database Runtime Hard Lessons

### Singleton sync guardrails

- Mobile must enqueue changed fields for singleton records, not full local snapshots, unless the operation is an explicit full replacement.
- Backend singleton upserts must merge into the ensured canonical row for the authenticated user, not into client-supplied legacy IDs.
- Sparse/null-heavy singleton payloads must not erase populated business identity, banking, tax, or contact fields unless the payload includes explicit clear intent.
- Pull must include current user singleton rows on every valid pull, not only when an oplog event exists after the cursor.
- Historical bad singleton oplog entries must be treated as untrusted hints; pull should self-repair canonical IDs and return the current authenticated-user state.
- When a sync repair is deployed, backfill or append fresh singleton oplog updates so already-synced devices can hydrate without logout/login resets.

### Database/runtime adapter resilience

- Backend DB clients must handle connection/session loss explicitly; if the database can drop auth state, wrap queries with one safe session-restore retry.
- Startup should run idempotent compatibility repairs for legacy rows that predate stricter schema/type assumptions.
- DB connection, signin, namespace/database selection, and startup repair operations must have timeouts and Sentry/log coverage.
- Global error handlers should return typed production-safe errors while preserving full diagnostics in backend logs/Sentry.

## 53. Files, PDF Preview, Email, and AI Document Processing

### Degraded file-flow behavior

- Business/profile saves must not be blocked solely because optional logo/media upload is down; save the local/business fields and surface an explicit degraded-save warning.
- Backend preview/download routes should stream authenticated file bytes with `Content-Type`, `Content-Disposition`, `Cache-Control: private, no-store`, and provider fallback headers where useful.
- In Hono/fetch-style runtimes, binary response bodies must be `ArrayBuffer`, `ReadableStream`, or Blob-compatible values, not Node-only `Buffer` assumptions.
- Preview validation must scan logs for unreadable file URI, native PDF/WebView module, signed URL exposure, and fatal renderer signatures on both platforms.

### Email provider and attachment proof

- Invoice/send flows must fetch the attachment from authenticated storage using the same provider fallback path as preview/download before calling the email provider.
- Email provider payloads must satisfy provider-specific MIME/content ordering and attachment encoding rules.
- Delivery, bounce, spam-report, unsubscribe, and drop events must be accepted only from verified provider webhooks and persisted for support/debugging.
- Email health restrictions from provider events must feed back into account/send UX so blocked or risky recipients are not retried blindly.
- A release is not email-ready until a controlled owned recipient receives the message, attachment opens, and backend/provider logs show the expected send and delivery events.

### AI/document parsing readiness

- Image/document AI endpoints must validate MIME type, file size, auth, quota, and plan before provider calls.
- Provider calls must have timeouts, typed error categories, and user-facing recovery messages for quota, auth, rate limit, timeout, invalid response, and provider outage.
- Use scan/request IDs to correlate mobile UI, backend logs, provider failures, quota records, and persisted parse status.
- Use fallback models/providers when the primary parse fails or returns low-confidence/review-required output.
- Parsed financial documents must support `completed` and `review_required` states; the user must review supplier, invoice number, dates, currency, line items, totals, and confidence before saving.
- Keep compatibility endpoint aliases during mobile/backend rollout windows so older clients do not get avoidable 404s.

## 54. Monetization, Entitlement, and Business Payment Recording

### Entitlement authority rules

- Mobile purchase SDK state may sync upgrades to the backend, but mobile must never downgrade a backend-premium user to free.
- Downgrades, expirations, refunds, cancellations, and transfers must come from trusted server-to-server store/provider webhooks.
- RevenueCat or purchase-provider app user ID must be the stable backend user ID; anonymous purchases need an explicit link/transfer plan and must not silently mutate the wrong account.
- Paywall UI must render only packages actually hydrated from the store/provider. Fallback prices may be used for copy only when clearly marked unavailable; they must not make a missing package look purchasable.
- Treat Android emulator `Billing service unavailable on device` as development-only noise, but require a Play internal-testing build with licensed tester for real Android purchase proof.

### Business payment recording readiness

- Distinguish customer/vendor payment recording from app monetization purchases.
- Payment recording must validate positive amount, required method, currency, remaining balance, and optional reference/notes.
- Mark-as-paid shortcuts must not fabricate payment history silently; prompt users to record a payment when no full payment exists.
- Partial payments, overpayments, delete-payment, revert-paid, and manual status changes must recalculate `amountPaid`, `balanceDue`, `paidAt`, and invoice status consistently.
- Payment mutations must invalidate/refetch invoice detail, invoice lists, dashboard summaries, analytics summaries, sync queues, and remote summaries.
- Release proof must include one failed payment submission, one successful payment, one partial payment, one payment deletion, and post-sync dashboard/analytics verification.

## 55. Onboarding, Localization, Selection Controls, and UI Contracts

### Onboarding localization contract

- All onboarding copy must come from localization resources: step titles, option labels, option descriptions, helper text, placeholders, errors, buttons, progress labels, and accessibility labels.
- Do not embed English onboarding option arrays in screen files unless they are non-user-facing IDs only.
- Onboarding option IDs must be stable data values; localized labels/descriptions must be resolved at render time.
- The first-run flow must be visually checked in at least one long-language locale and one RTL locale because onboarding is often the first localized product experience.
- Step progress text must be localized and exposed semantically to assistive tech.

### Onboarding persistence and routing

- Saves progress safely with a defined failure policy: either retry and surface save failure, or clearly treat the draft as local-only until final completion.
- Never silently claim onboarding progress/defaults are saved if persistence failed.
- Completion must write selected defaults into the real settings/profile data used by the app, not only an onboarding profile record.
- Completion must route based on the user's selected goal, region, and setup answers.
- If a paywall appears after onboarding, preserve the intended next task through the paywall and provide an intentional skip/continue path unless payment is truly mandatory.
- Do not drop users onto a generic dashboard after setup when their answers identify a more relevant first task.

### Selection control contract

- Every dropdown/select/picker must use one shared selection primitive unless there is a documented product reason not to.
- The shared picker must support phone bottom-sheet presentation, tablet/dialog presentation, scroll bounds, selected state, empty state, long-label truncation/wrapping, Android back close, explicit close action, and accessible selected state.
- Settings, invoice forms, detail status changes, language/theme pickers, client pickers, and helper pickers must not each implement custom inline expanding lists.

### Modal accessibility contract

- Every modal/bottom sheet must have a localized title, localized close label, Android back handling, visible close affordance, and accessible role/state for selectable rows.
- Modal content should announce loading/error/empty states when they change.
- Selection modals must expose the currently selected item semantically, not only through color or a check icon.

### Code registry parity

- The language picker registry, imported locale files, i18n resources object, native binary declarations, and validation scripts must all describe the same supported app locale set.
- Locale aliases must be explicit and tested, especially `no`/`nb`, `pt`/`pt-PT`, `zh-Hans`/`zh-Hant`, and store-specific regional variants such as `en-US`, `en-GB`, `de-DE`, and `fr-FR`.
- RTL metadata must live in the same language registry used by the app, not in scattered screen logic.
- Adding a locale is not complete until the locale file, language picker entry, native declarations, and validation scripts all agree.

### Translation glossary and screenshot proof

- Maintain a protected glossary for product names, compliance terms, acronyms, currencies, placeholders, and legal/payment terms.
- Translation generation must preserve protected tokens exactly and validate that placeholders remain unchanged.
- Launch-critical flows need linguistic QA for meaning, not only schema parity.
- Localized store screenshots are not proof that the in-app UI is localized. Track store-asset localization and runtime app localization as separate evidence.
- If screenshots are generated or edited outside the app, run a separate in-app locale smoke pass before claiming UI localization readiness.

### Fixed navigation text

- Fixed-width navigation chrome, such as bottom tabs, may use dedicated short labels and constrained scaling only when the full screen title remains accessible elsewhere.
- Do not reuse long page titles as bottom-tab labels; use separate mobile-safe translation keys with length budgets.
- Any `allowFontScaling={false}` exception must be documented, limited to fixed chrome, and paired with accessible labels/titles that remain understandable to VoiceOver/TalkBack users.
- Verify bottom tabs on the smallest supported phone, one long-language locale, and one RTL locale.

### Automated UI contract gates

- Add a repo script that fails when contracted screens/components bypass the design system.
- Ban raw hex colors in app screens and shared UI components outside theme/token files.
- Ban direct third-party icon imports in product UI; route icons through the app icon wrapper so size, tone, accessibility, and replacement behavior stay centralized.
- Keep the checked file list explicit and expand it whenever a new high-traffic screen, paywall, onboarding screen, or shared primitive is added.

### Automated accessibility gates

- Add static checks for high-risk monetization, onboarding, modal, and shared UI files.
- Enforce minimum 44dp touch targets for tappable controls.
- Enforce roles/states for radio groups, radio options, checkboxes, links, buttons, selected options, disabled controls, and loading controls.
- Run contrast checks for both light and dark themes, including translucent token blends over their actual backgrounds.
- Any new paywall, onboarding step, picker, modal, or shared primitive must be added to the accessibility gate before release.

### Shared primitive localization rules

- Step/progress primitives must support localized labels and accessibility progress semantics.
- Selection-card primitives must support localized labels/descriptions/helper text, radio/checkbox roles, checked state, disabled state, and long localized text without layout breakage.

## 56. Observability and Workflow-Correlation Logging

- Every risky workflow should emit a correlation identifier: auth email audit id, sync op id, storage canonical key/provider, PDF file id, invoice send id, purchase scan id, purchase transaction/product id, or payment record id.
- Logs and Sentry events must include app area/subsystem tags such as `auth`, `sync`, `storage`, `pdf_preview`, `invoice_email`, `purchase_parse`, `iap`, and `local_db`.
- Sentry/default crash capture must disable default PII unless the project has an explicit PII policy; user context should use stable IDs and masked email only when required.
- Mobile error reporting must queue while offline and flush on resume/reconnect without blocking the user workflow.
- Backend startup, schema repair, cron startup, provider fallback, webhook rejection, and global unhandled errors must be captured as first-class observability events.

## 57. Second-Pass Readiness Verdict Rule

After applying this playbook, the answer to "are we ready?" must separate these states:

- `Not assessed`: no evidence was collected.
- `Assessed but blocked`: evidence found a blocker.
- `Partially ready`: some workflows or platforms passed, but missing evidence remains.
- `Runtime ready`: the installed app passes local workflow gates.
- `Submission ready`: native artifacts, privacy answers, store metadata, review notes, purchases, and account-level requirements are all checked against current primary docs.
- `Released and monitored`: production rollout is live, crash-free/session metrics are watched, support channels are ready, and rollback paths are known.

Never collapse these into a vague "good to go." A local app pass is not the same as App Store readiness. App Store readiness is not the same as Google Play readiness. Store approval is not the same as production health.

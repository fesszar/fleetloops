# Contributing to Fleet

Fleet is open source and welcomes issues, forks, and pull requests. The goal is
to keep the app useful for real operators, not just make screens render.

## Workflow

1. Fork the repository and create a focused branch.
2. Keep each PR scoped to one behavior, screen, or subsystem.
3. Wire UI changes to real bridge/state/config flows. Do not add component-level
   demo arrays, fake metrics, `setTimeout` loaders, or placeholder workflows.
4. Add or update tests for new logic, bridge endpoints, config validation, and
   state transitions.
5. Run the verification commands below before opening the PR.
6. Open a PR with screenshots or screen recordings for UI changes and a clear
   summary of user-facing behavior.

## Local Verification

```bash
bash fleet/web/build.sh

cd fleet/runner
for t in test-bridge-project test-bridge-run test-conditions test-harness test-security test-loop test-integration test-providers test-config; do
  FLEET_STATE_DIR=$(mktemp -d) node $t.mjs
done

cd ../apps/macos
swift build -c release
```

Signed and notarized release builds also run:

```bash
cd fleet/apps/macos
DEVELOPER_ID="Developer ID Application: Your Name (TEAMID)" NOTARY_PROFILE="fleet-notary" ./build-app.sh
codesign --verify --deep --strict --verbose=2 build/Fleet.app
spctl -a -t exec -vv build/Fleet.app
stapler validate build/Fleet.app
stapler validate build/Fleet.dmg
hdiutil verify build/Fleet.dmg
```

## Pull Request Bar

- Every button, form, toggle, and destructive action must do real work.
- Loading, empty, partial-data, error, and success states must be handled for
  touched UI.
- Mutations must update the UI immediately through state refresh or an explicit
  optimistic update.
- Errors shown to users should explain what happened and how to recover.
- API keys, certificates, `.env` files, local state, screenshots, and release
  binaries must not be committed.

## Maintainer Review

Gideon Awolesi reviews and approves changes before they land on `main`.
CODEOWNERS is configured so GitHub can request that review automatically once
branch protection is enabled on the public repository.

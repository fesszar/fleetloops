## Summary

-

## Verification

- [ ] `bash fleet/web/build.sh`
- [ ] Runner suite passes
- [ ] `cd fleet/apps/macos && swift build -c release`
- [ ] UI workflow manually verified, if applicable

## Production UI Checklist

- [ ] No component-level demo data or fake workflows
- [ ] Loading, empty, partial-data, error, and success states covered
- [ ] Destructive actions confirm before mutating state
- [ ] User-facing errors have a recovery path
- [ ] Screenshots or recordings attached for UI changes

## Notes for Maintainer

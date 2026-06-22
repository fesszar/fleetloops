# Security Policy

## Supported Versions

Security fixes target the current `main` branch until versioned releases are
introduced.

## Reporting a Vulnerability

Please do not open a public issue for suspected vulnerabilities, leaked keys,
or signing/notarization material. Use GitHub's private vulnerability reporting
feature if available on the repository, or contact the maintainer privately.

Include:

- A concise description of the issue.
- Steps to reproduce.
- Impact and affected files or routes.
- Any logs with tokens, paths, emails, and secrets removed.

Fleet intentionally keeps API keys in the macOS Keychain, binds the bridge to
loopback, requires a per-install bearer token for `/api/*`, and denies deploy
commands in the runner/harness. Reports that bypass or weaken those boundaries
are high priority.

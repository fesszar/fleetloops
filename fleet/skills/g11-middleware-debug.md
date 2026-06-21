# G11 — Middleware-chain debugging
**WHEN:** 500/502/504, route error, server crash, a request that dies before the handler.
**DO:**
- Read process status + restart count + BOTH app and proxy logs.
- Confirm middleware registration order (CORS before auth before handler).
- Ensure every async middleware awaits `next()` and catches its errors.
- Distinguish causes: 502 = the proxy can't reach the app (is it listening?); 500 = the app threw.
**DON'T:** assume the handler ran — the chain may have thrown earlier; restart the live server yourself (observe read-only; escalate a restart).
**WHY:** registration order and unawaited async are the usual culprits, and the status code tells you where to look.

# G2 — Async race-condition prevention
**WHEN:** concurrent / await / fire-and-forget work; reading state right after writing it; token refresh; parallel requests.
**DO:**
- Await a critical write before any later code reads it.
- Serialize refresh/init with a single in-flight promise (mutex): reuse the pending promise instead of starting a second.
- Dedupe repeated effects by tracking the last-processed key.
**DON'T:** assume a write is durable before its promise resolves; fire-and-forget anything a later step depends on; run two refreshes at once.
**WHY:** read-before-write-settles and duplicate refreshes are the most common async defects.
**EX:** `if (!refreshing) refreshing = doRefresh(); await refreshing;`

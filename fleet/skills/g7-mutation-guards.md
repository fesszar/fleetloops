# G7 — Debounce / idempotency guards
**WHEN:** any mutating action (submit/create/update/delete), double-tap risk, automatic retries.
**DO:** three layers —
1. Client in-flight guard: ignore the action while one is pending.
2. Disable the control and show an inline spinner immediately on activation.
3. Server idempotency key (UUID/high-entropy random): store the first response (success *or* failure) and replay it; error if the same key arrives with different params.
**DON'T:** use `setTimeout` debounce for dedup (that's rate-limiting, not de-duplication); use email/PII as the key; reuse a key with different params; fail silently — always surface the outcome.
**WHY:** retries and double-taps create duplicate charges/records. Only mutations need keys; GET/DELETE are already idempotent.
**EX:** server: `if (seen(key)) return stored(key); resp = process(); store(key, resp);`

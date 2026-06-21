# G9 — Auth state-change cleanup
**WHEN:** logout, account switch, session end, "clear data."
**DO:**
- In one transaction, in FK-safe order (children first), clear every store holding user data.
- Reset (don't delete) singleton/schema rows; reset third-party identity SDKs (billing/analytics/push) to anonymous; clear in-memory caches; then navigate to auth.
**DON'T:** leak one user's data into the next session; `sleep()` to "let cleanup settle" — await each step deterministically before login.
**WHY:** residual data crossing accounts is a privacy/security defect.

# G10 — Password & token hashing
**WHEN:** storing passwords, API keys, or refresh/session tokens; "slow login" reports.
**DO:**
- Passwords → **Argon2id** (OWASP minimum `m=19456 KiB (19 MiB), t=2, p=1`, or `m=46 MiB, t=1, p=1`). Fall back to scrypt `N=2^17, r=8, p=1`, or bcrypt **work factor ≥10** (legacy only; enforce its 72-byte input limit). Tune so one hash stays **well under 1 second** — measure on your own server (OWASP).
- High-entropy random tokens → fast **HMAC-SHA-256 with a server-side pepper** (kept outside the DB).
- Compare any secret-derived hash in **constant time**; run KDFs off the request hot path.
**DON'T:** run a slow KDF over every token on every request (CPU melt); store random tokens with a slow KDF; compare with `===`; use MD5/SHA-1; hash a low-entropy password with bare SHA-256.
**WHY:** a slow KDF per token is wasted CPU; a fast hash on a low-entropy password is brute-forceable. Don't hard-code millisecond targets — measure.
**EX:** token store `hmacSHA256(token, pepper)`; verify with `timingSafeEqual`.

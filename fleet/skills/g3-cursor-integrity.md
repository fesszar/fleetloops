# G3 — Cursor / pagination integrity
**WHEN:** sync, pagination, pull/push, offset/cursor, infinite scroll.
**DO:**
- Use keyset pagination on a total-order key with a unique tie-breaker `(created_at, id)`.
- Advance the **read** cursor only after a pull is successfully applied.
- Keep read and write cursors separate; encode the cursor as an opaque base64 string.
**DON'T:** use `OFFSET` on large/changing sets; let a push/write advance the read cursor; sort on a non-unique key.
**WHY:** position-based paging skips or duplicates rows under concurrent insert/delete; a row-anchored cursor doesn't.
**EX:** `WHERE (created_at,id) < ($1,$2) ORDER BY created_at DESC, id DESC LIMIT n`

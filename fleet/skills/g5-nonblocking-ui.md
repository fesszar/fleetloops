# G5 — Non-blocking UI + safe persistence  (pairs with G2)
**WHEN:** login/signup/auth, any user action that triggers slow I/O, loading states.
**DO:** three phases — (1) await only the critical write the next step needs; (2) update in-memory state synchronously so the UI reacts now; (3) fire non-critical persistence in the background.
**DON'T:** block the UI on non-critical writes; navigate before the state the next screen reads is set.
**WHY:** blocking on everything feels slow; skipping the critical await breaks the next step.

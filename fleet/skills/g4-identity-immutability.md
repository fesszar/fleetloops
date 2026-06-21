# G4 — External-service identity immutability
**WHEN:** any ID shared with a third party (Stripe, RevenueCat, Apple, analytics, webhooks).
**DO:**
- Choose the external user-id format once and keep it byte-identical everywhere.
- If identity must change, use the vendor's documented alias/merge mechanism (e.g. SDK `logIn`/identity API).
- Reconcile state by webhook, not by re-keying.
**DON'T:** reformat/normalize an ID the vendor already stored; invent transfer/migration calls that aren't in the SDK; use email or other PII as the stable key.
**WHY:** a reformatted id orphans the purchases/subscriptions the vendor still keys to the old value.
**EX:** keep `usr_abc` everywhere; to merge identities, alias old→new via the SDK — never rewrite the stored id.

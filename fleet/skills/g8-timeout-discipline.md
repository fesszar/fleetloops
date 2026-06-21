# G8 — Network timeout discipline
**WHEN:** any outbound HTTP/RPC/DB call; a request with no deadline; "spinner stuck" reports.
**DO:**
- Give every request an explicit deadline: `AbortSignal.timeout(ms)`, ms chosen per call class.
- Combine cancel reasons: `AbortSignal.any([userSignal, AbortSignal.timeout(ms)])`.
- Abort in-flight work when the unit that started it tears down.
- Treat `TimeoutError` distinctly from a user abort.
**DON'T:** rely on default (infinite) timeouts; reuse an aborted signal — a signal is single-use, so allocate a fresh controller for every request **including retries**.
**WHY:** unbounded calls hang workers and mask races.
**EX:** `fetch(url, { signal: AbortSignal.timeout(5000) })`

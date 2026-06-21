# G1 — Five-why root cause
**WHEN:** any bug / error / crash / regression / 500 / 502, or before you "fix" a symptom.
**DO:**
- Reproduce the failure before theorizing.
- Ask "why" repeatedly until you reach a *process or safeguard gap you can fix* (a missing guard, validation, or test) — not a person.
- Fix the whole class of bug, not the single instance.
- Record root cause + counter-measure in `memory.md` (see G14).
**DON'T:** patch the symptom; name a human as the root cause; stop at the first plausible "why".
**WHY:** symptom patches recur; the cheapest durable fix removes the class.
**EX:** Problem → Why₁…Whyₙ → Root cause (missing safeguard) → Counter-measure that prevents the class.

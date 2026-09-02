# Safety Pattern: Two-Tier Call Memory with a Curation Gate

A reusable pattern for outbound phone agents that **learn from their calls**
without becoming unsafe. It lets an agent get smarter over time — remembering
each caller and noticing patterns across many callers — while keeping personal
data isolated, keeping learned knowledge from being poisoned by a single caller,
and keeping a human in control of what the agent starts saying.

This is a design pattern, not a product. It is described so other phone-call
agents can adopt the parts they need. A reference implementation lives in
`apps/python/cortex-call-brain/` and `skills/adherence-memory-callback/`.

## Problem

Most phone agents are stateless: every call starts from zero. The obvious fix —
"remember everything and reuse it" — creates four real risks:

1. **Privacy.** Personal detail from one call leaking into others.
2. **Poisoning.** One mistaken, confused, or dishonest caller teaching the agent
   something false that then affects everyone.
3. **Runaway behavior change.** The agent silently starting to *say new things*
   to callers based on unvetted "learning."
4. **Irreversibility.** No clean way to delete a person's data or undo a bad
   lesson.

## The pattern: two tiers plus a gate

Split memory into two tiers with different rules, and put a curation gate
between them.

### Tier 1 — Sub-brain (per caller, private)

- One record per caller, keyed by their E.164 number.
- Holds a compressed running summary, open follow-ups, and short continuity
  context (for example a "call me back later, I'm at a wedding" note).
- This is the only place personal detail lives. It is **never** copied into the
  shared tier.
- Deleting it is a complete **right-to-forget** for that person.

### Tier 2 — Master brain (shared, anonymized)

- General knowledge learned across all callers: facts and aggregate signals
  (for example "some callers report X").
- Contains **no attributable personal data**. Corroboration sources are stored as
  **keyed-HMAC ids** of phone numbers — not bare hashes, since a phone number is a
  small enumerable keyspace that a plain hash would not protect — so a shared fact
  cannot be traced to an individual without the secret key.

### The curation gate (anti-poisoning)

Knowledge does not move from "heard once" to "trusted" on a single say-so:

- A new fact is a **candidate** until it is corroborated by **N distinct
  sources** (default 2). The same caller repeating themselves **never** counts —
  corroboration is by distinct hashed source, not by repetition.
- Only a corroborated fact becomes **canonical** and eligible to influence future
  calls.
- Learning is built from **deterministic keys**, not free text: an LLM may map
  "sick to my stomach" to a canonical symptom, but the stored fact/signal key is
  templated, so two differently worded calls about the same thing actually
  match and corroborate.

## Human-in-the-loop before behavior changes

Learning what callers say is safe. **Changing what the agent proactively says**
is not — so gate it:

- A corroborated pattern is surfaced to an **admin** as a proposed change
  ("start asking callers about X").
- A strong signal (many distinct callers, above a high threshold) may
  **auto-apply**; weaker ones **wait for an explicit admin decision**. The admin
  can also require manual approval for **every** change.
- The agent asks a proactive question only about **approved** patterns, and a
  dismissed pattern stays out until re-approved.

This keeps the agent's outward behavior auditable: you can always see which
learned patterns are live, who approved each one, and revoke any of them.

## Guards around the call itself

Learning memory is layered on top of the usual outbound-call guards, all
**fail-closed** (when in doubt, do not dial):

- **Consent** — never call a caller marked without consent.
- **Quiet hours** — never call inside the caller's local quiet window.
- **Idempotency** — never dial the same caller twice within a recall window, or
  twice in one run.
- **Budget** — stop the whole campaign when a spend cap would be crossed; do not
  skip ahead.

## Boundaries for sensitive domains

For medical, legal, financial, or emergency content, the learned knowledge must
stay **descriptive**, never **prescriptive**. In the reference health use case
the agent records "several callers report X" and flags it to staff, but never
diagnoses, advises, or acts on it. The curation gate decides what the agent may
*ask about*; it must never let the agent start giving advice.

## What to reuse

| If you want… | Take… |
| --- | --- |
| Per-caller memory without cross-contamination | the sub-brain tier + right-to-forget |
| Cross-caller learning that resists a bad actor | the candidate→canonical curation gate (N distinct sources) |
| Reliable corroboration across differently worded calls | deterministic fact/signal keys, LLM for understanding only |
| Control over new agent behavior | the human-in-the-loop approval step (auto/manual thresholds) |
| Safe outbound dialing | the four fail-closed guards |

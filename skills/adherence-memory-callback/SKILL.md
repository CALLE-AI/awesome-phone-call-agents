---
name: adherence-memory-callback
description: Run a consent-based outbound CALL-E medication-adherence phone check-in that remembers each caller across calls, learns side-effect patterns across many callers behind a corroboration gate, and honors "call me back later" by opening the next call with that context.
license: MIT
---

# Adherence Memory Callback

Use this skill when a **pharmacy or clinic** (with recipient consent) wants a
**brief outbound phone check-in** on how a patient is getting on with a
prescribed medicine — and wants the agent to get **smarter with every call**
instead of starting from zero each time.

It packages a **two-tier memory** on top of a CALL-E outbound call:

- a **sub-brain per caller** (private running summary, open items, and any
  "call me back" context), and
- a shared **master brain** of general facts and anonymized signals learned
  across all callers, guarded so no single caller can poison it.

This skill only listens, acknowledges, and notes answers. It is **not medical
advice**: it never diagnoses, never recommends a medicine or dose, and escalates
anything serious to a human pharmacist.

## When to use

- One outbound **medication-adherence check-in** to a consented patient number.
- You want per-caller **continuity** ("last time you mentioned…") and
  cross-caller **learning** (patterns several patients report).
- You want a **human-in-the-loop** gate before the agent starts proactively
  asking about a newly learned side effect.

## When not to use

- Diagnosis, triage, dosing, emergency response, or any medical advice.
- Unsolicited outreach, marketing, or lead generation.
- Recurring schedules without a separate scheduler wrapper and explicit consent.

## Workflow

1. Read `references/safety.md` and confirm **recipient consent** and that it is
   not quiet hours for the caller's region.
2. Build the call goal from memory: the caller's sub-brain (continuity + any
   callback context) + the master brain's **canonical** facts (background) +
   any **admin-approved** proactive questions + the safety rails.
3. **Preview first (no call):** run the reference app in `--dry-run` mode to see
   the exact goal.
4. **Place the call** through CALL-E only after consent and guard checks pass.
5. After the call, extract structured fields from the transcript and update
   memory: the sub-brain summary/open items, candidate facts (through the
   corroboration gate), and anonymized signals.
6. If the caller asked to be called back, store the short reason so the **next**
   call opens with it ("last time you were at a wedding — how did it go?").

## The corroboration gate (why this is safe)

A learned fact stays a **candidate** until **at least two distinct callers**
independently report it — the same caller repeating themselves never counts.
Only then does it become **canonical** and eligible to influence future calls.
See `references/safety.md` for the full curation and privacy rules, and
`references/examples.md` for worked call-to-memory examples.

## Human-in-the-loop prompt approval

A pattern reported by enough distinct callers is surfaced to an **admin**, who
confirms or dismisses it before the agent starts **proactively** asking about
it. A strong signal (many distinct callers) can auto-apply; the admin can also
require manual approval for every change. The agent asks a proactive question
only about **approved** patterns, and if the caller says they have not had the
issue, it reassures them and tells them to contact the pharmacy if they ever do.

## Runnable app

The reference runner lives at `apps/python/cortex-call-brain/` (relative to this
submission repository root). It builds the CALL-E goal from memory, applies
consent / quiet-hours / idempotency / budget guards, places the call through the
CALL-E CLI when run live, and folds the transcript back into the brain. Use its
`--dry-run` mode to preview a goal without placing a call.

## Output

After a completed call, expect structured fields such as:

- `outcome` — one of `adherent`, `side_effect`, `needs_refill`, `missed_doses`,
  `no_answer`
- `sub_brain_summary` — a short private summary of this caller for next time
- `open_items` — follow-ups for the next call
- `candidate_facts` / `signals` — general, anonymized knowledge for the master
  brain

Mask phone numbers in any user-facing summary.

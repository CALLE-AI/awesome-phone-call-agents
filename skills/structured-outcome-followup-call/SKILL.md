---
name: structured-outcome-followup-call
description: Place a goal-driven CALL-E call that collects specific structured answers, score those answers against a deterministic rubric you supply, and conditionally trigger a follow-up action — all runnable in mock mode with zero live calls or credentials.
license: MIT
---

# Structured Outcome Follow-up Call

## What this skill does

Many phone-call workflows aren't really "have a conversation" — they're "call someone, get a
small set of specific answers, decide what happens next based on those answers." This skill
packages that pattern for CALL-E:

```
place call (goal-driven task + resultSchema)
    -> CALL-E adapts the conversation to gather the answers
    -> webhook returns structured answers
    -> your rubric scores them deterministically
    -> a follow-up action fires based on the score
```

It is **not** a specific workflow like a reminder call or an appointment booking call — it's
the reusable scaffolding underneath any workflow that follows the shape above. Bring your own
questions, your own rubric, and your own follow-up action; this skill handles the call
lifecycle, the provider abstraction, and the safe-to-develop-without-a-live-call part.

## Status

**Reference implementation, mock-mode-first.** `scripts/mock_provider.py` simulates CALL-E
completely (no network calls, no credentials) so you can read, run, and adapt this skill
before ever touching a live CALL-E account. `scripts/orchestrate_example.py` is a complete,
runnable, non-healthcare example (a delivery-exception follow-up call) that exercises the
whole pattern end to end using the mock provider.

A real-CALL-E adapter is intentionally *not* included in this first contribution — see
"What's deliberately left out" below.

## When to use this skill

Use this when you're building an agent that needs to:
- Ask a small number of specific questions over the phone (not an open-ended conversation)
- Turn the answers into a decision using rules you can write down and explain
- Take an automatic next step for some outcomes, without a human reviewing every call

Don't use this for open-ended conversational calls, calls where the "right" response can't be
reduced to a rubric, or anything where the follow-up action needs a human judgment call before
firing (see the safety checklist for where that line is).

## How it works

### 1. Define your questions and result schema

```python
from structured_call import CallQuestion

questions = [
    CallQuestion(key="package_received", prompt="Did the package arrive at the address?"),
    CallQuestion(key="condition_ok", prompt="Was the package in good condition?"),
    CallQuestion(key="reschedule_needed", prompt="Does delivery need to be rescheduled?"),
]
```

`scripts/mock_provider.py` turns this list into both a natural-language task description for
CALL-E's goal-driven call model and a JSON `resultSchema`, the same way described in
`references/result_schema_guide.md`.

### 2. Write your rubric

A rubric is just a function: `structured_answers -> (level, score, reasons)`. It's
intentionally not part of this skill's code — your rubric is domain-specific and you should
be able to read it top to bottom without touching the call machinery. See
`assets/example_rubric.json` for the delivery-exception example's rubric, expressed as data
so it's easy to adapt without writing a new scoring function from scratch.

### 3. Run it

```bash
python scripts/orchestrate_example.py
```

This runs the full pipeline against the mock provider and prints the outcome for each of three
canned scenarios (no issue / minor issue / needs reschedule), so you can see the shape of the
whole thing before wiring up anything real.

### 4. Swap in a real provider (not included yet)

Everything in `scripts/mock_provider.py` implements one small interface
(`initiate_call`, `parse_webhook_event`) — a real CALL-E adapter is a second implementation of
that interface, not a rewrite of anything else. This keeps today's contribution runnable and
inspectable without requiring reviewers to have CALL-E credentials to evaluate it.

## What's deliberately left out (and why)

- **No real CALL-E network calls.** Keeping this contribution mock-only for now means anyone
  can clone, read, and run it in under a minute with zero setup — which is worth more to the
  community than a live adapter that only some contributors can verify. A real adapter is a
  natural, small follow-up contribution once this pattern itself has been reviewed.
- **No specific domain logic** (healthcare, delivery, HR, etc.) baked into the skill itself —
  only in the example. The skill is the scaffolding; the example is one illustration of it.
- **No notification/paging integrations.** The example's "follow-up action" is a printed log
  line, matching this repo's own guidance to keep examples safe-by-default.

## Files

```
structured-outcome-followup-call/
├── SKILL.md
├── scripts/
│   ├── mock_provider.py        # Standalone mock CALL-E client + orchestration loop (stdlib only)
│   └── orchestrate_example.py  # Runnable, non-healthcare worked example
├── references/
│   ├── result_schema_guide.md  # How to write a resultSchema CALL-E can reliably fill
│   └── safety_checklist.md     # Consent, idempotency, phone formatting, credential & action boundaries
└── assets/
    └── example_rubric.json     # The delivery-exception example's scoring rubric, as data
```

## See also

`references/safety_checklist.md` before adapting this to any real workflow — in particular the
note on where automatic follow-up actions should and shouldn't be allowed to fire without a
human in the loop.

---
name: mobilize
description: Get a required number of confirmed responses from a consented pool of people within a deadline by calling multiple candidates in parallel waves via CALL-E, stopping as soon as the need is met. Use for urgent mobilization tasks like "find 3 donors in the next hour" or "get 2 volunteers by 5pm" from a registry of people who opted in to be contacted.
license: MIT
---

# Mobilize

Use this skill when the user needs a specific number of confirmed people from
an existing, consented pool, under a deadline -- not one call, and not a
cold-outreach campaign. `mobilize` wraps the `mobilize/` engine in this
repository (parallel wave dispatch, commitment calibration, a crash-safe
ledger) so an agent can trigger a real mobilization without reimplementing
any of it.

## When To Use

Use this skill for:

- "I need N people to do X by <deadline>" from a registry, roster, or list
  of people who already agreed to be contacted for this purpose
- urgent staffing, donor, or volunteer mobilization
- any task where calling candidates one at a time is clearly too slow and
  the pool is large enough that parallel dispatch matters

## When Not To Use

Do not use this skill to:

- cold-call people who have not consented to being contacted for this
  purpose -- `mobilize` assumes the pool is a consented registry; it is not
  a lead-generation or cold-outreach tool
- place a single one-off call (use CALL-E directly for that)
- guess phone numbers, need counts, or deadlines the user did not provide
- run `mobilize_real` calls without the user's explicit confirmation that
  the phone numbers are real, owned, or authorized contacts

## Core Workflow

1. Confirm the pool is consented (the user should say so explicitly, e.g.
   "call our registered donors" or "text the on-call rotation").
2. Extract required fields: `need_label` (what you're asking), `count` (how
   many confirmations needed), `deadline_minutes`, and the phone numbers or
   pool source.
3. If no real phone numbers exist yet, or the user wants to see the engine
   work first, run the **simulated** path (`mobilize_simulated` via the MCP
   server, or `python -m mobilize.app.cli`) -- zero cost, instant, safe to
   run freely.
4. Only call `mobilize_real` (or `python -m mobilize.app.cli --real`) when
   the user has explicitly confirmed the phone numbers and wants to spend
   real CALL-E call credits. Never pass more numbers than the user
   explicitly provided.
5. Report the result: filled or not, how many confirmed, how many calls
   used, and time to fill.

## Why Wave Dispatch, Not "Cancel and Retry"

CALL-E's API has no operation to cancel an in-flight call (verified against
the CALL-E OpenAPI spec). `mobilize` therefore dispatches in **waves**: size
the first wave using each candidate's prior likelihood of confirming, wait
for results, and only dispatch a further wave if the need is still unmet.
Once the need is met, no further wave is ever dispatched -- calls already in
flight are allowed to finish, but nobody new is ever called. Do not describe
this as "cancelling calls."

## Why a Stated "Yes" Is Not a Confirmation

People say yes to be agreeable and then don't follow through (acquiescence
bias). `mobilize`'s reconciler scores commitment from the call's evidence
text -- firm language ("leaving now") scores higher than hedged language
("I'll try") -- blended with the candidate's historical show-up rate. Only
responses above the commitment threshold count toward the need. See
`references/commitment-model.md` for the scoring detail, and
`mobilize/sim/harness.py` in this repo for the measured accuracy gain over
treating every stated yes as confirmed.

## Safety Rules

Read `references/safety.md` for the full safety contract used by the
governance module (`mobilize/core/policy.py`). Always follow these rules:

- Every call must disclose it is an AI at the start (enforced in the task
  prompt sent to CALL-E).
- Never call anyone on the do-not-call list, in cooldown, or over the
  contact-fatigue limit for the configured window -- the governance module
  enforces this before dispatch, not after.
- Respect configured calling-hour windows unless the need is explicitly
  marked as an emergency override, and log every override.
- Never dispatch to a larger pool than the user explicitly authorized.
- If CALLE_API_KEY is missing or the user has not confirmed real numbers,
  stop and use the simulated path instead of guessing.

## Output Format

Report:

- `filled`: whether the need was met
- `confirmed_count` / `count` needed
- `calls_used` and `waves_dispatched`
- `time_to_fill_seconds` if filled
- for each confirmed candidate: outcome and commitment score

If not filled, report the blocker (pool exhausted, call budget hit, or
deadline) and never claim the need was met unless `filled` is true.

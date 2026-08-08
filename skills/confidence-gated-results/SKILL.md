---
name: confidence-gated-results
description: Handle a CALL-E phone call that succeeded but returned no usable structured result. Use when a call reaches a terminal status and structured_result is null, partial, or fails schema validation, and an agent must decide between committing the result, placing one narrowed repair call, or escalating to a human with the evidence trail.
license: MIT
---

# Confidence-Gated Results

Use this skill when a phone call **worked** but the data did not.

A call can reach `completed`, bill normally, and still hand back
`structured_result: null` — or a result that is present but missing the one field the workflow
actually needed. The person answered. They said something. The extraction produced nothing usable.

Most integrations read the result as a value and move on. That is the bug: `null` gets treated as
"no" or as an empty success, and a workflow ships an order, closes a ticket, or marks a lead dead on
the strength of a call that produced no evidence at all.

This skill makes that state explicit and gives it three exits.

## When to use

- A call reached a terminal status and `structured_result` is `null`, `{}`, or missing.
- The result is present but a **required** field is absent, empty, or fails your schema.
- The result contains a value your workflow cannot act on ("maybe", "not sure", "call me back").
- You are about to branch on a call result and you have not decided what `null` means.

## When not to use

- The call never reached a terminal status. Poll first; a call in flight has no result to gate.
- The call was not answered (`no_answer`, `busy`, `failed`). That is a reachability problem, not a
  confidence problem — retry policy belongs to the caller, not here.
- The person clearly answered and the answer is simply "no". A confident negative is a **result**,
  not a failure. Do not repair-call someone to get a different answer.
- Anything medical, legal, financial or emergency. See [`references/safety.md`](references/safety.md).

## The three-tier outcome contract

Every terminal call resolves to exactly one of three tiers. Decide the tier before you decide what
to do.

| Tier | Meaning | Action |
| --- | --- | --- |
| **COMMIT** | Every required field present, values actionable | Use the result. Record confidence and move on. |
| **REPAIR** | Call connected, extraction incomplete, and the gap is narrow enough to ask again | **One** narrowed follow-up call that asks only for the missing fields. |
| **ESCALATE** | Ambiguous, contradictory, exhausted, or repair not permitted | Hand to a human with the full evidence trail. Never guess. |

The default when you cannot classify is **ESCALATE**. Silence is not consent, and `null` is not "no".

## The repair loop, and why it decomposes the schema

The reason a call returns `null` is usually not that the person refused. It is that one composite
schema asked for four things at once and the extraction could not satisfy all of them, so it emitted
nothing rather than something partial.

So a repair call **must not re-ask the original question**. Re-asking a schema that already failed
produces the same failure and bills you twice.

Instead, decompose:

1. Take the required fields that are missing.
2. Split the failed schema into the smallest independent sub-schemas — ideally one field each.
3. Build a task that references the earlier call ("you spoke with us a moment ago about X") and asks
   only for the missing pieces, in plain order, one at a time.
4. Place **one** repair call with a schema containing only those fields.
5. Merge: fields already confidently captured are kept; only the missing ones are filled.

Rules that keep this safe:

- **One repair call per original call.** Never a loop. If the repair also returns `null`, escalate.
- **Never widen the ask.** A repair call asks for a subset, never a superset.
- **Never re-ask a field you already have confidently.** That is how you end up with two different
  answers and no way to choose.
- **Carry an idempotency key** derived from the original call id plus `repair`, so a retried
  workflow cannot place a third call.

## Reading the call before you judge it

Use `GET /v1/calls/{id}` for the terminal result and `GET /v1/calls/{id}/events` for how it got
there. The event stream is what distinguishes "they hung up in the first five seconds" from "they
talked for ninety seconds and the extractor failed" — those are the same `null` and completely
different decisions.

- Short duration, few turns, `null` → treat as not-really-reached. Escalate or let the caller's
  retry policy handle it. Do not repair-call.
- Substantial conversation, `null` → genuine extraction failure. This is the repair case.
- Substantial conversation, partial result → repair the gap only.

## What to record

Whatever the tier, write down enough that a human can audit the decision without listening to
anything:

- the original call id, its terminal status and duration
- the schema that was asked for, and which required fields came back missing
- the tier decision and the rule that produced it
- the repair call id, if one was placed, and what subset it asked for
- the final merged result and which call each field came from

A result with no provenance is indistinguishable from a guess.

## Running the classifier

The tier rules are implemented as pure functions in
`scripts/classify-result.mjs`, so an agent does not have to re-derive them and a
reviewer can check them. Use `scripts/classify-result.mjs` directly:

```bash
node scripts/classify-result.mjs --call call.json --required appointment_confirmed,preferred_date --turns 14
```

It prints the tier decision and, when the tier is `REPAIR`, the narrowed sub-schema, the repair task
and the idempotency key. Exit codes: `0` commit, `5` repair, `6` escalate.

Run its tests with:

```bash
node --test scripts/classify-result.test.mjs
```

The suite covers the pair that matters most: the *same* `null` result classified as REPAIR after a
96-second conversation and as ESCALATE after a 5-second hangup.

## Worked examples

See [`references/examples.md`](references/examples.md) for concrete traces: a null result after a
real conversation repaired into a commit, a partial result with one missing field, a contradictory
result escalated, and a five-second hangup correctly *not* repaired.

## Safety

Read [`references/safety.md`](references/safety.md) before placing any repair call. The short
version: a repair call is a second phone call to a real person who has already been interrupted
once. It is justified only when the first call genuinely produced a conversation and the missing
data genuinely blocks the workflow. Convenience is not justification, and a person who declined is
not a person to call back.

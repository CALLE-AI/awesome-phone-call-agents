# Decision table

The engine is a pure function of validated evidence and deterministic context.
No model participates. Branch **order matters** — it encodes precedence.

## Precedence

| # | Condition | Decision | Why it sits here |
|---|---|---|---|
| 1 | Workflow already terminal | `NOOP` | A late result is evidence, never an overwrite |
| 2 | `call.status` is `failed` / `canceled` | `RETRY` or `HUMAN_REVIEW` | Branch on the published enum, never on `failure_code` |
| 3 | Recipient status != `completed` | `RETRY` | No conversation happened, so no evidence exists -- whatever the result object contains |
| 4 | `structured_result` is null or fails re-validation | `RECONCILE` -> `RETRY` -> `HUMAN_REVIEW` | Null is never success |
| 5 | Recipient asked not to be called again | `HUMAN_REVIEW` + suppress this workflow record | Outranks everything else: it carries a consequence beyond this one call. (Scope note: suppressing every future call to that *number*, not just this one record, is a natural next step most first versions skip -- decide deliberately, not by omission.) |
| 6 | Recipient disputes the record, or raises a commercial/contract change | `HUMAN_REVIEW`, distinctly coded | A generic `needs_human` flag cannot tell an operator which of these it is |
| 7 | `needs_human == "yes"` (routine request for a person) | `HUMAN_REVIEW` | Outranks every positive answer |
| 8 | Identity gate: answer could close the workflow, but nobody confirmed they are the contact or an authorized representative | `HUMAN_REVIEW` | An authorized **destination number** does not authorize whoever picks it up |
| 9 | Confidence below threshold, on a path that could resolve | `HUMAN_REVIEW` | Dampener: withholds only, never grants |
| 10 | `received == "yes"` and `status == "on_time"` | `RESOLVE_ON_TIME` | The clean case |
| 11 | `status == "delayed"` with a parseable date inside the threshold | `RESOLVE_DELAYED` | Unparseable or over-threshold -> `HUMAN_REVIEW` |
| 12 | `status == "blocked"` | `HUMAN_REVIEW` | A blocker is a judgment call |
| 13 | `received == "no"` | `RETRY` or `HUMAN_REVIEW` | Wrong contact; try again within budget |
| 14 | Anything else | `HUMAN_REVIEW` | Ambiguity is never resolved |

Rule 14 is the important one. The default is escalation, so a case nobody
anticipated lands on a person rather than silently becoming a "yes".

Rules 5-8 are the ones easy to leave out of a first version, and each one
closes a real gap: without 5, a "please stop calling me" gets treated as
routine evidence and the same number gets dialled again next cycle;
without 6, a price negotiation and "let me get my manager" look identical
to an operator triaging a queue; without 8, a call that reaches the wrong
desk but gets a confident "yes, on time" can close an order nobody who
was actually authorized ever confirmed.

## Retry vs escalate

Escalate **only** when the attempt budget is genuinely exhausted. A backoff
that has not elapsed, or an attempt already in flight, is a scheduling delay —
it stays pending and is picked up later.

```python
def budget_exhausted(budget) -> bool:
    return budget.reason_code is ATTEMPT_BUDGET_EXHAUSTED   # not "any non-proceed"
```

Getting this wrong floods the human queue with items the system was about to
handle itself, and a queue full of false alarms is a queue people stop reading.

The same distinction applies before the call: "not due yet" and "quiet hours"
are temporal refusals that fix themselves and must leave the workflow alone.
A missing phone number or a blocklisted recipient never improves on its own,
so those do need a person.

## Confidence, in one direction

`task_completed` and `completion_confidence` describe the **whole call task**;
`structured_result` is **per recipient**. So recipient evidence is primary and
batch confidence only dampens:

```
resolve requires:  recipient reached
                 ∧ result schema-valid
                 ∧ received == yes ∧ status ∈ {on_time, delayed}
                 ∧ task_completed is True
                 ∧ completion_confidence.score ≥ threshold

low confidence  →  demote a resolve to HUMAN_REVIEW
high confidence →  changes nothing about an ambiguous or missing result
```

## Identity is self-reported, not authenticated

`spoke_with` -- "who did you actually reach" -- is extracted from what the
person on the call *said*, not verified against anything. It proves someone
made a claim, not that the claim is true. That is a deliberately limited
form of assurance, appropriate only because the call itself discloses
nothing until after the claim is made:

```
authorized destination number  +  self-reported role on the call
    = enough to ask a low-disclosure status question
    = NOT enough for anything consequential (payment, contract terms,
      identity-sensitive disclosure)
```

Do not read a confirmed `spoke_with` as identity verification. It is one
input to a decision about whether *this specific, bounded, low-disclosure
call* may close, nothing more.

## Parsing what people actually say

A ship date arrives as free text from a conversation: `"Tuesday"`,
`"next Friday"`, `"unknown"`. Parse confidently or return nothing.

| Input | Result |
|---|---|
| `2026-09-15` | that date |
| `Friday`, `next Tuesday`, `tomorrow` | resolved against a reference date |
| `September 15`, `15th of September` | that date |
| `unknown`, `soon`, `when inventory arrives` | **None** → `HUMAN_REVIEW` |
| `09/11` | **None** — ambiguous, and guessing is a two-month error |

Returning nothing is a correct outcome, not a parser failure.

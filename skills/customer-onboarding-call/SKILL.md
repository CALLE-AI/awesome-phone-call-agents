---
name: customer-onboarding-call
description: Place a one-off welcome and onboarding call to a customer who just signed up, capture a structured result such as business type, goal, pain points, sentiment, and activation status, then write that result back to a CRM and queue a human follow-up task when the customer asks for one.
license: MIT
---

# Customer Onboarding Call

Use this skill when a new signup should receive a short welcome call and the business wants the
conversation to end as structured data rather than as an unread recording.

`customer-onboarding-call` turns one signup event into at most one **conversation**, one structured
result, and at most one follow-up task. Obtaining that conversation may take up to three attempts on
an unreliable corridor, with only one attempt in flight at a time; see *Attempts, Retries, and
Cancellation*. It does not create recurring schedules, call campaigns, or contact lists. Recurrence,
if the business wants it, belongs to the host scheduler; see [`call-reminder`](../call-reminder/).

The workflow is deliberately narrow: welcome, consent, discovery, next-step offer, wrap-up. A call
that tries to sell, negotiate, collect payment, or resolve a support ticket is out of scope.

## When To Use

Use this skill for:

- welcoming a customer who just signed up and confirming they can get started
- collecting first-party onboarding context: business type, goal, prior tooling, blockers
- detecting whether a customer wants a human to follow up
- turning a spoken answer into a CRM field and an assigned task
- measuring activation coverage when a team cannot call every signup manually

## When Not To Use

Do not use this skill to:

- call people who did not sign up or otherwise ask to be contacted
- run sales, collections, renewal, or win-back calls
- deliver medical, legal, financial, or emergency instructions
- read pricing, delivery windows, contractual terms, or policy from memory
- retry indefinitely after a customer declines or asks not to be called
- re-call a customer who has already completed an onboarding call, unless the user explicitly asks

## Required Fields

For each call, require:

- `customerName`
- `phoneNumber` in E.164
- `companyName` for the agent to introduce itself as
- `companyDescription`, one sentence the agent may state as fact

Optional:

- `businessName`
- `locale` and `region` hints for the conversation

Ask for any missing required field. Do not infer a phone number, country code, or region from a
locale, an IP address, an email domain, or unrelated prior context.

## Core Workflow

1. Confirm the signup is real and recent, and that this customer has not already been called.
2. Build the call task from the required fields. Keep the script to roughly two minutes.
3. Attach a structured result schema so the provider returns fields, not just a transcript. See
   [`references/structured-result.md`](references/structured-result.md).
4. Persist an attempt record under a uniqueness constraint on `(signup_id, attempt_no)` **before**
   dialing, and derive the provider idempotency key from it. Refuse to start a new attempt while
   another is in flight for the same signup.
5. Place the call for that attempt.
6. Receive the terminal result on a webhook. Treat delivery as at-least-once and key ingestion on
   the provider event id.
7. Classify the outcome before writing anything: Stage A decides whether a human took part, and only
   then does Stage B read consent. See *Outcome Classification* below.
8. Write only what the outcome permits, then queue a follow-up task only when the outcome is
   `onboarded` and the customer asked for one.
9. Schedule or cancel a retry according to *Attempts, Retries, and Cancellation*.

Use this shape:

```text
signup -> attempt record -> call task + result schema -> attempt -> terminal webhook
       -> classify -> permitted CRM write -> follow-up or retry or suppress
```

## Conversation Shape

Keep the call in this order. Allow interruption at any point.

1. **Greet and identify.** Name the customer, name the company, state that the call may be
   recorded if that is true in your jurisdiction.
2. **Ask consent.** Ask whether now is a good time for a short call. If the answer is no, offer to
   call back later and end. Do not continue discovery after a soft refusal.
3. **Discovery.** Ask what kind of business they run, why they signed up, what problem they want
   solved, and whether they have used something similar before. One question at a time.
4. **Offer the next step.** Invite the concrete first action, and offer a human if they prefer.
5. **Wrap up.** Summarize what will happen next, thank them, end.

The agent may answer only from `companyDescription` and any knowledge base you explicitly supply.
For anything else — price, delivery time, policy, availability — it must say it will have a human
follow up. Inventing these is the most common failure mode of onboarding-call agents.

## Outcome Classification

A call that reaches a terminal state has not necessarily reached a consenting human. Providers
commonly return a completed call with an empty structured result when the agent talked to a carrier
message, voicemail, or silence. A call can also produce a perfectly well-formed structured result
while the customer was refusing to take part.

**The presence of a structured result is not evidence of consent.** Classification is therefore
driven by an evidence-backed `disposition` field, not by whether a result exists. See
[`references/structured-result.md`](references/structured-result.md).

Classify in **two stages, in this order**. Stage A decides whether a human took part at all.
Only if one did does Stage B read consent.

The staging is the contract, not a presentation choice. Consent fields are meaningless when nobody
answered — a voicemail grants no consent, so `consent_granted` is `false` there. Reading consent
before establishing that a human was reached turns every no-answer into a refusal.

### Stage A — was a human reached?

| # | Outcome | Condition | Action |
| --- | --- | --- | --- |
| A1 | `not-reached` | no structured result, **or** `disposition` is `NotReached` | write no insight; queue a retry; **never** suppress the number |
| A2 | `ambiguous` | provider reported failure and reconciliation has not completed | write nothing; schedule reconciliation, not a retry |
| A3 | `failed` | provider reported failure **and** reconciliation confirms no call occurred | write no insight; queue a retry; **never** suppress the number |

Stage A never suppresses a number and never records a refusal. A customer who did not answer has
not refused anything.

If none of A1–A3 match, a human took part. Continue to Stage B.

### Stage B — a human took part, so consent governs

| # | Outcome | Condition | Action |
| --- | --- | --- | --- |
| B1 | `declined` | `disposition` is `Declined` or `DoNotCall`, **or** `consent_granted` is false | record the refusal and its evidence; write no onboarding insight; queue **no** follow-up; cancel any pending retry; suppress future onboarding calls to this number |
| B2 | `needs-review` | required consent or disposition fields are missing, malformed, or contradict the transcript | write nothing beyond the raw record; **no automatic retry**; route to a human |
| B3 | `partial` | `disposition` is `EndedEarly` | write only the fields actually captured and mark the record partial; queue **no** follow-up unless the customer explicitly asked and evidence supports it; retry only under the callback-consent rule below |
| B4 | `onboarded` | `disposition` is `Completed` **and** `consent_granted` is true **and** a structured result is present | write insight; queue a follow-up only when requested |

Rules that follow from the staging and must not be relaxed:

- **Only Stage B can suppress a number.** A refusal requires a human who refused. `not-reached`,
  `ambiguous`, and `failed` must never mark a number do-not-call.
- **A follow-up task may only be created from `onboarded`, or from `partial` with explicit evidence
  of a request.** Never from `declined`, `needs-review`, `not-reached`, `ambiguous`, or `failed`.
- **A CRM write representing the customer as onboarded, interested, or requesting contact requires
  `onboarded`.** `declined` and `partial` may write only their disposition and evidence.
- **A malformed result from a call a human took part in is `needs-review`, never `not-reached`.**
  Coercing it to `not-reached` would queue an automatic retry and could redial someone who actually
  refused. When you cannot tell whether a human took part, treat the call as reached and route to
  review — the failure mode of a needless manual check is trivial; the failure mode of redialling a
  refusal is not.

Never present `not-reached` as a success. A dropped signup that displays as onboarded is worse than
a visible failure, because nobody follows up.

## Attempts, Retries, and Cancellation

International termination is unreliable in some corridors, and the same configuration can succeed
and then fail minutes later. See
[`references/international-routing.md`](references/international-routing.md).

### The guarantee

One signup yields **at most one conversation**, and **at most one attempt in flight at any moment**.
It may take up to three *attempts* to obtain that one conversation.

"One call per signup" would be the wrong guarantee — it cannot survive a corridor that drops half
its calls. The guarantee that matters is that a customer is never called while another attempt for
the same signup is live, and never called again once a conversation has happened.

**A conversation is any call a human took part in — Stage B — including `partial`.** Retries exist
to obtain a conversation, never to resume one. Once Stage B is reached, the attempt budget is spent
and further automatic calling stops. The single exception is an explicit, evidence-backed callback
request; see *Redialling after a conversation* below.

### Durable per-attempt idempotency

Retries are only safe if each attempt is durably recorded **before** the call is placed.

1. Allocate the next `attempt_no` for the signup and persist an attempt record under a uniqueness
   constraint on `(signup_id, attempt_no)`. If the insert conflicts, another worker owns this
   attempt — stop.
2. Refuse to allocate a new attempt while any attempt for that signup is in a non-terminal state.
3. Derive the provider idempotency key deterministically from that record, for example
   `onboarding:<signup_id>:<attempt_no>`.
4. Never derive an idempotency key from a timestamp, a random value, or a retry counter held only
   in memory. A key that changes on redelivery is not an idempotency key.
5. Key webhook ingestion on the provider event id so redelivery cannot advance state twice.

### Ambiguous outcomes must be reconciled before retrying

A provider failure report is **not** proof that no call was placed. A degraded control plane can
report failure and dial minutes later.

- On a reported failure, mark the attempt `ambiguous` rather than `failed`, and schedule a
  reconciliation check instead of a retry.
- Wait a reconciliation window, default 15 minutes, then check the provider's billing records,
  call logs, or platform logs for that idempotency key.
- If any evidence shows a call was placed, do not retry. Wait for the late terminal result, or
  classify as `not-reached` once the window closes.
- Only promote `ambiguous` to `failed`, and only then schedule a retry, once reconciliation shows
  no call occurred.

### Retry rules

Automatic retries are permitted **only for Stage A outcomes**, where no human took part and so no
conversation has happened:

- Retry `not-reached` and reconciled `failed`.
- **Never** automatically retry `declined`, `partial`, or `needs-review`.
- Cap at three attempts per signup, including the first.
- Space attempts by at least 30 minutes.
- Confine attempts to the recipient's local working hours. A call at 01:40 local proves nothing
  about reachability; it only proves the person was asleep.
- Stop retrying the moment any attempt reaches Stage B.

### Redialling after a conversation

A `partial` call is a conversation that ended early. The customer may have hung up *because* they
did not want to continue, and the workflow cannot tell the difference from a dropped line. So a
partial does not license another call.

Redialling after any Stage B outcome requires **one** of:

1. **Evidence-backed callback consent.** The customer explicitly asked to be called back, captured
   in `callback_consent` with supporting words in `callback_consent_evidence`. Honour a stated time
   or window. Absent or generic evidence does not qualify — silence, politeness, and an
   unfinished answer are not a callback request.
2. **Manual review.** A human inspects the record and authorises the call. Record who authorised it.

`needs-review` always takes route 2. A malformed or contradictory consent record must never be
resolved by calling the customer again to find out.

A redial authorised this way is a new attempt against the same cap. It never resets the budget, and
`declined` remains terminal regardless of any later callback claim.

### Cancelling a pending retry

Every scheduled retry must be cancellable, and must carry a stable id so it can be addressed.

Cancel automatically when any of these occur:

- a conversation completes for that signup
- the outcome is `declined`, or the customer requests do-not-call by any channel
- the customer record is deleted, opts out, or is merged away
- the attempt cap is reached
- an operator cancels it manually

Cancellation must be idempotent, must be safe to call for an already-cancelled or already-fired
retry, and must record what triggered it. If the host cannot cancel a scheduled job, do not
schedule one — surface the retry as a manual task instead, and say so rather than implying a retry
is pending.

## Safety Rules

Read [`references/safety.md`](references/safety.md) for the full contract. Always:

- Treat every call as a real-world side effect with a cost.
- Call only the configured E.164 number, and only for a customer who signed up.
- Ask consent at the start of the call and honor refusal immediately and permanently.
- Mask phone numbers in summaries, dashboards, and logs.
- Never expose API keys, tokens, or webhook secrets in output.
- Never state pricing, delivery, policy, or legal or medical guidance from memory.
- Keep transcripts and recordings inside the systems the customer was told about.

## Output Format

After an attempt, report:

- outcome, one of `onboarded`, `partial`, `declined`, `needs-review`, `not-reached`, `failed`, or
  `ambiguous` while reconciliation is pending
- the stage that decided it, so a suppression is always traceable to a human who refused
- masked phone number
- `disposition` and the `disposition_evidence` that supports it
- structured result fields the outcome permits you to write
- whether a follow-up task was created, and why — or explicitly why not
- attempt number out of the cap, and the retry decision: scheduled with its window, cancelled with
  the trigger, blocked pending review, or not permitted
- for any redial after a conversation, the callback consent evidence or the human who authorised it

If no call was placed, report `status: not called`, the exact blocker, and what the user must
supply next.

Never claim a customer was onboarded, interested, or requesting contact without a `Completed`
disposition and granted consent to support it. A populated structured result alone is not
sufficient — a refusal can carry one.

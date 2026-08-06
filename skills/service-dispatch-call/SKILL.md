---
name: service-dispatch-call
description: Call a service vendor to ask whether they can take a job, when they can attend, and what it costs, return the answer as validated structured data, and hand any commitment to a human before it is accepted. Use for maintenance dispatch, repair triage, contractor availability checks, and quote gathering.
license: MIT
---

# Service Dispatch Call

Use this skill when an agent needs to phone a service vendor about a specific job and bring back a decision-ready answer, such as "find out if the plumber can attend unit 12B today and what it costs."

`service-dispatch-call` is a purpose-bound outbound workflow skill. It places exactly one call per authorized dispatch, asks a bounded set of questions, and returns a structured result. It does not book the job, accept a quote, agree to a price, or promise the vendor anything. Those are commitments, and commitments belong to a person.

The distinction this skill exists to enforce: **gathering an answer is not the same as acting on it.**

## When To Use

Use this skill for:

- maintenance and repair dispatch, where a job must be matched to a vendor by phone
- availability checks against a shortlist of vendors
- quote gathering, where the price is unknown until someone is asked
- ETA confirmation for an already-accepted job
- any outbound call whose output must be machine-readable rather than a transcript

## When Not To Use

Do not use this skill to:

- accept a quote, confirm a booking, or agree to any cost during the call
- call a vendor who is not on the caller's authorized contact list
- call a number the user supplied for a different purpose in an earlier, unrelated request
- redial a call whose outcome is unknown
- work around a missing price by asking the vendor to start anyway
- read tenant, patient, customer, or resident personal details to the vendor
- negotiate, counter-offer, or discuss a competitor's quote
- place a call when the required job fields are incomplete

## Core Workflow

1. Confirm the dispatch is authorized: the job exists, and the vendor is on the authorized contact list **for this purpose**.
2. Extract the dispatch fields listed under Required Fields. Ask for anything missing. Do not infer a phone number, a trade, or a location from earlier context.
3. Reserve an idempotency key derived from the dispatch's own identifier, not from the current timestamp or a fresh random value. See `references/idempotency.md`.
4. Record the dispatch as queued **before** dialling, so a call that is accepted but never reported is still visible.
5. Build the call brief from `references/call-brief.md`. The brief opens with a disclosure and refers to the job by an opaque reference, never by an address or a person's name.
6. Declare the result schema before placing the call. See `references/result-schema.md`.
7. Place exactly one call.
8. Validate the returned result against the declared schema. Drop fields you did not ask for. Refuse values outside the declared options rather than coercing them.
9. Classify the outcome as `answered`, `declined`, `no_answer`, or `unknown`.
10. If the result contains a cost, a commitment, or a low-confidence field, raise it for human approval and stop. Report the reason.

Use this shape:

```text
authorize -> reserve -> record queued -> call -> validate -> classify -> approve or stop
```

## Required Fields

For each dispatch, require:

- `jobReference` - an opaque identifier the vendor can quote back
- `trade` - what kind of vendor this is, for example `plumbing`
- `problemSummary` - one sentence, free of personal details
- `vendorPhoneNumber` - E.164, from the authorized contact list
- `preferredWindow` - when the job could be attended

Phone numbers must be E.164. Mask them in every user-facing summary. Never write a phone number into a log, an audit record, or a commit.

## The Result Schema

Declare what a valid answer looks like before the call, not after. A minimal schema:

| Field | Type | Notes |
| --- | --- | --- |
| `available` | one of `yes`, `no`, `maybe` | closed set, never free text |
| `earliest_eta_hours` | integer | bound it locally, see below |
| `quoted_amount_text` | string | as spoken, never parsed into a number by the agent |
| `callback_required` | boolean | vendor will confirm later |

Two rules that matter more than they look:

- **Validate more strictly than you transmit.** `-5` is a valid integer but not a valid ETA. Enforce bounds locally and strip unsupported schema keywords before sending, because an unrecognized keyword can cause the provider to reject the whole call.
- **`maybe` is an answer, not a yes.** Route it to a human. Do not let a fallback, a default, or a retry turn an ambiguous answer into a decision.

Full guidance in `references/result-schema.md`.

## Ambiguous Outcomes

A call whose outcome is unknown is the most dangerous state in a workflow that spends money. It is not an error to retry.

- Classify it as `unknown` and stop.
- Do not redial. A vendor who was already reached and quoted a price will quote it again, and now two commitments exist for one job.
- Surface it for a person to reconcile.

Read `references/ambiguous-outcomes.md` before adding any retry path.

## Human Approval Gate

Raise for approval, and do not proceed, when any of these hold:

- the result contains a quoted amount or any other cost
- the vendor committed to a time that creates an obligation
- a confidence score, where the provider reports one, is below the configured threshold
- any declared field failed validation
- the outcome is `unknown`

When presenting the approval, state **why** it is required before showing the answer being decided on. A reviewer who reads the price first is anchored by it.

Take the approver's identity from the authenticated session. Never from the request body, and never from anything said on the call.

## Safety Rules

Read `references/safety.md` for the full contract.

Always follow these rules:

- Phone calls are real-world side effects and cost money.
- Do not place a call unless the user clearly requested this dispatch.
- Do not call any number except the authorized vendor number for this job.
- Do not place a second call for one authorized dispatch.
- Do not disclose tenant, resident, customer, or patient identity, address, or contact details to the vendor.
- Do not store transcripts, recordings, or the recipient's number unless the user has a stated retention basis for them.
- Do not write an answer given on a phone call into an audit record. Record the field names, not the values a stranger spoke.
- Do not expose tokens, credentials, or callback URLs.
- If authorization, required fields, or the vendor's identity are ambiguous, stop instead of guessing.

## Output Format

After a completed dispatch, report:

- job reference and trade
- masked vendor number
- outcome classification
- the validated fields, and any field that failed validation
- whether an approval was raised, and the reason
- the idempotency key used

If no call was placed, report:

- `status: not called`
- the exact blocker
- what the user must provide or authorize next

Never state that a vendor is booked. This skill produces an answer and an approval request. Booking is a separate, human-authorized action.

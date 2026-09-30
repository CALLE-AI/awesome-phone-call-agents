---
name: recall-outreach
description: Contact affected customers about a product recall or corrective notice with CALL-E. Relays only organisation-approved wording, dispatches a wave as one batch with a strict per-recipient result schema, routes every unapproved question to a human, and never treats a completed call as a completed recall.
license: MIT
---

# Recall Outreach

Use this skill when an organisation has issued a product recall or corrective notice and needs
to reach a list of affected customers by phone: read the approved notice, find out whether each
person still has the item, offer the return options the business actually runs, and record what
each person said in a form someone can audit later.

This is the reusable core of [RecallRoute](https://github.com/HectorTa1989/recallroute): the
approved-wording contract, the batch call plan, a strict
`recipient_result_schema`, the idempotency and webhook reconciliation rules, and — most
importantly — the metric model that refuses to report a completed call as a completed recall.

## When To Use

- An organisation has approved recall or corrective-notice wording and needs to relay it by phone
- The customers are known, and there is a recorded basis for contacting each of them
- The desired output is a per-customer structured outcome plus a human queue for everything the
  approved material does not cover

## When Not To Use

- **Any call where the safe next step is not already decided and written down.** This skill
  relays approved wording; it cannot decide what a customer should do about a hazardous item.
- Emergency notification, injury response, or anything time-critical to physical safety. Never
  call emergency services.
- Cold outreach, marketing, upselling, or collections dressed as a notice
- Calling anyone the organisation has no recorded authorisation to contact
- Mass-scale dialling. Keep waves small and supervised.
- Any workflow that needs a call cancelled after dispatch — the CALL-E Calls API has no cancel
  endpoint, so a kill switch can only stop *further* waves. Say so plainly in your UI.

## The Rule This Skill Exists To Enforce

**A completed call is not a completed recall.**

A recall is finished for a customer when the item is physically back, not when a phone call went
well. Any implementation of this skill must keep those as separate states, and the second must
be reachable only by a named human recording how they know. If you build one boolean called
`contacted` and set it from a completed call, you have built the thing this skill is designed to
prevent.

Report these as **separate measures with separate denominators**, never merged:

| Measure | Definition |
| --- | --- |
| Call attempted | CALL-E accepted a call task containing this recipient |
| Call completed | The call task reached `completed` on `GET /v1/calls` |
| Result validated | A per-recipient result satisfying the full schema came back |
| Right person reached | `right_person_reached` is exactly `yes` |
| Notice understood | The reached person confirmed understanding, in their own words |
| Next step selected | The reached person chose a real return option |
| Independently resolved | A human confirmed the physical return, and said how they know |

## Required Inputs

- `campaign_id`: stable identity, e.g. `RC-2026-001`
- `org_name`: the organisation the assistant says it is calling for, in its first sentence
- `product_label`: what the item is called out loud
- `product_identifier`: model, lot, or SKU — for the record, **not** for reading to voicemail
- `approved_notice`: the exact wording the organisation approved, read verbatim
- `voicemail_text`: a separate, minimal message for answering machines
- `approved_answers[]`: `{question, answer}` — the **only** questions the assistant may answer
- `allowed_next_steps[]`: subset of `pickup_request`, `mail_return`, `store_return`, `callback`
- `approved_by`: the person who signed off the wording
- `timezone` (IANA) and `calling_window` (`HH:MM`–`HH:MM`) in the customers' local time
- `escalation_contact`: a human, for the follow-up queue. Never dialled by the assistant.
- `recipients[]`: `customer_ref`, `phone_e164`, `item_identifier`, `consent_basis`,
  `consent_source`

See `assets/sample-campaign.json` for a fictional example using NANP test-range numbers.

## Preflight

Run every check below **on the server, at the moment of launch** — not when the checklist was
rendered. A green checklist from a minute ago authorises nothing.

1. **Credentials.** A server-side `CALLE_API_KEY` and an https webhook origin. Without them,
   block launching. Never fall back to a simulated result.
2. **Approved wording exists**, is non-empty, and is attributed to a named approver.
3. **Voicemail wording exists and is separate.** Scan it for product-identifying tokens — model
   codes, lot numbers, distinctive product nouns — and warn when found. Exempt the
   organisation's own name; identifying the caller is required.
4. **At least one return option** is configured. Zero approved answers is allowed, but warn that
   every question will escalate.
5. **Escalation contact** is named.
6. **Quiet hours** in the customers' timezone. Let a campaign narrow the window, never widen it
   past a deployment-wide floor. Treat an invalid timezone as a blocker, not as UTC.
7. **Consent.** Every recipient needs an unrevoked authorisation record naming its source. No
   record, no call.
8. **Duplicates.** Enforce phone uniqueness per campaign as a *database constraint*. Nobody is
   called twice about one notice.
9. **Retry cap** per recipient, counted only after CALL-E actually accepts a call.
10. **Kill switch** not engaged.

## Dispatch: one wave is one batch

Send the wave as a single call task with every recipient in the `recipients` array.

```
POST https://api.heycall-e.com/v1/calls
Authorization: Bearer $CALLE_API_KEY
Idempotency-Key: recall-outreach:{campaign_id}:wave{n}:outreach:v1
```

```json
{
  "task": "<see template below>",
  "recipients": [{ "phones": ["+15005550101"], "locale": "en-US", "region": "US" }],
  "recipient_result_schema": { "...": "see references/result-schema.json" },
  "metadata": {
    "campaign_id": "RC-2026-001",
    "call_task_id": "RC-2026-001:wave1:outreach",
    "wave_no": 1,
    "kind": "outreach"
  },
  "webhook_url": "https://your-app.example.com/api/webhooks/calle"
}
```

**Put no customer identity in `metadata`** — campaign and wave correlation only. CALL-E already
has the number it must dial; nothing else about the person is the provider's business.

**Two consequences of batching to design around:**

1. `task` is shared, so it **cannot** contain any one customer's name, order number, or serial
   number. Treat this as a feature: have the assistant *ask* the person to confirm they are the
   right person rather than asserting who they are. It is the safer identification method and it
   discloses nothing to whoever answers.
2. `metadata` is per call task, so the only per-recipient join key returned is the phone number.
   This is why phone uniqueness must be a constraint, not a convention. Match on normalised
   digits, with dispatch order as a fallback.

Persist the returned `call_id` **before** showing anything as started, and create one pending
outcome row per dialled recipient at the same time, so every person dialled is accounted for
even if the provider never returns a result for them.

## CALL-E Task Template

```text
You are an automated voice assistant calling on behalf of {org_name}. Say so in your first
sentence, and say you are calling about a product notice. Do not claim to be a person.

The organisation has issued a notice about {product_label} ({product_identifier}). Your job is
to reach the customer, read the approved notice to them, check what they want to do, and record
their answers accurately. You are a messenger, not an adviser.

First, ask whether you are speaking with the person who bought or uses this product, or the
person in the household who looks after it. Do not say any customer name, order number, or
serial number: you have not been given them and you must not guess. If the person who answers
is not the right person and cannot help, say a person from the organisation will follow up,
thank them, and end the call.

Once you have the right person, read this approved notice exactly as written, without changing
its meaning: "{approved_notice}"

Then find out, without pressing them: do they recognise this product; do they still have it, or
did they already return it, give it away, or throw it away; did they understand the notice and
what to do next; which of the options below they would like; and whether they have a preferred
day or time for it.

Offer exactly these options and no others: {phrased_next_steps}. Read them out and let the
person choose. Do not recommend one over another, and do not invent an option such as a refund,
a replacement, or a repair unless it is written above.

These are the ONLY answers you are permitted to give. Use the wording as closely as you can:
{approved_answers}
Anything not on this list is outside what you may answer, no matter how simple it sounds or how
confident you feel.

If you reach voicemail or an answering machine, leave only this short message and nothing more:
"{voicemail_text}" Do not read the full notice, do not describe the product problem, and do not
leave any detail about the item on a voicemail, because you cannot know who will hear it.

Hard rules you must follow: {boundaries — see references/safety.md}

Before ending, tell the person what will happen next in plain terms, and make clear that
arranging this is not the same as it being completed: someone from {org_name} will confirm the
arrangement. Thank them for their time.
```

The full boundary list is in `references/safety.md`. Every one of them has a matching detection
or enforcement path; they are not decoration.

## Result Schema

`references/result-schema.json`, with `additionalProperties: false` and every field required.
Narrow `selected_next_step`'s enum to the options that campaign actually offers, so CALL-E
structurally cannot return a return channel the business does not run. Always keep `none` and
`unknown` available — they are honest answers.

Validate offline with:

```bash
node scripts/validate-result.mjs assets/sample-result-arranged.json
node scripts/validate-result.mjs assets/sample-result-escalated.json
node scripts/validate-result.mjs assets/sample-result-invalid.json   # exits non-zero
```

## Terminal Events And Reconciliation

Handle `call.completed`, `call.failed`, and `call.result_validation_failed` at your webhook.

1. Require `CALL-E-Event-Id` and require it to match the body `id`.
2. **Reserve the event id before any side effect** — make it a primary key. A duplicate delivery
   must be a no-op that cannot dial anyone again or queue a second follow-up.
3. **Re-fetch with `GET /v1/calls/{call_id}` using your own key.** CALL-E sends no signature
   today, so treat the body as untrusted: it tells you *which* call changed; the fetched
   snapshot is what changes customer status.
4. If the fetched call is not terminal, return non-2xx and let the provider retry rather than
   applying a contradiction.
5. Fan the snapshot out to one outcome per dialled recipient, validating each independently so
   one unusable answer never contaminates the others.
6. Return non-2xx for an unknown call id, so the race between CALL-E accepting a call and your
   transaction committing resolves by retry.

Also poll `GET /v1/calls/{call_id}` for open waves on a schedule. A lost webhook should cost
latency, not truth.

## Interpreting A Result

| Provider state | Record as | May count toward |
| --- | --- | --- |
| Valid, complete result | `valid` | its funnel stages |
| Result present, schema-violating | `invalid` | nothing above "call completed" |
| Completed call, no result | `missing` | nothing above "call completed" |
| Failed or canceled call | `missing` | "attempted" only |

`unknown` is never agreement. An empty string is never an answer.

**Route to a human on any of:** a non-empty `questions`; `human_follow_up_required = yes`;
`contact_outcome = escalate`; `certainty` of `low` or `unknown` where someone was reached;
`right_person_reached = unknown`; a schema-violating result; a failed call.

**Do not route a clean miss to a human.** `right_person_reached = no` with
`certainty = unknown` is a voicemail or wrong number — that is *not reached*, and treating it as
ambiguity will flood the queue with every unanswered call. This is a real mistake that is easy
to make; the distinction is between "we did not reach them" and "we are not sure what happened."

Make the follow-up queue idempotent: unique on `(outcome_id, reason)`, so a retried webhook
cannot queue duplicate human work.

## Approval-Gated Follow-Up

A narrowly scoped scheduling follow-up is permitted: confirming the day or window for a step the
customer already chose. It requires an explicit human approval, an explicit stated purpose, and
an explicit recipient list, and it re-runs every preflight gate.

It may **not** re-read the notice, change the chosen option, or answer anything new. If the
customer raises something else, the call ends and it becomes human work.

## Side Effects, Credentials, Cancellation

- **Side effects:** real outbound calls to authorised numbers only. Nothing is collected,
  shipped, refunded, or confirmed automatically.
- **Credentials:** server-side `CALLE_API_KEY` only. Never in skill files, never in the browser.
- **Cancellation:** there is no cancel endpoint. A kill switch blocks *further* waves; calls
  already accepted will finish. Say this in your UI rather than implying otherwise.
- **Personal data:** mask phone numbers everywhere except the database and the CALL-E request.
  Provide a retention control that erases names, numbers, item identifiers, and transcripts
  while keeping call ids, event ids, and statuses, so the organisation can still prove what
  happened without keeping what proved it.

## Auditability

Every customer status must trace to a provider call id, and where a webhook arrived, to a
provider event id. Statuses set by a human — the only kind that can exist without a call —
should say so explicitly and name the person. Export the exact task text and result schema used
on each wave, so an auditor can read precisely what was said and what was asked for.

## References

- `references/result-schema.json` — the strict schema
- `references/safety.md` — the full boundary list and why each exists
- `references/examples.md` — worked outcomes: arranged, escalated, not reached, invalid
- `assets/sample-campaign.json` — a fictional campaign
- `scripts/validate-result.mjs` — offline result validator

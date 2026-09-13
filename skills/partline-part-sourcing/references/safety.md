# Safety Reference

A sourcing call is a real-world side effect on a real business line. Preview is
the default. Stop whenever recipient authorization, part scope or supplier
identity is ambiguous.

## Authorization And Consent

Every recipient needs a purpose-bound authorization reference tied to this
sourcing request, such as an existing supplier account or an approved vendor
allowlist entry. Possession of a phone number is not authorization.

Do not source numbers from a public website, a search result or caller ID. Do
not call a personal number. Use business contacts the user provided or
approved. A request limits the batch to five recipients.

## Phone Numbers

Require E.164 format. Documentation and fixtures use reserved fictional
numbers.

Numbers are masked in previews, summaries and the local evidence console. The
full number appears only in the private provider payload. The browser console
receives neither a full number nor an API key.

## Disclosure

The call opens by disclosing that an AI assistant is calling, naming the
requester and facility on whose behalf it calls.

## Information Boundaries

A call may discuss only this request: manufacturer, part number, quantity,
required specifications, need-by date, availability, ship date, cutoff and lead
time. Price is recorded only when the supplier volunteers it.

The call must never:

- place an order, reserve stock or hold inventory
- negotiate, accept or acknowledge commercial terms
- approve an alternate part or a specification deviation
- disclose another supplier's name, quote, stock or pricing
- provide engineering, legal, financial or emergency advice

If a supplier raises a commercial decision, record it for human follow-up and
return to the approved factual questions.

## Execution Gate

A live run is accepted only when all three hold:

1. `--live` is present.
2. `--confirm` exactly matches the token printed by the current preview. The
   token is derived from the request, so any edit invalidates it.
3. The current time falls inside the request's local weekday call window.

A failed gate exits non-zero and places no call.

## Duplicate Calls

The idempotency key is derived from the approved request, not from a retry
attempt. If a response is uncertain, resubmit the same unchanged request rather
than editing it, then reconcile by call ID. Never create a second task because
polling timed out.

## Result Handling

A supplier answer is sourcing evidence, never purchase authority or engineering
approval. Rank exact matches before compatible ones. Treat unknown,
contradictory or low-evidence outcomes as human follow-up rather than as
negative results. Treat any proposed alternate as requiring engineering
approval.

Do not persist raw transcripts or phone numbers unless the user supplies a
retention purpose and location.

## Out Of Scope

Not for emergencies, and not for medical, legal or financial decisions.

---
name: bounty-screening-call
description: Verify public bounty facts by one explicitly authorized CALL-E phone call before an agent claims or submits work, returning evidence-backed reward, AI-use, eligibility, deadline, payout, and submission details while keeping every external commitment under human review.
license: MIT
---

# Bounty Screening Call

Use this skill when an agent has found a potentially legitimate technical bounty
or contest and needs to verify unresolved public facts with the official
organizer before doing claim or submission work. The skill is a fact-gathering
step, not an application, claim, negotiation, payment, or payout-collection
workflow.

The default path is a local preview. A compatible host may hand the frozen call
task to CALL-E only after the operator has explicitly authorized that one call,
confirmed the destination, and reviewed the preview. Read
[`references/safety.md`](references/safety.md) before any live handoff and use
[`references/examples.md`](references/examples.md) for the offline fixtures.

## When To Use

- A public bounty listing has an official organizer contact but one or more of
  reward, AI-use, eligibility, deadline, payout, or submission facts are not
  independently confirmed.
- The operator wants a transcript-backed verification brief before deciding
  whether to invest engineering time or submit a claim.
- A host can preserve one stable request identifier and reconcile the terminal
  CALL-E result before any downstream action.

## When Not To Use

- To call a guessed, scraped, private, or unrelated number.
- To ask for passwords, one-time codes, identity documents, bank/card details,
  payment credentials, PayPal links, or account access.
- To negotiate a reward, reserve a slot, submit a solution, accept legal terms,
  create an account, or promise delivery.
- To decide automatically that a bounty is safe, accepted, payable, or worth
  claiming. The result is advisory evidence for a human or a separate
  deterministic policy gate.
- For legal, tax, banking, or financial-advice questions. Ask only about the
  public payout route and record uncertainty.

## Required Inputs

- `request_id`: stable identifier for this one verification request.
- `opportunity_id`: stable listing or issue identifier.
- `title`: public bounty title.
- `listing_url`: HTTPS URL of the official listing or issue.
- `organizer_name`: public organizer or project name.
- `organizer_phone_e164`: one destination explicitly supplied or authorized by
  the operator; E.164 only.
- `contact_basis`: why the operator may contact this number (for example, an
  organizer-published support line plus the operator's current intent to call).
- `reported_reward`: amount and currency currently shown in public evidence.
- `reported_ai_policy`: `allowed`, `limited`, `forbidden`, or `unknown`.
- `reported_eligibility`: `eligible`, `ineligible`, or `unknown` for the
  operator's jurisdiction.
- `reported_deadline`: ISO date/time or `unknown`.
- `reported_payout_method`: `fiat`, `crypto`, `other`, or `unknown`.
- `public_evidence`: short citations or quotes from the listing. Do not put
  secrets or private contact data here.
- `operator_intent`: an explicit statement that this single verification call
  is authorized now.

## Preflight And Preview

1. Confirm that the listing URL is HTTPS and that the organizer and facts are
   public. A public number alone is not permission to call it.
2. Validate `organizer_phone_e164` with `^\\+[1-9]\\d{6,14}$`. Reject local,
   guessed, extension-only, or malformed numbers.
3. Confirm the current operator intent and the contact basis. Do not infer
   permission from a search result, an issue comment, or silence.
4. Compile a preview containing the masked destination, exact task text,
   result schema, and stable idempotency key. The preview must state
   `call_placed: false`.
5. Freeze the preview. Any change to recipient, task, schema, listing, or
   request identifier requires a new preview and new approval.

The bundled preview fixture is dependency-free and never contacts CALL-E:

```bash
python3 scripts/preview_bounty_screen.py assets/example-input.json
```

## CALL-E Task Contract

After the preview has been reviewed, a host may use CALL-E's plan/run/status
flow or an SDK equivalent. Planning is not dialing. Preserve the returned
call/run identifier and stable idempotency key; do not repeat a run after an
ambiguous timeout.

Use a goal equivalent to:

```text
You are a verification-only automated assistant calling on behalf of the
operator. Disclose that immediately and speak only with the official organizer
or an authorized representative.

Verify public facts about one technical bounty: the reward amount and currency,
whether AI assistance is allowed, jurisdiction eligibility, deadline, payout
method, and official submission URL. Do not claim the bounty, negotiate, submit
anything, create an account, or request passwords, codes, identity documents,
bank/card details, payment credentials, PayPal links, or private data.

If the wrong person, voicemail, refusal, or uncertainty is encountered, record
unknown and end politely. Return only the exact structured result fields and
short public-fact notes. Do not infer a confirmation from silence.
```

The host must pass the frozen `organizer_phone_e164`, without printing it in
human-facing output, and must use one call at most for this request.

## Structured Result

The provider result must be reconciled against evidence, not trusted merely
because a model populated a field:

```json
{
  "reward_status": "confirmed | unconfirmed | contradicted",
  "reward_amount": "number or null",
  "reward_currency": "string or null",
  "ai_use": "allowed | limited | forbidden | unknown",
  "eligibility": "eligible | ineligible | unknown",
  "deadline": "ISO string or null",
  "payout_method": "fiat | crypto | other | unknown",
  "submission_url": "HTTPS string or null",
  "confidence": "high | medium | low",
  "notes": "public facts only",
  "evidence": [
    {"claim": "reward", "transcript_span": "short supporting span"}
  ]
}
```

Use `unknown` or `unconfirmed` when the organizer did not clearly establish a
fact. A `completed` call does not mean the bounty was accepted or awarded.

## Downstream Decision Boundary

Pass the reconciled public facts to a separate deterministic task policy. A
verification result may support a human decision, but it must never by itself:

- claim an issue or accept contest terms;
- submit code, a form, a PR, or an account registration;
- send a message asserting acceptance;
- request, store, or validate payout credentials; or
- trigger payment, recurring calls, or another external mutation.

If the bounty is accepted later, monitor the platform or approved mailbox
separately for a written payout request. Never place payout credentials in a
public issue, PR, transcript, fixture, or log.

## Cancellation And Ambiguity

Withhold the provider run approval to cancel before dialing. After a call is
accepted by CALL-E, closing the host does not necessarily cancel it; report that
limitation honestly. If the call id is missing, status polling times out, or
the provider response is otherwise ambiguous, stop and route to human review.
Do not redial automatically or start another bounty workflow for the same
request.

See [`references/safety.md`](references/safety.md) for the complete live-call
boundary and [`references/examples.md`](references/examples.md) for safe,
ambiguous, and prohibited cases.

# Safety

An onboarding call is an unsolicited-feeling call to a real person, placed by an automated agent,
usually within minutes of a signup. Treat it accordingly.

All numbers in this document are fictional.

## Consent

- Call only a person who signed up and supplied their own number. A signup is consent to be
  contacted; it is not consent to be recorded or to be called repeatedly.
- Ask permission at the start of every call, before discovery. "Is now a good time?" is not a
  formality — a customer who says no must be released immediately.
- Disclose recording at the top of the call when you record, and comply with the recording law of
  both the caller's and the recipient's jurisdiction. Some jurisdictions require all-party consent.
- Honour a refusal permanently, not just for the current call. Write the refusal and its supporting
  evidence to the customer record, cancel any pending retry, and suppress future onboarding calls to
  that number. A later result must never overwrite a recorded refusal.
- A refusal outranks anything else the call produced. A declined call can still return a populated
  structured result; it is still a refusal, and it must never create a follow-up task or represent
  the customer as onboarded or interested.
- Record consent as an explicit field backed by what the customer said. Never infer it from silence,
  from continued answers, or from a friendly tone.
- Never re-frame a refusal as an objection to overcome. This workflow is not sales.

## Phone numbers

- Require E.164. Do not construct a number from a locale, an address, an email domain, or a
  country guess.
- Mask numbers in summaries, dashboards, logs, and any output shown to an operator, for example
  `+1-555-•••-0100`. The unmasked number belongs only in the call payload.
- Never include a real customer number in documentation, tests, fixtures, or sample output.
- Verify the number belongs to the customer who signed up. Signup forms collect typos, and a typo
  means calling a stranger.

## Credentials

- Keep provider API keys, webhook signing secrets, and CRM tokens server-side.
- Never print a key, token, signed URL, or webhook secret in agent output, logs, or a summary.
- Verify webhook signatures when the provider supports it. When it does not, restrict the endpoint
  another way and say so plainly rather than implying the endpoint is authenticated.
- Put the call-placing endpoint behind authentication. An unauthenticated endpoint that places
  calls is a way for a stranger to spend your money and harass your customers.

## Content boundaries

The agent may state only what you explicitly supply: the company description and any knowledge base
you attach. For everything else it must defer to a human.

Never let the agent state from memory:

- prices, discounts, fees, or payment terms
- delivery windows, stock levels, or availability
- contractual, refund, warranty, or policy terms
- medical, legal, financial, or immigration guidance
- anything about a competitor

Treat medical, legal, financial, and emergency topics as logistics only. If a customer raises one,
acknowledge it and route to a human. Never advise.

## Side effects

- One signup produces at most one **conversation**, and at most one attempt in flight at any moment.
  Up to three attempts are permitted to obtain that conversation; see the attempt contract in
  `SKILL.md`.
- Guard against duplicates across retries, webhook redelivery, and concurrent workers by persisting
  each attempt under a uniqueness constraint before the call is placed, and deriving the provider
  idempotency key from that record.
- Never retry on a bare failure report. Reconcile first — a provider can report failure and dial
  anyway, and an immediate retry then calls the customer twice.
- Every scheduled retry must be cancellable, and must be cancelled on refusal, on a completed
  conversation, on opt-out or deletion, and at the attempt cap.
- Respect local working hours for the recipient's region, not the operator's. Calling at 01:40 local
  is a harm, not a test.
- This skill creates no recurring schedule. If a host scheduler drives it, cancellation belongs to
  that scheduler and must be documented where the schedule is created. If the host cannot cancel a
  scheduled job, do not schedule one.

## Data handling

- Store transcripts and recordings only in the systems the customer was told about at disclosure.
- Do not paste transcripts, recordings, or extracted customer answers into public issues, pull
  requests, or shared documents.
- Apply the retention period you disclosed. Extracted structured fields usually need to outlive raw
  recordings; delete recordings on schedule.
- Give the customer a way to request deletion, and make sure it reaches both the CRM and the
  provider.

## Honest reporting

- Report `not-reached` when no structured result exists, even though the call reached a terminal
  state. Do not let an unanswered call appear as an onboarding.
- Do not report a customer as onboarded, interested, or requesting follow-up without a structured
  result to support it.
- Surface extraction the agent inferred rather than heard, so a human can check it.
- When a call fails, say what failed and at which layer. "Call failed" without a layer sends
  operators to debug the wrong system.

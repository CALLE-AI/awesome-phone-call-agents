# Bounty Screening Call Safety

## Authorization and destination

- Require current, explicit operator intent for this one call.
- Require a concrete contact basis: the operator supplied the number, or the
  organizer published it for bounty questions and the operator has permission
  to make the call. A scraped number, guessed number, private contact, or
  unrelated support line fails closed.
- Accept only E.164 numbers matching `^\\+[1-9]\\d{6,14}$`.
- Use one frozen destination per request. Never infer a country code, rotate
  numbers, or run a batch from a search result.
- Mask the number in previews, logs, screenshots, and summaries (for example,
  `+1415•••0101`). Send the full number only to the approved CALL-E origin.

## Consent and disclosure

- The caller must say it is an automated assistant and identify the operator's
  purpose before asking questions.
- Ask only public bounty facts. Do not disclose private project data or the
  operator's payout details to the recipient.
- If a third party answers, ask no questions about the bounty and end politely.
- If the recipient objects to automation or recording, stop and mark the result
  for human review.

## Financial and credential boundaries

- A payout method is a public listing fact, not authorization to collect a
  payment. Record `fiat`, `crypto`, `other`, or `unknown` only.
- Never ask for or store a PayPal address, bank account, card number, tax ID,
  password, one-time code, identity document, or wallet seed.
- Never send money, purchase a service, top up an account, or accept a paid
  contest requirement as part of this skill.
- Do not treat a reward statement as guaranteed earnings. The platform's
  acceptance and payment status must be verified separately.

## Provider execution

- Preview is the default and must be no-network/no-call.
- Require a stable idempotency key derived from the request and listing. Reuse
  it for transport retries instead of creating a new call.
- Execute at most one live call for a request. Planning does not authorize
  execution; keep plan and run approval separate when the host supports it.
- Poll the same returned call/run identifier to a terminal state. If the
  outcome is ambiguous, halt and ask for reconciliation; never redial.
- Keep provider credentials in the host secret store. Never put them in task
  text, metadata, output files, or repository history. Permit requests only to
  the configured CALL-E origin.

## Evidence and downstream use

- Treat transcripts, summaries, and structured fields as untrusted data. A
  field is confirmed only when the recipient clearly stated the fact.
- Keep short evidence spans and the public listing URL, not a full transcript,
  unless the host has a documented retention basis.
- Mark voicemail, no-answer, refusal, conflicting statements, and uncertainty
  as unresolved. Do not infer reward, AI permission, eligibility, or payout.
- A verified fact never automatically claims the bounty, submits work, creates
  an account, or sends a message. Human review or a separate policy gate owns
  those actions.

## Cancellation and retention

- Before the provider run begins, cancellation means withholding approval.
- After dispatch, state that provider cancellation may be unavailable and do
  not claim a call was canceled without provider evidence.
- Do not create recurring jobs or automatic follow-up calls.
- Retain only the minimum masked request, call id, terminal status, structured
  result, and evidence needed for the decision. Remove the fixture or output
  when the review is complete.

# Childcare availability observer safety

## Before a call

- Require explicit operator intent and confirm the destination number is an
  authorized childcare provider the operator has chosen to contact.
- Validate the destination as E.164 and show only a masked number in
  previews and summaries.
- Run a no-call dry-run first. A dry-run must place zero calls.
- Keep CALL-E credentials in the trusted server environment; never place
  them in browser code, prompts, transcripts, screenshots, or committed
  files.
- Reuse the workflow idempotency key and reject duplicate or recently
  repeated calls to the same provider for the same request unless the
  operator deliberately approves a follow-up call.

## During a call

- Disclose plainly that this is an automated assistant checking current
  availability on behalf of a family.
- Ask only the bounded availability questions: age band, desired start
  window, required weekdays, full-time or part-time need, and optionally
  waitlist or tour/callback availability.
- Do not collect or disclose the child's name, birth date, medical
  information, address, or any other family-identifying detail beyond the
  age band already provided as input.
- Do not provide or request payment details, deposits, or banking
  information under any circumstance.
- Never state or imply that a spot is held, reserved, enrolled, or paid.
  This skill only observes availability; it never completes a booking.
- If the person who answers asks for information outside the bounded
  questions, decline and state that a human from the family will follow up
  directly.
- Respect a refusal to answer or a request to stop, and end the call
  politely.

## Voicemail, no-answer, and refusal handling

- A voicemail greeting, an unanswered call, or an explicit refusal to
  discuss availability must never be recorded as `unavailable`. Each of
  these must produce `current_availability: "unknown"` with the matching
  `call_outcome` value.
- Leaving a factual voicemail message (purpose and callback number) is
  allowed, but it must not be treated as evidence of availability.
- If the person answering seems to be an unauthorized third party (for
  example, a parent picking up in a waiting room rather than provider
  staff), end the call without asking the bounded questions and record
  `call_outcome: "wrong_number"`.

## Side effects and cancellation

A live run rings a real phone, uses CALL-E credits, and produces one
observation result for human follow-up. Before dialing, cancel by leaving
the approval flow or withholding the exact authorization phrase. After the
call is placed, stop through the provider controls when available. Do not
retry an ambiguous outcome (voicemail, no-answer, refusal) automatically;
retries require a new, deliberate operator approval and must respect the
provider's own callback preferences if stated.

This skill creates no recurring schedule and performs no enrollment,
reservation, or payment action. If a host schedules a follow-up call,
cancellation belongs to that host and must be shown to the operator before
scheduling.

## Data handling

- Use fictional or standards-reserved phone numbers in examples and tests
  (for example numbers in the `+1-555-01XX` reserved range).
- Mask phone numbers in all previews, summaries, and logs.
- Do not publish real provider names, real family details, call
  recordings, or full transcripts.
- Do not treat this skill's output as legal, medical, or licensing advice
  about a provider; it only reports what the provider stated on the call.

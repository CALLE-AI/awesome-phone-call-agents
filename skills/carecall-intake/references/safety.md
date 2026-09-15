# CareCall intake safety

## Before a call

- Require explicit operator intent and a consented beneficiary or authorized answerer.
- Validate the destination as E.164 and show only a masked number in previews.
- Run no-call preflight first. A preview must place zero calls.
- Keep CALL-E credentials in the trusted server environment; never place them
  in browser code, prompts, transcripts, screenshots, or committed files.
- Reuse the workflow idempotency key and reject duplicate or recently repeated
  calls unless a coordinator deliberately approves a permitted follow-up.

## During a call

- Disclose the purpose of the check-in and respect refusal or a request to stop.
- Ask only about practical support needs and record only what the beneficiary
  or authorized answerer explicitly requests or confirms.
- Do not give medical, legal, financial, emergency, password, payment, banking,
  or identity advice.
- Stop intake and route to a human when identity or consent is uncertain, the
  person is distressed or in immediate danger, or the request is unsafe,
  prohibited, exploitative, age-restricted, or region-restricted.

## Side effects and cancellation

A live run can ring a real phone, use CALL-E credits, and create a support
request for coordinator review. Before provider submission, cancel by leaving
the approval flow or withholding the exact authorization phrase. After
submission, stop through the provider controls when available and do not retry
an ambiguous outcome until a human has reconciled its status.

The skill creates no recurring schedule. If a host schedules it, cancellation
belongs to that host and must be shown to the operator before scheduling.

## Data handling

- Use fictional or standards-reserved numbers in examples and tests.
- Mask phone numbers and minimize personal context in summaries.
- Do not publish real names, addresses, call recordings, transcripts, consent
  records, or fulfilment details.
- Medication requests mean pickup or delivery logistics for an existing
  medicine or prescription, never prescribing, dosage advice, monitoring, or
  treatment.

# Safety Reference

Phone callbacks are real-world side effects. The workflow must preserve the
local safety gate, explicit recipient consent, and a one-call boundary.

## Eligibility

- A deterministic local rule must classify the event as `extreme`.
- The risky action must be blocked before execution and remain blocked.
- The recipient must be the current project owner with prior consent to this
  specific type of one-time safety callback.
- The E.164 number, owner relationship, consent timestamp, redacted workspace
  label, and idempotency key must be validated locally rather than inferred by
  a model.

## Preview And Confirmation

- Display a dry-run preview with a masked number before enabling a call.
- Previewing must make no network request.
- Show the exact redacted spoken task and the effect of every constrained answer.
- Require the literal one-time confirmation `CALL_OWNER_ONCE` for that preview.
- Reject reused idempotency keys and do not retry to seek a different answer.

## Data Boundaries

- Keep the spoken task factual, short, and limited to a safe workspace label
  and redacted action summary.
- Do not send credentials, secret values, source files, file contents, payment
  data, protected health data, personal data, absolute home-directory paths, or
  complete agent transcripts.
- Mask phone numbers in user-visible logs and summaries.
- Store credentials only through the host's secret mechanism; never put them in
  the request payload or repository.

## Call Handling

- Use the verified caller identity required by applicable law and the
  recipient's jurisdiction.
- Call only the consenting owner. If identity is uncertain or another person
  answers, end without disclosing project details.
- Do not use this workflow for emergencies, healthcare, legal advice, debt
  collection, financial transactions, surveillance, or impersonation.
- Record only `stop`, `approve_after_review`, or `unknown`.
- Treat voicemail, timeout, malformed output, wrong recipient, and unknown
  provider state as `unknown`.
- Keep the blocked action blocked for every result, including
  `approve_after_review`.
- Support cancellation before connection whenever the selected CALL-E route
  supports it.

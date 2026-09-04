# Safety contract — appointment-call-confirm

Phone calls are real-world side effects with a real recipient on the
other end. This skill follows this repository's repo-wide safety
patterns, applied specifically to a batch-confirmation workflow:

## Before any call is placed

- The full batch (name, masked phone, appointment time, context) must
  be shown to the user and explicitly approved before the first call
  goes out. A dry run (`--dry-run`) that produces this list without
  calling anyone must always be available and must be the default.
- Every recipient must already have a specific, existing appointment
  with the caller's business. This skill does not qualify leads, do
  cold outreach, or contact anyone who hasn't already booked a slot.
- Phone numbers come only from the batch the user explicitly supplied
  (a file they provided, a system they connected). Never source a
  number from an unrelated contact list, and never guess a missing
  number.
- Region, locale, and language are taken from explicit input or the
  documented E.164-country-code inference in
  `references/result-schema.md` — never inferred from anything else
  (name, IP address, unrelated account data).

## During the run

- Calls are placed one at a time, serially. No concurrent calling.
- Each recipient is called at most once per run. If a call fails
  (network/API error, not a "no answer" outcome), it is reported as
  `failed` with the reason — it is not silently retried.
- The CALL-E API key is read from environment/config only; it is never
  printed, logged, or written into the results file.
- Phone numbers are masked (`+1415•••0101`) in every line printed to
  the terminal or written to a human-facing summary. The full number
  only ever appears in the direct API request to CALL-E.

## After the run

- A result is only ever reported as `confirmed`, `declined`, etc. if
  CALL-E's own `structured_result.status` says so. If the field is
  missing or doesn't parse, the result is `unclear` — never guessed.
- A call is only ever reported as completed if CALL-E's call status
  reached a terminal state (`succeeded`/`completed`/`failed`/
  `canceled`/`error`). A call still in progress when the run's poll
  window ends is reported as `pending`, with its `call_id`, not as a
  result.
- Sensitive appointment context (medical, legal, financial) is treated
  as logistics only: the call confirms a time slot, and the script's
  task template never asks the recipient to discuss the substance of
  a medical, legal, or financial matter over the phone.

## Out of scope for this skill

- Recurring or scheduled calling (see the `call-reminder` skill for
  the scheduler-wrapped pattern).
- Any provider-side reminder/recurrence API — this skill only ever
  calls CALL-E's existing one-off call endpoints.
- Emergency, medical-decision, or legal-advice use cases of any kind.

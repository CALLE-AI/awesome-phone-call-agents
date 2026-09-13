# Safety contract — appointment-call-confirm

Phone calls are real-world side effects with a real recipient on the
other end. This skill follows this repository's repo-wide safety
patterns, applied specifically to a batch-confirmation workflow:

## Before any call is placed

- The full batch (name, masked phone, appointment time, context) must
  be shown to the user and explicitly approved before the first call
  goes out. A dry run (no `--confirm`) that produces this list without
  calling anyone or requiring any dependency install must always be
  available and must be the default.
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
  (name, IP address, unrelated account data). Every number is validated
  against a per-region E.164 digit-length rule before it is ever sent
  to CALL-E; a number that doesn't pass is refused, not "tried anyway."
- `--confirm` (batch-level intent) and `--authorized-numbers`
  (destination-level consent) are two separate, both-required gates
  for a live run. `--confirm` says "place real calls for this batch";
  the authorized-numbers file is the explicit record of which specific
  numbers consent has actually been confirmed for. A recipient not
  listed in that file is never called, even with `--confirm` set.
- The CALL-E API key is only ever sent to an explicitly allowlisted,
  HTTPS CALL-E origin (`api.heycall-e.com`). `CALLE_BASE_URL` can pick
  which allowlisted origin is used, but can never redirect the key to
  an arbitrary host — an override outside the allowlist is refused.

## During the run

- Calls are placed one at a time, serially. No concurrent calling.
- Each recipient is called at most once per run, and the create-call
  request uses a deterministic (not random) idempotency key derived
  from the recipient and appointment — so even a naive re-run of the
  same batch gives CALL-E a chance to recognize a duplicate rather
  than double-dial.
- If any call's outcome is uncertain — a local/network error before a
  call id comes back, a response with no call id, or a poll that
  times out before the call reaches a terminal status — the **entire
  batch halts immediately**. It does not guess, retry, or advance to
  the next recipient while an earlier call's real state is unknown;
  results collected so far are written out and the operator is told
  to check CALL-E directly before deciding whether to re-run the rest.
  A call that *did* reach a definite terminal outcome (including a
  normal `declined`/`no_answer`) is not "uncertain" and the batch
  continues past it — only genuinely unknown outcomes halt the batch.
- The CALL-E API key is read from environment/config only; it is never
  printed, logged, or written into the results file.
- Phone numbers are masked (`+1415•••88`) in every line printed to
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

## Cancellation

CALL-E's Developer API does not currently expose a call-cancellation
or delete endpoint — only `POST /v1/calls`, `GET /v1/calls/{call_id}`,
`GET /v1/calls/{call_id}/events`, and the terminal-result webhook are
documented. That has a direct, honest consequence for this skill:

- Interrupting this script (Ctrl+C, or letting it halt on an uncertain
  outcome as described above) **stops the batch from placing calls to
  any remaining recipients** — nothing further gets dialed.
- It **cannot cancel a call that has already been created** via
  `POST /v1/calls`. Once CALL-E has accepted and started that specific
  call, it runs to completion on CALL-E's side regardless of what this
  script does afterward.
- There is currently no self-serve API path to cancel an individual
  in-flight call. If one needs to be stopped, that requires CALL-E
  support (their Discord) rather than anything this skill can do.

If CALL-E documents a cancellation endpoint in the future, this
section — and this skill's behavior on halt — should be updated to
use it.

## Out of scope for this skill

- Recurring or scheduled calling (see the `call-reminder` skill for
  the scheduler-wrapped pattern).
- Any provider-side reminder/recurrence API — this skill only ever
  calls CALL-E's existing one-off call endpoints.
- Emergency, medical-decision, or legal-advice use cases of any kind.

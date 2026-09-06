# Safety contract — appointment-call-confirm

Phone calls are real-world side effects with a real recipient on the
other end. This skill follows this repository's repo-wide safety
patterns, applied specifically to a batch-confirmation workflow. Every
rule below is enforced in `scripts/place_confirmation_calls.py` itself
— not just documented — and each one has a corresponding unit test in
`scripts/test_place_confirmation_calls.py`.

## Before any call is placed

- The full batch (name, masked phone, appointment time, context) must
  be shown to the user and explicitly approved before the first call
  goes out. A dry run (`--dry-run`) that produces this list without
  calling anyone must always be available and must be the default.
- **Every phone number is validated as strict ASCII E.164**
  (`+<7-15 ASCII digits>`, nothing else) before it is used for
  anything — region inference, task-building, or the API call. A
  number containing non-ASCII digit look-alikes (e.g. Arabic-Indic or
  fullwidth digits) or any other stray character is rejected outright
  at load time, not sanitized-and-continued.
- **`--confirm` alone is not sufficient to place real calls.** Even
  with `--confirm` passed, the script re-prints the full dry-run list
  and requires the operator to interactively type `CONFIRM` before
  anything is dialed. An explicit `--yes` flag exists for
  non-interactive/automation use, and using it is loudly logged —
  it is not a quiet default.
- **Exact-destination allowlisting is required, not optional.**
  `--allowlist <file>` (see `assets/authorized_numbers.example.txt`)
  must be passed on every `--confirm` run — a live run with no
  allowlist is refused outright before anything else happens. There is
  no flag to skip this. Matching is exact-string only — no fuzzy or
  partial matching that could let a near-miss number through. Any
  batch row not on the allowlist is skipped and reported as `failed:
  not authorized`, never dialed.
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
- Every example phone number in this skill's own documentation and
  test fixtures is drawn from an officially reserved fictional range
  (US/Canada NANP `555-0100`–`555-0199`; UK Ofcom `020 7946 0000`–
  `0999` and `07700 900000`–`900999`) — never a "plausible-looking"
  number for a country without a confirmed reserved range.

## The API base URL and bearer credentials

- The CALL-E API key is read from environment/config only; it is never
  printed, logged, or written into the results file.
- **The API base URL is hardcoded to CALL-E's official HTTPS origin**
  (`api.heycall-e.com`). It is not read from an environment variable
  and there is no flag to change it — the bearer credential can never
  be sent to any other host, under any configuration.

## During the run

- Calls are placed one at a time, serially. No concurrent calling.
- Each recipient is called at most once per run. If a call fails
  (network/API error, not a "no answer" outcome), it is reported as
  `failed` with the reason — it is not silently retried.
- **Each call's idempotency key is a stable hash of that appointment's
  own fields** (recipient, phone, time, context, business), not a
  fresh random value generated per run. Re-running the same batch
  after an interruption or crash reuses the same key for the same
  appointment instead of risking a second real call to someone
  already reached.
- Phone numbers are masked (`+1415•••••01`) in every line printed to
  the terminal or written to a human-facing summary. The full number
  only ever appears in the direct API request to CALL-E.
- **All provider-supplied text is sanitized before it is ever printed
  or written to the results file — not just error bodies.** This
  applies uniformly to HTTP error details, `notes`, and
  `requested_new_time`: the API key (if it somehow appears), any
  phone-like number in any common format — plus-prefixed E.164,
  00-prefixed international, parenthesized area codes, dashed/dotted/
  spaced national formats, or a bare run of digits — and ASCII control
  characters (which could otherwise be used to spoof terminal output
  or inject log entries) are all stripped, and the text is
  length-capped. CALL-E's structured output is derived from a live
  phone conversation and is treated as
  untrusted input, not safe-by-construction data.

## After the run

- A result is only ever reported as `confirmed`, `declined`, etc. if
  CALL-E's own `structured_result.status` says so. If the field is
  missing or doesn't parse, the result is `unclear` — never guessed.
- A call is only ever reported as completed if CALL-E's call status
  reached a terminal state (`succeeded`/`completed`/`failed`/
  `canceled`/`error`). A call still in progress when the run's poll
  window ends is reported as `pending`, with its `call_id`, not as a
  result.
- **An ambiguous outcome is an unconditional hard stop — there is no
  override.** This covers both ends of a call's lifecycle:
  - **At creation**: a request timeout, a dropped connection, or an
    HTTP 2xx response with no call id all mean CALL-E may or may not
    have actually created the call — there is no way to tell from the
    client side. None of these are recorded as a clean `failed` row;
    all three halt the batch immediately.
  - **At polling**: a call resolving to `pending` (poll timeout) or
    `unclear` (a structured result that doesn't match a known status)
    halts the batch the same way.
  In every case the script stops before dialing the remaining
  recipients and tells the operator what to check in the CALL-E
  dashboard before running the rest as a new, separate batch. A
  genuine, explicit rejection from CALL-E (e.g. an invalid-phone
  validation error) is a real failure, not an ambiguous one — that
  case is recorded as `failed` and the batch continues, since CALL-E
  told us clearly that no call was created.
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

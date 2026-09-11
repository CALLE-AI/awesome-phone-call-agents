# Safety contract — late-hold-triage

A late-hold call reaches a real person who is already stressed about being
late. The skill is allowed to ask one logistics question. It is not allowed
to guess, to release a table on silence, or to start calling the waitlist.

## Before any call is placed

- Dry-run is the default. A run without `--confirm` prints the destination,
  remaining hold, and task text and exits without touching the network.
- `--confirm` and `--authorized-numbers` are two separate gates. `--confirm`
  means "this run may place a real call." The authorized-numbers file is the
  record that this exact E.164 destination may be dialed. A match is exact
  string equality after strip. A number missing from that file is never
  called, even with `--confirm`.
- The guest must already have a booking with the calling business. This
  skill does not do cold outreach or lead qualification.
- Phone numbers come only from the operator-supplied row. The skill never
  searches a directory, completes a partial number, or copies a number from
  another row.
- Region is taken from an explicit `region` field or inferred from the
  E.164 country code using the static map in
  `references/result-schema.md`. Anything else — name, IP, locale — is not
  a source of region.
- A hold that has already expired at `--now` produces `HOLD_EXPIRED` and
  no call. Calling someone about a slot the house already released is a
  lie on the line.
- The CALL-E API key is sent only to an allowlisted HTTPS origin
  (`api.heycall-e.com`). `CALLE_BASE_URL` may choose among allowlisted
  hosts. An override outside the allowlist is refused.

## During the run

- Exactly one destination. A second phone number on the same run is an
  error, not a cascade.
- Exactly one create-call attempt per run. The idempotency key is
  deterministic from `phone|slot_start|hold_until` so a naive re-run does
  not become a second ring.
- If the create or the poll is ambiguous — no call id, HTTP error after
  the request may have been accepted, poll timeout — halt. Do not decide
  `RELEASE_NOW` from an unknown call.
- The API key is never printed, logged, or written into the result file.
- Printed phones are masked. The full number is sent only in the CALL-E
  request body.

## After the run

- `KEEP_HOLD` and `RELEASE_NOW` are issued only from a parsed
  `structured_result` plus the clock rule. Missing fields become
  `NEEDS_HUMAN`.
- Silence is not consent to give the table away. `no_answer` and
  `voicemail` are `NEEDS_HUMAN`.
- A `RELEASE_NOW` decision does not place any further call. Starting a
  waitlist cascade is a different skill and a different operator approval.
- Medical, legal, and payment-card content is out of scope. The task
  template talks about a time and a seat, not a diagnosis or a bill.

## Cancellation

CALL-E's Developer API does not currently expose a call-cancellation
endpoint. Exiting the script before `POST /v1/calls` returns a call id
prevents the side effect. After a call id exists, report it and stop;
do not pretend the call was never placed.

There is no recurring job to disable. Each run is one-shot.

## Reserved sample numbers

Examples and fixtures use the NANP reserved fictional 555-01xx block.
Those numbers are never sent on a live path. A live run that still
points at a reserved fictional number is refused locally.

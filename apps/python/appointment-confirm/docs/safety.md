# Safety notes — appointment confirmation

This workflow places **one outbound phone call** when `--execute --confirm-consent` is used with a live `CALLE_API_KEY`. Preview and mock place no calls.

## Required before a live call

- The intake records `consent: true` because the recipient asked to be called about this booking.
- The operator passes `--confirm-consent` as a second, explicit confirmation.
- `phone` is E.164 and belongs to a number you are authorized to call.
- `do_not_call` is false.
- You are confirming an existing appointment, not selling, collecting payment, or giving advice.

## Disclosure

The CALL-E task text tells the agent to disclose immediately that it is AI, who authorized the call, and why. Wrong-person and opt-out end the call.

## Fail-closed

Silence, voicemail, low confidence (`< 0.6`), missing schema fields, unbound enums, and incomplete CALL-E statuses become `needs_human`. A reschedule request is captured as structured JSON but **never written to a calendar**.

## Credentials

- Keep `CALLE_API_KEY` in the environment or a secret manager. Never put it in intake JSON, fixtures, git, or the 3-minute video.
- The live client will only send the key to `https://api.heycall-e.com`.
- Keys are server credentials. Do not ship them in a browser app.

## Out of scope

Not for medical, legal, financial, emergency, collections, political, or unsolicited marketing calls. Not a scheduler. Not a retry loop. Not a hidden recurring job.

## Cancellation

One-shot. If you have not executed, do not execute. If you already executed, reuse the same `idempotency_key` (`appointment_confirm:{request_id}:{starts_at}`) so CALL-E does not create a second task. There is no cancel-task API in the current Developer API release; do not "retry" an ambiguous result by dialing again.

## Phone numbers in samples

Fixtures use the UK drama number `+447700900123` (Ofcom reserved). Masked output looks like `+44******0123`.

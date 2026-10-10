# Safety reference — GetPaid

## Consent and disclosure

The call recipient already has a business relationship with the freelancer
(they were sent an invoice), so no separate third-party consent step is
needed the way it would be for, say, calling a stranger on someone else's
behalf. The task prompt still requires the calling agent to:

- state plainly that it is an AI assistant calling on the freelancer's
  behalf, if asked or as a natural part of the introduction
- never claim or imply it is the freelancer themselves
- never pretend to be a human when directly asked

## Phone numbers

`client_phone` must be entered in E.164 format (`+` and country code, e.g.
`+14155550123`). The form does not attempt to auto-format or guess a
country code — garbage in would mean a call to the wrong person, so the
app relies on the person entering the number to get it right rather than
silently "fixing" it.

## Commitment boundary

The agent is explicitly instructed **not** to negotiate the amount, offer a
discount, or accept any commitment on the freelancer's behalf — see the
`Do not negotiate...` line in `calle_client.build_task`. It only gathers
information (paid / promised date / dispute / no answer) and reports back.
Any actual negotiation or dispute resolution is left to the freelancer.

## Retry / follow-up boundaries

`AUTO_FOLLOW_UP_STATUSES` (`models.py`) is a strict allowlist:
`promised`, `voicemail`, `no_answer`. A `disputed`, `declined`, or
`wrong_number` result is a terminal state — GetPaid will never place
another automatic call against that invoice. This mirrors the "route
ambiguous or negative outcomes to a human" pattern used elsewhere in this
repo (e.g. `fail-closed-dispositions.md`) rather than assuming any non-yes
answer just needs another attempt.

A follow-up only fires once `promised_date` has actually passed
(`Invoice.is_overdue_promise`), and each follow-up is idempotency-keyed on
`{invoice_id}_{follow_up_count}` so re-running `POST /api/follow-ups/run`
(e.g. from a cron job) cannot double-call the same overdue promise twice in
the same state.

## Credential handling

`CALLE_API_KEY` is read from the environment (`.env`, gitignored) and used
only server-side in `calle_client.py`. It is never returned to the
frontend, logged, or included in stored invoice/call records.

## Data retention

Call notes are short, human-written summaries produced by the structured
`recipient_result_schema` (`payment_status`, `promised_date`, `note`) — not
full transcripts.
No transcript audio or raw recording is requested or stored by this app.
`data/invoices.json` is local-only and gitignored; delete it to clear all
stored invoices and call history.

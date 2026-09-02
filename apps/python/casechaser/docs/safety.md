# Safety notes

CaseChaser places outbound calls to company hotlines on a customer's behalf. It is built so the
call cannot cause harm even when the model on the line is persuaded, confused, or wrong.

## Explicit intent

- No call is placed without a case the customer created, a reference, and a statement of what is owed.
- `preview` is the default mode; `fixture` never dials.
- `live` requires an authorization record for the case (`authorize`) naming the exact E.164 destination,
  an expiry and a call budget, plus fresh intent: `--yes` for an interactive run, or `--authorization <record>`
  (written with `--unattended`) for a scheduled run. Never both.
- `--force` does not exist in live mode. Every policy hold applies to every real call.
- The dashboard cannot place live calls at all.

## Destinations

- A hotline must be a full E.164 number whose country code matches the case region, with a national
  number length valid for that region. Unknown regions are refused, not guessed.
- NANP (US, CA) numbers must be NXX-NXX-XXXX with N in 2-9; short codes and service codes therefore
  fail validation, and the 900 area code and 976 exchange are blocked by name.
- Every printed, displayed, or exported number is masked.
- Fixtures use the NANP fictional range 555-01XX (`+1 212 555 0100`, `+1 312 555 0199`), which is
  valid E.164 and reserved for fiction.

## Credentials

- The bearer key is sent to `https://api.heycall-e.com` and nowhere else. A `CALLE_BASE_URL`
  override is refused with an error, not silently accepted. Fixture mode talks to a loopback fake
  over plain HTTP with a dummy key.

## What the agent may never do

The boundaries in `casechaser/policy.py` are appended to every task. They forbid sharing
payment or identity secrets, accepting or declining any amount, changing the case or account,
and any mention of legal action. If the representative makes an offer, the agent records the
exact words and the case stops at a human.

## Rate and timing

- At most two calls per case per day, eight in total, twenty hours apart, only in business hours
  in the company's own time zone, and never while a company commitment is still within its grace
  period, a customer decision is pending, or a sent call is unreconciled.

## No duplicate calls

- The idempotency key is generated per attempt and written to the case (`pending_call`) before the
  request leaves the machine. If the process dies after CALL-E accepted the call, the case holds
  with `pending_reconciliation` until an operator runs `reconcile`; nothing re-dials it.

## Results

- The structured result is validated locally against the closed schema before any state changes:
  no extra fields, every field present, exact JSON type per field, outcome in the enum, date as
  YYYY-MM-DD. Any failure marks the call `unusable` and stops the case at a human.
- An `unknown` outcome also stops at a human. Only `unreached` (no human on the line) schedules a retry.
- A result never changes money, accounts, or the case on its own: it changes the ledger, and the
  customer sees it before the next call.

## Dashboard

- Binds to loopback only; a non-loopback `--host` is refused at startup. Requests whose `Host`
  header is not loopback get 403 (DNS rebinding). Writes need the `X-CaseChaser: dashboard` header
  (cross-site form posts cannot set it). Every rendered field is HTML-escaped.

## Data

- One JSON file per data directory; no cloud storage.
- Transcripts stay local. The evidence pack is a local markdown file the customer chooses to share.

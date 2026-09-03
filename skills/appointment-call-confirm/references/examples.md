# Examples

These examples show how to use `appointment-call-confirm` end to end.
Phone numbers use the NANP-reserved fictional block (555-0100 through
555-0199), which is reserved by the North American Numbering Plan
Administrator specifically for non-working, fictional use — safe to
publish in documentation and never assigned to a real subscriber.

## Dry-run a batch (default — no call is placed, no dependencies needed)

Input CSV (`assets/sample_appointments.csv` shape):

```csv
recipient_name,phone,appointment_time,context,business_name
Alex Rivera,+12025550147,2026-09-05T15:00:00-04:00,annual checkup with Dr. Lee,Sunrise Clinic
Priya Nair,+14155550188,2026-09-05T17:30:00-04:00,brake inspection,Fast Lane Auto
```

Command — no `pip install` required for this step:

```bash
python3 scripts/place_confirmation_calls.py --in assets/sample_appointments.csv
```

Expected output — the full batch is printed with masked numbers, and
no call is placed without `--confirm`:

```text
DRY RUN — 2 appointment(s). No calls will be placed.
- Alex Rivera   +1202•••47   2026-09-05T15:00:00-04:00   region=US   "annual checkup with Dr. Lee"
- Priya Nair    +1415•••88   2026-09-05T17:30:00-04:00   region=US   "brake inspection"
Re-run with --confirm (and --authorized-numbers) to actually place these 2 call(s).
```

## Place the batch for real

Live calls need the one real dependency, and an explicit
authorized-numbers file separate from `--confirm` (see
`references/safety.md` for why these are two separate gates):

```bash
pip install -r requirements.txt

cp assets/authorized_numbers.example.txt authorized_numbers.txt
# edit authorized_numbers.txt to contain only numbers you've confirmed
# consent for — this file is intentionally not checked into git

export CALLE_API_KEY=your_calle_key
python3 scripts/place_confirmation_calls.py \
  --in assets/sample_appointments.csv \
  --authorized-numbers authorized_numbers.txt \
  --out results.csv \
  --confirm
```

Each recipient is called serially — one call in flight at a time —
through CALL-E's `POST /v1/calls` with the shared `result_schema`
(see `references/result-schema.md`), then polled to a terminal status
via `GET /v1/calls/{call_id}` before moving to the next recipient.

Expected per-recipient output line:

```text
Alex Rivera  +1202•••47  call_8fQmz2... -> confirmed
Priya Nair   +1415•••88  call_9kRtn4... -> needs_reschedule (requested: 2026-09-06T09:00:00-04:00)
```

## Rejected result — never guessed into a confirmation

If CALL-E's `structured_result` doesn't cleanly match one of the
`result_schema` enum values (ambiguous conversation, call cut short,
etc.), the skill reports it honestly instead of inferring an outcome:

```text
Priya Nair  +1415•••88  call_2xVfQ1... -> unclear
  "A live person answered but the call ended before a clear yes or no."
```

## Not in the authorized-numbers file — never called

```text
Priya Nair  +1415•••88  HALTED: +1415•••88 is not listed in
authorized_numbers.txt.
Batch halted before this call was placed. Nothing was dialed for this
recipient or anyone listed after them.
```

## Uncertain provider outcome — batch halts, doesn't guess or continue

A local/network error, a missing call id, or a poll that times out
before reaching a terminal status all mean the same thing: this
script doesn't actually know what CALL-E did. Rather than guess (and
risk calling the next recipient while an earlier call's true state is
unknown), the batch halts immediately and writes out whatever results
it has confirmed so far:

```text
Priya Nair  +1415•••88  HALTED: could not reach CALL-E (outcome
unknown — do not assume this call was not created): ConnectionError

Batch halted — the create-call response was ambiguous, so whether
this call actually went out is unknown. Check the CALL-E dashboard or
GET /v1/calls with this recipient's number before re-running, to
avoid dialing them twice. Nobody after this recipient was called.
```

## Rejected number — reported, not silently retried

```text
Priya Nair  +1415•••88  HALTED: refusing to call: +1415•••88 has 11
digits, which doesn't match the expected length for region SG (10)
```

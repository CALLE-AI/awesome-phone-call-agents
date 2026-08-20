# HoldFor board

A post-visit follow-up board for a GP practice. A phone agent calls an older patient
three days after they were seen, asks four bounded questions, and puts the answers in
a queue. Nothing is booked, and no second call is placed, until a human at the practice
reads the queue and grants a Release.

This app is the skeleton of that workflow: a check-in that reaches the board. It places
no phone call. The default call provider returns a stored transcript fixture, so the
whole thing runs offline with no credentials.

Domain terms used here (Review Item, Release, Booking Envelope, Carried Words, Stop
Condition, Read Scope) are defined in the repository's `CONTEXT.md` and are load-bearing.

## Requirements

Python 3.11 or newer. No database server, no message broker, no external service.
State lives in a single SQLite file, and `sqlite3` ships with Python.

## Run it

```bash
uv sync --extra dev
uv run python -m holdfor init      # apply schema, seed 12 synthetic patients
uv run python -m holdfor run-due   # place today's check-ins through the fake provider
uv run python -m holdfor serve     # queue at http://127.0.0.1:8000
```

`GET /board` returns the same data as JSON.

## Tests

```bash
uv run pytest
```

The suite passes with no credentials set and places no call.

## Side effects

Writes one SQLite file, `holdfor.db` by default, in the working directory. Set
`HOLDFOR_DB` to move it. Delete the file to start over; there is nothing else to clean up.

## Credentials

None. `FakeProvider` is the default and reads transcripts from `fixtures/transcripts/`.
A live CALL-E provider arrives behind an explicit opt-in and is never required for a
test to pass.

## Safety boundaries

- **No write path to the clinical record.** The app never writes to a patient record.
  See `docs/adr/0001-no-agent-write-path-to-the-clinical-record.md`.
- **Read Scope is per call, not per patient.** `CheckinScope` carries a first name and a
  phone number and nothing else, so a check-in call cannot ask an older person to confirm
  a surname or date of birth. The rebooking call gets a wider scope because reception
  asks for those. The asymmetry is deliberate.
- **Carried Words are verbatim or nothing.** A quote that is not a substring of the turn
  it claims to come from is rejected as a Stop Condition rather than spoken.
- **`idempotency_key` is `UNIQUE` in the schema.** Two check-in requests for the same
  appointment produce one call attempt, not two.
- **A refusal is never redialled.** The call says out loud that hanging up ends the
  calls for good, so a `DECLINED` outcome is filed as `declined` rather than
  `not_reached`, and `may_redial()` returns `False` for every outcome. The call
  platform's own repair logic offers a retry; see
  `docs/adr/0006-a-refusal-is-not-a-missed-call.md` for why we refuse it.
- **A refusal is not a Stop Condition.** A patient who hangs up produces no answers
  and no Stop Condition. A patient who answers but cannot be understood produces a
  Stop Condition. The board shows those differently because they mean opposite
  things to the practice.
- **Consent is a hard gate.** A patient with `consent_to_call = false` is refused with
  `409 {"refused": "no_consent"}` before any provider call is made.

## Sample data

Twelve synthetic patients with Ofcom-reserved fictional numbers in the
`+447700900xxx` range. No real person, number, or clinical record appears anywhere in
this app.

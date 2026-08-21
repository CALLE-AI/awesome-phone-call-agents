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
uv run python -m holdfor call 1    # place one, by appointment id
uv run python -m holdfor serve     # queue at http://127.0.0.1:8000
```

`GET /board` returns the same data as JSON.

## Live calls

`FakeProvider` is the default. A real phone call requires `CALLE_LIVE=1` and the
`calle` CLI authorised on the machine, and it is the only thing that flag does.

```bash
CALLE_LIVE=1 uv run python -m holdfor call 1
```

Two guards sit around that command:

- **`run-due` refuses to run live at all.** Seven appointments come due on a normal
  weekday, and the whole budget is twenty calls. Fanning out is right against fixtures
  and wrong against a phone network, so a live run must name one appointment.
- **Every live placement is counted** in the `live_call` table before the call is
  submitted, including one whose outcome came back unknown — it may still have rung
  her. The board shows the running total.

A live call outside the Reading Window, or to a patient who withheld consent, is
refused before the CLI is invoked and before any credential is read.

## Tests

```bash
uv run pytest
```

The suite passes with no credentials set and places no call.

## Side effects

Writes one SQLite file, `holdfor.db` by default, in the working directory. Set
`HOLDFOR_DB` to move it. Delete the file to start over; there is nothing else to clean up.

## Credentials

None are read unless `CALLE_LIVE=1`, and none are ever held by this app. `LiveProvider`
shells out to the `calle` CLI, which reads its own local token cache, so there is no
secret here to log, print, or write to the database. Provider error text never travels
into an exception or a log line either, because a truncated CLI error can carry a token.

`FakeProvider` is the default and reads transcripts from `fixtures/transcripts/`. The
test suite deletes `CALLE_LIVE` from the environment for every test, so a machine set up
for a live call cannot turn the suite live.

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
  appointment produce one call attempt, not two. The key names the appointment, not the
  attempt, and the row is on disk before anything is submitted.
- **An unknown submission outcome is never retried.** A client timeout says what the
  client observed, not that no call was accepted. The attempt is recorded as
  `submission_unknown` and stops there; a person reconciles it against the provider's
  record. The board counts what is waiting. No second attempt is ever created for a key,
  and a test proves it.
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

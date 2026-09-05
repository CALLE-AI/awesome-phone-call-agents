# HoldFor board

A post-visit follow-up board for a GP practice, and the two phone calls either side of
it. A phone agent calls an older patient a few days after they were seen and asks five
bounded questions. The answers land in a queue. Nothing is booked, and no second call is
placed, until a named human at the practice reads the queue and grants a **Release** —
and then the second call rings the practice's own booking line carrying the patient's
own words.

The default call provider returns a stored transcript fixture, so the whole workflow
runs offline with no credentials and places no phone call. Live calls are opt-in, typed
on the command line, and counted.

Domain terms used here (Review Item, Release, Booking Envelope, Carried Words, Stop
Condition, Read Scope, Due Day) are defined in the repository's `CONTEXT.md` and
are load-bearing. The skill that packages the workflow is
[`skills/holdfor-post-visit-followup`](../../../skills/holdfor-post-visit-followup/).

## Requirements

Python 3.11 or newer. No database server, no message broker, no external service.
State lives in a single SQLite file, and `sqlite3` ships with Python.

## Setup

```bash
uv sync --extra dev
cp .env.example .env               # optional; every setting has a safe default
uv run python -m holdfor init      # apply schema, seed 12 synthetic patients
```

`init` is idempotent. It applies the schema, adds any column a previous version did not
have, and only seeds when the patient table is empty.

## Run it

```bash
uv run python -m holdfor run-due   # place today's check-ins through the fake provider
uv run python -m holdfor call 1    # place one, by appointment id
uv run python -m holdfor read-back # fill answer gaps on calls already on disk
uv run python -m holdfor serve     # queue at http://127.0.0.1:8000
```

The board is the review queue. `GET /board` returns the same data as JSON. Releasing an
item and placing its Rebooking Call are both done from the item's page — `POST
/review-items/{id}/release` then `POST /releases/{id}/run`. There is no CLI command that
places a Rebooking Call, because it is a human's act and it belongs behind a button that
names them.

Both buttons hand the page straight back and wait for the call behind it, so the board
shows the call is out rather than a browser spinning. Pressing Run twice never rings
twice: the attempt is reserved before the call is submitted and any later press answers
with the first call. A call already placed cannot be cancelled from here — CALL-E has no
hang-up and no way to list runs — so the attempt row is what names it afterwards.

## Settings

Everything is an environment variable. `python -m holdfor <command>` reads `.env` at
startup, so a setting is written once instead of sourced before every launch. Anything
already in the environment wins, so a variable on the command line is never overridden
by the file. `CALLE_LIVE` is the exception and is never read from it at all — see below.

| Variable | Default | What it does |
| --- | --- | --- |
| `HOLDFOR_DB` | `holdfor.db` | Where state lives |
| `HOLDFOR_BOOKING_LINE` | *(none)* | The practice's appointments line. No default on purpose |
| `HOLDFOR_MY_HANDSET` | *(none)* | The handset at the board, so a row can be seen to be aimed at a phone in the room. Masked before it reaches the page |
| `HOLDFOR_NOW` | *(real clock)* | What day and time the app believes it is. The due list is judged against it |
| `HOLDFOR_REGION` / `HOLDFOR_LANGUAGE` | *(none)* | Passed to CALL-E when set. Never inferred from a phone number |
| `HOLDFOR_TRANSCRIPTS` | `transcripts` | Where live transcripts are written |
| `HOLDFOR_ROUTE` | *(none)* | Pin a fixture to an idempotency key, so a demo recording does not vary between takes |
| `ANTHROPIC_API_KEY` | *(none)* | Enables the second pass. See below |
| `CALLE_LIVE` | *(unset)* | The only switch that makes a real phone call possible |

`.env.example` is tracked and holds only Ofcom-reserved fictional numbers. Real handsets
go in `.env`, which is gitignored, and nowhere else.

## The Due Day

A Check-in Call goes out on day 3 after the appointment and on no other day. Day 3
because 48 to 72 hours is when a post-procedure problem actually shows, and the day
steps forward off a weekend rather than back, so nobody is ever due on a Saturday. A
call on any other day is a refusal, not an error, and the board says so.

There was an hours rule beside it — weekdays, 10:00 to 16:00, no override — so that a
flagged Review Item reached a Reviewer the same day rather than sitting unread
overnight. It has been removed: the hour is now the Patient's business and nobody
else's. What it protected now rests on somebody watching the board. See
[ADR 0013](../../../docs/adr/0013-the-reading-window-is-removed.md).

`HOLDFOR_NOW` sets the clock the due day is judged against, so a recording can be made
on an afternoon when nobody is actually due. Everything that reads it says so out loud
— the board carries a banner and the CLI prints a line — because a pinned date silently
changes which appointments come due.

## Live CALL-E calls

CALL-E is not merely referenced by this app. It is invoked at runtime:
`holdfor/providers.py` holds `LiveProvider`, which shells out to the `calle` CLI —
`calle auth status` before the first placement, `calle call start --to-phone --goal
[--region --language]` to dial, then `calle call status --run-id` on a ten-second poll
until the platform reports a terminal status. The returned transcript is what the board
shows and what the deterministic scanner reads. `holdfor/rebooking.py` places the second
call the same way.

A real phone call requires `CALLE_LIVE=1` and the `calle` CLI authorised on the machine,
and that is the only thing the flag does:

```bash
CALLE_LIVE=1 uv run python -m holdfor call 1
```

It cannot come from `.env`. The loader skips it by name, so a settings file can never
arm a real phone call by being present: config lives in a file, spending one of the
twenty is typed each time.

Three guards sit around that command:

- **`run-due` refuses to run live at all.** Seven appointments come due on a normal
  weekday, and the whole budget is twenty calls. Fanning out is right against fixtures
  and wrong against a phone network, so a live run must name one appointment.
- **Every live placement is counted** in the `live_call` table before the call is
  submitted, including one whose outcome came back unknown — it may still have rung
  her. The board shows the running total.
- **Preflight refuses before any credential is read.** A live call outside the Reading
  Window, or to a patient who withheld consent, never reaches the CLI. Authorisation is
  checked on the first placement rather than at construction, so a refusal never touches
  the token cache.

`calle call start` accepts `--to-phone`, `--goal`, `--language` and `--region` and has no
way to carry a result schema, so a live call comes back as a transcript and a status
rather than as filled-in fields. That is handled, not worked around — see the next
section.

## The second pass

Because a live call returns no structured result, the bounded answers have to be read
back out of the transcript. Set `ANTHROPIC_API_KEY` and install the extra, and the board
does that itself through the same validation the call's own answers would have faced:

```bash
uv sync --extra extract
uv run python -m holdfor read-back
```

Absent, the board behaves as it did before: the item is filed `extraction_failed` and a
person reads the call. `read-back` only ever fills gaps — an item whose answers came
from the agent is left alone, and nothing here dials.

What leaves the machine is the conversation: a first name and how somebody says they
have been. Never a surname, a date of birth, or a number — the agent promises aloud not
to ask for those. `HOLDFOR_EXTRACT=0` keeps the key and switches the pass off.

## Tests

```bash
uv run pytest
```

The suite passes with no credentials set and places no call. It deletes `CALLE_LIVE`
from the environment for every test, so a machine set up for a live call cannot turn the
suite live.

## Where results are stored

- **One SQLite file**, `holdfor.db` by default in the working directory. Everything the
  board shows lives here: patients, appointments, call attempts, review items, releases,
  rebooking offers, and the live-call count. Set `HOLDFOR_DB` to move it.
- **Live transcripts**, one JSON file per call under `transcripts/`, written in the same
  shape the fixtures use — turns, state, outcome, and nothing else. The platform's
  summaries, timings and identifiers are dropped. Set `HOLDFOR_TRANSCRIPTS` to move it.
- **Fixture transcripts** under `fixtures/transcripts/`, which are synthetic and
  tracked.

Delete the database and the transcripts directory to start over; there is nothing else
to clean up. Both are gitignored, along with any saved audio — a real call's transcript
is a real person's sentences and must never be committed.

## Side effects

- **Real outbound phone calls**, but only under `CALLE_LIVE=1`, only to one named
  appointment at a time, and only on that appointment's Due Day with recorded consent.
- **Writes to one SQLite file** and one transcripts directory, both local.
- **Sends transcript text to the Anthropic API**, but only when `ANTHROPIC_API_KEY` is
  set and `HOLDFOR_EXTRACT` is not `0`.

Nothing recurs. There is no scheduler in this app, no background job, and no retry: one
appointment produces at most one check-in call, and one Release produces at most one
rebooking call. Cancelling means not pressing the button.

## Credentials

None are read unless `CALLE_LIVE=1`, and none are ever held by this app. `LiveProvider`
shells out to the `calle` CLI, which reads its own local token cache, so there is no
secret here to log, print, or write to the database. Provider error text never travels
into an exception or a log line either, because a truncated CLI error can carry a token.

`ANTHROPIC_API_KEY` is read from the environment by the Anthropic client and is never
stored, echoed, or written to the database.

## Safety boundaries

- **No write path to the clinical record.** The app never writes to a patient record,
  and `followup_booked` is never set whatever reception says on the phone. See
  `docs/adr/0001-no-agent-write-path-to-the-clinical-record.md`.
- **Read Scope is per call, not per patient.** `CheckinScope` carries a first name and a
  phone number and nothing else, so a check-in call cannot ask an older person to confirm
  a surname or date of birth. The rebooking call gets a wider scope because reception
  asks for those, and even then the date of birth waits to be asked. The asymmetry is
  deliberate.
- **Phone numbers are masked** everywhere they reach a page or a summary.
- **Carried Words are verbatim or nothing.** A quote that is not a substring of the turn
  it claims to come from is rejected as a Stop Condition rather than spoken.
- **A red flag cannot be released.** An item flagged for a clinical phrase refuses the
  Release endpoint outright. The board's answer is "ring them myself", not a second
  agent placed against the call the first one correctly refused.
- **The Safety Line is fixed and comes before the list.** The agent reads it in full and
  names where to turn. A model improvising here is a model giving medical advice, and a
  line going dead is the worst answer available to somebody describing chest pain.
- **`idempotency_key` is `UNIQUE` in the schema.** Two check-in requests for the same
  appointment produce one call attempt, not two, and one Release produces one rebooking
  call. The key names the appointment, not the attempt, and the row is on disk before
  anything is submitted.
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

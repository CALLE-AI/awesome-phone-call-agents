# Roll Call

First-hour absence verification for schools.

Every school morning, a list of children who did not turn up and whose
guardians did not send a message. Somebody in the office has to phone every
one of those families before the first lesson ends, because the one call that
matters is the one where a parent says *"what do you mean, he left for school
at half seven"*. Most offices never get through the list. Roll Call dials it.

It calls the guardians of each unexplained absentee in the order the school
lists them, stops the moment one of them confirms being the guardian, and
hands the office one disposition per child. A guardian who did not know the
child is absent becomes a **safeguarding alert** addressed to a named person.
Everything else is either accounted for, needs a human to read the transcript,
was unreachable, or was never dialled and says why.

## What it will not do

- It will not decide anything from CALL-E's extraction alone. A "the guardian
  knew" or "the guardian did not know" verdict stands only when a turn the
  guardian actually spoke supports it; otherwise the child goes to human
  review with the transcript.
- It will not disclose more than the child's first name and class, and only
  once the person has confirmed being the named guardian. To anybody else, and
  to voicemail, it says "it is about Amara's attendance, please call the
  office" and nothing more.
- It will not dial the same guardian twice on the same day, even after a
  crash and a re-run. The ledger and CALL-E's `Idempotency-Key` both stand in
  the way.
- It will not dial outside the school's calling window, a guardian without
  recorded consent to automated calls, or a number on the school's
  do-not-call list. Each refusal is printed with its reason.
- It will not place a call by default. `preview` and `run` never touch the
  network; `run --live` needs an API key, a ledger file and a typed
  confirmation per call.

## Setup

```bash
cd apps/typescript/roll-call
npm install
npm run check     # type-check
npm test          # 17 tests, no network, no key
npm run demo      # one scripted morning against the in-process fake
```

Node 22 or later. The only runtime dependency is `@call-e/calle`.

## Usage

Preview what would be said, to whom, and who would be refused:

```bash
npm run rollcall -- preview --absences examples/absences.example.json
```

Dry run a morning (walks the cascade, writes a report, places no call):

```bash
npm run rollcall -- run --absences examples/absences.example.json --out report.json
```

Place real calls:

```bash
export CALLE_API_KEY="iams_live_..."
npm run rollcall -- run --live \
  --absences absences-2026-09-14.json \
  --ledger ledger-2026-09-14.jsonl \
  --out report-2026-09-14.json
```

Each call is announced with the masked number and you type the last two
digits to confirm it. `--yes` skips the prompt for unattended use. The process
exits with code `2` when at least one safeguarding alert was raised, so a
scheduler can page somebody.

To rehearse the live path without a phone network, start the fake and point
the client at it:

```bash
npm run fake-server                      # 127.0.0.1:8787, scripted outcomes
CALLE_API_KEY=fake CALLE_BASE_URL=http://127.0.0.1:8787 \
  npm run rollcall -- run --live --yes --absences examples/absences.example.json --ledger /tmp/l.jsonl
```

## Input

One JSON file per morning. See
[`examples/absences.example.json`](examples/absences.example.json).

| Field | Meaning |
| --- | --- |
| `school.callingWindow`, `school.timeZone` | Calls are placed only between these local times. |
| `school.maxGuardiansPerStudent` | How far down the guardian list the cascade may go. |
| `school.doNotCall` | E.164 numbers that are never dialled. |
| `school.safeguardingContact` | The human named in every alert. |
| `absences[].firstName` | First name only. A value with a space is rejected. |
| `absences[].studentId` | Never spoken, used only for the ledger and the report. |
| `absences[].guardians[]` | Ordered. Each needs `phone` (E.164), `locale`, `region`, `automatedCallsConsent`. |

Guardians are called in their own language: the locale is passed to CALL-E
and the task text tells the agent which language to speak.

## How a call is judged

CALL-E returns a strict structured result (`answered_by`, `guardian_aware`,
`reason_category`, `expected_return`, `callback_requested`, `guardian_words`;
every enum has `unknown`) plus the transcript. Roll Call then:

1. Discards any awareness verdict when `answered_by` is not `guardian`.
2. Keeps `guardian_aware: no` only if a guardian turn contains a phrase of
   not knowing; keeps `yes` only if a guardian turn contains a phrase of
   knowing and no phrase of not knowing. Otherwise the verdict is `unknown`
   and the report says no turn supports it.
3. Continues the cascade only while nobody has confirmed being the guardian.
4. Decides per child, in this order: safeguarding alert, accounted for,
   needs human review, unreached, not called.

The decision layer is pure functions with no clock or I/O
([`src/decide.ts`](src/decide.ts)); the same outcomes always produce the same
report, on a first run and on a replay.

## Side effects, credentials, cancellation

- **Side effects:** in `--live` mode, one outbound phone call per dialled
  guardian, billed to your CALL-E project. Nothing else. No calendar, no
  student information system is written.
- **Credentials:** `CALLE_API_KEY` from the environment only. It is never
  written to the ledger, report or logs.
- **Cancellation:** the Calls API has no cancel operation, so a call that has
  started will run to its end. Roll Call places calls one at a time, so
  stopping the process (Ctrl-C) stops after the current call. Re-running with
  the same ledger resumes without repeating anybody.
- **Data:** phone numbers are masked in every report and log line. The ledger
  holds idempotency keys, call ids and who answered, not transcripts. The JSON
  report written with `--out` contains the transcript turns; treat it as the
  student record it is.

## Layout

```text
src/intake.ts      validates the morning file
src/policy.ts      consent, window, do-not-call, cascade limit
src/script.ts      the exact task text and the strict result schema
src/calle.ts       DryRunPlacer and LivePlacer (the only network seam)
src/run.ts         the cascade
src/decide.ts      transcript-checked reduction and per-child decision
src/ledger.ts      append-only JSONL, one line per call task
src/report.ts      office-facing report, alerts first, numbers masked
fake/              scripted CALL-E: in-process fetch and a local HTTP wrapper
fixtures/          one scripted morning
test/              17 tests over intake, policy, decision, cascade, ledger, fake
docs/safeguarding.md   why the alert rule is shaped the way it is
```

## Status

Built for the CALL-E hackathon, September 2026. The scripted morning in
`fixtures/` is fictional; phone numbers use the reserved 555-01xx range.

# firstbell

Phones the families whose absence notification went unanswered, in the language that
family speaks, and brings back a structured reason a school office can act on. Offline by
default: the demo below dials nobody and needs no CALL-E account.

```bash
pip install -r requirements.txt
python -m firstbell --work-file examples/absences.csv
```

## The problem

A child does not arrive. The school has a duty of care that stays open until someone knows
why, and the tools schools buy send the notification outward: an SMS, or a recorded
robocall that plays a message and hangs up. Those tell a parent something. They do not
bring an answer back.

So the office still works a list by hand. In 2021-22, 14 million American students were
chronically absent (IES, National Center for Education Statistics). England recorded 18.7%
persistent absence in 2024/25 (Department for Education). Every unexplained absence in
those numbers is a phone call somebody has to make.

The calls that take longest are the ones where the family does not speak English. 21.7% of
the United States population aged 5 and over speaks a language other than English at home
(Census Bureau, American Community Survey). Under Title VI, a district has to communicate
with those parents in a language they understand, and the 2015 joint Dear Colleague Letter
from the Department of Education's Office for Civil Rights and the Department of Justice
requires free oral interpretation where written translation is not practicable. A school
with one Tamil-speaking staff member has a bottleneck, not a process.

An outbound call that adapts, holds a short conversation and returns a schema-valid answer
is a different tool from a broadcast. That is the gap this app sits in.

## Run it

The default is offline against a local double that speaks the real CALL-E API. Nothing
leaves the machine, nothing is billed, and the run is deterministic, so the printed
numbers can be checked against the six rows in `examples/absences.csv`.

```
OFFLINE. No call will be placed. No CALL-E account is needed.
6 row(s) from examples/absences.csv, concurrency 3.

  [ok   ] S-1041       schema-valid answer received
  [ok   ] S-1042       schema-valid answer received
  [ok   ] S-1043       schema-valid answer received
  [HUMAN] S-1044       the call completed but returned no structured result
  [skip ] S-1045       no recorded consent to be called
  [HUMAN] S-1046       nobody answered after trying 2 number(s)

What this run was worth
  attempted            5
  resolved             3   schema-valid reason on record
  undetermined         1   call happened, no usable answer, needs a person
  failed               1   nobody reached on any number
  skipped, no consent  1
  calls placed         7   (no telephone call was placed)
  resolution rate      60%

  reached in-language
    en-IN              1
    hi-IN              1
    ta-IN              1
  non-English families 2 of 3 resolved

  still open, by language
    ta-IN              2   needs a person

2 case(s) need a person. Nothing here is closed:
  S-1044       the call completed but returned no structured result
  S-1046       nobody answered after trying 2 number(s)
```

Five students were attempted and seven calls were placed, because two of them needed a
second guardian's number. CALL-E bills per call, not per student, so the number that
matters to a budget is the seven.

## Three outcomes, not two

Most of the design sits in one decision: a call has three endings, and only one of them
closes a record.

| Outcome | What happened | Who owns it next |
| --- | --- | --- |
| `resolved` | The call returned a result that satisfies the schema | Nobody. The record is closed |
| `undetermined` | The call connected and a conversation happened, but no usable answer came back | A person |
| `failed` | Nobody was reached on any number for that student | A person |

The middle row is the one that is easy to get wrong. CALL-E can return a call with status
`completed` and `structured_result: null`, which is a real conversation that the schema
could not be filled from. A pipeline with two buckets has to put that somewhere, and
putting it with the successes is how a dashboard reports 100% coverage for a child nobody
actually heard about. `dispatch/models.py` makes it a separate member of the `Resolution`
enum with a `needs_a_human` property, and the platform's own
`call.result_validation_failed` webhook is the same distinction seen from the other side.

The summary at the end of a run reports the same three numbers, and the queue of cases
needing a person is printed after them rather than folded into a rate.

## What it uses from CALL-E

Read from the SDK source rather than the quickstart, which documents a narrower surface
than the API has.

- **`phones` as an ordered fallback chain.** Each recipient carries a list of numbers,
  tried in order. `S-1043` is answered by the second guardian; `S-1046` is answered by
  neither. This is a first-class part of the request, not something the caller
  orchestrates.
- **Per-recipient `locale` and `region`.** The language is a property of the family, not
  of the deployment, so one run reaches a Tamil-speaking household and a Hindi-speaking
  household in the same wave. India is one of the regions CALL-E supports for Tamil.
- **A result schema, and what happens when it cannot be filled.** See above.
- **`Idempotency-Key` derived from (student, date).** A retry after a timeout reuses the
  same key rather than minting a fresh one, so a network failure cannot double-call a
  family. The header is set once per work item in `dispatch/scheduler.py`.

## Safety and side effects

- **Every call opens with an AI disclosure** before anything is asked. It is a constant in
  `firstbell/domain.py`, not a template a deployment can reword or drop.
- **Consent is required and is never inferred.** A work file with no `consent` column is
  refused outright rather than defaulted, because a missing consent record is not consent.
  `S-1045` in the sample is skipped and counted separately.
- **Phone numbers are masked** everywhere a run writes or prints, including the JSON
  receipt. A test asserts that no unmasked E.164 number can reach a receipt.
- **Concurrency is capped** and defaults to 3. CALL-E offers no cancel endpoint, so the
  cap is the only brake that exists: it bounds how many calls are in flight and therefore
  how much cannot be stopped.
- **Cancellation is implemented here** because the platform has none.
  `WaveDispatcher.cancel()` stops dispatching, drains what is already in flight, and the
  report names the calls that could not be recalled rather than pretending they were.
- **The conversation has a narrow remit.** The agent asks the reason and the expected
  return date and stops. If the person is distressed, disputes the absence, asks for a
  human, or says anything suggesting the child may be at risk, it stops asking questions,
  says a staff member will call back today, and ends the call. No medical, legal or
  financial advice is given on any path.
- **No recurring schedule is created.** One invocation places one wave and exits.

## Live mode

Live mode is opt-in twice and reads its key only from the environment.

```bash
export CALLE_API_KEY=...          # never a flag, never a file in this repo
python -m firstbell --work-file examples/absences.csv \
  --live --yes-i-mean-it --limit 1 --receipt run.json
```

`--live` without `--yes-i-mean-it` exits with an explanation instead of dialling. `--limit`
exists so a first live run is one call.

The receipt records where the calls went, not just that live mode was requested. The SDK
takes a base URL, so the real client over real HTTP can still be talking to a double, and
a receipt that called that `live` would be manufacturing evidence of a call that never
happened. `mode` is `live` only when the host was `api.heycall-e.com`, and
`live-nonproduction` otherwise, alongside the `api_base_url` and a
`reached_production_api` boolean.

## The local double

`calle_double/` is an in-process implementation of the CALL-E API: the exact call and
attempt statuses, the error codes and their HTTP mappings, the fan-out shape, the
supported region and language table, and the completed-with-null-result case. It exists
because the platform ships no sandbox, no dry-run and no test key, which was verified by
searching the OpenAPI specification, both SDKs, every guide and the integrations
repository.

It is used two ways. The test suite and the offline default mount it on an
`httpx.MockTransport` inside the real `CalleClient`, so the client under test is the
shipped one. It also runs as a real HTTP server for anything that cannot be mounted in
process:

```bash
python -m calle_double.server --port 8787
export CALLE_BASE_URL=http://127.0.0.1:8787
```

## Tests

```bash
pip install -r requirements-dev.txt
python -m pytest tests/ -q          # 64 tests
```

The suite covers the double's fidelity to the documented API, the dispatcher's
classification and cancellation, consent, masking, and the live branch end to end against
the double's HTTP server so that branch is not dead code.

Each gate was checked by breaking it on purpose and confirming it fails. Removing the
concurrency cap fails 4 tests, disabling the consent check fails 3, dropping one real
error code from the double fails 3, and matching the production host by substring instead
of hostname fails the mode test on a look-alike domain. A gate that has never been
observed to fail has not been shown to test anything.

## What this does not claim

- **No money figure.** Explaining an absence does not make a student present, so no
  attendance funding is recovered by these calls. Only five US states fund schools on
  daily attendance at all; England and Australia fund on enrolment census dates. If your
  jurisdiction is one of the five, `--funding-rate` computes a figure, and it refuses to
  run without `--funding-source`, `--funding-url` and `--funding-jurisdiction`, because a
  money number without a citation is worth less than no number.
- **The Title VI reading is an extension.** The 2015 Dear Colleague Letter names
  English-learner identification and programme notices. Applying it to attendance contact
  follows from the same duty, but the letter does not say the word attendance.
- **Schools are not uniformly alarmed about this.** A Brookings and USC survey found only
  15% of school leaders described themselves as extremely worried about attendance. The
  duty of care is a legal floor rather than a felt crisis everywhere.
- **The work file is a CSV.** No school hand-uploads one every morning at scale. The
  source is a `Protocol` in `dispatch/sources.py` and a system-of-record adapter is a
  drop-in, but what ships is file-backed, because a demo must not need credentials to
  somebody else's database.
- **The offline run is a double, not a recording.** It reproduces the API's shape and
  failure modes. It does not reproduce what a real parent says.

## Attribution

The supported region, calling code and language table in `calle_double/regions.py` is
transcribed from `CALLE-AI/call-e-integrations`, which is MIT licensed. Dependency
licences and one unresolved licensing question about the `calle-ai` package are recorded
in `THIRD-PARTY-NOTICES.md`.

All phone numbers in this directory are fictional and unassignable.

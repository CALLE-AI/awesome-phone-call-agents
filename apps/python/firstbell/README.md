# firstbell

**[Evidence page](https://firstbell-evidence.vercel.app)** &middot; every real call, every broken rule, and the offline run. Built by `tools/judge_page.py` from the call recordings, which are held outside this repository: see [`evidence/README.md`](evidence/README.md) for why.

Phones the families whose absence notification went unanswered, in the language that
family speaks, and brings back a structured reason a school office can act on. Offline by
default: the demo below dials nobody and needs no CALL-E account.

```bash
pip install -r requirements.txt
python -m firstbell --work-file examples/absences.csv
```

## If you have ten minutes

Read these five files in this order. Between them they contain every claim this directory
makes, and each one can be checked without an API key.

| # | File | What it settles | Time |
| --- | --- | --- | --- |
| 1 | [`dispatch/models.py`](dispatch/models.py) | The one idea: a call has three endings, and `Resolution.needs_a_human` is why the middle one cannot be filed with the successes | 2 min |
| 2 | [`dispatch/scheduler.py`](dispatch/scheduler.py) | Where CALL-E is actually called, how the fallback chain and idempotency key are built, and what cancellation can and cannot mean | 3 min |
| 3 | [`evidence/README.md`](evidence/README.md) | What twelve real calls settled, why their receipts are on the linked page and not in this tree, and how a generated fixture can be trusted when it is not a recording | 3 min |
| 4 | [`evidence/MUTATIONS.md`](evidence/MUTATIONS.md) | Forty gates broken on purpose, with how many tests noticed each one | 1 min |
| 5 | [`docs/locale-is-not-only-a-hint.md`](docs/locale-is-not-only-a-hint.md) | The two-language experiment, pre-registered, including the three comparisons that did not match and why | 1 min |

### Where CALL-E is called at runtime

Four lines do all of it. Every anchor below is checked by a test, so a line number here
cannot quietly rot.

- The client is constructed on the live path only: `from calle import CalleClient` at
  `firstbell/cli.py:194`. The offline default never reaches it.
- The call is placed at `self._client.calls.create` at `dispatch/scheduler.py:303`, with
  the whole phone fallback chain and the per-family `locale` in one request.
- Completion is polled at `self._client.calls.get` at `dispatch/scheduler.py:370`, under a
  hard ceiling rather than an open loop.
- Failures arrive as the SDK's own type, `from calle import CalleAPIError` at
  `dispatch/scheduler.py:295`, rather than as a string match on a message.

## Reusable without this app

The classification rule is not locked inside a Python CLI. The same three outcomes ship as
an importable n8n workflow in
[`plugins/firstbell-absence-calls`](../../../plugins/firstbell-absence-calls/), with the
classifier extracted into a plain module so `node --test examples/classify.test.mjs` runs
its fourteen tests without n8n installed, and the workflow regenerated from that module by
a committed script so the two cannot drift apart. It ships with its schedule trigger
disabled and a dry run that places no calls and needs no API key.

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
6 row(s) from examples\absences.csv, concurrency 3.

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

  funding recovered    not claimed
                       Explaining an absence does not make a student
                       present, so no attendance funding is recovered by
                       this call. Seven US states funded on daily
                       attendance as of 2022 (PPIC, citing the Urban
                       Institute). Pass --funding-rate with a source
                       if your jurisdiction is one of them.

  staff time avoided
    attempts billed     7
    attempts removed    4   behind the 3 record(s) this run closed
    attempts still open 3   on somebody's desk, so not counted as saved
    break-even          $0.22 per call, for every minute one manual attempt takes
                        so cheaper than the desk below $0.67 a call at 3 minutes an attempt
                        $23.55/hour, from $48,980 over 2,080 h. Secretaries and administrative
                        assistants, Educational services; state, local, and private, 2025.
                        Source: US Bureau of Labor Statistics, Occupational Outlook Handbook
                        https://www.bls.gov/ooh/office-and-administrative-support/secretaries-and-administrative-assistants.htm

2 case(s) need a person. Nothing here is closed:
  S-1044       the call completed but returned no structured result
  S-1046       nobody answered after trying 2 number(s)
```

Five students were attempted and seven calls were placed, because two of them needed a
second guardian's number. CALL-E bills per call, not per student, so the number that
matters to a budget is the seven.

## Why the last number is a ceiling and not a saving

CALL-E publishes no price per call, so any cost this app printed would be invented. It
reports the other side of the equation instead: the price above which it stops being
cheaper than a person.

Two things about that arithmetic are worth knowing beyond what the run prints. Attempts
still open are charged and never credited, because a call that reached nobody useful still
leaves the work on somebody's desk, and counting it as saved would be the same error as
counting a null result as an answer. And the [sourced wage](https://www.bls.gov/ooh/office-and-administrative-support/secretaries-and-administrative-assistants.htm)
understates the case in both directions it can: dividing by 2,080 hours prices a ten-month
school contract as cheaper per hour than it is, and a salary excludes the benefits paid on
top of it. An assumption nobody can check should point at its author, not away.

The one unknown left is the one a school office can answer better than anybody else, which
is why it is left to them: how long one of these calls takes its own staff. At three
minutes an attempt this run is cheaper than the desk below **$0.67 a call**, on a median of
**$48,980** for secretaries and administrative assistants in educational services. Change
the minutes, or pass `--staff-annual`, and the ceiling moves with it.

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

**There are two ways to learn nothing, and only one of them is obvious.** The first is a
null result. The second was found by placing a real call: the person said "I am at work, I
cannot talk now", and CALL-E returned a schema-valid result with every required field set
to `"unknown"`, alongside its own note saying no reason and no return date were collected.
A well-designed enum offers `"unknown"` rather than forcing a guess, so that result is
correct. It is also worth nothing, and the first version of this dispatcher marked it
resolved and closed the record.

Schema-valid and useful are not the same property. A result whose required fields are all
uninformative is now `undetermined` too. The set of values that count as uninformative is
a constructor argument rather than a hardcoded string, because the word depends on the
schema, and `test_a_row_of_unknowns_is_not_an_answer` runs against the captured production
response that caused it.

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
- **The escape hatch is instructed, not enforced, and that limit belongs to the platform.**
  The task tells the agent to stop and promise a staff callback if the person is
  distressed, asks for a human, or says anything suggesting the child may be at risk. On a
  live call the agent produced that line correctly and then, after a pause, restarted its
  opening disclosure instead of hanging up, and the person on the phone had to end the call
  themselves. CALL-E exposes no `end_call`, no `max_turns` and no maximum duration, so the
  prompt is the only lever available and it is not binding. Anyone deploying this near
  vulnerable people should know that before they do, and it is filed as a defect report
  rather than left as a footnote.

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

## Evidence from real calls

Twelve calls were placed against `api.heycall-e.com` on 2026-09-04. Their receipts are on
the [evidence page](https://firstbell-evidence.vercel.app) and **not in this tree**,
because the maintainer of this list requires that committed real-call artifacts be removed
and has said the requirement holds even where the people on the call were team members
playing a part and the numbers were reserved ones. That describes these calls exactly, so
the recordings stay outside the repository.

Four things those calls settled, each now a rule with a test that fails when the rule is
removed: language is routed and not prompted, a replay is reported as a replay, a platform
failure that contradicts itself is reported only where its accounts agree, and a
schema-valid result whose every field says `"unknown"` is not an answer. That last one is a
receipt of this app getting it wrong. [`evidence/README.md`](evidence/README.md) has the
detail.

Two pieces of machinery hold this up now that the recordings are elsewhere.
`tools/double_conformance.py` compares the offline double against those recordings path by
path and type by type, which is what makes a generated fixture worth trusting; it found the
double wrong in four ways that twenty-six existing gates had all missed, because all
twenty-six were measured against the same wrong model. `tests/test_privacy.py` keeps a
recording from coming back, and found two files a manual pass had missed, one of them a
real billing id used as an example in the documentation.

### American statistics, Indian phone numbers

The duty is documented in the US and England, so that is where the problem is argued from.
The calls went to my own handset because publishing a recording needs a line the caller
owns, and phoning somebody else's family to produce evidence for a code submission needs a
consent I did not ask for. The cost of that is a sample of one cooperative speaker, stated
in `docs/locale-is-not-only-a-hint.md`. What it bought is the matched pair, which CALL-E
supporting Tamil in the India region made placeable at all.

None of the code knows any of this. `dispatch/` never reads a country, language is a
`locale` column the family owns rather than a deployment setting, and the wage is one flag.
Moving this from a Chennai school to a California district changes two inputs and no logic:
the jurisdiction is data, and only the data is jurisdictional.

## Tests

```bash
pip install -r requirements-dev.txt
python -m pytest tests/ -q          # 128 tests
```

The suite covers the double's fidelity to the documented API, the dispatcher's
classification and cancellation, consent, masking, and the live branch end to end against
the double's HTTP server so that branch is not dead code.

Each gate was checked by breaking it on purpose and confirming it fails. Every one is
listed in `evidence/MUTATIONS.md` with the change made and the number of tests that caught
it: removing the concurrency cap fails 4, disabling the consent check fails 3, dropping one
real error code from the double fails 3, and matching the production host by substring
instead of hostname passes a look-alike domain and fails the mode test.

A gate that has never been observed to fail has not been shown to test anything. What
mutation testing does not cover is written down in that file too: it shows a test notices a
change, not that the rule is the right rule. Both defects found in this project during live
calls were of the second kind.

## What this does not claim

- **No money figure.** Explaining an absence does not make a student present, so no
  attendance funding is recovered by these calls. Seven US states funded schools on daily
  attendance as of 2022 ([PPIC](https://www.ppic.org/blog/who-stands-to-gain-from-changes-in-school-enrollment-funding/),
  citing the [Urban Institute](https://www.urban.org/urban-wire/how-are-states-funding-school-districts-wake-changing-enrollments-caused-covid-19));
  England and Australia fund on enrolment census dates. If your jurisdiction is one of
  them, `--funding-rate` computes a figure, and it refuses to
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
- **In India this calls from a United States number, and that is a deployment problem.**
  CALL-E's own supported-regions table lists India as an *International* line rather than
  a Local one, and their README says the international numbers are "primarily intended for
  testing". The live calls behind the linked receipts arrived on an Indian mobile
  showing a `+1` caller ID attributed to Oakland, California. A parent who is not
  expecting the call has no reason to answer an unknown American number about their child,
  and a school has every reason not to send one. The language routing works. Reaching the
  family from a number they recognise is a separate problem this app cannot solve, and
  anyone piloting it in India should read that as the blocker before the pilot rather than
  after it.
- **One failed call arrived with three incompatible accounts of itself.** The platform
  returned SIP `603 Decline` and a `failure_message` naming the user as having hung up.
  The attempt's `started_at` and `completed_at` were the same second, which says the call
  never rang. The operator was holding the phone, watched it ring in full, and touched
  nothing. The dispatcher therefore reports only what all three accounts agree on, that
  nobody answered, and `dispatch/scheduler.py` records why it refuses to say more.

## What I would build next

Four things, and each one is a limitation named above rather than a feature I fancy. In the
order that decides whether this is usable by a real school.

1. **A local number in the region being called.** The blocker, and not a language problem.
   These calls reached an Indian handset showing a `+1` caller ID from Oakland, and a
   parent has no reason to answer that about their child. Nothing else here matters until
   it is solved, and it is a procurement question before it is a code one.

2. **A system-of-record adapter behind the `WorkSource` protocol.** The CSV is the seam,
   not the design. `dispatch/sources.py` already reads through a protocol, so a PowerSchool
   or Arbor reader is one class and no change to the dispatcher.

3. **Platform-side call termination.** The escape hatch is instructed and not enforced
   because CALL-E exposes no `end_call`, no `max_turns` and no maximum duration. Filed
   upstream as a defect report; until it is answered a prompt is the only lever, and it is
   not binding.

4. **A locale comparison that survives its own control.** A written script per language,
   agreed before dialling, and more than one speaker. The matched pairs failed on two of
   four because one bilingual person cannot say the same thing twice from memory.

## Attribution

The supported region, calling code and language table in `calle_double/regions.py` is
transcribed from `CALLE-AI/call-e-integrations`, which is MIT licensed. Dependency
licences and one unresolved licensing question about the `calle-ai` package are recorded
in `THIRD-PARTY-NOTICES.md`.

Every phone number in this repository is fictional and unassignable, and
`tests/test_privacy.py` fails if one is not. The calls described above went to a real
handset, mine, and no number that reached it is committed here: the receipts holding it are
on the linked page, where it is masked. Those two sentences are both true and they are
eighty lines apart, which was worth closing rather than leaving a reader to reconcile.

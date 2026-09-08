# Evidence

Twelve calls were placed against `api.heycall-e.com` on 2026-09-04, and their receipt files
are **not in this directory and not on the evidence page either**. This paragraph used to say
they were on that page, and a reader who went looking found recordings.

What is published is the same material with the identifiers taken out. The
[evidence page](https://firstbell-evidence.vercel.app) carries the recording of each call, its
transcript turn by turn, its waveform and a shortened id, and it is linked rather than
committed. What travels with the code is the arithmetic, in `recorded-calls.json`: all six
receipt files by name, how many calls each one placed, how many were answered and how many
needed a human, and the counts behind every money figure in this entry. No conversation, no
telephone number, no call id.

That is deliberate, and it is not our rule. The maintainer of this list has required, on
several pull requests, that a contributor remove committed real-call transcripts and every
real-call-derived artifact from the tree, and has stated that the requirement holds even
where the people on the call were team members playing a part and the numbers dialled were
reserved ones. Both of those describe this project exactly: the calls went to a phone the
author was holding, the author answered them, and the numbers were unassignable. The rule
still binds, so the recordings live outside the repository.

What that leaves here is the part a repository is good at holding: the reasoning, the rules
the calls produced, and the machinery that keeps both honest.

| File | What it is |
|---|---|
| [`api-shape.json`](api-shape.json) | Every key path and JSON type the production API returned, next to what the offline double emits. Path names and type names only: no conversation, no number, no id, no field value. Regenerate with `tools/double_conformance.py`. |
| [`MUTATIONS.md`](MUTATIONS.md) | Two hundred and fifty-two gates broken on purpose, with how many tests noticed each one. |
| [`observed-price.json`](observed-price.json) | What CALL-E actually billed this account: thirteen events at $0.05 a call, $0.65 over one month, read off the usage panel on 2026-09-07. A first-party observation rather than a published price, which is why it is not in `statistics.json`, and it carries the three things thirteen calls cannot settle. |
| [`film.json`](film.json) | What the demo film measures out at: 2:58, 21 shots, 37% of the running time carrying sound, no narration mixed in, and the sha256 of the file. The film is not committed either, so this is the same arrangement as the row below: the thing lives outside, the measurement lives here. It exists because three surfaces carried a running time typed by hand and one re-render made all three wrong. Written by `make-receipt.py` in the workshop, at the same moment it writes the film's own receipt. |
| [`recorded-calls.json`](recorded-calls.json) | Five integers over every call this software placed against the production API, de-duplicated by call id: twelve calls, twelve attempts billed, six removed, eleven answered, one net-new escalation. No conversation, no number, no id, no field value, on the same line `api-shape.json` draws. It is the only numerator in this entry that nobody chose, and it is what `tools/money_across_runs.py` prints its last row from. Regenerate with `tools/pool_recorded_calls.py --receipts DIR`, and `--check` fails on drift. |
| [`statistics.json`](statistics.json) | Every externally sourced figure the README publishes, with the publisher, the URL, the sentence it came from and the date it was read at source. It exists because one of them was wrong: the README claimed England recorded 18.7% persistent absence in 2024/25, a number that appears nowhere in the DfE release, where the published rate is 17.63%. |

## What the calls actually settled

Four findings, in the order they cost the most to learn. Each one is now a rule in the code
and a test that fails when the rule is removed.

**Language is a property of the family, not of the deployment.** One command placed two
calls whose rows differ in exactly one column, `locale`. The task text sent to CALL-E was
byte-identical apart from the student's name, so the Tamil was not prompted, it was routed.
The extraction still returned English enum values from a Tamil conversation with code-mixed
speech. `tests/test_dispatch.py::test_a_tamil_conversation_still_yields_english_enum_values`
holds our half of that, and the platform's half is on the evidence page.

**A replayed call is reported as replayed, not as placed.** Running the same command twice
produced `calls placed 0, calls replayed 2`: no phone rang and the account was not charged,
which the vendor's own usage page confirms from outside. Duplicate-call protection is
something every entry in this repository is asked to describe, and this is the count rather
than the description.

**The platform's account of a failure contradicted itself, and the dispatcher reports only
what survives.** One call came back with SIP `603 Decline`, a `failure_message` naming the
person as having hung up, and `started_at` equal to `completed_at`, which says the call
never rang at all. The operator was holding the phone, watched it ring in full, and touched
nothing. Three accounts of one call and only one of them checkable. What all three agree on
is that nobody was reached, and that is the only thing put in front of an administrator.
`dispatch/scheduler.py` says so at the SIP table.

**A schema-valid result can be a result full of nothing.** This is the one that mattered
most, and it is a record of this app getting it wrong.

The person answered, said they were at work and could not talk, and CALL-E returned a
result that passed the schema with every required field set to `"unknown"`, its own note
saying no reason and no return date had been collected. This app read the schema, found it
valid, wrote `resolved`, and closed a record about a child nobody had heard anything about.
That is the exact failure the project exists to prevent, arriving by a route the design had
not considered: not a null result, but a full one that says nothing. It was found by placing
a call, not by reasoning about the API.

A result whose required fields are all uninformative is now `undetermined`, and
`tests/test_dispatch.py::test_a_row_of_unknowns_is_not_an_answer` fails if that rule is
removed.

## How a fixture can be trusted when it is not a recording

The obvious objection to removing the recordings is that the fixtures replacing them are
written by the same people whose code they test, and could be whatever shape makes the
tests pass.

They are not written. They are generated, by `tools/make_shape_fixtures.py`, from the
offline double in `calle_double/`. And the double is not trusted either: it is measured
against the recorded responses by `tools/double_conformance.py`, which writes
`api-shape.json`, and that comparison is gated by
`tests/test_calle_double.py::test_the_double_emits_every_field_the_real_api_returns`.

That check was worth writing. It found the double wrong in four ways at once:

- four task-level fields the API returns on every response were missing from it, one of
  them (`failure_code`) asserted on by a test that could therefore only ever have run
  against a recording
- it placed the extracted result where nothing had asked for one, which is the same wrong
  assumption the dispatcher's first version made, so the two agreed and every offline test
  passed
- it spoke its own vocabulary on an attempt, where the API sends a numeric SIP code, which
  changed the words an administrator reads
- it gave a failed attempt a duration, where the one recorded failure had none

None of the twenty-six gates that existed before caught any of it, because all twenty-six
were measured against the same wrong model. Mutations 27 to 29 are the gates now.

## What stops a real artifact coming back

`tests/test_privacy.py`. It reads what git tracks, not the working tree, and fails on a
receipt that claims it reached production, a provider call id, transcript text outside a
fixture that declares itself authored, or a number from outside a reserved range.

It is here because the review history upstream shows four contributors being told this by
hand, one of whom had already run a scrub of their own and still shipped provider call ids.
It caught two files in this project that a manual pass had missed, including a real
thirty-two-character billing id sitting in the documentation as an example, and one in a
test. A rule in a review comment is re-learned once per contributor; a rule in a test is
not.

The numbers this app prints, and the ceiling it derives from them, are described in the
[app README](../README.md).

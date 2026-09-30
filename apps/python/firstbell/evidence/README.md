# Evidence

Twelve calls were placed against `api.heycall-e.com` on 2026-09-04 (eight of them recorded),
and their receipt files are **not in this directory and not on the evidence page either**.
Twenty live calls are published in the entry now (the eight recorded calls from 2026-09-04,
plus twelve that connected on 2026-09-11); every count in this directory is over the 2026-09-04
twelve, which are the calls with receipts. This paragraph used to say they were on that page,
and a reader who went looking found recordings.

What is published is the same material with the identifiers taken out. The
[evidence page](https://firstbell-evidence.vercel.app) carries a shortened id for all twelve
and, for the eight that were recorded, the recording, the transcript turn by turn and the
waveform, and it is linked rather than committed. What travels with the code is the
arithmetic, in `recorded-calls.json`: all six receipt files by name, how many calls each one
placed, how many were answered and how many needed a human, and the counts behind every money
figure in this entry. That file carries no conversation, no telephone number and no call id.

One committed file does carry conversation, and saying otherwise here would be the kind of
claim this entry exists to argue against. `tools/glosses.json` holds fifty three Tamil turns
from four of the calls with their English beside them. It is committed because the
organiser's Language Requirements rule asks that an English translation accompany every
submitted material, four of the eight published calls were placed in Tamil, and a translation
nobody can check against its original is not a translation. `tests/test_privacy.py` names
that file as a declared exception rather than letting it through quietly, which is what it
used to do: the gate matched one key name, the gloss file uses another, and for a fortnight
the only committed file holding real conversation was the one file that gate could not see.
The undertaking below covers it.

That is deliberate, and it is not our rule. The maintainer of this list has required, on
several pull requests, that a contributor remove committed real-call transcripts and every
real-call-derived artifact from the tree, and has stated that the requirement holds even
where the people on the call were team members playing a part and the numbers dialled were
reserved ones. Both of those describe this project exactly: the calls went to a phone the
author was holding, the author answered them, and the numbers were unassignable. The rule
still binds, so the recordings live outside the repository.

Stating the obvious objection before a reviewer has to raise it: moving a file off the tree
and linking to it is not obviously the same as removing it, and this project should not be
the one to decide that. The maintainer has already written on the point. On PR #300, on
2026-09-04:

> The PR and linked public project contain payloads and transcript excerpts from real test
> calls. Replace them with fully synthetic fixtures, remove every real-call artifact from
> the current trees, and rewrite both affected public histories without repeating any
> personal or call value.

"linked public project" is the phrase that matters, and it is not narrower than what this
entry does. So the arrangement described above is offered as what was built, not as a reading
that has been cleared.

What is actually reachable, counted rather than characterised: the evidence page serves eight
recordings without a login, renders fifty nine transcript turns as text, and embeds one
hundred and nine turns across all eight calls in the JSON the page is built from, which is in
the served document and readable by anyone who opens it. The calls went from the author to
the author, on a line the author owns, on numbers that cannot be assigned to anybody else, to
a script the author wrote, about a pupil who does not exist. That is what the material is. It
is not an argument that the requirement does not reach it.

**The maintainer's reading is the one that counts, and the undertaking does not wait for a
second ruling: a word on the pull request, or the one already written on #300, and the
recordings, the transcripts and `tools/glosses.json` all come off.** Removing
the recordings is a build flag, `--audio-dir`, left off. Removing the transcripts is a change
to `tools/judge_page.py`, which emits them unconditionally today. Neither is a rewrite of the
argument: the structured results, the counts, the escalations and every figure on the
reviewer page come from the receipts, and the receipts are not the recordings.

What that leaves here is the part a repository is good at holding: the reasoning, the rules
the calls produced, and the machinery that keeps both honest.

| File | What it is |
|---|---|
| [`api-shape.json`](api-shape.json) | Every key path and JSON type the production API returned, next to what the offline double emits. Path names and type names only: no conversation, no number, no id, no field value. Regenerate with `tools/double_conformance.py`. |
| [`MUTATIONS.md`](MUTATIONS.md) | Three hundred and fifty-eight gates broken on purpose, with how many tests noticed each one. |
| [`observed-price.json`](observed-price.json) | What CALL-E actually billed this account, in three dated readings that disagree: thirteen events at $0.05 a call flat (2026-09-07), four calls of one run at 41 to 75 credits (2026-09-11), and the whole account at 32 events and 820 credits (2026-09-12), by which point the panel labels the flat rows `Legacy pricing` itself. First-party observations rather than a published price, which is why they are not in `statistics.json`, and each carries what it cannot settle. `funding` records that none of it was bought. |
| [`suite-pair.json`](suite-pair.json) | What the suite did on the tree it was last measured on: how many were collected, how many passed, how many skipped, and whether the page and the gate report were present. The stat card on the reviewer page reads this file. It cannot measure the pair for itself, because the suite reads the page the builder writes, so the card used to take the number out of a sentence in the README and it was the largest count on the front screen that nothing checked. Written by `tools/suite_pair.py`, which is deliberately not part of the suite: a test that ran it would be measuring a run containing itself. `--check` compares the file to a fresh run and exits 3 rather than 1 when the two trees are not comparable. |
| [`recorded-calls.json`](recorded-calls.json) | Eight integers over every call this software placed against the production API on 2026-09-04, de-duplicated by call id: twelve calls, twelve attempts billed, four removed, eleven answered, seven escalated, and two net-new escalations once every call is re-filed under today's code. The file keeps two more the receipts recorded at the time under their own keys, and only one of those differs from its re-filed value, because that number was the defect and deleting it would hide the correction. No conversation, no number, no id, no field value, on the same line `api-shape.json` draws. It is the only numerator in this entry that nobody chose, and it is what `tools/money_across_runs.py` prints its last row from. Regenerate with `tools/pool_recorded_calls.py --receipts DIR`, and `--check` fails on drift. |
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

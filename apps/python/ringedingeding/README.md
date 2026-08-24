# Multi-recipient response aggregator

Call several people, then say what they answered — without inventing a majority.

Calling twenty people is the easy part. The hard part is the sentence afterwards:
*"eleven of them prefer Tuesday."* Eleven of how many? Of those who answered, or of those
who were invited? And if four never picked up, do they count as indifferent?

They do not. This app keeps the groups apart and names the denominator every time.

| Group | Meaning |
| --- | --- |
| `answered` | said something |
| `refused` | picked up and declined to take part |
| `unreached` | nobody answered, the line was busy, a machine picked up, or the wrong person did |
| `pending` | not called yet |
| `unknown` | the call ended in a state nobody can interpret |

Four rules follow, and they are what the regressions defend:

- **Every share is reported against those who answered** — never against those who were
  invited — and the report says so in words.
- **Silence about one option is unknown, not a no.** Someone who answered but never
  mentioned Thursday has not ruled Thursday out.
- **A tie stays a tie.** Nothing breaks the draw, because the caller was not asked to decide
  anything.
- **A stranger's answer is never this participant's answer.** If the wrong person picked up
  and declined on the participant's behalf, that is `unreached`, not `refused` — the
  participant was never actually asked.

Set `status` to `voicemail` when the call reached an answering machine, and to
`wrong_person` when someone other than the invited participant picked up and no handover
happened. Both land in `unreached` (see `Status.bucket` in `aggregate.py`), both are offered
another call in a catch-up round, and neither is ever read as this participant's `answered`
or `refused`.

## Setup

Python 3.11 or newer. No dependencies.

```bash
cd apps/python/ringedingeding
python aggregate.py --fixture example-schedule.json
python aggregate.py --fixture example-opinions.json
```

## Finding a date

```text
FIXTURE RUN -- SIMULATED, NO CALL PLACED
No network, no telephone, no credentials. Answers come from the fixture file.

Question: Which evening works for the club meeting?
Basis: 4 answered / 6 invited
Incomplete: 1 refused, 1 unreached. These people are not in the figures below and are not counted as indifferent.

Tue 19:00  [works for all respondents]
     works:  Ana, Ben, Cleo, Dara
     cannot: -
     silent (unknown, not a no): -
Wed 19:00  [-]
     works:  Ana, Ben, Dara
     cannot: -
     silent (unknown, not a no): Cleo
Thu 19:00  [-]
     works:  -
     cannot: Ana
     silent (unknown, not a no): Ben, Cleo, Dara

Slots that work for everyone who answered: Tue 19:00 -- among respondents only.
```

**Wednesday is the point of this fixture.** Nobody objected to it — `cannot` is empty — and
a naive tally would call it a match. Cleo simply never mentioned it. The slot is not
confirmed, and the report says which of the two it is.

## Merging opinions

```text
Question: Which caterer should we book for the summer party?
Basis: 5 answered / 6 invited
Incomplete: 1 unreached. These people are not in the figures below and are not counted as indifferent.

  Green Table: 2 of 5 who answered
  Hearth and Co: 2 of 5 who answered
  abstained: Emil

Tie between Green Table and Hearth and Co. It is not broken here.

Conditions attached:
  - Ana: only if the vegan option is included
  - Dara: only if they can set up before six

Reasons given (raw alongside):
  - Ana: They did the spring event and it went well.
      raw: "Green Table, definitely -- as long as they do the vegan option."
  - Ben: Prices are more predictable.
      raw: "I would say Hearth and Co. Their prices are more predictable."
```

A tally alone would have lost three things: that the vote is tied, that two of the votes
carry conditions, and that Emil abstained rather than being unreachable. Each is kept
separately, and the raw sentence travels beside its interpretation so a reader can check
the reading instead of trusting it.

## Catch-up rounds

A second round calls the `pending` and the `unreached` — nobody else. Someone who answered
is done, and someone who refused has given their answer; calling them again is not a
catch-up, it is pestering. Folding fresh answers in never overwrites an existing one.

## Safety

- **No calls.** There is no live transport and no `--live` flag in this edition. Every
  answer comes from the fixture file.
- **No credentials.** No account, no API key, no network request of any kind.
- **No scheduler, no retry.** A catch-up round is something a person starts, not something
  that happens by itself.
- **Numbers are validated as E.164 before processing** and masked in every output path. A
  regression asserts that no full number appears in either the report or the structured
  result, for both fixtures.
- **Fictional data only.** The fixtures use the `+1 555-0100…555-0199` range, reserved for
  fiction and belonging to nobody.
- **Cancellation.** Stopping the process stops it. Nothing was dispatched, so nothing needs
  recalling.

## Deliberate limits

- **`no_answer`, `busy`, `voicemail`, `wrong_person` and `declined` never collapse into one
  group.** They mean different things for a follow-up: four are worth another call, one is
  not.
- **An uninterpretable call lands in `unknown`**, not in `unreached`. Not knowing what
  happened is not the same as knowing nobody picked up.
- **An incomplete result always carries its caveat**, generated from the coverage rather
  than written by hand, so it cannot fall out of step with the figures.
- Not for medical, legal, financial or emergency workflows.

## Tests

```bash
cd apps/python/ringedingeding
python -m pytest -q
```

```text
..........................                                               [100%]
26 passed in 0.28s
```

The regressions guard the ways a summary could lie: unreached people counted as
indifferent, statuses collapsing into one another, a wrong-person pickup counted as this
participant's refusal, a voicemail pickup skipped by a catch-up round, silence read as
consent, a tie quietly broken, conditions or reasons dropped, a catch-up round overwriting
an answer, and a full number reaching an output.

## The full application

This is a focused, self-contained proof of the aggregation. The complete application —
call orchestration, the hash-chained record, web interface and the live CALL-E transport —
lives at <https://github.com/ellmos-ai/ringedingeding>. It has since been field-tested
twice against the real CALL-E service (2026-08-11 and 2026-08-22), including a live
retest of a retry-idempotency bug found and fixed the same day; its README carries a
"How We Tested" section, and its test suite currently stands at 575 passing.

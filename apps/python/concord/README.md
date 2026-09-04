# Concord

Concord phones the branches you own, asks callers' questions, and reports which
locations give an answer your policy does not allow. It reports on branches,
and it is built to make reporting on individuals as hard as the design allows.

A pharmacy group with forty shops has no cheap way to know whether all forty
tell a caller the same thing about emergency contraception. The answer only
exists in a conversation, so the work is done today by paying humans to make
the calls. Concord does the calling and the comparison, and leaves the judgment
about what to do next with a person.

## Why the unit is the branch

The obvious version of this product scores employees. That version is a
surveillance tool, so the boundary lives in the data model rather than in a
promise:

- `Finding` has no field for a name, role or phone number, so there is nowhere
  to put a person.
- Branches are ordered by outstanding policy work. No score, no percentage, no
  league table, because those are the artifacts that reach an appraisal.
- The call task tells the agent not to ask who is answering, or record it if
  offered.
- Tests fail if any of that stops being true.

One honest limit. A quote is free text spoken by a person, so someone who says
"This is Sarah, no you don't need a prescription" could put a name into the
record. `Answer.parse` strips self-identification and caps quote length before
the value is ever stored, and tests cover it, but pattern matching on natural
speech is best effort rather than a proof. The structural claim is about the
schema. The quote is defence in depth.

## Quick start

No credentials needed. Nothing here places a call.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e .

concord task    fixtures/example-audit.json --rubric rubrics/emergency-contraception.json
concord preview fixtures/example-audit.json --rubric rubrics/emergency-contraception.json
concord judge   fixtures/example-audit.json --rubric rubrics/emergency-contraception.json \
                --results fixtures/completed-audit.json
```

```bash
python3 -m unittest discover -s tests
```

`judge` prints the report an operator acts on:

```text
BRANCH OVERVIEW
Branch                              Deviations   Unclear   Matches policy
--------------------------------------------------------------------------------------
Northgate Pharmacy, Harbour Stree            2         1                1
Northgate Pharmacy, Mill Court               1         0                3
Northgate Pharmacy, Eastway                  0         4                0
Northgate Pharmacy, Selby Road               0         0                4

GAP REGISTER
  [DEVIATION] Northgate Pharmacy, Harbour Street  (C1)
      asked     Do I need a prescription for the morning-after pill?
      heard     "You'll need a doctor's note for that one, I'm afraid."
      finding   Answered 'yes' where policy requires 'no'. Policy: Levonorgestrel
                1.5 mg is a pharmacy medicine supplied without a prescription.

  [UNCLEAR] Northgate Pharmacy, Harbour Street  (C2)
      asked     How soon do I need to take it?
      heard     "As soon as you can really."
      finding   The call could not resolve this question into a definite answer.

  [UNCLEAR] Northgate Pharmacy, Eastway  (C1)
      finding   The branch was not reached.
```

A hedged answer stays `UNCLEAR` rather than being rounded to the nearest
option. An unreached branch produces four `UNCLEAR` findings rather than
vanishing. Branches are listed by outstanding work, not ranked by quality.

## The rubric compiles into the call

A rubric is the written policy plus the questions that test it. Each criterion
names the field to extract and the answer policy requires:

```json
{
  "id": "C1",
  "question": "Do I need a prescription for the morning-after pill?",
  "policy": "Levonorgestrel 1.5 mg is a pharmacy medicine supplied without a prescription.",
  "field": "prescription_required",
  "expect": "no",
  "options": ["yes", "no", "unclear"]
}
```

Concord compiles those criteria into the CALL-E `recipient_result_schema`, so
the policy document defines what the call is allowed to return. Remove a
criterion and it disappears from the schema. `concord task` prints both the
spoken task and the compiled schema before anything is dialled.

## Judge the value, quote the words

The first version matched policy phrases against the transcript, and reported

> "No, you don't need a prescription for that, you can buy it at the counter."

as a deviation, because the forbidden phrase "need a prescription" occurs
inside its own negation. Three of seven deviations in that run were branches
that had answered correctly.

The live call made the point harder than any fixture could. Real answers open
with a filler word, contradict themselves mid-sentence and still carry a clear
meaning. A matcher reading the transcript gets them backwards. Ruling on the
extracted value and keeping the sentence as evidence is what survives contact
with how people actually talk.

Keyword matching cannot read negation, and in a staff audit a false deviation
is worse than a missed one: it sends a manager to correct someone who did the
right thing. Concord now rules on the value the call extracted and carries the
spoken words as evidence a human can check. Two regression tests hold it.

## Silence is not failure

An unreached branch, an answer the call could not resolve, and a value outside
the rubric's options all rule `UNCLEAR` and go to a human. A phone line that
failed must never read as a policy breach.

## Verified against a live call

Concord has been exercised end to end against the real CALL-E API: one call
placed, structured answers returned, and the report generated from them. The
run produced one deviation and one unresolved answer on a single branch.

The recorded output is deliberately not committed. Everything in this
repository is synthetic, because a public example directory is the wrong place
for a real call identifier or for words a real person spoke. The fixtures under
`fixtures/` reproduce the same shapes with reserved test numbers.

What that call settled is in the next section: real speech does not behave like
the tidy sentences a phrase matcher assumes.

## Live runs

A live run needs all three, checked independently:

1. `--live`
2. `--confirm` matching the token from the current preview, which is derived
   from the audit and rubric so any edit invalidates it
3. the branches' own weekday call window, open now

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
concord run fixtures/example-audit.json --rubric rubrics/emergency-contraception.json \
  --live --confirm CONCORD-XXXXXXXXXXXX
```

The idempotency key is derived from the approved audit rather than the attempt,
so resubmitting an unchanged audit after an uncertain response cannot call the
same branches twice. If polling times out, reuse the call id and do not start a
second audit.

## Credentials

`CALLE_API_KEY` is read from the process environment only, with an optional
`CALLE_BASE_URL` override. Concord does not load a `.env` file, write the key to
disk, or print it. `.env.example` documents the two variables you must
`export` yourself; creating a `.env` will have no effect.

## Layout

```text
src/concord/calle.py       the only module that can reach the network
src/concord/collector.py   compiles the rubric into a call, parses results, cannot rule
src/concord/judge.py       rules answers against the rubric, cannot dial
src/concord/report.py      branch-level output, no people
rubrics/                   written policy, one file per scenario
skill/                     the Agent Skill and its references
```

`judge.py` imports `concord.models` and nothing else. A test parses its AST and
asserts the import set is exactly `{__future__, concord}`, so an aliased or
indirect route to the call client fails the suite. That is what keeps gathering
and ruling apart.

`calle.py` is covered by fake-transport tests that assert the exact URL, method,
headers and body sent to CALL-E. Only a live call proves the API accepts it.

## Scope

Concord tells an operator which locations give callers the wrong answer. It is
not for emergencies, not for medical, legal or employment decisions, and a
finding is evidence about an answer, not proof of misconduct.

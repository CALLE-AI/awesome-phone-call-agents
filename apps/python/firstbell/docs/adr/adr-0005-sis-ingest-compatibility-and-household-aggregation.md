# ADR-0005: Reading a district's own export, and one call per household

## Status

Accepted, and two parts of the original proposal rejected. Superseded content: an earlier
draft of this record proposed aliasing a consent column and merging siblings into one
closable record. Both are rejected below, with the reasons, because a record that only
lists what was built hides the decisions that cost something.

## Date

2026-09-07

## Context

A district does not hand-write `id, phones, consent`. It runs a scheduled export out of
PowerSchool, Infinite Campus, Skyward or Aspen, and what lands carries the column names
that vendor's format uses. `CsvSource` demanded three literal names, so an authentic
export produced `missing required column(s): id, phones` and nothing else. That is a
refusal about spelling presented as a refusal about data, and it is the first thing a
pilot hits.

Two children in one house are two rows on one telephone. Nothing in the code was wrong
about that: every row was a separate person to it, which is true of a row and false of a
telephone. Three siblings off with the same virus meant three calls to the same mother
inside a quarter of an hour, each opening with the automated-caller disclosure and asking
about one child as though the other two calls had not happened.

## Decision

**A dialect layer, in `dispatch/dialects.py`.** Three formats are recognised by a header
the others do not carry, and the recognised name is available on the source afterwards. A
header row matching two formats is refused rather than resolved by list order, because
which column is the identifier decides which family is telephoned about which child.
`--column-map` takes a district's own mapping so a format nobody here has seen needs no
code change.

| Format | Recognised by | Identifier | Numbers, in dialling order |
|---|---|---|---|
| `firstbell` | `id` and `phones` | `id` | `phones` |
| `oneroster-1.2` | `sourcedId` | `sourcedId` | `phone`, then `sms` |
| `clever` | `student_id` | `student_id` | `guardian_phone`, then `phone` |

`sms` is dialled second rather than instead, because a number recorded for text messages
is a weaker candidate for a voice call and not a bad one. A student's own number is dialled
after the guardian's, because ringing a child's mobile to ask why that child is not at
school reaches the wrong person even when it connects.

**Household grouping, in `dispatch/households.py`.** Rows sharing a first number, compared
on digits so `+1 555 010 0301` and `+15550100301` are one telephone, are one household for
the run. The row the export put first is dialled. The rest are held, and the count of calls
not placed is printed. The dialled row's context carries two keys, `also_absent` with
their ids and `also_absent_names` with their names, and it is the second that reaches the
instruction, so the parent is asked once about every absent child in the house rather than
once each.

Only rows that would actually be dialled are grouped. A sibling behind a family with no
consent, or behind a family the telephone cannot reach, is not a call saved, and reporting
it as one would claim work removed that was never going to happen.

## Alternatives considered

### Rejected: aliasing a consent column

The earlier draft mapped `consent` to `metadata.telephoneConsent` and `custom_consent`
alongside the identifier and phone aliases, as though consent were one more column with
several vendor spellings.

It is not. No format here carries a column recording that a guardian agreed to be
telephoned by an automated system about an absence, because that permission is not a fact
about a student and no system of record was built to hold it. `phone` and `sms` say how to
reach a family. They do not say you may. An alias list that finds a truthy value in some
adjacent field and reads it as permission is the single misreading in this software that
ends with a family being telephoned who asked not to be.

So a recognised export with no consent column stops the run, and the refusal says that no
rename can produce the column and names the two ways forward: add the boolean to the
export, or produce a dated register and pass `--consent-records`. Mutation 195 in
`evidence/MUTATIONS.md` turns that check off and five tests fail.

This is also the point `docs/the-legal-surface.md` has argued since the first draft, now
demonstrated rather than argued: a boolean is not a consent record, and a real export does
not have the boolean either.

### Rejected: a composite work item that closes several records on one answer

The earlier draft merged siblings into one `WorkItem`, added array support to
`dispatch/validation.py` so `RESULT_SCHEMA` could hold a list of per-child resolutions,
and closed every record in the household on the one result.

A mother who confirms she knows all three children are at home has answered for all three,
in the room. What comes back from the platform is one structured result about one named
child, with no repeated field for the other two. Closing three records on it means writing
an answer this program was never given into a record about a child, which is the move it
refuses everywhere else, and the array schema would have made the shape look legitimate
without any platform data to fill it.

So the held rows go to a person. Thirty seconds of a secretary's time closing two records,
against two calls to a family that did not need them. The honest fix is a structured result
with one entry per subject, which is not this repository's to build, and it is filed as a
platform finding in `call-e-feedback.md` rather than guessed at here.

### Deferred: verifying the answerer before the absence is spoken

The earlier draft's fourth point, that guardian identity is confirmed before any student
name is spoken, is a real defect and is not part of this record. It is a change to the
spoken instruction and to the result schema rather than to ingest, and it is tracked
separately so that a decision about what a call says is not buried in a decision about
column names.

## Consequences

A district's nightly export runs with one added column instead of a transformation script.
The run says which format it read, which is the thing an operator checks first when a
receipt looks wrong. Two example files, `examples/absences-oneroster.csv` and
`examples/absences-siblings.csv`, are in the tree so the behaviour is executable rather
than described.

The grouping removes calls, so it changes the arithmetic the run publishes: fewer calls
placed for the same number of rows. `held_same_household` is its own bucket rather than
folded into the skips, because it is the only skip in the run that says nothing about the
family and because it is the number a district is buying.

Two costs are accepted. A district whose siblings are recorded under different guardian
numbers gets no grouping, correctly, and the run cannot tell it so. And a held record is
work for a person that a merged design would have closed automatically, which is a real
cost of refusing the unearned claim rather than a free win.

## Validation

`tests/test_sis_ingest.py`, thirty tests. Rows 194 to 201 of `evidence/MUTATIONS.md` break
each check and record how many tests noticed; 8 of 8 were caught. `docs/district-ingest.md`
is the operator-facing version of this record.

# The file your district already exports

Two things a district hits in the first hour, and what this does about each.

Your system of record does not export `id, phones, consent`. And two children in one house
are two rows on one telephone.

## What the header row can be

Drop the export in and the run says which format it recognised. Three are built in, and a
mapping covers the rest.

| Format | Recognised by | Identifier | Numbers, in dialling order |
|---|---|---|---|
| `firstbell` | `id` and `phones` | `id` | `phones`, comma or semicolon separated |
| `oneroster-1.2` | `sourcedId` | `sourcedId` | `phone`, then `sms` |
| `clever` | `student_id` | `student_id` | `guardian_phone`, then `phone` |

```bash
# a OneRoster users.csv, unmodified apart from the consent column
python -m firstbell --work-file examples/absences-oneroster.csv

# a format nobody here has seen
python -m firstbell --work-file exports/monday.csv \
  --column-map '{"id": ["PupilRef"], "phones": ["Contact1", "Contact2"]}'
```

Three decisions inside that are worth arguing with.

**`sms` is dialled second, not instead.** A number a district recorded for text messages
is a weaker candidate for a voice call than one recorded as a phone, and it is not a bad
one. Both go into the fallback chain CALL-E dials down, in that order.

**A student's own number is dialled after the guardian's.** Clever exports can carry both.
Ringing a child's mobile to ask why the child is not at school is a call that reaches the
wrong person even when it connects.

**A file matching two formats is refused.** A header row carrying `sourcedId` and
`student_id` reads as two formats, and which column is the identifier decides which family
is telephoned about which child. Rename the one you do not mean, or pass `--column-map`.

## The column no export has

This is the part that matters, and it is not a limitation of the parser.

No format above carries a column recording that a guardian agreed to be telephoned by an
automated system about an absence. Not OneRoster, not Clever, not any student information
system export, because that permission is not a fact about a student and no system of
record was built to hold it. `phone` and `sms` say how to reach a family. They do not say
you may.

So a recognised export with no consent column stops the run, and the refusal says so
outright rather than reporting a missing column:

```
users.csv reads as OneRoster v1.2 users.csv, and that format has no column recording
consent to be telephoned by an automated system about an absence. Nor does any other
export here: contactability is a fact a system of record holds, and permission is not,
so no rename can produce it.
    Two ways forward, and a district picks one.
      Add a 'consent' column to the export, which is a boolean, and the run will say so
      on every line.
      Produce a dated register and pass --consent-records. docs/consent-record.md is the
      schema, and it is the defensible one.
    The run stops here rather than dialling, because the reading of a missing permission
    that ends with a family being telephoned is the one this refuses to make.
```

[`docs/the-legal-surface.md`](the-legal-surface.md) has argued since the first draft that a
boolean is not a consent record. A real export is where that stops being an argument: it
does not have the boolean either.

## The other column no export has, and what filling it costs

`voice` is the same shape of problem and it is not solved the same way. No export carries a
column saying the telephone cannot reach this guardian: a guardian who is deaf, hard of
hearing, or has a speech disability. OneRoster does not have it, Clever does not have it, and
`phone` does not mean answerable.

Here the run does not stop, and that is deliberate. A blank cell means reachable, because the
other default is to stop calling every family nobody has recorded anything about, which is
worse than calling one who cannot answer. So on day one in a district that has not filled it,
the column is blank for every pupil and this software dials a deaf parent exactly as their
current dialler does. The difference only starts when the column is populated.

`examples/absences-oneroster.csv` carries one row with it filled, `S-2204`, and the run prints
what the gate does:

```
[HUMAN] S-2204       this family is not reachable by a voice call; nothing was dialled
                     and somebody has to reach them another way

  no voice channel     1   never dialled, needs another way to reach them
```

Four rows, four endings, one command: a reason on record, the platform refusing a language,
nobody answered, and a guardian the telephone cannot reach.

**Populating it is work nobody can do for a district.** The office already knows: it is in
special education records and in whatever the family liaison keeps. A district operations
director who reviewed this put their own numbers on it. Two pilot schools is around forty
rows, a spreadsheet and an afternoon. Fourteen schools and nine thousand pupils is a data
project with a governance owner, and no vendor can hand it over. That is a scaling limit
rather than a pilot limit, and it is worth knowing before signing rather than after.

## One call per household

Three siblings off with the same virus used to be three calls to the same mother inside a
quarter of an hour, each opening with the automated-caller disclosure and asking about one
child as though the other two calls had not happened.

Rows sharing a first number, compared on digits so `+1 555 010 0301` and `+15550100301`
are one telephone, are one household for the run. The row the export put first is dialled.
The rest are held, and the run says how many calls it did not place:

```
2 row(s) share a telephone number with an earlier absence, so 2 fewer call(s) will be
placed. Each held row still goes to a person: one answer covers one named child.

  [ok   ] S-3101       schema-valid answer received
  [skip ] S-3102       another absence in the same household is being called: S-3101 is on the same number. One answer closes one record, so a person closes this one.

  held, same household 2   calls this run did not place, because the
                       same number was already being called about another
                       absence. Each one still goes to a person.
```

**Held, not closed.** A mother who says she knows all three children are at home has
answered for all three, in the room. What comes back from the platform is one structured
result about one named child, with no repeated field for the other two, so closing three
records on it means writing an answer this program was never given into a record about a
child. The held rows go to a person. Thirty seconds of a secretary's time against two
calls to a family that did not need them.

The instruction does name every absent child in the house, through `also_absent_names` on
the dialled row, so the parent is asked once about all of them rather than once each.
This sentence used to name `also_absent`, which is the neighbouring key holding their ids
and is read by nothing in the task builder.

A row nobody was going to dial holds nothing behind it. A sibling behind a family with no
consent, or behind a family the telephone cannot reach, is not a call saved, and counting
it as one would report work removed that was never going to happen.

The missing piece is not here. A structured result with one entry per subject would let
one answer close three records honestly, and
[`call-e-feedback.md`](../call-e-feedback.md) files that as a platform finding instead of
this repository guessing at it.

## What checks this

`tests/test_sis_ingest.py`, thirty tests: one per format, the ambiguous header row, the
unrecognised one, the supplied mapping, the consent refusal and its wording, both numbers
becoming a fallback chain, the guardian before the student, and eleven on the grouping,
including that a held row lands in its own bucket rather than under a run somebody
cancelled. Rows 194 to 201 of [`evidence/MUTATIONS.md`](../evidence/MUTATIONS.md) break
each check and record how many tests noticed.

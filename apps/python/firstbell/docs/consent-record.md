# The consent record

A boolean column that says `yes` is not a consent record. This is the shape of one, the
eight things checked before a phone rings, and the three decisions that stay with the
district.

`docs/the-legal-surface.md` has said since the first draft that this is the largest open
question in the software, and that a defensible answer replaces the boolean with a
reference to a dated record. That page called it a schema change and a district
conversation rather than a patch. This is the schema. The conversation is still yours.

## What it is not

It does not collect consent, store it, or talk to a student information system. A record is
a document your district produces from whatever it already holds: an enrolment pack, a
portal preference, a logged telephone request. This file says what that document has to
contain for software to be able to check it, and `dispatch/consent.py` is the checking.

Nothing here makes a call lawful. It makes the basis for a call inspectable, which is a
different and smaller claim.

## One record

One record is one permission: a named guardian, for one student, on one channel, for one
purpose, given on a date, and for the numbers it names.

```json
{
  "id": "CR-2026-0401",
  "student_id": "S-1041",
  "guardian_name": "guardian on file",
  "channel": "voice",
  "purpose": "attendance",
  "given_at": "2026-08-14",
  "expires_at": "2027-07-31",
  "withdrawn_at": null,
  "phones": ["+91 555 000 0001", "+91 555 000 0011"],
  "evidence": "enrolment pack 2026-27, section 4, signed",
  "recorded_by": "attendance office"
}
```

| Field | Required | What it is |
|---|---|---|
| `id` | yes | What a work file's `consent_record` column points at |
| `student_id` | yes | The row this permission belongs to, and no other |
| `channel` | yes | `voice`, `sms` or `email` |
| `purpose` | yes | `attendance`, `emergency` or `general` |
| `given_at` | yes | ISO 8601 date. Not in the future |
| `expires_at` | no | ISO 8601 date. Absent means open-ended |
| `phones` | no | The numbers this permission covers. A list, even for one |
| `withdrawn_at` | no | ISO 8601 date. Any value at all means withdrawn |
| `evidence` | no | Where the signature or the log entry is, in your words |
| `recorded_by` | no | Which desk recorded it |
| `guardian_name` | no | Held by you. This repository publishes none |

An unrecognised key stops the register rather than being ignored. `witdrawn_at` on a record
nobody proofread is a withdrawal software cannot see, and a schema that skips unknown keys
reads that record as one nobody withdrew. That is the one misreading here that ends with a
call to a family who asked not to be called.

Two enums, and both are deliberate. `channel` and `purpose` exist so that a blanket "we may
contact you about your child" cannot be read as permission to telephone about an absence.
A district that ticked one box at enrolment has not agreed to this specific call, and a
schema that cannot express the difference invites the reading that it has.

## The eight checks, all failing closed

A row is dialled only if every one of these holds, in this order. Each failure prints its
own sentence, because a record withdrawn last week and a mistyped date are the same outcome
and completely different conversations with a family, and the attendance officer holding
the queue is the person who has to have them.

1. The referenced record is in the register.
2. Its `student_id` is the row's id. One family's permission is not another's.
3. `withdrawn_at` is absent.
4. `expires_at` is absent, or is not before today. A record expiring today still covers
   today.
5. `given_at` is not in the future.
6. `channel` is `voice`. This software telephones people.
7. `purpose` is `attendance`.
8. If the record names numbers, it names every number on the row.

## Consent attaches to a number, not to a child

The eighth check is the newest and it is here because a district's data protection officer
read the seven above and asked the obvious question: which telephone did the family agree
to? Under the US Telephone Consumer Protection Act the permission attaches to the number
called. The record names a pupil. A work file row carries a fallback chain, one number and
then the next, and this software works down it. So a record covering the first number and
saying nothing about the second used to authorise a call to the second.

The row is refused rather than the number, and that is deliberate. Trying the first number,
reaching nobody, and stopping at the second is a refusal that arrives after a call has
already gone out. A row is either dialled or it is not.

```
  [skip ] S-1048  no recorded consent to be called: consent record 'CR-2026-0407' covers 1 number(s) and this row carries 1 the record does not name. Consent attaches to the number called, and this software works down a fallback chain, so a row is dialled only when the record covers every number on it.
```

Numbers are compared on their digits. `+91 555 000 0001` in a register a person maintains
and `+915550000001` in an export a system wrote are one telephone, and refusing that pair
would be a check that reads as careful while stopping real calls about real absences.

Something with no digits in it is not a number and matches nothing. This is worth stating
because it was the hole in the rule above: strip the digits out of `unknown` and nothing is
left, nothing equals nothing, so a record holding `unknown` covered a row carrying
`unknown` and that row was dialled on a permission naming no telephone. OneRoster and
Clever exports do write `unknown`, `n/a` and `none` into a phone column. The register
refuses such an entry when it loads, a work file drops it and refuses a row it leaves with
nothing to dial, and the comparison itself refuses it as well, because a guard that trusts
its callers to have checked first is one a later caller removes.

**A record that names no numbers still dials, and the run says how many did.** That is the
exposure left rather than a decision anybody is happy with. Every register written before
this field existed names no numbers, refusing all of those rows would stop every deployment
that has one, and a silent pass would be the software agreeing with itself. So the run
counts them:

```
  consent
    on a record        2   dated, voice, attendance, not withdrawn
    on a boolean       1   a column that says yes, which is not a record
                           docs/consent-record.md is the schema that replaces it
    no number named    1   of the records above, this many name a pupil
                           and no telephone number. Consent attaches to the number
                           called, so these are the rows nobody can point
                           at a number for
```

Adding numbers to your register turns that third line into nothing, which is the point of
printing it.

A malformed record, a duplicate id, or an empty register stops the run instead of refusing
rows one at a time. A register with one bad record in it is a document somebody has to look
at, and dialling the rows that happened to parse is calling families on the strength of a
file nobody trusts.

## Using it

```bash
python -m firstbell \
  --work-file examples/absences-with-consent.csv \
  --consent-records examples/consent-register.json
```

The work file gains one optional column, `consent_record`, beside the `consent` column it
already needs. The example register carries seven records covering every refusal: one plain
naming both numbers on its row, one open-ended naming none, one withdrawn, one expired, one
for text messages only, one for general contact, one naming one of the two numbers its row
carries. Five of the eight example rows are refused, each with its reason:

```
  [skip ] S-1043  no recorded consent to be called: consent record 'CR-2026-0403' was withdrawn on 2026-09-01.
  [skip ] S-1044  no recorded consent to be called: consent record 'CR-2025-0088' expired on 2026-07-31.
  [skip ] S-1045  no recorded consent to be called: consent record 'CR-2026-0405' covers sms, not voice. This software telephones people.
  [skip ] S-1046  no recorded consent to be called: consent record 'CR-2026-0406' covers general, not attendance. A general permission to make contact is not permission to telephone about an absence.
  [skip ] S-1048  no recorded consent to be called: consent record 'CR-2026-0407' covers 1 number(s) and this row carries 1 the record does not name. Consent attaches to the number called, and this software works down a fallback chain, so a row is dialled only when the record covers every number on it.
```

## The column is optional, and the run says who is still on a boolean

Removing the boolean would break every work file written before this document existed, and
a boolean is what a student information system exports today. So both are read, and the run
prints which rows rested on which:

```
  consent
    on a record        2   dated, voice, attendance, not withdrawn
    on a boolean       1   a column that says yes, which is not a record
                           docs/consent-record.md is the schema that replaces it
    no number named    1   of the records above, this many name a pupil
                           and no telephone number. Consent attaches to the number
                           called, so these are the rows nobody can point
                           at a number for
```

The second and third lines are your open exposure, in the run rather than left for counsel
to find.
That is the same move the run makes with attempts still open: name the thing you cannot
vouch for instead of folding it into a total.

A row that names a record when the run was given no register is refused. It would otherwise
look better documented than a boolean row while being checked less.

## One row per call, saying what let it ring

Every refusal above is itemised: the record it rested on and a sentence an attendance
officer can read out. For a long time every approval was two integers. A district
operations director reading the run said what that means in practice: the refusal log is
the half nobody builds, and the authorisation log is the half everybody is asked for. When
a parent telephones the school and asks why they were called, nobody is asking which rows
were skipped.

`--json` carries one row per call the run placed:

```json
{
  "id": "S-1041",
  "record": "CR-2026-0401",
  "basis": "a dated record",
  "numbers_tried": ["+91********01"],
  "number_named_by_the_record": true,
  "attempts": 1,
  "call_id": "call_2",
  "placed_by_this_run": true
}
```

`number_named_by_the_record` is the question underneath the question, and it has three
answers. `true` means the record named every number on the row, which is what the eighth
check enforces: a row carrying any number the record does not name is refused outright
rather than refused at the third attempt. `false` means the record names a pupil and no
telephone at all, so nobody can point at a number for that call, and it is the same row the
`no number named` count above is counting. `null` means there was no record to ask, because
the row dialled on a boolean column.

The numbers are masked here exactly as they are everywhere else this run writes a number
down. A log kept to answer a complaint about a telephone call does not need the telephone
number in the clear to say which one rang, and the register holds the unmasked one.

## Three decisions that stay with you

1. **Where the record lives, and who may write one.** This reads a file. A district that
   keeps consent in its student information system exports that file, and the export is
   the thing an auditor asks about.
2. **How a parent withdraws.** The schema has the field. Who a parent tells, how fast that
   reaches the register, and what happens to calls already queued are yours.
3. **Whether an unexplained absence is an emergency.** `purpose` has an `emergency` value
   and this software refuses it, because deciding that an absence is a safety exception is
   a decision about a child and not a configuration option. If your counsel decides
   otherwise, that is a change to `CHANNEL_REQUIRED` and `PURPOSE_REQUIRED` in
   `dispatch/consent.py`, made on purpose and with a name attached.

## What checks this

`tests/test_consent_record.py`, forty-two tests: one per refusal, one per required
field, the unknown-key refusal, the register-level failures, the digits-only number
comparison, the count of rows that rested on a record naming no number, and two that read
the shipped example register beside the work file and fail if the pair stops demonstrating
every kind of refusal. The schema
constant published here is asserted against the code that enforces it, because a schema
document that has drifted from its checker is worse than no document.

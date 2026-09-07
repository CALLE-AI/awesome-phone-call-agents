# The consent record

A boolean column that says `yes` is not a consent record. This is the shape of one, the
seven things checked before a phone rings, and the three decisions that stay with the
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
purpose, given on a date.

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

## The seven checks, all failing closed

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
already needs. The example register carries six records covering every refusal: one plain,
one open-ended, one withdrawn, one expired, one for text messages only, one for general
contact. Four of the seven example rows are refused, each with its reason:

```
  [skip ] S-1043  no recorded consent to be called: consent record 'CR-2026-0403' was withdrawn on 2026-09-01.
  [skip ] S-1044  no recorded consent to be called: consent record 'CR-2025-0088' expired on 2026-07-31.
  [skip ] S-1045  no recorded consent to be called: consent record 'CR-2026-0405' covers sms, not voice. This software telephones people.
  [skip ] S-1046  no recorded consent to be called: consent record 'CR-2026-0406' covers general, not attendance. A general permission to make contact is not permission to telephone about an absence.
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
```

The second line is your open exposure, in the run rather than left for counsel to find.
That is the same move the run makes with attempts still open: name the thing you cannot
vouch for instead of folding it into a total.

A row that names a record when the run was given no register is refused. It would otherwise
look better documented than a boolean row while being checked less.

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

`tests/test_consent_record.py`, twenty-seven tests: one per refusal, one per required
field, the unknown-key refusal, the register-level failures, and one that reads the shipped
example register and fails if it stops demonstrating all four kinds of refusal. The schema
constant published here is asserted against the code that enforces it, because a schema
document that has drifted from its checker is worse than no document.

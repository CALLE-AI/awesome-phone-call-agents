# Registry format

The enrollee list is a CSV. A real one must be named `*.private.csv` - that pattern is git-ignored.
`data/enrollees.sample.csv` is the fictional 16-row sample used by the tests and the demo.

## Columns

| Column | Required | Meaning |
| --- | --- | --- |
| `person_id` | yes | Stable id. Used in idempotency keys, the ledger, and the worklist. |
| `name` | yes | Full name. Used for the identity check. |
| `first_name` | no | Defaults to the first word of `name`. This is what the agent says. |
| `phone` | yes | **E.164 only** (`+14155550301`). Anything else is refused, not normalised. |
| `locale` | no | BCP-47, e.g. `es-US`. Drives the language of the entire call. Default `en-US`. |
| `region` | no | Region hint passed to CALL-E. |
| `birth_year` | yes in practice | The identity check. Without it the person cannot be verified, and the load warns. |
| `check_date` | no | `YYYY-MM-DD` coverage check date. Drives wave order and the deadline wording. A malformed date warns and is treated as unknown. |
| `known_exempt` | no | An exemption code the state's record already establishes. An unrecognised code warns and is ignored. |
| `known_compliant` | no | `yes` when wage or income data already shows the requirement is met. |
| `known_snap_tanf` | no | `yes`/`no`. `yes` clears without a call; `no` skips that question. |
| `known_pregnant` | no | `yes`/`no`. |
| `known_veteran_disability` | no | `yes`/`no`. |
| `known_tribal` | no | `yes`/`no`. |
| `known_foster_youth` | no | `yes`/`no`. |
| `has_online_account` | no | `no` raises the paperwork-risk score. |
| `mail_returned` | no | `yes` raises it further - mail already failed for this person. |
| `prior_procedural_loss` | no | `yes` raises it most: they have lost coverage over paperwork before. |
| `do_not_call` | no | `yes` means the row is never loaded. |
| `consent` | **yes** | Must be `yes`. Anything else and the row is refused. |
| `consent_source` | no | Where the consent came from. Recorded, not validated. |
| `notes` | no | Operator notes. Never spoken on the call. |
| `scenario` | no | **Dry-run only.** Tells the fake CALL-E server how this person behaves. Ignored in live mode. |

Unknown columns are ignored. Column order does not matter. Quoted commas and CRLF line endings are
handled.

## What gets refused, and why

The sample list is 16 rows and loads 13 people:

```
registry: Row e014 skipped: no consent to be called about coverage.
registry: Row e015 skipped: phone +14*******01 already belongs to another row.
registry: Row e016 skipped: on the do-not-call list.
```

- **No consent.** Not negotiable and not overridable.
- **Duplicate phone.** Two people sharing a number would collapse into one CALL-E run and one
  transcript, and there would be no honest way to attribute the answers. The second row is refused
  rather than guessed at.
- **Do-not-call.** Someone already said no.
- **Invalid phone.** Refused rather than normalised: a number the code repaired is a number the code
  might have repaired wrong, and the cost of a wrong repair is calling a stranger about someone
  else's health coverage.

Every skip is counted in the load report and printed. Nothing is dropped silently.

## The `known_*` columns are the whole point

These carry what the state already knows, and they do two different jobs:

- **A `yes` clears the person entirely.** They are never called. In the sample, Daniel Kim
  (`known_snap_tanf=yes`) and Grace Thompson (`known_compliant=yes`) are cleared by data.
- **A `no` removes one question from the call.** Maria Gonzalez has `known_snap_tanf=no`, so she gets
  6 questions instead of 7.

Populating them well is the highest-leverage thing an agency can do with this tool. Every `yes` is a
call that never has to happen; every `no` is half a minute of someone's day given back. The 2019
Arkansas evidence says most of the people at risk are already exempt - so the more of that the data
can settle, the fewer people have to prove it over the phone.

`tribal` is loadable as a `known_*` column but is **never asked on a call**. Its `question` is `null`
in the rules file and `validateRules` fails the load if that ever changes. American Indian and Alaska
Native status is established administratively, not by a robot asking someone to declare their
ancestry over the phone.

## Priority scoring

Wave order is deadline first, then paperwork risk:

| Signal | Points |
| --- | --- |
| Prefers a language other than English | +2 |
| No online account | +2 |
| Mail to them was returned | +3 |
| Lost coverage over paperwork before | +3 |
| Under 27 | +1 |

Priority band 1 is a coverage check within 150 days, band 2 within 200, band 3 beyond. Within a
band, the highest risk score goes first.

These are not arbitrary weights. They are the signals that predicted procedural disenrollment during
the 2023-24 unwinding, when 69% of all disenrollments were procedural rather than substantive: people
the state could not reach, whose mail bounced, who had no portal account, or who had been through it
before.

## A minimal file

```csv
person_id,name,phone,locale,birth_year,check_date,consent
p001,Ana Diaz,+14155550401,es-US,1990,2027-01-31,yes
p002,John Reed,+14155550402,en-US,1984,2027-02-28,yes
```

That is enough to run. Everything else makes the calls shorter, better targeted, or unnecessary.

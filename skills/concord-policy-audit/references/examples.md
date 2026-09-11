# Examples

All branches, numbers and organisations in these examples are fictional, and
every number is a reserved 555 test number.

## The bug this design exists to prevent

The first version of the judge matched policy phrases against the transcript.
Given a rubric that forbade telling callers a prescription is required, it
ruled this answer a deviation:

```text
[DEVIATION] Northgate Pharmacy, Selby Road  (C1)
    heard    "No, you don't need a prescription for that, you can buy it at the counter."
    finding  The answer states 'need a prescription', which the policy excludes.
```

The answer is correct. The forbidden phrase occurs inside its negation.

Three of seven deviations in that run were branches that had answered
correctly. In an audit of an operator's own staff, a false deviation is worse
than a missed one: it sends a manager to correct someone who did the right
thing.

Concord now rules on a value the call extracted, and carries the quote as
evidence rather than as the thing being matched:

```json
{ "criterion_id": "C1", "value": "no",
  "quote": "No, you don't need a prescription for that, you can buy it at the counter." }
```

Two regression tests hold this: the correct answer containing the forbidden
phrase must rule `COMPLIANT`, and the genuinely wrong answer must rule
`DEVIATION`.

## Preview, the default

```bash
concord preview fixtures/example-audit.json --rubric rubrics/emergency-contraception.json
```

```text
CONCORD  /  CALL PREVIEW
==============================================================================
Audit       AU-2026-09-03
Org         Northgate Pharmacy Group
Rubric      RB-EC-01  Emergency contraception counter enquiry
Window      09:30-16:30 Europe/London
Side effect Places 4 outbound call(s) to your own branches.
Scope       Branch policy concordance. Not a staff performance review.

BRANCHES TO CALL
Branch                                Masked number     Authorization
------------------------------------------------------------------------------
Northgate Pharmacy, Selby Road        +44********01     owned-estate register 
Northgate Pharmacy, Harbour Street    +44********02     owned-estate register 
Northgate Pharmacy, Mill Court        +44********03     owned-estate register 
Northgate Pharmacy, Eastway           +44********04     owned-estate register 

SCENARIO
  A caller asks whether the branch stocks levonorgestrel 1.5 mg emergency contraception, whether a prescription is needed, how soon it should be taken, and whether an age limit applies.

QUESTIONS ASKED
  C1  Do I need a prescription for the morning-after pill?
  C2  How soon do I need to take it?
  C3  Do you have it in stock today?
  C4  Is there an age limit to buy it?

APPROVAL CHECKPOINT
No call was placed. Review this exact audit before approving it.
Token        CONCORD-CAB767FD2A6B
Live command concord run fixtures/example-audit.json --rubric rubrics/emergency-contraception.json --live --confirm CONCORD-CAB767FD2A6B
```

## The rubric compiles into the call

```bash
concord task fixtures/example-audit.json --rubric rubrics/emergency-contraception.json
```

Each criterion contributes one enum-constrained field and a quote property:

```json
{
  "type": "object",
  "required": ["reached", "prescription_required", "stated_window_hours",
               "answered_own_stock", "age_limit_claimed"],
  "properties": {
    "prescription_required": { "type": "string", "enum": ["yes", "no", "unclear"] },
    "prescription_required_quote": { "type": "string" }
  }
}
```

Remove a criterion from the rubric and it disappears from the schema. The call
cannot return a category the policy never contemplated.

## Refused live runs

The three gates are independent. A correct token does not buy a call outside
opening hours.

```bash
concord run fixtures/example-audit.json --rubric rubrics/emergency-contraception.json \
  --live --confirm WRONG-TOKEN
```

```text
Concord refused: the approval token does not match this exact audit. Run preview
again and approve the audit you actually intend to place.
```

```text
Concord refused: the call window for these branches is closed
(09:30-16:30 Europe/London, weekdays). Branches are called during their own
opening hours.
```

Both exit 2 and place no call.

## The gap register

```bash
concord judge fixtures/example-audit.json --rubric rubrics/emergency-contraception.json \
  --results fixtures/completed-audit.json
```

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

Three things to read here. A hedged answer stays `UNCLEAR` instead of being
rounded to the nearest option. An unreached branch produces four `UNCLEAR`
findings rather than vanishing. And branches are ordered by outstanding policy
work, not scored.

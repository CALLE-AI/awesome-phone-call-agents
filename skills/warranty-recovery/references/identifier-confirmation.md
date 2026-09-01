# Confirming a high-consequence identifier

An RMA number is not a fact about a conversation. It is an instruction to ship
a unit, and a single wrong digit produces a result that passes every schema
check and is still false. Schema-valid does not mean factually correct, and
this is the field where the difference costs money.

## The exchange

```text
Representative  "RMA four eight one seven one."
Agent           "Just to confirm, that is RMA four-eight-one-seven-one, correct?"
Representative  "Correct."
```

Only after that third line may the application treat
`authorization_reference = RMA-48171` as verified.

## Why extraction confidence is not enough

A confidence score describes how sure a model is that it heard a value. It says
nothing about whether the value is the one the representative meant. The two
failures that matter here — a misheard digit and a value the representative
later corrected — are exactly the cases a confident extraction gets wrong.

So confidence is not an input. The evaluation function takes no confidence
argument, and there is nothing a caller can pass that substitutes for the
read-back.

## The states

```text
ABSENT ─────────────► no reference was given
UNCONFIRMED_IDENTIFIER ─► a value exists but did not survive the checks
CONFIRMED_IDENTIFIER ───► every check passed
```

A value is promoted to `CONFIRMED_IDENTIFIER` only when all of these hold:

1. a confirmed value is present;
2. a read-back was performed and the representative responded to it;
3. a confirmation quote exists, is at least twelve characters, and is
   affirmative rather than a denial;
4. the quote is grounded in the counterparty's own turns of the transcript;
5. the confirmed value matches the expected shape for that identifier.

Anything else leaves the state at `UNCONFIRMED_IDENTIFIER`, and the business
result carries no reference at all. Losing a reference costs a call back.
Publishing a wrong one costs a shipment sent to the wrong authorization.

## Corrections

When the read-back is wrong, the representative corrects it and the corrected
value is the one that survives. The value first heard is kept beside it, marked
as corrected, so a reviewer can see the catch happened.

## What the platform does and does not do

The read-back is a property of the task text, not of the schema. A schema can
record that a read-back happened; only the instruction in the task can make it
happen. Read `calle-platform-notes.md` for what CALL-E guarantees here.

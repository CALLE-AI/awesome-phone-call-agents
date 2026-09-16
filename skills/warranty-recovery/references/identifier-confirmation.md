# Confirming a high-consequence identifier

A case, claim or credit reference is not a fact about a conversation. It is
an instruction to act against one specific record, and a single wrong digit
produces a result that passes every schema check and is still false.
Schema-valid does not mean factually correct, and this is the field where
the difference costs money.

## The exchange

```text
Representative  "Your case reference is four eight one seven one."
Agent           "Just to confirm, that is case four-eight-one-seven-one, correct?"
Representative  "Correct."
```

Only after that third line may the application treat
`confirmed_reference = CASE-48171` as verified.

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
ABSENT                    no reference was given
UNCONFIRMED_IDENTIFIER    a value exists but did not survive the checks
CONFIRMED_IDENTIFIER      every check passed
```

A value is promoted to `CONFIRMED_IDENTIFIER` only when all of these hold:

1. a confirmed value is present;
2. a read-back was performed and the representative responded to it;
3. a confirmation quote exists, is affirmative rather than a denial, and is
   not a hedge;
4. the quote is one of the counterparty's own turns, or a substring of one
   that is at least twelve characters;
5. **the confirmation binds to the exchange the identifier was read back in**;
6. the confirmed value matches the expected shape for that identifier.

Anything else leaves the state at `UNCONFIRMED_IDENTIFIER`, and the business
result carries no reference at all. Losing a reference costs a call back.
Publishing a wrong one costs a correction filed against somebody else's
case.

## Rule 5 is the one that matters

Rules 1 to 4 are what most workflows already do, and together they are not
enough. Consider a transcript that contains this, truthfully:

```text
bot   "Is now a good moment for a couple of questions?"
user  "Yes, that is fine, go ahead."
```

That is an affirmative counterparty turn, twelve characters and more, present
in the transcript, quotable. A workflow that grounds a confirmation by looking
for an affirmative turn will accept it as agreement to a number that had not
been mentioned yet.

So the confirmation is bound to an exchange rather than to the transcript as a
whole:

- the quote is located as a specific counterparty turn, by index;
- the agent turn that turn was answering is the one immediately before it,
  with no other counterparty turn in between;
- the confirmed value's digits must appear in that pair, spelled or written,
  so `"four eight one seven one"` and `"48171"` are the same digits;
- when more than one number was in play, a bare "correct" resolves nothing.
  Only the counterparty naming this number, and no other, resolves it.

A correction is treated more strictly still. When the counterparty contradicts
the read-back, the agent's turn carries the value being *rejected*, so it stops
being admissible: the corrected value has to come out of the counterparty's own
mouth in the same turn.

## Short replies

"Correct." is the most common thing a warranty desk says, and an early version
refused every one of them: a twelve-character floor, inherited from an evidence
check that guards *substring* matches against long turns, was being applied to
whole turns as well. Failing closed on the most natural confirmation in English
is not conservatism, it is a workflow that never confirms anything.

The floor now applies where it belongs, to substring matches. A short reply is
admitted when it is the complete counterparty turn, and then held to stricter
conditions than a long one, because it carries no words of its own:

- it must immediately answer an agent read-back;
- that read-back must put **exactly one** identifier in front of the
  counterparty, so a read-back naming a case number and an RMA together cannot
  be resolved by "Correct.";
- and because the same short string can occur several times in one call, every
  occurrence of it must bind to the same identifier, or none of them counts.

A long quote carries enough of its own words to locate itself. A short one does
not, so the exchange has to do all the work.

## What this refuses, and should

| Situation | Result |
| --- | --- |
| "Yes, that is fine, go ahead" to an earlier question | `IDENTIFIER_NOT_IN_EXCHANGE` |
| "Yeah, I think so" | `QUOTE_HEDGED` |
| "No, it is four eight one seven one", nothing further | `QUOTE_NEGATED` |
| "Correct." answering a read-back that named two numbers | `AMBIGUOUS_EXCHANGE` |
| "Correct." answering "am I through to the warranty desk?" | `IDENTIFIER_NOT_IN_EXCHANGE` |
| "Correct." with no read-back before it | `QUOTE_TOO_SHORT` |
| One read-back naming a case number and an RMA, answered "correct" | `AMBIGUOUS_EXCHANGE` |
| A confirmation of the case number, reused for the RMA | `IDENTIFIER_NOT_IN_EXCHANGE` |
| The agent's own read-back quoted as the confirmation | `QUOTE_NOT_IN_COUNTERPARTY_TURN` |
| No transcript at all | `TRANSCRIPT_UNAVAILABLE` |

The last row is deliberate. Without a transcript there is no way to know what
the counterparty was agreeing to, so no identifier is ever confirmed on a call
whose transcript is empty. That is a workflow that returns less, not one that
guesses.

## Corrections

When the read-back is wrong, the representative corrects it and the corrected
value is the one that survives. The value first heard is kept beside it, marked
as corrected, so a reviewer can see the catch happened.

## What the platform does and does not do

The read-back is a property of the task text, not of the schema. A schema can
record that a read-back happened; only the instruction in the task can make it
happen.

The binding above needs the agent's turns as well as the counterparty's, which
CALL-E provides: `recipients[].attempts[].transcript_turns`, each turn carrying
`speaker` as `bot`, `user` or `unknown`. Read `calle-platform-notes.md` for the
rest of what is guaranteed and what is not.

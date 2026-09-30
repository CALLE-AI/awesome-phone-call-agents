# Further patterns

The implementation detects two patterns. These are the others worth detecting, written
down so that adding one is a deliberate decision with a stated failure mode, rather than
scope that crept in.

Each is given with its signal, why it is hard, and what the call would ask.

## Unacknowledged condition

> **You:** Assuming we go with the 20% volume discount, we can commit to 500 units.
> **Them:** Great, we'll schedule delivery for the 14th.

The discount was never agreed. Both parties now believe the deal is closed, on different
terms, and it surfaces at invoicing.

**Signal:** a premise stated in one message that no later message acknowledges, while the
thread otherwise proceeds as settled.

**Why it is hard:** requires tracking which propositions have been taken up across a
whole thread, not comparing an adjacent pair. Rules will not do it well; this is the
pattern that most needs a model.

**The call asks:** whether the condition holds, not whether the deal is on.

**Highest value of anything on this list**, because the cost of being wrong is largest and
the failure is invisible for longest.

## Contradiction across messages

> Message 3: "Let's do Thursday."
> Message 7: "See you Wednesday."

**Signal:** two incompatible concrete facts — dates, quantities, names — in the same
thread, with no message reconciling them.

**Why it is tractable:** dates and numbers are extractable, and incompatibility is
checkable. This is the most mechanically feasible extension.

**The call asks:** which of the two is right.

**Watch for:** legitimate changes of plan. A later message superseding an earlier one is
not a contradiction, and treating it as one produces an irritating call about something
already settled.

## Stalled thread against a deadline

> You asked five days ago. The deadline is tomorrow. Nothing has come back.

**Signal:** an unanswered ask, a deadline in the thread, and elapsed time.

**Why it is different in kind:** there is no ambiguity to repair. This is chasing, and it
needs a separate justification — the channel did not fail, the person did not reply.
Building it changes what the product is.

**Not recommended** without deciding that deliberately.

## Pre-commitment verification

> About to sign, pay, or book. One term should be confirmed aloud first.

**Signal:** an irreversible action imminent, and a material term that exists only in
writing.

**Why it is risky:** this is exactly where mandatory AI disclosure lands worst and where
the recipient most expects a person. A disclosed AI caller verifying a rate before a loan
signing reads badly, however useful it is.

**If built:** restrict to confirming a fact already in writing, never to negotiating one,
and let the user write the question themselves.

## Ambiguous referent

> **You:** Can you review the deck and the contract?
> **Them:** I'll look at it tonight.

**Signal:** an ask naming two or more objects, and a reply with a singular pronoun.

**Why it is marginal:** usually recoverable from context, and the cost of guessing wrong
is small. A call here is disproportionate.

---

## Adding one

1. Write the failing example and the near-miss that must **not** fire, as tests, first.
   The near-miss is the harder and more important one.
2. Add the detector. Keep one finding per reply.
3. Give it its own `call_question` and result schema. Keep `required` to closed enums.
4. Decide what the draft says when it resolves — and confirm that saying nothing is
   acceptable when it does not.
5. Add it to the "when not to use" list in `SKILL.md` if it has a context where it would
   be inappropriate.

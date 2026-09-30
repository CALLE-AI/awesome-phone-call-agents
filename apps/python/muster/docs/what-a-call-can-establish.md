# What a phone call can and cannot establish about a person

A pattern for any CALL-E workflow whose result is a claim about a human being
rather than a fact about a business.

## The substitution that breaks these workflows

An agent is asked "is this person alive", "is this person still at this
address", "is this person still eligible", "did this person consent". It places
a call, somebody answers, and the answer is recorded against the person.

The call did not establish that. It established that **a human answered a
line**. Everything else was inferred, and the inference is invisible in the
result.

## Separate the three claims

Every workflow of this kind is really three claims stacked on top of each
other. Grade them separately or you will conflate them.

1. **Reachability.** Somebody answered a number on record. This is the only
   claim a call establishes on its own.
2. **Identity.** The person who answered is the subject. A call gives weak
   evidence for this and none at all against a competent impersonator.
3. **The fact you actually wanted.** Whatever the subject asserted.

A result that reports only claim 3 has silently asserted claims 1 and 2.

## Rules that follow

**A third party is never a substitute for the subject.** Somebody vouching that
the subject is well, at home, still eligible, or consenting is a claim by the
speaker, not evidence about the subject. It deserves its own outcome value.
Collapsing it into a pass is the single most common failure in this category,
and it is exactly the failure that let one family draw a pension for
thirty-two years after a death.

**Distinguish a recording from a person.** A voicemail greeting can carry the
subject's own voice and name. Ask something that did not exist before the call
began -- words minted for this call, today's weekday -- and check the answer in
code. This is the only cheap defence against replay, and it is not a defence
against a live impersonator.

**Score the challenge yourself.** Send the model the words that were heard and
score them against what was issued in your own code, with normalisation for
transcription differences. A model asked "was that correct" is being asked to
mark its own homework, and it will be generous.

**Choose prompts a co-resident would not know.** The adversary in a liveness or
eligibility check is usually not a stranger. It is somebody in the same house
who knows the date of birth, the mother's maiden name and the street. A
knowledge challenge only raises the cost of fraud; it never proves identity.

**Read the turn structure, not just the words.** `transcript_turns` carries
`offset_seconds` and a `speaker` of `bot`, `user` or `unknown`. An `unknown`
turn between a question and its answer, or a reply that arrives many seconds
late, means somebody was prompting. Use it to downgrade only. It is a
heuristic and it must never raise confidence or conclude fraud.

**Accessibility is not failure.** Deafness, aphasia, dementia, a language
mismatch and a poor line all look identical to a failed challenge. Record these
at enrolment and route those subjects to a human before dialling. A system that
cannot tell "did not answer correctly" from "could not answer" will punish
disabled people first and hardest.

## The asymmetry rule

Decide which error is worse and make only the cheap one automatic.

For a liveness check, wrongly continuing a payment costs one cycle. Wrongly
stopping one can remove somebody's only income. So a pass may close
automatically; nothing else may act. The negative outcome opens a case for a
person and changes nothing on its own.

State this in code where it cannot drift:

```python
@property
def stops_payment(self) -> bool:
    """This never stops a payment. Kept explicit so it cannot drift."""
    return False
```

## Never invert the claim

A call that fails to establish that somebody is alive has not established that
they are dead. A call that fails to reach somebody has not established that
they moved. Absence of evidence needs its own outcome value -- `UNPROVEN`, not
a negative -- and the difference must survive into whatever consumes the
result.

## What to publish alongside the result

- the grade, and the named reason it was reached
- what was asked, so the result can be re-read later
- the quoted spans that support it
- what the call did **not** establish

A result that carries its own limits can be audited. A boolean cannot.

# Referral authorization

A number that arrives on a call is a claim about the world, not a permission to
act on it. This is the boundary that separates a workflow which chases one
question from a workflow which walks outward through the phone book on its own.

## The asymmetry

The desk you were authorized to call was chosen by a person who knew the case:
they had a relationship with that organization, a reason to contact it, and
standing to ask. None of that transfers to the number that desk reads out.

The referred number is:

- **unverified.** Nobody checked that it belongs to whom the speaker said. It
  may be a wrong digit, a decommissioned line, a personal mobile, or a number
  read from a screen the speaker cannot see clearly.
- **unconsented.** The person who answers it has no relationship with the
  requester and never agreed to be called about this case.
- **unbounded.** Each hop can name another hop. Without a gate, one authorized
  call becomes an unbounded outward walk, and every leaf of it is a stranger
  hearing a stranger's business.

So the chain stops at `awaiting_approval` and a person runs `approve`. The
approval is per destination and recorded on the hop, so the evidence pack can
say who allowed each call.

## Why an unquoted referral is refused entirely

`referral_target_phone` without `referral_quote` is not a weak referral, it is
an unattributed one. The number is in the result object, but nothing in the
transcript is on record as having produced it.

That state has two causes and they are indistinguishable from the outside:
either the recipient said a number and the extraction dropped the sentence, or
the extraction supplied a number the recipient never said. The second is the
dangerous one, and no amount of confidence in the first justifies dialling on
it. The case goes to a person, who can read the transcript and decide.

The same applies in reverse. A spoken referral whose number does not normalize
to E.164 — an extension, a partial number, a name instead of a number — is
reported with the raw text preserved and never dialled. Repairing a phone
number is guessing who answers.

## Why a name is not an identity

When a referral names an organization already called but gives a different
number, that is `loop_suspected`, not `loop_detected`.

Large organizations really do have several numbers, and a genuine transfer from
a general line to a claims desk looks exactly like being sent in a circle. The
difference is not in the data, so the code does not pretend to see it. The chain
pauses, shows the person both numbers and both names, and lets them decide
whether this is the same desk refusing twice or a real handoff inward.

Loop *detection* stays on the one thing that is an identity: the normalized
E.164 destination. `+1 (555) 010-0` and `+15550100` are the same telephone, and
a chain that let punctuation hide a cycle would keep dialling forever while
every check stayed green.

## What the requester's own number is for

`requester_phone` is recorded so the chain can recognize being sent back to the
person who started it. "Have the customer call us" closes the loop as surely as
a referral between two desks, and it is the outcome most likely to be read as
progress by a workflow that is only looking for a new number to dial.

# What a phone answer proves

A verified field means one specific thing: **the agent asked, and somebody at
that number gave a usable answer.** It is worth being precise about how little
that guarantees, because the gap is where automated phone work goes wrong.

## What `verified` does not establish

**That the person knew.** Whoever answers a phone is whoever answers a phone.
A receptionist saying a part is in stock is repeating what a screen shows, or
what they remember. The gate confirms the exchange happened; it cannot confirm
the speaker was right.

**That it is still true.** An answer is a snapshot of the moment the call
ended. This is why the freshness ledger stores a timestamp with every fact and
why volatile fields carry a TTL of zero: the answer was true, and the ledger
does not pretend it stays true.

**That the right organisation answered.** A number can be reassigned,
forwarded, or wrong in the source list. Confirming the department reached is a
separate field with its own probe, and it should be one whenever misdirection
would matter.

**That the question was understood as intended.** The probe confirms the topic
was raised. It cannot confirm the phrasing meant to the listener what it meant
to whoever wrote the task.

**That a negative outcome is a verified one.** The gate credits a field when a
question was asked about it, and a fact established by absence has no question
behind it. A real call instructed to stay in an automated menu returned
`reached_human: "no"` — correct, and withheld, because nothing in the call
established it. Write probes for what somebody says, not for what fails to
happen.

## Boundaries that are not configuration

**Emergency and crisis lines are refused.** `+1911`, `+1988`, `+112` and `+999`
prefixes are rejected before dialing and there is no setting that permits them.
A phone agent that can reach an emergency line by misconfiguration eventually
will.

**Consequential decisions are not the callee's to make on a call.** Gather an
answer; do not accept an offer, authorise a payment, confirm a legal position,
or communicate a medical instruction. The commitment boundary sits with a
person who has the authority and the context.

**Do not use a phone answer as identity proof.** Reaching a number establishes
that the number was reachable. It does not establish who spoke.

## Handling what comes back

**A refusal is a valid outcome.** An organisation declining to confirm
something over the phone is often correct, frequently required by their own
policy, and is not a failure to retry around.

**An unknown outcome is reconciled, never re-dialed.** A timeout does not mean
no call happened — CALL-E's own tracker records a call that timed out client
side and then dialed and completed. Retrying places a second real call.

**Withheld beats guessed.** Every verdict except `verified` yields `null`. That
is deliberate: a missing value is a visible gap, while a wrong value is
invisible until it causes harm.

## Data

Numbers are masked in every output, including echoed metadata and error
payloads. Transcripts contain a real conversation with a real person: the
traversal probe writes them under `probe-output/`, which is gitignored and must
stay that way. Do not paste raw transcripts into issues, pull requests, or
chat logs.

Credentials are read from the environment, used server side, and never written
to any output file.

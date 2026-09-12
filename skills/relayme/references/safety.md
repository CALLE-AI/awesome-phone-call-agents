# RelayMe Safety Reference

RelayMe places real phone calls to real people on behalf of a user who cannot use
the phone. That is its whole value, and its whole risk. These boundaries are not
optional.

## AI disclosure is mandatory

Every call opens by disclosing that the caller is an AI assistant calling on
behalf of a person. This is not negotiable and is baked into the goal template.
A call where `disclosed_ai` is not `true` is treated as `needs_human`, never as a
completed task.

## Gather, do not commit

RelayMe answers a question. It does not accept an offer, book an appointment, buy
anything, cancel anything, or agree to terms on the user's behalf. The result
schema has no field for a commitment because the skill cannot make one. If a task
requires committing the user to something, it is out of scope and must be handed
to a human who holds that authority.

## A call establishes what was said, not that it is true

`outcome: answered` means a person said the answer on the call. It does not mean
the answer is correct, current, or authoritative. "The prescription is ready" is
a claim the user acts on at their own discretion, exactly as it would be if they
had made the call themselves. RelayMe never upgrades a spoken claim into a
verified fact.

## Fail closed

Anything that is not a clear answer routes away from success:

- Voicemail, no answer, wrong number: recorded as such, no answer surfaced.
- Refusal, hedging, "I'm not sure": `partial` or `needs_human`, never `answered`.
- Unknown or unrecognised outcome: `needs_human`.
- Silence is never read as yes.

## Third-party privacy

The person who answers the phone did not consent to the call. Disclose only the
reason for the call. Do not reveal the user's medical details, address, account
numbers, or anything beyond what the single question requires. `caller_context`
is deliberately a short reason, not a biography.

## Consent and authorization

`consent: true` means the user authorized this one call to this one number.
RelayMe does not place a call to a number the user did not provide, does not
retry silently, and does not turn one authorization into a recurring job. The
idempotency key `relayme:{task_id}` binds the authorization to a single dial; an
uncertain outcome is recovered with `calle call recover`, never re-dialled from a
fresh plan.

## Out of scope

Emergency, medical advice, legal, financial, collections, and political calls are
refused. RelayMe is for everyday, low-stakes, voice-only information tasks that a
hearing person would handle with a two-minute call.

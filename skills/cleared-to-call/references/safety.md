# Safety Reference

An outbound collection call is a real-world side effect with a legal
consequence attached. In the United States, a non-compliant call carries
statutory damages per call, and the operator placing it is liable - not the
model, not the software.

That asymmetry is the whole design. This skill refuses far more readily than it
proceeds.

## Explicit Intent

Place a call only when the operator has explicitly asked for this batch or this
account to be called.

Never place a call to test the gate, warm up a connection, verify credentials,
or demonstrate that the workflow runs. Dry run proves all of that without
dialing anyone.

Never place a call to a number the operator has not confirmed they are
authorized to call.

## Never Guess

The gate blocks rather than infers. Specifically, do not infer:

- **timezone** from the phone number, area code, country code, locale, IP
  address, UTC offset, or server time
- **consent** from the existence of an account, a prior payment, a past call, or
  an unrelated agreement
- **a phone number** from a name, an address, or a similar record
- **an amount** or **a due date** that is not in the record

A missing field is a block, and the block is the correct answer. Report exactly
which field is missing so a human can fix the record.

## Phone Numbers

Use E.164 only, for example `+15550101234`.

Mask numbers in every summary, log line, audit entry, error message, and status
report. The mask keeps the first two and last four characters:
`+15550101234` becomes `+1******1234`.

The full number appears in exactly two places: the suppression list, which must
match real dial targets, and the dial payload handed to the provider. It does
not belong in an audit log, a commit message, an issue comment, a screenshot,
or a demo recording.

Documentation, fixtures, and tests use reserved fictional numbers only.

## Opt-Out Handling

An opt-out is immediate, unconditional, and permanent.

When a recipient revokes consent:

- acknowledge once, briefly
- end the call
- do not ask why
- do not offer alternatives, a callback, a different time, or a smaller payment
- do not attempt to "confirm" the opt-out by asking again
- write the number to the suppression list
- record the outcome as `opt_out`

Re-read the transcript after every call, even one that ended normally. The
agent's in-call behavior is not evidence that the opt-out was honored: the
post-call check is what actually suppresses the number, and it must run whether
or not the agent claims to have handled it.

A suppressed number stays suppressed. Removing an entry is a deliberate,
human-authorized act on the record, never a step in a calling workflow.

## Detection Limits

The revocation detector matches a list of phrases. It is literal, auditable, and
incomplete. It will not catch every possible way a person can ask to be left
alone - sarcasm, indirect phrasing, another language, or a phrasing nobody
anticipated.

Two things follow, and both belong in any operator briefing:

- the phrase list is a floor, not a ceiling; the call task must also instruct the
  agent to honor an opt-out it understands but that is not on the list
- when the agent reports an opt-out that the detector did not match, trust the
  agent and suppress the number

Never narrow the phrase list to make a batch complete. Add to it.

## Sensitive Content

A collection call is logistics only.

Do not provide, in the call or in any summary: financial advice, credit advice,
legal advice, settlement negotiation, hardship assessment, or any statement
about consequences of non-payment - no credit reporting, no legal action, no
account closure, no fees.

Do not pressure, repeat demands, or continue after a refusal.

If the recipient disputes the balance, acknowledge the dispute, record it, and
end the call. Do not argue and do not re-assert the balance.

If the recipient describes an emergency or a crisis, end the collection purpose
of the call and direct them to appropriate local services.

## Credentials

Never expose or log API keys, OAuth tokens, access tokens, refresh tokens,
confirmation tokens, session cookies, auth callback URLs, or provider
credentials.

Never ask an operator to paste a credential into a chat message.

The gate itself needs no credentials. Only the call route does, which is a good
reason to keep them separate.

## Audit Integrity

The audit log is append-only, and each entry hashes the one before it.

- never rewrite, delete, or reorder an entry
- never backdate a timestamp
- never write an allow entry for a call that was blocked, or the reverse
- verify the chain after every batch and report the result

If verification fails, say so immediately and prominently. A broken chain means
the log can no longer prove anything, which is a more serious problem than a
failed call.

## Batch Boundaries

- one call attempt per account per run
- no automatic retries after a refusal, a dispute, or an opt-out
- no hidden schedules and no recurring jobs created as a side effect
- a blocked account is never passed to the caller, under any flag or override
- a run in which every account is blocked is a correct run, and should be
  reported as one

## Boundaries Of This Skill

This skill checks the five rules in `references/policy.md` under US federal law.
It does not check state-level rules, call frequency caps, reassigned number
databases, litigation-risk suppression, or any non-US regime. Do not describe it
as making a calling program compliant. It enforces five specific preconditions,
proves it did, and refuses when it cannot.

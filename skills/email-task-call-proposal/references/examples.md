# Examples

## Safe

- A studio coordinator reviews a source-linked proposal to move a Thursday
  appointment after the phone-only business requests a call.
- A host previews the proposal with the fictional number `+14155550101` and
  does not dial until the user approves the exact goal.
- A confirmed call result is shown to the user while the calendar update stays
  a separate pending proposal.

## Unsafe

- Calling a scraped lead list or guessing a number from a person's name.
- Treating voicemail, silence, or an unclear transcript as confirmation.
- Writing a Google Calendar event directly from `requestedNewTime` without a
  human approval step.
- Putting an API key or private transcript in an intake file, repository, log,
  or demo recording.
- Retrying automatically after a timeout or ambiguous CALL-E outcome.

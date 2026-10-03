# Examples

## Safe
- Calling a policyholder who submitted a first notice of loss online and consented to an automated follow-up call to gather structured incident details.
- Previewing the call task text in dry-run mode against fictional fixture data without placing a real call.
- Routing to human review when the claimant declines to provide a policy number or the outcome is `voicemail`.
- Using `+15550001234` (NANP reserved test number) in all fixtures and examples.

## Unsafe
- Asking the claimant to confirm coverage applicability, claim approval status, or settlement amounts on the call.
- Collecting SSN, payment details, or banking information under any circumstances.
- Treating a `voicemail` or ambiguous outcome as a completed intake and proceeding to downstream steps.
- Retrying automatically after a `refused` or `unclear` outcome — those require human review.
- Using a real person's phone number in fixtures or test data.

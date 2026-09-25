# Examples

## Safe
- Calling a policyholder who filed a claim online and consented to automated follow-up to collect their incident description, date, estimated damage, and policy number.
- Running `npm run dry-run` with fictional fixture data to preview both call task texts without placing any real calls.
- Call 2 notifying a claimant that their claim was received and an adjuster will follow up within 2-3 business days.
- Routing to human review when Call 1 returns `voicemail` and blocking Call 2 from running.
- Using `+15550001234` (NANP reserved test number) in all fixtures and examples.

## Unsafe
- Asking the claimant to confirm a policy number, coverage type, or account details over the phone — CALL-E safety policy blocks this.
- Treating a `voicemail` or `no_answer` outcome as completed and proceeding to Call 2.
- Retrying automatically when outcome is `unclear` or `refused` — those always go to human review.
- Running `--live` without an explicit `CALLE_API_KEY` set in the environment.
- Logging or storing a phone number in full — always mask to first 4 characters plus asterisks.
- Using a real person's phone number in fixtures, examples, or test data.

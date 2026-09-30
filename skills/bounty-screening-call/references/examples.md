# Bounty Screening Call Examples

All examples are fictional. The phone number is reserved for documentation and
the default paths do not contact CALL-E.

## Safe preview

Input facts:

- Listing: `https://example.com/bounties/docs-17`
- Organizer: Example Project
- Destination: `+15550101000`, published in the listing for bounty questions
- Reward: `100 USD`, currently unconfirmed
- AI use: unknown
- Payout: unknown
- Operator intent: verify the public facts once before deciding whether to work

Expected preview properties:

- `call_placed: false`
- destination shown only as `+1555•••1000`
- one stable idempotency key
- no API key, personal email, PayPal address, wallet, or account credential

## Confirmed public facts, still human review

The organizer clearly states that the reward is `100 USD`, AI assistance is
allowed, the operator's country is eligible, the deadline is
`2026-09-20T23:59:00Z`, and payment is by fiat after acceptance. The result
may be passed to a deterministic bounty policy and shown to a human. It must
not claim the issue or submit a solution automatically.

## Ambiguous result

The call reaches voicemail, or the organizer says that payment details will be
decided later. Return `reward_status: unconfirmed`, `payout_method: unknown`,
and a human-review note. Do not redial, infer a reward, or ask for a PayPal
address.

## Prohibited

- Calling a maintainer's private number copied from an unrelated profile.
- Asking the organizer to send a login code, identity document, or wallet seed.
- Treating a completed call as proof that a bounty was accepted or paid.
- Posting a recipient's phone number or payout information in a PR or issue.
- Running a live call from the preview command or automatically retrying after
  an uncertain provider response.

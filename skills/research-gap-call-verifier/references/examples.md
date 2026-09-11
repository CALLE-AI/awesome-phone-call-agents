# Examples

All organizations and phone numbers below are fictional. `+1 202-555-0123` and `+1 202-555-0124` are reserved NANP fictional-use numbers.

## Appropriate Request

> I found two Chicago venues with cited capacity information, but neither site confirms Friday availability or the current food and beverage minimum. Prepare calls to their published business lines so I can review the questions.

Build a no-call preview from `assets/fictional-research.json`. Show both masked recipients, the AI disclosure, three unresolved questions, and a total of two possible calls. Stop for approval. Do not imply that asking for research also approves dialing.

## Prohibited Request

> Call every venue in the city repeatedly and pretend to be a wedding planner so they give me unpublished discounts.

Refuse. The request combines deception, bulk unsolicited outreach, repeated calls, and an attempt to obtain non-public terms. Do not build a plan and do not place a call.

## Honest Reconciliation

The fictional result fixture demonstrates three different outcomes:

- The cited seating capacity remains `sourced`.
- A direct answer about Friday availability becomes `confirmed_by_phone` and retains the callee quote.
- A refused minimum-spend answer becomes `not_established`.
- The failed call to the second venue becomes `not_reached`.

Report "one of three call questions confirmed," not "two venues verified." The denominator is part of the evidence.

## Changed Recipient

If the user edits `+12025550123` to another number after preview, rebuild the plan and request approval again. Never copy the old approval or idempotency key onto the changed recipient.

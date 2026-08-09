# Privacy and safety model

## Data minimization

RecallReady needs only:

- an official public recall ID;
- a model/product identifier;
- an optional non-sensitive date or batch code; and
- a destination phone number drawn from the official record or supplied for an explicitly authorized demo.

The browser receives only the final four digits of the destination. The server keeps the full number in volatile memory for the preview lifetime. RecallReady does not persist phone numbers or transcripts.

## Call boundaries

Every task requires an automated-assistant disclosure and prohibits:

- names, addresses, emails, accounts, orders, payment data, passwords, health information, and full serial numbers;
- purchases or any other financial commitment;
- acceptance of legal terms;
- scheduling a technician or appointment;
- declaring a product safe;
- medical, legal, or emergency advice.

If a hotline requires sensitive or binding information, the structured result must set `needs_human=true` and return the smallest safe next step.

## Consent and side effects

No call is created during search or preview. The user must inspect a single-use preview and type `CALL NOW`. Live calls are also locked at deployment level unless `LIVE_CALLS_ENABLED=true`.

Demo numbers require an attestation that the operator owns the number or has explicit permission for that one test call. Production calls are restricted to the consumer-contact number published in the authoritative recall record.

## Fail-closed behavior

- Missing official or authorized-demo phone → refuse.
- Missing model identifier → refuse.
- Demo number without consent → refuse.
- Expired, unknown, or already-used preview → refuse.
- Wrong approval phrase → refuse.
- Live call without server opt-in or API key → refuse.
- Ambiguous conversation → `unknown` or `needs_more_information`, never “safe.”

## Threats explicitly not solved

- CALL-E and telephone carriers may retain service-side operational records.
- A caller may provide inaccurate information.
- A recall remedy can change after the call.
- Caller ID, the phone network, and a spoken case reference do not prove identity.
- RecallReady is not a safety authority and cannot determine that a product is safe.

The user must follow the official recall notice and the recalling firm's current instructions.

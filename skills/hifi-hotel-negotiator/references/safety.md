# Safety Reference

Phone-call workflows have real-world side effects. `hifi-hotel-negotiator` enforces explicit user consent, strict budget ceilings, and zero disclosure of sensitive payment credentials.

## Explicit Intent & User Authorization

- Place calls only when explicitly initiated by the user through the dashboard or client trigger.
- Never place unsolicited automated bulk calls.
- Require all core reservation parameters (`check_in`, `check_out`, `adults`, `hotel_phone`) before dialing.
- If any required parameter is missing, prompt the user rather than guessing or inferring.

## Phone Numbers & Privacy

- Use E.164 phone numbers only.
- In public logs, documentation, and user interfaces, mask destination numbers (e.g., `+1******1234`).
- Documentation examples must only use reserved fictional numbers (such as `+15550101234`).
- Never leak private hotel staff or traveler phone numbers in git commits, issues, or public telemetry.

## Financial & Credential Safety

- **Zero Payment Disclosure**: The voice agent must never ask for, transmit, or disclose credit card numbers, CVVs, bank details, or OTPs over the phone.
- **Budget Ceiling**: The agent must never accept or negotiate any quote exceeding the traveler's configured `budget_cap`.
- **Pre-Payment Hold**: If a hotel requires immediate non-refundable card pre-payment to secure a quote, the agent must log the policy, terminate the negotiation safely, and flag the offer for manual traveler review.

## Disclosure & Truthfulness

- Disclose AI identity clearly at the beginning of the call (e.g., *"I'm an AI travel concierge calling on behalf of a guest..."*).
- Never fabricate availability, prices, or policies. If a detail was not explicitly confirmed by the front desk, record it as `null` instead of guessing.
- Do not mark a reservation as confirmed unless the hotel explicitly issues a valid booking confirmation reference number.

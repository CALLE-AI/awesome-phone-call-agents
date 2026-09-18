# Safety

## Phone-call safety rules

PhoneScout places real outbound phone calls. Every call must follow these rules:

- **Explicit user intent.** Never dial without the user confirming the plan.
- **E.164 phone numbers.** All phone numbers must include country code.
- **Mask phone numbers in summaries.** When presenting results to the user, show partial numbers (e.g. +1 212...0365).
- **No credential exposure.** API keys must never appear in task text, transcripts, or user-facing output.
- **No hidden recurring schedules.** PhoneScout is one-shot research. It does not create cron jobs or recurring calls.
- **No duplicate calls.** Idempotency is handled by the CALL-E API layer.
- **Clear cancellation.** The user can stop a research run at any time. Partial results are returned immediately.
- **Information gathering only.** PhoneScout calls are read-only research feelers. Do not make bookings, reservations, or financial commitments during a research call.
- **Medical / legal / financial boundaries.** PhoneScout can research medical providers and collect pricing/availability, but never makes medical decisions, provides legal advice, or handles financial transactions.

## Research call protocol

Every PhoneScout call must:

1. Open with transparency: "Hi, I'm calling to ask a few questions about [service] — this is just for research, I'm not making a booking today."
2. Ask the research questions while the person is engaged.
3. Close with: "Thank you — as I mentioned, this is just research. My client will call back if they decide to book."
4. Never negotiate a booking, hold a table/slot, or provide a callback number for a reservation.

## Data handling

PhoneScout does not persist call results to disk. Results are printed to stdout and discarded when the session ends. Transcripts and evidence are present in the agent's chat response only. No call recordings are stored.
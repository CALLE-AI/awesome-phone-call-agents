# Safety

## Phone-call safety rules

call-e-booking places real outbound phone calls that can result in confirmed reservations.
Every call must follow these rules:

- **Explicit user intent.** Never dial without `--confirm`. The plan must be shown and approved first.
- **E.164 phone numbers.** All phone numbers must include country code.
- **Mask phone numbers in summaries.** When presenting results, show partial numbers.
- **No credential exposure.** API keys must never appear in task text, metadata, or user-facing output.
- **No hidden recurring schedules.** call-e-booking is one-shot. It does not create cron jobs or recurring calls.
- **No duplicate bookings.** Idempotency keys are derived from the request. Re-running the identical command within CALL-E's window returns the same call.
- **Clear cancellation.** Bookings can be aborted before `--confirm`. After confirmation, cancellation is handled by the business's own policy.
- **Medical / legal / financial boundaries.** call-e-booking can book medical appointments but never provides medical advice, diagnoses, or treatment recommendations. Financial transactions are handled by the business, not by the agent.
- **Calendar writes are verified.** After a successful booking, the agent must confirm the calendar event was created before reporting success.

## Booking safety gates

1. **Plan preview.** `calle_booking.py plan` shows the exact task before dialing.
2. **Confirmation gate.** `calle_booking.py book --confirm` requires the flag. Without it, the script exits with a dry-run note.
3. **Real call reminder.** The agent must explicitly tell the user: "This will place a real outbound call."
4. **Medical calls are higher risk** — strict IVRs, hold queues, privacy/consent rules.

## Data handling

call-e-booking returns structured results (confirmation number, date, time) to the agent. Calendar events are written via the google-workspace skill. No call recordings are stored by the script. Transcripts and evidence are available through the CALL-E API and dashboard.
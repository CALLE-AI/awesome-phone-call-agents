# Examples

## Safe

- A studio coordinator confirms Thursday 10:00 with someone who booked online and asked to be called.
- Mocking `fixtures/conversation_reschedule.json` to show a 14:00 request without dialing.
- Previewing a masked plan in a demo video.

## Unsafe

- Calling a scraped lead list.
- Treating voicemail as a yes.
- Writing a Google Calendar event from `requested_time` without a human.
- Putting an API key in the intake JSON or on screen during a recording.
- Retrying automatically when CALL-E returns `unknown`.

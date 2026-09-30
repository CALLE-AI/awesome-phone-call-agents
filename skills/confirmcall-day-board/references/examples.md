# Examples

## Safe

- A tutoring desk runs the Thursday fixture board and reviews Maya confirmed / Jordan reschedule / Eli declined before touching the calendar.
- Previewing masked CALL-E scripts with `npm run preview` for a demo video.
- A clinic coordinator confirms only bookings that already exist and asked to be called.

## Unsafe

- Calling a scraped lead list or marketing list.
- Treating voicemail as a yes.
- Writing Google Calendar events from `requested_time` without a human.
- Putting an API key on screen during a recording.
- Automatic retries when CALL-E returns unknown or no_answer.

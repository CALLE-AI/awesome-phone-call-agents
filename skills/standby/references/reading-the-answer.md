# Reading the answer

Deliberately lopsided. **Anything that is not a clear yes is not a yes.**

A false acceptance ends the cascade and leaves the shift unfilled with everyone
else already stood down — the most expensive mistake this skill can make. A
false decline costs one extra phone call.

## Order of trust

1. **The structured extraction**, when the call returned one. `decision` of
   `accept` / `decline` / `callback`, plus `arrives_at` or `callback_at`.
2. **The call status**, for anything that never became a conversation:
   `no_answer`, `busy`, `voicemail` → no answer. `failed`, `invalid_number`,
   `rejected` → failed.
3. **The transcript**, only to classify. Never to invent a time.

## The trap

Check for refusal *before* agreement.

> "Sorry, I can't take it today."

contains "can". A naive yes-check reads that as an acceptance, stops the
cascade, and the station opens one short. Refusal markers are tested first, in
both the shift's language and English.

## Unparsable

If the transcript exists but says nothing decidable — half a sentence, background
noise, a hang-up mid-word — record it as a decline **and mark it unparsed**, so
the log distinguishes "they said no" from "we could not tell". Never let an
unparsed call become an acceptance.

## No stated arrival time

An acceptance without a time is still an acceptance. Record the arrival as
unknown rather than assuming the shift start; the supervisor can ask.

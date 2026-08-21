# An Offered Slot is matched against the envelope, never resolved into a date

"Tuesday the 26th" is not a date. Turning it into `2026-08-26` needs a year, a month,
and a rule for what "Tuesday" means when today is a Friday — three resolutions, each
silent when wrong, and a wrong one books a Patient into a slot nobody offered.

So we do not resolve it. The Booking Envelope is already a short range of days, which
lets us ask the smaller question: does the reception turn name a day that exists inside
the envelope? Day-of-month and weekday tokens are read from the turn the model anchored
its claim to, then matched against the dates the envelope actually spans. An envelope of
two weeks holds one 26th, so "the 26th" resolves against it without a calendar. It holds
two Tuesdays, so a weekday with no day-of-month is ambiguous and flags rather than
taking the nearer one.

The same move settles the clock. A Practice books between about 08:00 and 18:30, so a
bare "ten past nine" is 09:10 and "half four" is 16:30 — not because we guessed the half
of the day, but because the other reading is not something a surgery offers. Practice
Hours are the constraint doing the work, not an inference. A time outside them is
flagged rather than assumed.

A turn that names no day we can read is a flag, never a guess. That is the rule Carried
Words already follow: no span, no Release.

## Consequences

The matcher cannot serve an envelope spanning more than a month, because two 26ths would
then fall inside it and the ambiguity we avoided returns. That is a constraint on the
Release form rather than a defect: a Reviewer authorising five weeks has not narrowed
anything. `holdfor/extract.py:35` already anchors a model claim to the turn it came from;
the slot match reuses that discipline instead of inventing a second one.

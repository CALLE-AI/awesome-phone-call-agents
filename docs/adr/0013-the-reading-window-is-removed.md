# The Reading Window is removed

No Check-in Call was placed outside weekdays 10:00 to 16:00. The rule was bound to
human availability rather than to the Patient's: 10:00 because before that she may
still be getting up, 16:00 because a Review Item flagged after it sits unread
overnight, and the whole point was that a call nobody can catch the result of should
not be made. It had no override, deliberately, because an override would have deleted
the reason.

It is gone. `window.open_at` is deleted and `checkin.preflight` no longer reads the
clock. Two of the three gates remain: recorded consent, and the Due Day.

The reason is a demonstration, not a clinical finding. This is hackathon work with a
video to record and a team spread across time zones, and the window refused every call
outside a six-hour weekday slot — which is when the people playing the Patient and
reception are actually free. `HOLDFOR_NOW` existed to move the clock the rule was
applied to, and using it meant every take was filmed against a board carrying a banner
saying the clock was a lie. Removing the rule is more honest than demonstrating the
system through a setting that exists to work around it.

## What is kept

The **Due Day** carries what survives. Day 3 after the appointment, stepped forward off
a weekend and never back, and no call on any other day. So no call is placed at the
weekend even now — not because the hour is refused, but because `window.due_date` never
lands on one. The day-3 reasoning is clinical and unaffected: 48 to 72 hours is when a
post-procedure problem shows.

Consent is untouched, and is still asked first, so a Patient who withheld it is refused
for `no_consent` and never for a reason that implies some better time.

The refusal reason `outside_reading_window` becomes `not_due_today`, because a reason
string naming a rule that no longer exists would send a Reviewer looking for a clock.

## Consequences

The guarantee this bought is gone, and nothing replaces it. A Check-in Call may now be
placed at 22:00, and if it comes back with a red flag on it, the Review Item sits on the
board until somebody looks. ADR 0005 puts Stop Condition enforcement in two layers and
neither is a person; the layer that was a person was this window, and it has been
removed for the convenience of the people building it rather than for the Patient's.

Anyone running this for real should put it back, or replace it with something that pages
a human. The board shows a flagged item and does nothing else about it — silence on a
screen nobody is watching is the failure this rule existed to prevent, and it is now
reachable.

Nothing stops a call at an hour that would be unkind to an 82-year-old, either. The
prompt-layer safety and the consent gate say nothing about the time of day, so the
protection is now entirely that a human presses the button, on the one day it is
allowed, at an hour they chose.

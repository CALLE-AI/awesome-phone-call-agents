# Examples

Every number below is inside a range the German network operators keep
permanently unassigned for use in media — `+49 176 040690 00` to `99`. None of
them can ring. See `references/safety.md` for the full list of withheld ranges
and where they come from.

## A no-show at 05:12

> "Someone's called in sick for the 6am care shift at Haus Lindenhof. Ring the
> standby list until someone can cover it."

The skill asks for what it will not guess: the timezone, the roster, and
confirmation that the roster is a consented standby list. Then:

```
04:40  skipped   Bruno Feld       opted out of standby calls
04:41  skipped   Farid Haddad     no number on file
04:43  calling   Aylin Kaya       +49 176 040690 01
04:44  no answer Aylin Kaya       queued for the second sweep
04:45  calling   Carla Mensah
04:46  declined  Carla Mensah     "Sorry, I can't take it today."
04:47  calling   Dario Petrov
04:48  callback  Dario Petrov     asked to be rung back at 05:05
04:49  calling   Eva Lindqvist
04:50  declined  Eva Lindqvist
04:52  calling   Greta Sommer
04:53  accepted  Greta Sommer     arriving 05:50
       FILLED — 5 calls placed, 4 people stood down and never rung
```

Note what did **not** happen: Aylin was not redialled straight away, Dario's
callback never came due because the shift filled first, and the four people
after Greta were never disturbed.

## Everyone is asleep

Scenario `second-sweep`. Seven no-answers on the first pass, then the second
sweep reaches someone who has since seen the missed call.

The retry pass earns its place here: an immediate redial would have rung the
first person twice inside ninety seconds and still reached nobody.

## A call nobody could read

Someone picks up, the question is asked, and the line drops mid-sentence:

```
04:47  calling   Dario Petrov
04:48  HELD      Dario Petrov     the reply was not intelligible and the call
                                  ended before an answer was given
       Nobody further down the list is rung until a person resolves this.
```

The cascade **stops here.** It does not score the call as a decline and move to
Eva. Two people are exposed by that shortcut at once: Dario, who may well have
been saying yes into a dropping line and is now silently passed over, and Eva,
who gets rung about a shift that might already be taken. Neither shows up as an
error anywhere afterwards — the log would say "declined" and the morning would
look ordinary.

So it waits. A supervisor listens to the call and records what it meant, by
name:

```
04:51  reconciled  Dario Petrov   "declined" — recorded by S. Hoffmann
04:52  calling     Eva Lindqvist
```

The cascade then carries on from exactly where it stopped. If the supervisor
records "accepted" instead, it stops for good and stands the rest of the list
down, exactly as if the classifier had read the acceptance itself.

Three properties of this, all of them deliberate:

- **The hold is enforced, not advised.** Attempting to start any call while one
  is held raises an error, the same way a second concurrent call does.
- **The resolution carries a name.** "Reconciled by a human" is not an audit
  trail. Who decided, and when, is recorded on the attempt.
- **A hold cannot resolve into another hold.** It has to become a real outcome.

## Nobody can take it

```
       EXHAUSTED — 12 calls placed, nobody available
```

The skill says so and stops. It does not loop, does not widen the list, and does
not call anyone twice. A human decides what happens to the shift.

## An acceptance that arrives late

> "Yeah, I can do it, I'd be there about eight."

For a 06:00 shift this is reported as:

```
       FILLED by Jonas Weber, arriving 08:00.
       That is 120 minutes into the shift - the gap is covered, not closed.
```

The cascade still stops, because a second person turning up mid-shift is worse.
But it does not report a clean fill.

## Quiet hours

At 23:00 for a shift two days away, the skill does not dial and says why. At
04:40 for a 06:00 shift it dials, because the shift is inside the ninety-minute
window where not calling is the worse outcome.

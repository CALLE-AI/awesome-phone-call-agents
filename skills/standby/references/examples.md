# Examples

All numbers below are in reserved test ranges and cannot reach a real person.

## A no-show at 05:12

> "Someone's called in sick for the 6am care shift at Haus Lindenhof. Ring the
> standby list until someone can cover it."

The skill asks for what it will not guess: the timezone, the roster, and
confirmation that the roster is a consented standby list. Then:

```
04:40  skipped   Bruno Feld       opted out of standby calls
04:41  skipped   Farid Haddad     no number on file
04:43  calling   Aylin Kaya       +49 152 000 00001
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

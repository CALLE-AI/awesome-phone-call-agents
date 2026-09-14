# The money, in full

Three derivations, in the order a district asks for them: why the headline figure is a
ceiling and not a saving, what the safeguarding rule costs at the grade it lands on, and
where the saving turns into a loss.
## The one line, if you only read one

**Quote $0.35 a call.** It is the smallest of the figures here, it is the one a reader
reproduces with one command, and it is the demo run's. **Plan against $0.70 a call as a
cost**, which is what the same arithmetic gives when every escalated call is priced as a
callback rather than only the ones this software says it created. Which of the two a district
is living in is what the first week of a pilot measures, and nothing published before that
week can settle it.

**And the price side moved under all of it.** These calls were billed at $0.05 each across
the month of usage one account had on 2026-09-04. CALL-E now labels those rows `Legacy
pricing` on the panel itself. The nineteen calls billed since, from the same account to the
same country, ran $0.06 to $1.36 each, metered rather than flat, and average $0.40. Both
readings are in [`evidence/observed-price.json`](../evidence/observed-price.json) with the
three things neither can settle, and §10 of
[`CALLE_FEEDBACK_REPORT.md`](../CALLE_FEEDBACK_REPORT.md) shows the balance closing on both.
CALL-E publishes no price, so a district cannot look either up. Nothing below has been
re-derived against the newer reading, because the ceilings are desk time and do not depend
on what the call costs; what depends on it is whether the ceiling is worth paying, and on
2026-09-11 the answer got worse by roughly ten times.

That line is here because a district buyer read this entry and counted four per-call figures
across three surfaces without being told which one it stands behind. Every one of them is
defined and sourced below. Being defined is not the same as being usable, and a reader who
has to assemble the ranking themselves will pick the largest number or none of them.


This was three sections of the README. Two readers who came to the entry as district buyers
said they stopped reading in exactly this stretch, which is fair: it sits after the table
that already gives the three figures, and a reader who has the figures does not need the
derivation until they want to argue with it. It is a page now so it can be opened rather
than cloned, and so the README can hand a reader the conclusion and get out of the way.

Everything here is printed by the program. `python tools/money_across_runs.py` produces every
figure from one piece of arithmetic, and `python -m firstbell --work-file
examples/absences.csv` prints the derivation in total dollars at the foot of any run.

## Why the last number is a ceiling and not a saving

CALL-E publishes no price per call, so any cost this app printed would be invented. It
reports the other side of the equation instead: the price above which it stops being
cheaper than a person.

Two things about that arithmetic are worth knowing beyond what the run prints. Attempts
still open are charged and never credited, because a call that reached nobody useful still
leaves the work on somebody's desk, and counting it as saved would be the same error as
counting a null result as an answer. And the [sourced wage](https://www.bls.gov/ooh/office-and-administrative-support/secretaries-and-administrative-assistants.htm)
understates the case in both directions it can: dividing by 2,080 hours prices a ten-month
school contract as cheaper per hour than it is, and a salary excludes the benefits paid on
top of it. An assumption nobody can check should point at its author, not away.

The one unknown left is the one a school office can answer better than anybody else, which
is why it is left to them: how long one of these calls takes its own staff. At three
minutes an attempt this run is cheaper than the desk below **$0.59 a call**, on a median of
**$48,980** for secretaries and administrative assistants in educational services. Change
the minutes, or pass `--staff-annual`, and the ceiling moves with it.

## The work this run adds, at the grade it lands on

That ceiling was too high, and a district operations director reading the run found the
reason before any test did. The arithmetic priced the labour taken off the desk and priced
the labour it creates at nothing.

A call the safeguarding rule holds open is work that did not exist before the call. On the
committed run one of the five answered calls is that: schema-valid, complete, and not
closed, so without the rule it would have been filed as done and nobody would have rung
back. It goes to the designated safeguarding lead rather than to the office desk, and that
post costs more. The median for school and career counselors and advisors in local
elementary and secondary schools is **$77,800**, which is 1.59 times the desk wage, and
counsellors are the cheaper of the two posts a district staffs the role with.

So the run prints both halves and says which one the first ignores:

```
  work this run adds
    net-new escalations 1 of 5 answered call(s) would have closed
                        without the safeguarding rule, so they are work
                        that did not exist before this run
    added               $0.08 per billed attempt, for every minute one
                        callback takes the safeguarding lead
    ceiling after it    $0.35 a call, at 3 minutes for each of the two
                        (from $0.59: the line above ignores this)
                        4 attempt(s) removed at 3 minutes is $4.71 of desk time,
                        less 1 callback(s) at 3 minutes, $1.87 of counsellor time,
                        over the 8 attempt(s) billed
```

**$0.35, not $0.59.** That is this project's own headline number cut by two fifths by its
own arithmetic, and it is the honest one. Pass `--escalation-annual` to price the post at
your district's grade.

The three lines under it are the same figure in total dollars, because two rates and a
subtraction is a thing a reader has to trust and $4.71 less $1.87 over eight attempts is a
thing they can check. They are also there because the subtraction was wrong once: the cost
was divided by answered calls and the saving by billed attempts, which is money taken off
money on a different denominator. A district finance office found it. Correcting it moved
the ceiling from $0.21 to $0.35, in this project's favour, which is the direction that
makes a correction worth printing rather than quietly making.

Two things follow that a school should hear before a vendor tells them otherwise. The
net-new rate is what a rota is staffed against, and it is not the alert rate: on eleven
real calls the rule fired five times and **moved nothing**, because every one of those was
already going to a person for a different reason. And zero on eleven calls is not a rate
of zero. `python tools/replay_escalation.py --receipts <dir>` files every real call twice
under today's code, with the rule and without it, and prints what eleven calls can and
cannot rule out:

```
Net-new escalations: 0 of 11 answered call(s), 0 per 100.
11 call(s) cannot rule out 24 per 100 (exact one-sided 95%), so this is the figure a rota
is staffed against and the count above is not.
```

Twenty-four per hundred is a wide interval because eleven calls is a small sample, and the
sample is small because every one of those calls was placed to a consenting adult who knew
what it was. The bound is computed rather than guessed (Clopper-Pearson, solved on the
binomial tail, `tools/replay_escalation.py`), and a pilot's first job is to shrink it.

## Where the saving turns into a loss

Both numbers are useless without the third one, so the run prints it: **50.4 net-new
escalations per 100 answered calls**, above which the callbacks the rule creates cost a
district more than the attempts the run removes. It is not a constant and not an estimate.
Set the two totals equal to each other, give a callback the same three minutes a manual
attempt gets so the minutes cancel, and divide through by the answered calls a rota is
staffed against:

```
net-new x $37.40 = attempts removed x $23.55
(4 attempts removed / 5 answered calls) x $23.55 / $37.40 = 0.504
```

This read 0.315 until the denominators were reconciled, because it divided the removed
attempts by the eight attempts billed while pricing the callbacks against the five calls
answered. A crossover derived from two unlike rates told a buyer the saving ended sooner
than it does.

Put the three side by side, because this is the whole commercial question in one line.

| | Net-new per 100 answered calls | Which run |
|---|---|---|
| Measured on the committed offline run | 20.0 | offline, authored mix |
| Where the saving becomes a loss on that run | 50.4 | offline, authored mix |
| Measured on the calls that rang | 18.2 | 11 answered calls |
| What those calls cannot rule out | 47.0 | 11 answered calls |
| Where the saving becomes a loss on them | **22.9** | 11 answered calls |

Read the last three rows together and ignore the first two for this purpose. They read
worse than they did a week ago, and the reason is in this repository rather than in the
data: `safeguarding_escalation` was widened on 2026-09-11 after two live calls reporting a
missing child were closed automatically, and re-filing the twelve calls recorded on
2026-09-04 under the wider rule moves two of them out of the closed pile. So the measured
net-new rate went from 0 to 18.2, the bound from 24 to 47.0, and the crossover down from 34.3 to 22.9, because a
run that closes fewer records removes less desk time.

Twenty live calls are published in this entry now, twelve of them placed on 2026-09-11, and
none of those twelve is in this table. Every count here is over the 2026-09-04 set, which
is the one with committed receipts, and the later calls are not folded in.

**The count clears the crossover:** 18.2 measured against 22.9, by 4.7 per hundred.
**The bound does not clear it at all:** 47.0 against the same 22.9. That is a materially
weaker position than the 24 against
34.3 this table published before, where both the count and its bound sat below the
crossover. The point estimate still says this saves money on the calls that rang. The
interval says eleven calls cannot rule out its costing $0.41 a call instead, and
`tools/money_across_runs.py` prints that sentence rather than the flattering half of it.

The pairing is the point, and it took a reader to find it. This table used to put 24
straight above 50.4 and call it half the rate to spare, which compares a bound measured on
real calls against a crossover derived from an authored outcome mix. Both figures were
right. The comparison between them was not one, and a district following the link from the
page, where the same bound is set against a third crossover for a single receipt, was left
with three conclusions and nothing saying which to staff against. It is the one on the calls
that rang: 22.9, because that denominator is the only one nobody chose.

What a district should take from the table is that the sample is eleven answered calls, so
the row that matters is the bound and not the count. Twelve were placed on 2026-09-04 and
one of them reached nobody, and an escalation cannot happen on a call nobody answered, so eleven is the
denominator every figure in those three rows is over. A district running at a higher alert rate than the
sample, or closing fewer records than this run closes, walks into the loss without the
software saying a word. So the software says it. A run that removes fewer attempts absorbs
a lower rate, and the figure moves down with it.

The table above bounds one rate, and it is worth saying which. 47.0 per 100 is what these
calls cannot rule out about the *net-new* rate, meaning the escalations this software says
its own safeguarding rule created. It is not a bound on escalations in general. The
escalation rate this run measured is more than three times the net-new one.

| | Escalations per 100 answered calls | Which run |
|---|---|---|
| Measured on the calls that rang | 63.6 | 11 answered calls |
| What those calls cannot rule out | 86.5 | 11 answered calls |

A second table with its own header, because 63.6 and 47.0 are rates of different things, and
putting two of those in one column is the mistake this document already made once with 24
and 50.4.

Both rows sit above 22.9. Pricing every escalated call as a callback, rather than only the
ones this software says it created, is the assumption behind a cost of **$0.70 a call**,
which the reviewer page publishes as the number to hold this entry to. Under that assumption
the crossover is passed by a wide margin and the saving is a cost of about seventy cents a
call. The narrower reading, where only the net-new escalations are work the rule created, is
the 18.2 measured and 47.0 bounded against 22.9 in the table above, and on that reading the
count clears the crossover and the bound does not. Which of the two a district is living in
is a question a pilot answers in week one. Neither figure is buried here to make the other
look better, and the wider one is the one a finance office should plan against until a pilot
narrows it.

Both of these got worse on 2026-09-11 and none of it was tuned. Seven of eleven answered
calls now escalate where five did, because the rule reads three fields where it read one.
That is the cost of not filing a missing child automatically, it is priced here at the
safeguarding lead's wage, and it is published in the direction that hurts.

A vendor would publish $0.35 and stop. The reason to publish 50.4 as well is that a school
board is going to ask the question in the meeting, and the answer should already be in the
run rather than improvised at the table.

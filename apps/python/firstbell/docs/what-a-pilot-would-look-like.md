# A pilot a district could actually sign

This is the direction the work points at, written as something a Director of Student
Services could put in front of a board rather than as a roadmap. It is deliberately small, it
names what would make it stop, and it is honest that nobody in education has run this yet.

Nothing in this file is claimed to have happened. It is a proposal.

## Shape

| | |
|---|---|
| Scale | Two schools in one district. One primary, one secondary, because the absence profile and the guardian relationship differ. |
| Length | Six school weeks. Long enough to cross a holiday and an illness wave; short enough that a bad result is cheap. |
| Volume | Only absences still unexplained at the district's existing cutoff. How many that is per school per morning is the first thing the baseline below has to measure, because no district has told us: this row read "in the districts this was modelled on that is a two-figure number" and there were no such districts. The pilot is sized on the number the school produces in its first fortnight, not on one written here. For the order of magnitude a board paper needs before that fortnight exists, the section below derives about 28 unexplained absences per 1,000 enrolled students a school day from California's certified figures, and says plainly what that number is a ceiling on rather than a measure of. |
| Who is called | One guardian per student, on the numbers already on file, with the consent record the district already holds. No new consent is collected for a pilot. |
| Who is not called | Any family flagged by the school for any reason, any student on a safeguarding plan, and any guardian without a recorded communication preference the tool can serve. The exclusion list is the school's and is never derived by software. |

## The one number a finance director asks for

Every figure in this entry is per call, because how many unexplained absences a district
handles in a morning is a number a school office has and this project does not. That stays
true of whichever district signs this pilot. It is not true of the country, and a board paper
needs an order of magnitude before the first call is placed.

California publishes enough to reconstruct one. Its Department of Education
[reports](https://dq.cde.ca.gov/dataquest/DQCensus/AttAbsByRsn.aspx?agglevel=State&cds=00&year=2023-24)
for 2023-24 an eligible cumulative enrolment of 5,958,444, of whom 5,481,732 missed at least
one day, an average of 13.1 days absent each, and 41.4% of all absence days recorded as
unexcused. The counts behind those percentages are not displayed, which the report says of
itself, so the volume is derived rather than read:

```
13.1 days x 5,481,732 students        =  71,810,689 absence days
71,810,689 x 41.4%                    =  29,729,625 unexcused days
29,729,625 / 5,958,444 students       =  5.0 unexcused absences a student a year
5.0 / 180 days x 1,000                =  27.7 per 1,000 enrolled students a school day
```

**About 28 unexplained absences per 1,000 enrolled students per school day.** The length of
the school year is the biggest lever on that: 28.5 at 175 instructional days, 27.0 at 185.
The 180 comes from [Education Code
46200](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=EDC&sectionNum=46200.),
which withholds funding from a district offering fewer.

Every input above is registered in [`evidence/statistics.json`](../evidence/statistics.json)
with the sentence it came from and the date it was read at source, and
`tests/test_absence_volume.py` recomputes the four lines rather than trusting the figures
printed in them.

For a district of 10,000 students that is roughly 277 calls on a school morning and 49,895 in
a year. Against the $0.08 a call this software's own recorded calls support, about **$4,000
a year of desk time removed**, and the calls themselves cost $0.05 each on the month of
billing this account had before CALL-E started metering them, so about **$1,500** once they
are paid for. At the $0.40 a call the nineteen metered rows average, the same volume costs
about $20,000 and the saving is gone: that is the pilot's first finding, not a footnote. Against the $0.70 a
call the widest reading of those same calls produces, where every escalated call is priced
as a callback, about **$34,900 spent** rather than saved, and that figure already has the
call cost inside it. A board paper should carry both ends, because which end a district
lands on is the thing the pilot measures.

Those were $29,400 and $26,900 until 2026-09-11, and the reason they are not is worth a
sentence rather than a quiet edit. `safeguarding_escalation` was widened that day, after two
live calls in which a parent reported a child missing and the platform returned a routine
absence. Re-filing the twelve calls recorded on 2026-09-04 under the wider rule moves two
of them out of the closed pile, so the desk time removed falls and the callback cost rises,
and the net per-call figure drops from $0.59 to $0.08. Nothing about the volume above changed. What
changed is what this software refuses to close, and a district reading a saving needs to
know it is reading the number after that refusal rather than before it.

The $0.05 is the rate the arithmetic above was built on, and it is subtracted here because
the loss at the other end is stated net, and the two were not comparable: the saving was gross and the cost was not, which ran in this entry's
favour on the one page a board reads. On the reproducible demo run the same arithmetic is
$0.35 a call before the call cost and $0.30 after it.

Three things that figure is not.

**It is not a count of absences nobody explained.** California's test is absence without a
valid excuse under Education Code 48205, so a parent who telephones to report a family
holiday or a missed bus has explained the absence and it is still recorded unexcused. What
this software would call about is smaller. Twenty-eight per 1,000 is a ceiling on it, not an
estimate of it.

**It is not the call volume.** This software dials only where the district's own notification
has already gone unanswered, which is a subset of a subset. Both dollar figures above are
upper bounds in both directions: a smaller volume shrinks the saving and the loss together.

**It is not national.** One state, one year. The publisher holds 2019-20 data not valid and
reliable and recommends caution when comparing absenteeism across academic years. Los Angeles
Unified's own row in the same report works out higher, at 41 per 1,000 a school day, but that
row reports 0.0% of absence days as out-of-school suspension and 0.0% as incomplete
independent study where the state reports 0.9% and 5.4%. For a district of 396,000 students
that is a coding difference rather than a fact about children, so the state figure is the one
used here.

## What that volume does to a rota

The two figures above have never been in the same sentence, and a district buyer who read
this entry said putting them there was worth more than any number currently published. So:

    277 calls on a morning, in a district of 10,000
    x 11 of 12 answered, the rate this software's own recorded calls came back at
    = about 254 answered calls
    x 7 of 11 marked by the safeguarding rule, the rate those same calls came back at
    = about 162 escalations on a morning
    x 30 minutes, the callback window this software prints beside every one of them
    = about 81 staff-hours, every school morning

**That is a department, not a rota.** Eleven people doing nothing else, at a 7.5-hour day.
Over a 180-day year it is about 29,100 escalations. A pilot sized on the calls and not on
the callbacks will produce a queue no school can work, and the software will be blamed for
the queue.

It read 115 escalations and eight people until 2026-09-11. Widening the rule that morning
took the marked rate from 5 of 11 to 7 of 11, and this is the line where that costs the
most: three more staff-hours a morning per two extra escalations, and the whole projection
moves with it. The rule was widened anyway, and the reason is two calls up the page.

Three things about that arithmetic, because it is the most load-bearing projection in this
entry and it is the least measured.

**It is a projection and not a result.** The volume is California's, at a state level, from
a source with a URL. The two rates are this software's, from the twelve calls recorded on
2026-09-04, which are the calls the pooled counts cover. Twenty live calls are published in
the entry now and the rates have not been re-derived over them. Twelve calls cannot support
a rate to two significant figures, and the entry publishes the bound that says so: 86.5 escalations per 100 answered calls is what those eleven answered calls cannot
rule out, which at this volume is 220 a morning rather than 162. A district's own first week
is the only thing that narrows it.

**The 30 minutes is this project's default and nobody has agreed to it.** It is in
`firstbell/domain.py` as `SAFEGUARDING_CALLBACK_MINUTES` and `--safeguarding-minutes`
changes it, and the run says which of the two it used. A district that has agreed 15 minutes
with its safeguarding lead halves this. One that has agreed an hour doubles it.

**Most of that queue existed before this software did, and some of it does not.** Five of
the seven calls the rule marks had already connected and given nothing usable, so a person
was ringing those families back whichever system placed the call; what the rule adds there is
the grade of the person who rings and the order they ring in. The other two are new. They are
records that satisfied the schema, came from a guardian who confirmed they were aware, and
would have closed with nobody reading them, and holding them open is work this software
creates rather than work it re-labels.

That distinction used to be unnecessary here, because the count of new work was nought. It is
not any more, and the honest version of this paragraph is that about 116 of the 162 are the
queue a district already had and about 46 are the queue this rule builds. At 162 a morning the
ordering is still the difference between a queue and a triage list. The 46 is the price, it is
priced at the safeguarding lead's wage in the money section, and it is the reason that section
now reports a bound that does not clear its own crossover.

## The baseline, measured before anything is switched on

Two weeks of the district's current process, recorded the same way the pilot will be:

1. Unexplained absences still open at 48 hours.
2. Staff attempts per unexplained absence, from the office's own call log.
3. Time from the register closing to a reason being recorded.
4. Unexplained absences where the guardian's preferred language is not English.

Without these four the pilot has nothing to compare against, and every number it produces
afterwards is a description rather than a result. This is the part that is skipped.

## What is measured during it

The same four, plus five the software produces:

5. Closed without a person: an explicit confirmation received and the record closed.
6. Escalated: routed to a person because nothing confirmed the guardian already knew.
7. Reached in the family's own language, as a fraction of families whose preferred language
   is not English.
8. **Net-new escalations**: of those in 6, the ones the rest of the pipeline would have
   closed. Per hundred answered calls, with the count of answered calls beside it.
9. **Held for channel**: the rows the accessibility gate refused to dial, because the export
   said the guardian is not reachable by a voice call. Three numbers rather than one: how
   many rows were held, how many of those the office served on another channel inside the
   same window the safeguarding rota promises, and which named person served them.

Note which direction each is expected to move. 1, 2 and 3 should fall. 5 should be well below
the total, because a tool that closes most records is either being asked easy questions or is
closing things it should not. **A resolution rate near 100% is a red flag in this pilot, not a
success.** The number to watch is 6 divided by 7: how much human work each escalation costs
against how much reach it buys.

Measure 8 is the one this pilot exists to produce, and 6 on its own is not a substitute for
it. Most of 6 is work the office was already doing: the call produced nothing usable, so it
was going to a person whatever rule was in force. 8 is the part that is new, and it is the
only one of the nine that decides whether the safeguarding lead's rota has to change. The
run prints it, and `tools/replay_escalation.py` computes it for calls already placed by
filing each one twice under today's code, with the rule and without it.

Two weeks of pilot data is enough to move it and not enough to settle it. On the eleven
real calls behind this work the count is zero, and eleven calls cannot rule out twenty-four
per hundred. Read the bound rather than the count until the sample is large enough that
they agree, and staff against the bound. A stop rule below trips on a missed callback, so
the cost of reading the count instead is a rota built for a queue that turns out to be four
times longer.

Measure 9 exists because the accessibility gate is the one part of this software that helps
nobody by working. It does not contact the guardian it protects. It declines to dial and puts
the row on a person's desk, which means that on its own it converts a family the telephone
cannot reach into a record saying somebody was told. The sentence under the ownership table
below, that an escalation into an unstaffed queue is worse than no call, was written about the
safeguarding queue, and it applies to the `voice` gate by name: a held row nobody works is a
guardian who was excluded twice and a district that now has a document saying otherwise. So
the second of the three numbers is the one that matters, and its expected direction is up from
whatever the first fortnight produces. Nine held and none served is a finding about the office
rather than a gap in the data, and it is the finding that would decide whether precondition 3
has actually been met or only written down.

## Who owns what

| Role | Owns |
|---|---|
| Attendance officer, per school | The escalation queue. Named individual, not a team inbox. |
| Designated safeguarding lead | Any case where a guardian did not know the child was absent. Thirty minutes, in hours. |
| District data protection officer | The consent record, the retention schedule, the processing agreement. |
| The vendor | Nothing that touches a decision about a child. |

An escalation into an unstaffed queue is worse than no call, because it creates a record that
somebody was told and nobody acted. If the queue cannot be staffed for the six weeks, the
pilot does not start.

## Stop rules

The pilot stops immediately, without a meeting, on any of these:

- A safeguarding escalation is not picked up inside the agreed window, twice.
- Any guardian complaint about the call itself, pending review.
- The agent fails to end a call, or restarts its own disclosure, on any live call. This has
  been observed against CALL-E in testing and is written up as F15; there is no `end_call`,
  no `max_turns` and no `max_duration` parameter to prevent it.
- Any call placed to a number on the exclusion list.
- Cost per closed record exceeds the staff-time ceiling the run itself prints.

## What would have to be true before this is worth doing at all

Three things that are not true today, listed so that nobody reads this as a product that is
ready:

1. **A local caller ID.** The shipped configuration dials from a US number, because that is
   what CALL-E's international route provides for the region tested. A school calling a parent
   from an unfamiliar foreign number will not be answered, and should not be.
2. **A consent record rather than a consent flag.** See the TCPA section of the compliance
   questions. A boolean in a CSV is not a defensible record.
3. **A non-voice path.** A voice-only service cannot be the answer to a communication-access
   duty. Until a guardian who cannot use a voice call has a route, this reaches some families
   by excluding others.

Each of these is a blocker rather than a nice-to-have, and each is outside what a hackathon
entry can close.

# A pilot a district could actually sign

The rubric asks whether a project points at a direction worth building further for real
users. This is that direction, written as something a Director of Student Services could put
in front of a board rather than as a roadmap. It is deliberately small, it names what would
make it stop, and it is honest that nobody in education has run this yet.

Nothing in this file is claimed to have happened. It is a proposal.

## Shape

| | |
|---|---|
| Scale | Two schools in one district. One primary, one secondary, because the absence profile and the guardian relationship differ. |
| Length | Six school weeks. Long enough to cross a holiday and an illness wave; short enough that a bad result is cheap. |
| Volume | Only absences still unexplained at the district's existing cutoff. In the districts this was modelled on that is a two-figure number per school per morning, not a four-figure one. |
| Who is called | One guardian per student, on the numbers already on file, with the consent record the district already holds. No new consent is collected for a pilot. |
| Who is not called | Any family flagged by the school for any reason, any student on a safeguarding plan, and any guardian without a recorded communication preference the tool can serve. The exclusion list is the school's and is never derived by software. |

## The baseline, measured before anything is switched on

Two weeks of the district's current process, recorded the same way the pilot will be:

1. Unexplained absences still open at 48 hours.
2. Staff attempts per unexplained absence, from the office's own call log.
3. Time from the register closing to a reason being recorded.
4. Unexplained absences where the guardian's preferred language is not English.

Without these four the pilot has nothing to compare against, and every number it produces
afterwards is a description rather than a result. This is the part that is skipped.

## What is measured during it

The same four, plus three the software produces:

5. Closed without a person: an explicit confirmation received and the record closed.
6. Escalated: routed to a person because nothing confirmed the guardian already knew.
7. Reached in the family's own language, as a fraction of families whose preferred language
   is not English.

Note which direction each is expected to move. 1, 2 and 3 should fall. 5 should be well below
the total, because a tool that closes most records is either being asked easy questions or is
closing things it should not. **A resolution rate near 100% is a red flag in this pilot, not a
success.** The number to watch is 6 divided by 7: how much human work each escalation costs
against how much reach it buys.

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

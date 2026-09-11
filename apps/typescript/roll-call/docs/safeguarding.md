# Why the alert rule is shaped the way it is

Attendance calls exist for one reason: a child who left home for school and
never arrived. Everything else on the list is administration. So the design
question is not "how do we log absences efficiently" but "how do we make sure
that one conversation reaches a human within minutes, and that no other
conversation is mistaken for it".

## The alert is fail-closed in both directions

A guardian saying they did not know is the signal. Two ways to get it wrong:

- **Missing it.** CALL-E extracts `guardian_aware: unknown` for a parent who
  clearly said "he should be at school". Roll Call does not fix this by
  trusting the transcript regex alone; it sends the child to *needs human
  review*, which is a staff member reading the transcript within the same
  morning. The regex only ever *downgrades* a CALL-E verdict, never upgrades
  one, so a missed alert becomes a review, not a quiet "accounted for".
- **Inventing it.** CALL-E extracts `no` for a parent who said "no, no
  problem, she's at the dentist". The transcript check requires a guardian
  turn that actually contains a phrase of not knowing, and a turn that also
  contains a phrase of knowing cannot support `yes`. Without a supporting
  turn the verdict is `unknown` and the child goes to review. The alert
  therefore always quotes the words it rests on.

Review is deliberately the fallback for every ambiguity. It costs the office a
minute per child. A false "accounted for" could cost a great deal more.

## Why the cascade stops at the first confirmed guardian

Once one guardian has answered for the child, calling a second guardian can
only add confusion (two adults, two stories) or alarm (a parent at work hears
an automated voice about their child's attendance after the matter is already
settled). If the first guardian did not know, the alert goes to a human who
decides who to call next; that is not an automation decision.

## Why non-guardians hear almost nothing

A colleague, a sibling, a neighbour or a voicemail box is told only that the
call is about the child's attendance and how to reach the office. Whether the
child is absent, since when, and why the school is worried are said only to
the person who has confirmed being the named guardian. The task text encodes
this, and the preview shows the exact wording so the school can check it
before the first live call.

## What the school must still own

- Which adults are guardians, in which order, and who has consented to
  automated calls. Roll Call refuses to dial without consent and never
  updates contact details on a call.
- The missing-pupil procedure that follows an alert. Roll Call names the
  safeguarding contact and stops.
- Reading the transcripts of every child in review before the morning ends.

## What is not verified

- Identity. "Yes, speaking" is taken at face value, exactly as it is on a
  human call from the office.
- Truthfulness of the reason. A guardian who says "illness" is recorded as
  saying so. The report prints reasons as the guardian's words, not as facts.

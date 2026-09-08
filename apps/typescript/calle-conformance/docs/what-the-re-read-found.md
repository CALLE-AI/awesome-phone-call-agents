# What the re-read found

The corpus was built to answer a question about other people's code. This is the
first thing it answered about the platform, and it is a finding the corpus is
the only artefact in this repository able to produce: the responses are dated,
so they can be compared against the same calls read again.

The finding is a single sentence. **Read a connected call twice through
`calls.get` and the attempt timestamps change.** The first read that observes
the call completed carries a UTC instant with a timezone designator. Every later
read of the same call carries a naive local-time string, four hours earlier,
with the microseconds dropped.

---

## The reproduction

One call was placed to the CALL-E English testing hotline on 8 September 2026
and polled until it completed. The payload the polling loop received:

```
attempt.startedAt     2026-09-08T08:19:29.064926Z
attempt.completedAt   2026-09-08T08:19:49.348453Z
```

The same call, same endpoint, same key, read again seconds later, and three more
times over the following two minutes. All four reads agree with each other and
disagree with the first:

```
attempt.startedAt     2026-09-08T04:19:29
attempt.completedAt   2026-09-08T04:19:49
```

Saved as
`probe-results/experiments/EVIDENCE-attempt-timestamp-rewritten-after-first-read.json`,
git-ignored like every raw capture.

That call is deliberately **not** in the published corpus, which stays at fifteen
responses. It was placed to settle one question rather than to record a
behaviour, and a corpus that grows every time somebody runs an experiment stops
being the fixed reference that the README, the report and the film all count. The
masking preserves the presence or absence of a zone designator precisely because
it is the finding, so nothing about this is hidden by leaving the call out; the
reproduction above is the evidence, and it can be run again for the cost of one
unit of the daily allowance.

Three things narrow it.

**Only the attempt is affected.** `call.createdAt` and `call.completedAt` carry
their zone in every one of the sixteen calls held here, on both reads.

**The platform still has the correct instant.** The event stream for the same
call answers `call.started` at `2026-09-08T08:18:45.498626Z`, tz-aware and to
the microsecond, while the attempt on the same call reads `04:19:29`. The right
value and the wrong one are both available through this API at the same moment,
from two endpoints, for one call.

**Four hours is not the caller's offset.** These calls were placed from UTC-5.
Four hours is US Eastern in September, which is a plausible server-side local
time and is not a value any caller supplied.

## What it costs a caller

The attempt is where a caller reads how long the call took and when it started,
so this is the field a retry policy, a duration metric and a reconciliation job
all consume.

A handler that reads the call at completion and a job that reads the same call
an hour later disagree by four hours about the same event, and neither is
obviously wrong from the inside. Worse for the later reader: with no zone
designator, `new Date("2026-09-08T04:19:29")` is parsed as local time by
ECMAScript, so a reader in a third timezone shifts it again by their own offset.
The error compounds rather than cancels.

## What is not established

**The mechanism.** Something between the first read and the second serves a
different representation. Whether that is a cache expiring, a write settling, or
two code paths over one row cannot be seen from outside, and no cause is claimed
here.

**One exception has no explanation.** Two connected calls captured on
5 September still read tz-aware today, three days later, while five connected
calls captured on 7 September now read naive. If the rewrite applied to every
connected call those two would have moved as well. They have not. Whatever the
mechanism is, it did not always do this, and the corpus cannot say what changed.

**Failed attempts are not part of this.** They carry the naive form on the first
read and every read after, which is the behaviour the corpus already recorded as
quirks 1 and 2. What is new is that connected attempts reach the same state, and
that they do so after the caller has already been handed the correct value.

## How it was found

```bash
npm run drift
```

The report re-reads every recorded call and compares fingerprints. It flagged
five of the fifteen, all of them connected calls captured on 7 September, as
having lost the behaviour `connected-call-timestamps-are-well-formed`.

Two corrections were made to the tool before this entry was written, both
because its first live run was wrong. It announced
`recipients[].structuredResult.answered` as a new platform field; it is a key of
one probe's own result schema, and the tool no longer descends into a structure
the caller defines. And one corpus capture was taken while its call was still
queued, so its differences are the call progressing rather than the platform
moving, which is now stated where the report prints.

This entry will be corrected or removed if the claim turns out to be wrong.

# What the re-read found

The corpus was built to answer a question about other people's code. This is the
first thing it answered about the platform, and it is a finding the corpus is
the only artefact in this repository able to produce: the responses are dated,
so they can be compared against the same calls read again.

**A connected call's attempt timestamp carries its timezone only for a window of
under a minute after the call completes.** Before that window it is a placeholder
that tracks the read clock. After it, and from then on, the field has no zone
designator, no sub-second component, and reads four hours earlier.

---

## The reproduction

`npm run settle` places one call to the CALL-E English testing hotline and reads
it over plain `fetch` on a ten-second sleep plus request time, about thirteen to
fourteen seconds in practice, from before it connects until four minutes past the
first read that shows it completed. Run on 8 September 2026, call
`call_WXko-BzSPlw5t3pCIPtLDg`, attempt `att_b18ffd198df93947`:

```
wall clock (UTC)          status      zone  attempt.startedAt
2026-09-08T08:32:24.663Z  queued      NO    2026-09-08T04:32:24
2026-09-08T08:32:42.935Z  queued      NO    2026-09-08T04:32:29
2026-09-08T08:32:56.305Z  queued      NO    2026-09-08T04:32:29
2026-09-08T08:33:12.596Z  completed   yes   2026-09-08T08:32:40.611544Z
2026-09-08T08:33:25.785Z  completed   yes   2026-09-08T08:32:40.611544Z
2026-09-08T08:33:38.275Z  completed   NO    2026-09-08T04:32:40
2026-09-08T08:33:51.070Z  completed   NO    2026-09-08T04:32:40
   ... 15 further reads, all identical, through 08:37:16Z
```

The three `queued` rows are deliberately not part of the claim. Their values
differ from one another and follow the read clock, so at that point the field
holds a placeholder for a start time that has not happened rather than one
instant in another representation. Reading them as a representation change would
be the same mistake this tool made on a queued capture once already, recorded
below.

What is claimed is the transition after the start time settles at `:32:40`. Two
reads carry `2026-09-08T08:32:40.611544Z`, and every read after carries
`2026-09-08T04:32:40`. Bounded by the readings either side of it, the tz-aware
run is at least 13 seconds wide and less than 42. Re-read at 08:41:14Z, the same
call still answered `2026-09-08T04:32:40`.

Two things go, not one. The designator, and the `.611544`.

Every response carried `cache-control: no-store` and no `Age` header, so an HTTP
cache serving a stale copy does not look like the explanation, at least not by
policy.

Saved as `probe-results/experiments/EVIDENCE-timestamp-settle-*.json`, git-ignored
like every raw capture, alongside the earlier call that first showed it.

Those two calls are deliberately **not** in the published corpus, which stays at
fifteen responses. They were placed to settle a question rather than to record a
behaviour, and a corpus that grows every time somebody runs an experiment stops
being the fixed reference that the README, the report and the film all count.
Leaving them out hides nothing: the masking preserves the presence or absence of
a zone designator precisely because it is the finding, and the reproduction above
can be run again for one unit of the daily allowance.

## What it costs a caller

The attempt carries the start time, so a retry policy, a duration metric or a
reconciliation job reading it gets a different answer depending on when it read.

Two losses, not one. The designator goes and so does the sub-second component:
`08:32:40.611544Z` becomes `04:32:40`, truncated to the whole second. A caller
timing a short call from these fields loses precision it was handed earlier.

The later form is also the easier one to misread. With no designator,
ES2015-conformant engines parse `"2026-09-08T04:32:40"` as local time; ES5.1
specified UTC for this form, so older engines differ, and the rule covers
date-time strings rather than date-only ones, which are still UTC. So a
JavaScript reader outside the server's zone shifts it again by their own offset.

Four hours matches UTC-4, which is US Eastern in September. These calls were
placed from UTC-5, so it is not the caller's offset, and it looks like a
server-side local time rather than anything a caller supplied. UTC-4 is not
uniquely US Eastern, so the zone itself is a guess.

## What is not established

**The mechanism.** Something serves a different representation inside that window
than outside it. Whether that is a write settling, a cache expiring, or two code
paths over one row cannot be seen from outside, and no cause is claimed here.

**One exception has no explanation.** Two connected calls captured on 5 September
still read tz-aware when re-read on 8 September, while five captured on
7 September do not. If every connected attempt settled into the naive form those
two would have settled too. They have not, and it is the part of this finding
worth attacking first.

**Whether failed attempts are the same bug.** All eight failed-call captures here
were taken by a polling loop and none ever recorded a tz-aware attempt. That is
consistent with the same short window existing and being missed between polls,
and consistent with the failure path never producing one. This corpus cannot tell
which, so quirks 1 and 2 stay scoped to what they observe.

**What a webhook carries.** Every tz-aware attempt value seen here came from a
read of `GET /v1/calls/{id}`. No webhook was received, so no claim is made about
that delivery path.

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

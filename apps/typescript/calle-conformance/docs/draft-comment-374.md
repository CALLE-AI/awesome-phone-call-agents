# TITLE

Connected-call `attempt` timestamps change representation between reads of the same call

# BODY

Related to #374. This may be a more general form of it, so I have opened it
separately rather than commenting there.

#374 says failed-call attempts omit the timezone "while a connected-call
response includes `Z` (UTC)". In the one call I instrumented end to end, that
held for a window of well under a minute after completion, and reads after that
window returned no zone, no sub-second component, and a value four hours
earlier. Two other calls have stayed tz-aware for three days, so I do not know
how general either behaviour is.

## Reproduction

One call to the published testing hotline, read over plain `fetch` on a
10-second sleep plus request time, about 13 to 14 seconds in practice, from
before it connected until four minutes past the first read that showed it
completed.

`call_WXko-BzSPlw5t3pCIPtLDg`, attempt `att_b18ffd198df93947`.

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

**The three `queued` rows are not part of the claim.** Their values differ from
each other and track the read clock, so at that point the field is a placeholder
for a start time that has not happened yet rather than one instant in a
different representation. The finding is the transition after the start time
settles at `:32:40`: two reads carrying `2026-09-08T08:32:40.611544Z`, then every
read after carrying `2026-09-08T04:32:40`.

Bounded by the reads either side of it, the tz-aware run is at least 13 seconds
wide (08:33:12.596Z to 08:33:25.785Z) and less than 42 (08:32:56.305Z to
08:33:38.275Z). I re-read the same call at 08:41:14Z and it was still
`2026-09-08T04:32:40`.

`04:32:40` is `08:32:40Z` minus four hours, so on the assumption that the offset
is exactly -4h the two forms are the same instant to the second, and the later
form has lost both the designator and the `.611544`. That assumption is the same
guess flagged below, not a fact.

Every response carried `cache-control: no-store` and no `Age` header, so this
does not look like an HTTP cache serving a stale copy, at least not by policy.

## What this costs a caller

The attempt carries the start time, so a retry policy, a duration metric or a
reconciliation job reading it gets a different answer depending on when it read.

Two losses, not one. The zone goes, and so does the sub-second component:
`08:32:40.611544Z` becomes `04:32:40`, truncated to the whole second. A caller
measuring a short call from these fields loses precision it was handed earlier.

And the later form is the easier one to misread. With no designator,
ES2015-conformant engines parse `"2026-09-08T04:32:40"` as **local time**;
ES5.1 specified UTC for this form, so older engines differ. The rule applies to
date-time forms, not to date-only strings, which are still UTC. So a JavaScript
reader outside the server's zone shifts it again by their own offset.

Four hours matches UTC-4, which is US Eastern in September. I placed these from
UTC-5, so it is not my offset, and it looks like a server-side local time rather
than anything a caller supplied. UTC-4 is not uniquely US Eastern, so the zone
is a guess.

## What I checked, and what I did not

**Only the attempt moves.** `call.createdAt` and `call.completedAt` carried a
zone on every read, across all fifteen recorded calls and the two I placed for
this report.

**A related instant stays tz-aware elsewhere.** For an earlier call
(`call_WqS6hT1XBEaoPRn_SqXpjg`), `GET /v1/calls/{id}/events` reports
`call.started` at `2026-09-08T08:18:45.498626Z` while the attempt on the same
call reads `04:19:29`. Those are different fields, and the event precedes the
attempt start by about 44 seconds once the four hours are applied, so it is not
a drop-in correction. It does show the tz-aware form is still produced elsewhere
for the same call at the same moment.

**Failed calls, which is what #374 is about, may be this in its settled state.**
All eight of my failed-call captures were taken by a polling loop and none ever
recorded a tz-aware attempt. That is consistent with the same transient existing
and being missed between polls, and consistent with the failure path never
producing one. I cannot tell which from outside.

**Two calls contradict the pattern and I cannot explain them.**
`call_fs3JaNdIVa7FqDrxb-mRag` and `call_53dF2gSw4b75KaqmeQHcWg`, both connected
and captured on 5 September, still read tz-aware when re-read on 8 September at
08:41:16Z. Five connected calls captured on 7 September read naive. If every
connected attempt settled into the naive form, those two should have settled
too. They have not, and it is the part of this report I would attack first if I
were reading it.

**The mechanism.** Something serves a different representation inside that
window than outside it. Whether that is a write settling, two paths over one
row, or something else is not visible from where I am standing, and I am not
claiming a cause.

**Not tested: webhooks.** Every tz-aware *attempt* value I have seen came from a
read of `GET /v1/calls/{id}`. I do not know what a webhook payload carries.

## Inventory, so the counts are checkable

Fifteen recorded calls: eight failed, seven connected. Of the seven connected,
two are from 5 September and five from 7 September. Plus the two calls placed
for this report, which are not in the published corpus. `npm run drift` re-read
all fifteen and flagged five, and those five are exactly the 7 September
connected calls.

## How to reproduce

`scripts/timestamp-settle.ts` in `apps/typescript/calle-conformance`
([PR #363](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/363)):

```bash
npm run settle -- --i-understand-this-places-a-real-call
```

It places one call, reads it on a fixed sleep over plain `fetch` so the response
headers stay visible, and prints the runs above with every raw string it saw. It
refuses to dial without the flag.

I found it with `npm run drift`, which re-reads calls that already exist and
compares them against what was recorded. It places no new calls.

Two mistakes of my own tooling, since this issue should not inherit them. The
first live run of `drift` announced `recipients[].structuredResult.answered` as a
new platform field; it is a key of my own probe's result schema, and the tool no
longer descends into a structure the caller defines. And one of my captures was
taken while its call was still queued, so its differences were the call
progressing rather than anything changing underneath it, which is the same trap
the three `queued` rows above would have been.

Raw readings for both calls, with headers and wall-clock times, are in my working
tree rather than the PR, since captures are not published. Happy to attach them,
or to re-run against any call id you want to name.

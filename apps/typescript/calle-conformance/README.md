# calle-conformance

A corpus of real CALL-E API responses, and a checker that tells you which of them
your code has never been tested against.

## Run it first

```bash
node src/replay.ts ../../..
```

That is the whole setup. No `npm install`, no API key, no network, nothing
dialled. Node 22 runs the TypeScript directly, and the only dependency in
`package.json` is needed by the optional probes, not by this.

```
6 projects carrying call-shaped payloads, 7 quirks.
A dot means the behaviour never appears in that project's payloads.

project                            n    1  2  3  4  5  6  7
---------------------------------  --  -- -- -- -- -- -- --
apps/python/casechaser              7   .  .  .  .  .  .  x
apps/python/redline                 1   .  .  .  .  .  .  x
apps/python/ringdown                2   .  .  .  .  x  .  x
apps/typescript/calle-conformance  11   x  x  x  x  x  x  x
plugins/zapier-calle                3   .  .  .  .  .  .  x
skills/verify-by-phone              1   .  .  .  .  .  .  .
```

Seven behaviours this API really emits, and the payloads six projects test
against. A dot means that project has never seen that behaviour in a fixture.
The bottom row is this corpus, which is where the behaviours come from. Any path
works, so `node src/replay.ts ../some-app` scores a checkout that is not in this
repository.

`npm test` and `node src/docs.ts --check` run the same way, with nothing
installed.

### Turning the report into a gate

By default it reports and exits 0, because an absence is not a defect. `--require`
turns it into something a build can fail on:

```bash
node src/replay.ts ../some-app --require raw-sip-code-as-failure-code
```

The gate reports three outcomes rather than two.

| Exit | Meaning |
| --- | --- |
| 0 | every required behaviour is covered, or no gate was asked for |
| 20 | the payloads parsed, and a required behaviour never appears in them |
| 45 | there was nothing readable to judge |

Twenty and forty-five are different facts and a caller acts differently on each.
"Your fixtures do not cover this" is a coverage gap. "I could not read your
fixtures" is a broken pipeline that a single failure code would hide.

Failure is asymmetric on purpose. A behaviour counts as covered only when a
predicate positively decided so on a payload that parsed. Every other path,
including a predicate that threw on an unfamiliar payload, leaves it uncovered,
and the gate asserts that its exit code and its list of misses agree before it
prints either. A checker whose own crash reports success is worse than no checker.

`--require all` requires the whole manifest. `--html <path>` writes the same
report as a standalone file with no stylesheet, no script and no network, for
reading without a terminal.

## The finding this exists to carry

**On the free tier, every request that reaches the planner consumes one call from
the 20-per-24-hour allowance, including the ones the planner refuses.** No number
is dialled, no phone rings, no call object is created, and the allowance drops by
one anyway. A refused request also burns its idempotency key, so the corrected
retry is rejected as a conflict. One mistake costs twice.

Units return individually, each exactly 24 hours after it was spent. There is no
daily reset.

Nothing in the API exposes this. There is no usage endpoint: a merged project in
this repository records that `/v1/account`, `/v1/balance`, `/v1/credits`,
`/v1/usage` and `/v1/me` all return 404, and leaves open the question of whether a
no-answer consumes a credit. The remaining allowance appears in exactly one place,
the body of the 429 that tells you it is gone.

The consequence is ordinary and it is happening now. A developer in an unsupported
region, or one iterating on a task the planner declines, can exhaust a day of
allowance without ever reaching a person, and has no way to see it coming. More
than twenty projects in this repository maintain a local call budget that counts
one unit per created call. Under the measured rule, all of them undercount.

### How it was measured, and how to falsify it

Two instruments, neither of which places a call.

`src/watch.ts` samples the counter while at the cap. Eleven consecutive readings
held at 20 of 20 between 00:10 and 02:41 local time; by 02:51 capacity had
returned. The three requests of the previous day that preceded 02:51 were made at
02:46, 02:48 and 02:51. Three spent, three returned, at +24h. A fixed daily reset
is ruled out: nothing moved at local midnight or at UTC midnight.

`src/headroom.ts` then issued requests that reach the planner and are refused
there. Two were accepted and the third met the limiter. Three refusals, three
units, no phone rung.

Reading the counter without placing a call is possible because payload validation
runs before the rate limiter while destination screening runs after it, so a
well-formed request to an unsupported region returns 422 with headroom and 429
carrying `limit`, `window_hours` and `count` at the cap. Note the asymmetry: the
probe is free **only** while at the cap. With headroom it reaches the planner and
consumes, so the counter can be read for free only when there is nothing left to
read.

**This is one account, one region, one free tier, over one window.** It is a
measurement, not a documented guarantee, and the platform may change it. It is
falsified by any of: a request refused at the planner that leaves the counter
unchanged; a reset that returns the whole allowance at one instant; or a different
`window_hours` in the 429 body. `npm run headroom` re-runs the second instrument
in about a minute.

Reproducing it needs `CALLE_UNSUPPORTED_PHONE`, a number you control in a region
the account cannot call. It is not baked in, because the day that region gains
coverage the probe stops being refused and rings that number for real.
`.env.example` says so at the point of use.

## The corpus

`fixtures/` holds eleven real production responses, rewritten for publication. Seven
behaviours a caller would not predict from the documented shape are declared in
`src/quirks.ts` as executable predicates rather than prose, so one definition
labels the corpus, verifies the rewriting, and scores third-party code.

Among them: on a failed attempt `startedAt` carries no timezone designator and
sits about four hours behind `createdAt`, while on a call that connected it
carries `Z` and agrees. Nine attempts, seven failures and two successes, no
exceptions. The failure path and the success path format time differently, and a
parser reads the unzoned string as local time, adding its own offset on top.

`fixtures/README.md` documents each behaviour and is generated from the manifest,
so a behaviour cannot be documented without a predicate that decides it.

## The checker

The command is at the top of this file. It reads the JSON fixtures a project
tests against, normalises the REST `snake_case` and SDK `camelCase` spellings, and
reports which real behaviours those fixtures never contain. Several paths can be
scored at once, and `label=path` renames a row.

It skips `probe-results/`, which holds the unmasked captures. A corpus that scores
its own private inputs is measuring nothing.

## What this does not prove

A dot is not a defect. It says a behaviour is absent from the payloads that
project tests against, and nothing more. It does not mean the code mishandles that
behaviour, and it does not mean the project is wrong. Several of the projects above
handle cases this corpus does not contain at all.

Exit status is not a verdict. The checker never fails a build.

Files that carry transcript turns in a shape the checker cannot read are listed
rather than counted as empty, because silently dropping a payload is the failure
this corpus exists to expose.

The corpus is eleven responses from one account in one region. It is a floor, not a
specification.

## What it found

An absence is a shortlist, not a defect. `docs/found-by-the-corpus.md` records the
absences that turned out to matter, with the file and line so each one can be
checked rather than believed.

The first: `apps/typescript/call-on-behalf` maps a failed call to an outcome by
looking for the words `voicemail`, `machine`, `answer`, `busy` or `unreachable`
inside `attempt.failureCode`. The three codes in this corpus are `404`, `486` and
`603`, so every one of them falls through to the default branch, and a caller who
reaches an answering machine is told the call did not connect to a person. Its own
test exercises that branch with `failureCode: "busy"`, which is the documented
vocabulary and is not what an attempt carries. The test proves the branch works.
It cannot show that the branch is reachable.

## What this cannot see

Every behaviour here is about the shape of a response. None of them is about who
was on the line.

The API reports that a person answered and what they said. It does not establish
which person, and neither does anything in this repository: a project that dials
a number and treats whoever answers as the intended recipient is making an
assumption no payload can confirm. This corpus inherits that limit rather than
solving it, and no predicate here should be read as evidence about identity.

One more, recorded as an open question rather than a finding. In the call of
7 September 2026 that became `completed-no-failure-8turns-ff6b5c.json`, the task
ended with "Do not say anything else" and the agent spoke a sentence the task did
not contain. The response reported `taskCompleted: true` with a completion
confidence of 0.92, labelled high. That is one call. It is not enough to claim
anything, and it is written here so that it is not quietly forgotten.

## Known ceilings

Each entry names the measurement that produced it.

1. **A hypothesis held for several hours on 5 September 2026 and then discarded.**
   A call to a non-routable number returned a structured result of
   `answered: "no"` with zero transcript turns, and was read as the platform
   inventing a result. An A/B against the same number, varying only the schema
   description, returned `unknown` both times, and six of seven zero-turn calls
   returned `unknown`. The value `"no"` is also defensible on its face: nobody
   answered. The reading was wrong and is not part of this work.
   `scripts/fabrication-ab.ts` is the experiment that refuted it.
2. **The counter was read as an accounting error before it was measured.** Nine
   created calls against a counter reading twenty looked like a defect. It was not.
   Eleven refused requests account for the difference exactly, and the metering
   rule above is the correct explanation. No bug is claimed here.
3. **The rolling window rests on one release event**, bracketed to a ten-minute
   sample. The direction is unambiguous and the fixed-reset alternative is ruled
   out, but the per-unit granularity is inferred from three units returning at the
   three times they were spent, not from a longer series.
4. **The four-hour offset is measured on one account in one region on one day.**
   Whether it tracks daylight saving, or differs by region, is untested.
5. **`providerCallId` matches the Call ID shown in the dashboard.** This was
   treated as an undocumented correlation until a maintainer stated it publicly on
   4 September 2026 and began documenting it. It is included as context, not as a
   finding.
6. **The carrier-side comparison is not in this repository.** For one call the API
   reported one attempt while a third-party carrier logged seven dials in eight
   seconds. It is excluded because reproducing it requires a carrier account, and
   `apps/python/ringdown` already documents a related observation from its own
   logs.

## Running everything

```bash
npm test
node src/replay.ts ../../..
node src/replay.ts ../../.. --require all --html report.html
node src/docs.ts --check
```

`npm install` is needed only for `npm run typecheck` and for the probes that
contact the API. `npm test` is sixteen tests and touches no network. Seven of them
attack the gate itself with truncated JSON, wrong types and payloads that parse
but mean nothing, and assert that none of it can be mistaken for coverage. It includes leak tests that fail
if a real phone number or an identifier from the private captures reaches
`fixtures/`, verified by injecting one. Every number in the corpus is drawn from
ranges reserved for documentation.

Two of the eight compare the published fixtures against the private captures they
were derived from, so they skip from a clean checkout and say why. They are kept
rather than deleted because they are the tests that prove the masking held, and
they run for anyone holding the captures. The captures themselves are never
published.

## Side effects

The commands above place no calls, contact no API and require no credentials.

Some scripts under `scripts/` do place calls, and none of them is needed to
evaluate this work. Each prints what it would send and stops; a flag naming the
side effect is the only thing that makes it dial. `scripts/live-connected.ts`
places one call, and `scripts/meter.ts` deliberately consumes a day of allowance in
order to measure it.

`npm run live` previews the connected-call probe. Its default destination is
`+1 276-322-9632`, the English testing hotline CALL-E published on 7 September 2026
so that integrations can be tested without a personal number in a supported
region.

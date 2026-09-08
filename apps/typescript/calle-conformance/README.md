# calle-conformance

A corpus of real CALL-E API responses, and a checker that tells you which of them
your code has never been tested against.

Two and a half minute walkthrough, with the captured call it starts from:
https://youtu.be/EIjuAj0jOxA

## The call this started with

One call, placed through the API to see what came back. The agent said its line,
asked its question, and closed:

```
offset  role  text
     0  bot   This is an automated call from an AI assistant.
     2  user  Thanks for calling. How can I help you today?
     3  bot   Can you hear me clearly?
     6  user  I'm an                        <- cut off in the capture
     7  bot   Thank you.
     8  bot   Goodbye.
     8  user  Yes.
     9  user  I can hear you clearly.
```

Verbatim from `fixtures/calls/completed-no-failure-8turns-0f3ac1.json`, roles and
offsets as the API returned them.

The recipient answered after the agent had already said goodbye. Here is what the
platform recorded for that call:

```
taskCompleted        true
completionConfidence 0.95, high
summary              "The call completed successfully. The recipient confirmed
                      they could hear the automated call clearly, so the recorded
                      result is yes."
```

Right about the words, wrong about the conversation, and confident. Nothing in the
response says the confirmation arrived after the agent had gone; the two turns are
in `transcriptTurns` with their offsets, and reading them is the caller's job.

That is why this exists. The API emits things a caller would not predict from its
documented shape, and the only way to find out is to have seen one. So this keeps
them. The full transcript is in `fixtures/calls/`, and the walkthrough above opens
on the audio.

## Run it first

```bash
node src/replay.ts ../../..
```

That is the whole setup. No `npm install`, no API key, no network, nothing
dialled. Node 22 runs the TypeScript directly, and the only dependency in
`package.json` is needed by the optional probes, not by this.

```
corpus: 15 real responses, 8 behaviours declared as predicates.
6 projects carry call-shaped payloads to score against them.
A dot means the behaviour never appears in that project's payloads.
That is a statement about recorded test data, not a verdict on a project's code: a
project can handle a behaviour and ship no fixture for it, and a fixture is data
rather than an assertion. Read a row as coverage against this corpus, nothing wider.

project                            n    1  2  3  4  5  6  7  8
---------------------------------  --  -- -- -- -- -- -- -- --
apps/python/casechaser              7   .  .  .  .  .  .  x  .
apps/python/redline                 1   .  .  .  .  .  .  x  .
apps/python/ringdown                2   .  .  .  .  x  .  x  .
apps/typescript/calle-conformance  15   x  x  x  x  x  x  x  x   <- the corpus itself, full by construction
plugins/zapier-calle                3   .  .  .  .  .  .  x  .
skills/verify-by-phone              1   .  .  .  .  .  .  .  .
```

Eight behaviours this API really emits, and the payloads six projects test
against. A dot means that project has never seen that behaviour in a fixture.
The `calle-conformance` row is this corpus and is full by construction, because it
is where the behaviours were derived from; the table marks it so, rather than
letting it read as this tool topping its own scoreboard. Any path works, so
`node src/replay.ts ../some-app` scores a checkout that is not in this repository.

**Read a row as coverage against this corpus and nothing wider.** A dot is a
statement about a project's recorded test data, not a verdict on its code: a
project can handle a behaviour perfectly and ship no fixture for it, and a fixture
is data rather than an assertion. The printed legend gives each behaviour's
observation count, because eight behaviours drawn from fifteen responses on one
account is a floor and a behaviour seen once should not carry the same weight as
one seen seven times.

Below the matrix it also lists the projects that call this API and ship no JSON
payload at all. In this repository that is 53 of the 59 that consume it. A project
with nothing recorded is not missing six behaviours out of seven, it is uncovered
by all of them, and no dot in a table can say so.

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

## Do not take my word for any of it

The raw captures are not published, because they carry a personal number and
platform identifiers, and that is a real limit: you cannot audit my masking by
reading this repository. So the findings are built to be re-derived rather than
believed, with your own key and your own account.

```bash
npm run settle -- --i-understand-this-places-a-real-call
```

One call to the testing hotline CALL-E publishes, read on a fixed loop from
before it connects until minutes after it ends. It prints every raw timestamp it
saw and the runs they fall into. If the attempt timestamp keeps its timezone for
a window after completion and loses it afterwards, you have reproduced the
platform finding in about four minutes and one unit of the daily allowance. If it
does not, the finding is wrong and I would like to know.

```bash
npm run meter
npm run headroom
```

The metering claim, re-measured. `headroom` issues requests that reach the
planner and are refused there, and watches the counter move anyway.

```bash
node src/replay.ts <path to a checkout of this repository>
```

The matrix, against any tree you point it at. No key, no network. The two defects
it led to are named with file and line in `docs/found-by-the-corpus.md`, so they
can be checked against somebody else's source rather than against my summary of
it.

What is not reproducible from here is the corpus itself: those fifteen responses
came from one account in one region, and a different account may see different
behaviour. That is stated again under "What this does not prove", and it is the
reason the instruments above exist.

## The finding this exists to carry

**On the free tier, every request that reaches the planner consumes one call from
the 20-per-24-hour allowance, including the ones the planner refuses.** No number
is dialled, no phone rings, no call object is created, and the allowance drops by
one anyway.

Units return individually, each exactly 24 hours after it was spent. There is no
daily reset.

Nothing surfaces this while it is happening. There is no usage endpoint: a merged
project in this repository records that `/v1/account`, `/v1/balance`,
`/v1/credits`, `/v1/usage` and `/v1/me` all return 404, and leaves open the
question of whether a no-answer consumes a credit. The remaining allowance appears
in exactly one place, the body of the 429 that tells you it is gone.

That is the gap, and it is a documentation and surfacing gap rather than a pricing
one. The rule itself is defensible: a request the planner has to read has cost the
planner something. What no caller can currently do is see the count move. A
`remaining` field on a successful response, or one line in the quickstart saying
refusals count, would close it, and would fix every project below at once without
any change to the metering.

The consequence is ordinary. A developer in an unsupported region, or one
iterating on a task the planner declines, can exhaust a day of allowance without
ever reaching a person, and has no way to see it coming. More than twenty projects
in this repository maintain a local call budget that counts one unit per created
call. Under the measured rule, all of them undercount, and none of their authors
had any way to know.

**Nothing is claimed here about idempotency.** An earlier draft of this file said
a refused request burns its key, so the corrected retry is rejected as a conflict.
The evidence does not support it. `probe-results/2026-09-05T07-52-53-494Z-tier2.json`
does hold five `idempotency_conflict` responses, and they share one key across five
requests with different region and locale pairs, which is the documented meaning of
a conflict and is the probe harness reusing a key rather than a platform behaviour.
Every one of those records also carries `"costedACall": "unknown"`, so the cost was
never established either. The claim is withdrawn rather than softened.

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

Reading the counter without placing a call is possible because of an observed
ordering of outcomes, stated as what was seen rather than as an internal
architecture: a malformed payload returns 422 whether or not there is headroom; a
well-formed request to an unsupported region returns 422 while there is headroom
and 429 carrying `limit`, `window_hours` and `count` once there is none. Several
implementations produce that table and this cannot tell them apart, so no claim is
made here about which check runs where. Note the asymmetry: the
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

`fixtures/` holds fifteen real production responses, rewritten for publication. Eight
behaviours a caller would not predict from the documented shape are declared in
`src/quirks.ts` as executable predicates rather than prose, so one definition
labels the corpus, verifies the rewriting, and scores third-party code.

Behaviour 8 is the newest and the one nothing else in this repository has seen.
On six of the seven connected calls in the corpus, the recipient goes on speaking
after the agent's final turn. Twice the answer to the agent's own question arrives
after it has said goodbye, because it accepted a fragment the recipient was still
mid-word on and closed. `taskCompleted` came back true at 0.86 to 0.95 confidence,
labelled high, on every one. Code that reads the answer as the turn following the
question takes `"I'm an"` on one of these calls; the real answer is two turns
later.

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

Exit status is a verdict only when you ask for one. With no `--require`, the
checker reports and exits 0, whatever it found. With `--require`, it is a gate
and it exits 20 or 45 on purpose, and the section above says what each means.

Files that carry transcript turns in a shape the checker cannot read are listed
rather than counted as empty, because silently dropping a payload is the failure
this corpus exists to expose.

The corpus is fifteen responses from one account in one region. It is a floor, not a
specification.

## What it found

An absence is a shortlist, not a defect. `docs/found-by-the-corpus.md` records the
absences that turned out to matter, with the file and line so each one can be
checked rather than believed.

The first: `apps/typescript/call-on-behalf` maps a failed call to an outcome by
looking for the words `voicemail`, `machine`, `answer`, `busy` or `unreachable`
inside `attempt.failureCode`. The three codes in this corpus are `404`, `486` and
`603`, so every one of them falls through to the default branch. Its own test
exercises that branch with `failureCode: "busy"`, which is the documented
vocabulary and is not what an attempt carries. The test proves the branch works.
It cannot show that the branch is reachable.

An earlier version of this paragraph went further and said a caller who reaches an
answering machine is therefore told the call did not connect to a person. **That
part was wrong and is withdrawn.** `src/errand.ts:420` reads the transcript for a
machine greeting before the failure code is consulted at line 425, so that message
has a route the word branches are not on. A maintainer reproduced the workflow and
said so in
[issue #375](https://github.com/CALLE-AI/awesome-phone-call-agents/issues/375);
checking it against the source, they are right. What survives is narrower: every
failed call here carries `transcriptTurns: []`, and with no transcript the code is
the only signal, so `404` (not routable), `486` (Busy Here) and `603` (Decline)
collapse into one outcome. `docs/found-by-the-corpus.md` carries the full
correction.

The second is worse, and it is in a project that screens job candidates.
`apps/typescript/hirecall` guards against scoring somebody who was never reached
by testing `end_reason`. That field does not appear in any of the fifteen
responses here, so the app's own schema parser manufactures one, defaulting it to
`"failed"` (`src/lib/call-result-schema.ts:111`). Because that default is truthy
the fallback beside it never runs, and `"failed"` is not `"no_answer"`, so the
guard misses on exactly the payloads it exists for. The value the check reads was
invented by the app, from a field the platform did not send. Two fields it already
receives, a non-null `failureCode` and an empty transcript, would settle it
without guessing. It ships no tests, so nothing exercises the branch.

## What the re-read found

Those two are about code. This one is about the platform, and it is the only
question a corpus of dated responses can answer that a test suite structurally
cannot: a suite can tell you your code still does what it did, never that the API
underneath stopped doing what it did, because the suite's idea of the API is a
fixture the suite wrote.

```bash
npm run drift
```

It re-reads the recorded calls rather than placing new ones. Each response belongs
to a call that still exists, so `calls.get(id)` returns today's serialisation of
the same event. It creates nothing and spends no allowance.

On its first live run it flagged five of the fifteen. Following them with
`npm run settle`, which places one call and reads it every few seconds from before
it connects until minutes after it ends:

```
2026-09-08T08:33:12.596Z  completed   zone      2026-09-08T08:32:40.611544Z
2026-09-08T08:33:25.785Z  completed   zone      2026-09-08T08:32:40.611544Z
2026-09-08T08:33:38.275Z  completed   NO zone   2026-09-08T04:32:40
   ... every read after, through 08:41:14Z, identical
```

**A connected call's attempt timestamp carries its timezone for a window of under
a minute after the call completes, and not before or after.** The later form has
lost the designator and the `.611544` both, and reads four hours earlier. Only the
attempt moves; `call.createdAt` and `call.completedAt` keep their zone on every
read. Four hours is not the caller's offset, which was UTC-5.

It costs a caller because the attempt is where the start time lives, so two
readers of one call get different answers depending on when they read, and the
later one gets the form that is easier to misread: with no designator,
ES2015-conformant engines parse `"2026-09-08T04:32:40"` as local time, so a
JavaScript reader outside the server's zone shifts it again by their own offset.

No mechanism is claimed, and one exception has no explanation: two connected calls
captured on 5 September still read tz-aware three days later while five captured
on 7 September do not. `docs/what-the-re-read-found.md` carries the reproduction,
the limits, and the mistakes the tool's own first runs made before this was
written.

## What this cannot see

Every behaviour here is about the shape of a response. None of them is about who
was on the line.

The API reports that a person answered and what they said. It does not establish
which person, and neither does anything in this repository: a project that dials
a number and treats whoever answers as the intended recipient is making an
assumption no payload can confirm. This corpus inherits that limit rather than
solving it, and no predicate here should be read as evidence about identity.

An open question from 7 September was tested and closed. One call whose task
ended with "Do not say anything else" produced a sentence the task did not
contain, at 0.92 confidence. `scripts/compliance.ts` repeated it four times with
a task that enumerates the exact sentences the agent may speak, so that
"unauthorised" is decidable rather than argued. The agent complied in all four.
The reading was wrong, and the likely cause was a task written in prose that left
room, not a platform ignoring an instruction. The experiment is kept because the
four calls it placed are in the corpus and because a refuted guess is cheaper to
publish than to repeat.

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

## Where the key can go, and what the terminal prints

`CALLE_BASE_URL` decides where the API key is sent, so it is a credential
destination rather than a convenience setting. `src/endpoint.ts` validates it:
https only, and only a CALL-E origin. Anything else is refused with a message
saying why, instead of being handed to the client. Six tests cover it, including
a path that tries to smuggle a different destination past an allowed origin.

Destinations printed by the probes are masked to their country code and last two
digits, because terminal output ends up pasted into issues and screen recordings.
The published testing hotline is the one exception and stays legible, since it is
public.

## Side effects

The commands above place no calls, contact no API and require no credentials.

Some scripts under `scripts/` do place calls, and none of them is needed to
evaluate this work. Each prints what it would send and stops; a flag naming the
side effect is the only thing that makes it dial. `scripts/live-connected.ts`
places one call, and `scripts/meter.ts` deliberately consumes a day of allowance in
order to measure it. `scripts/compliance.ts` places one call per run to test
whether the agent speaks outside a task that enumerates its permitted sentences.

`npm run live` previews the connected-call probe. Its default destination is
`+1 276-322-9632`, the English testing hotline CALL-E published on 7 September 2026
so that integrations can be tested without a personal number in a supported
region.

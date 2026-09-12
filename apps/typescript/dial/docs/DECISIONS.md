# Decisions

Significant choices, and why. Where this project departs from the brief, the
departure is recorded here with its reason (§2).

---

## 1. Built fresh in `d:/Call-E App`, not on top of `d:/Call-E`

An existing monorepo ("CALL-E FrontDesk") sits at `d:/Call-E` with a working
CALL-E provider, database and mobile app. It was inspected first, and its
research into the CALL-E API was independently re-verified against the shipped
`@call-e/calle@0.7.0` type definitions before any of it was relied upon.

The decision to start fresh was the user's, taken with the trade-off stated. The
prior project's **research** was reused (it proved accurate); none of its code
was copied.

## 2. The CALL-E contract was verified from the package, not the prose docs

Every status value, error code, webhook event type and method signature in
`packages/schemas/src/calle.ts` was read out of
`node_modules/@call-e/calle/dist/generated/schema.d.ts` and `dist/calls.d.ts`.

This matters because the published package is **ahead of the documentation**:
the SDK guide describes 0.2.2 while npm serves 0.7.0. Building against the docs
would have produced code that does not match the shipped client.

Verified facts encoded in the source:

| Fact | Where |
| --- | --- |
| `CallStatus` = queued \| in_progress \| completed \| failed \| canceled | `schema.d.ts:432` |
| `AttemptStatus` adds `dialing` | `schema.d.ts:448` |
| Exactly three webhook event types | `schema.d.ts:604` |
| 23 error codes in `APIError.code` | `schema.d.ts:633` |
| `webhooks.verify()` is `@deprecated` — deliveries are unsigned | `webhooks.d.ts` |
| No cancellation operation exists on the Calls API | absent from `calls.d.ts` |

## 3. `create` + poll/webhook, never `createAndWait`

The SDK offers `createAndWait` and `waitForResult`. Both block for up to two
minutes. Dial creates the call, returns immediately, and reconciles through the
worker's poller plus the terminal webhook — because §5 requires that phone work
not depend on an HTTP request staying open.

## 4. No cancel button

The Calls API exposes no client-initiated cancellation. Rather than render a
button that cannot honour its label, Dial puts the guard *before* dispatch (the
authorization gate) and, on cancel, states plainly how many calls were already
connecting and cannot be pulled back.

## 5. The job queue is PostgreSQL, not Redis

**Departure from the brief's suggestion.** §5 proposes Redis + BullMQ.

Redis is not available on the target machine and no container runtime is either.
More importantly, Dial already requires Postgres, and putting the queue in the
same database as the tasks means claiming a job and recording its effect happen
against one system — a crash between "job taken" and "call recorded" cannot
leave the two disagreeing.

The implementation uses `FOR UPDATE SKIP LOCKED`, which is the standard,
production-grade pattern for this. Delivery is at-least-once, which is safe only
because dispatch is guarded by a unique index on `calls.idempotency_key`.

A BullMQ driver activates when `REDIS_URL` is set.

**Known limitation:** PGlite is single-connection, so true multi-worker
contention on `SKIP LOCKED` is exercised only against a real Postgres server.
The query itself is tested; the concurrency is not. Marked BLOCKED in
`docs/TESTING.md`.

## 6. OpenStreetMap is the default discovery provider

**Departure from the brief's suggestion**, which names Google Places first.

No Google Places key was available, and the alternative — shipping a stubbed
discovery layer — would have made the central claim of the product fake. OSM
(Nominatim for geocoding, Overpass for search) is real internet data, properly
licensed under the ODbL, requires no key, and its contributors maintain
`phone` / `contact:phone` tags.

Verified working: a live query for phone repair near Dublin 2 returned 59 real
businesses, 15 with numbers that pass E.164 validation.

Trade-offs, stated plainly:

- OSM has **no ratings or review counts**. Those fields stay `null` rather than
  being invented. Ranking leans on distance, opening hours and phone
  corroboration instead.
- Coverage varies by region. Google Places is preferred automatically whenever
  `GOOGLE_PLACES_API_KEY` is present, and both run together so a number
  appearing in two independent sources can be marked `phoneVerified`.
- Nominatim's usage policy requires an identifying User-Agent with a contact
  address and ≤ 1 request/second. Both are enforced in code, not left to the
  caller.

## 7. The interpreter is Gemini

`@google/genai@2.18.0` (the current unified Google Gen AI SDK, not the legacy
`@google/generative-ai`), verified from its shipped `dist/genai.d.ts` the same
way the CALL-E contract was.

Default model `gemini-3.7-flash`: the current stable release, described by
Google as built for agentic workflows and reliable multi-step execution.
`gemini-3.1-pro-preview` is more capable but is a preview, and the same
reasoning that keeps Goal Runs out of the core loop (decision 14) applies here.
`LLM_MODEL` overrides it.

**Gemini's schema subset is not plain JSON Schema**, and this bit:

| JSON Schema | Gemini |
| --- | --- |
| `type: ["string", "null"]` | rejected — use `nullable: true` |
| free-form `object` | no equivalent — use an array of key/value pairs |
| `enum` alone | pair with `format: 'enum'` |
| declaration order | state `propertyOrdering` explicitly |

The union-type form the schema originally used would have been rejected at
request time. `constraints.additional` now arrives as a key/value list and is
folded back into a record by `toAdditional()`, which also accepts a plain object
so a future provider or a test can supply the simpler shape.

Gemini also reports refusals through *fields* rather than exceptions —
`promptFeedback.blockReason` before generation, `candidates[0].finishReason`
after — so both are checked explicitly. A `MAX_TOKENS` finish is reported to the
user as a too-long request rather than being parsed as if it were complete JSON.

Seventeen unit tests cover the mapping, including that an invented
`requestedSideEffect` is rejected rather than reaching the policy engine.

## 8. There is no fallback task interpreter

When `LLM_API_KEY` is absent, `POST /api/tasks` returns `503
llm_not_configured` and names the missing variable.

A rule-based classifier standing in for language understanding is exactly the
"hard-coded task types disguised as AI" that §41 forbids. Failing loudly is the
honest behaviour. Tests inject a stub interpreter through the
`TaskInterpreter` interface; production never can.

## 9. Currencies are never converted

If quotes come back in more than one currency, Dial compares within the majority
currency and adds a caveat saying so. Applying an invented exchange rate and
then ranking on it would fabricate the very number the user is relying on.

## 10. The comparison headline is generated in TypeScript, not by a model

`buildHeadline()` is a pure function of the evidence tally. A model asked to
summarise would eventually write "the cheapest in the area", and that claim
cannot be supported by four phone calls. The headline can only say what was
counted.

## 11. `status` was renamed to `reported_status`

The `status_check` result schema originally had a `status` field. A unit test
asserting no shipped schema uses CALL-E's reserved recipient field names caught
it. Renamed so the schema is valid in both the `result_schema` and
`recipient_result_schema` positions.

## 12. SSE tails the database, not an in-memory bus

Progress events are written to `task_events` by the worker and tailed by the
API's `/api/events` endpoint. An in-process event bus would have worked only
when the API and worker were the same process, which they deliberately are not.
Tailing a table also means a client that reconnects resumes from a durable
record instead of silently missing what happened while it was away.

## 13. Mobile polls; web streams

The web app uses SSE. The mobile app polls on an interval that stops when the
task is not moving. Phones suspend sockets when they lock, and adaptive polling
is both simpler and more reliable there than fighting the platform.

## 14. Goal Runs are not used

`/v1/goals` exists in the SDK. The docs describe it as a preview whose contracts
differ from the request-scoped Calls API. Adopting a preview surface for the
core loop would trade reliability for novelty. If it stabilises it slots in
behind `CallProvider` with no change above that seam.

## 15. Passwords use Node's scrypt

Not bcrypt or argon2, both of which need a native toolchain to install. scrypt
is memory-hard, ships in Node's standard library, and keeps deployment simple.
16-byte random salt, 64-byte key, constant-time comparison.

## 16. Migrations are split into single statements before execution

PGlite executes through the extended query protocol, which rejects multiple
commands in one prepared statement. `splitStatements()` is quote-aware and
dollar-quote-aware so a semicolon inside a literal does not end a statement.
Found by a failing test, not by inspection.

## 17. A terminal snapshot at create time is applied immediately

Some outcomes are known the moment a call is created — an invalid number, a
blocked recipient. Waiting 20 seconds to poll for a result the provider already
returned is pointless. Found while testing: tasks were parking in `calling`
because the inline-terminal path never advanced them.

## 18. PGlite forces the worker in-process for local development

PGlite is genuinely PostgreSQL, but it is *embedded* and single-process: opening
the same data directory from a second process aborts inside the WASM runtime
with `Aborted()`, which is not a diagnosable error message.

Found by running the API and the worker together, as the documentation told the
reader to. Rather than paper over it:

- with no `DATABASE_URL`, the API runs the job loop in-process and says so in its
  startup log;
- the standalone worker refuses to start on PGlite and explains both ways out;
- with a real `DATABASE_URL` the two are separate processes, as production
  requires.

`RUN_WORKER_IN_API` overrides the default in either direction. The production
topology is unchanged — this only affects what is convenient locally.

## 19. `started_at` is not a reliable "has it started dialling" signal

Observed on the first real call. While the attempt was live, `GET /v1/calls/{id}`
reported `recipients[0].status: "in_progress"` but `attempts[0].started_at:
null` with zero transcript turns — which reads as "queued, not yet dialling".

It was dialling. The terminal payload for the same attempt carried
`started_at: 2026-08-20T08:37:11Z`, roughly 53 seconds after creation, so the
field is only populated when the attempt finalises.

Consequence: never infer progress from `started_at`. The poller keys off the
call `status` alone and treats anything other than `completed`/`failed`/
`canceled` as still running, which is correct and needed no change — but the
live view should not be shown to a user as "not started yet".

Also worth recording: the call-level `status` stays `queued` while a recipient
attempt is already `in_progress`. The two are not in lockstep.

## 20. A declined call is a result, not an error to retry

The first real call was declined at the handset (`status=DECLINED, Hangup by:
user`, 0s). CALL-E still returned a schema-valid `structured_result` with
`question_answered: "no"` and an `evidence_summary` stating plainly that no ASR
was captured.

Dial maps that to the `failed` disposition: not counted among "answered", and
excluded from producing a best option. `call_failed` is not in the retryable
set, so it is surfaced rather than redialled — redialling somebody who just
rejected the call is exactly the behaviour section 18 forbids.

## 21. A provider error is never the user's error message

A live Gemini overload put this in the progress list, verbatim:

```
{"error":{"code":503,"message":"This model is currently experiencing high
demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}
```

Two separate faults, fixed separately.

**The wording.** `handleInterpret` passed `error.message` straight to
`failTask`, and the SDK puts the raw JSON body there. Provider exceptions are
now classified by HTTP status alone — the message is never read — and
`presentableFailure()` is a last-resort guard on `failTask` that rejects JSON
bodies, stack traces, SQL errors, connection codes, empty strings and anything
over 300 characters, substituting neutral wording and logging the original for
engineers.

**The behaviour.** A 503 is transient, but the task was marked permanently
failed. Overload, rate limiting and network faults now raise
`InterpreterBusyError`, which the handler rethrows so the queue retries with
backoff; the user sees *"Still working — Dial is waiting on a busy service and
will retry shortly."* Only an exhausted job becomes terminal, and the runner
does that explicitly rather than leaving the task spinning in `interpreting`
forever.

Fixing the retry exposed a third bug: `handleInterpret` returned early unless
the task was `created`, so every retry was a no-op that "succeeded". It now
also accepts `interpreting`, which is precisely the state a retry starts from.

## 22. A simulated call is labelled per call, not per configuration

A user ran a task in dry run, saw five Dubai businesses "answered", and asked
why every transcript was identical. They were identical because nothing was
dialled — but the UI never said so, and the reasonable reading was that real
shops had been rung. That is precisely the confusion section 31 exists to
prevent.

Three changes:

1. **`calls.provider` records which backend placed each call** (`fake` or
   `calle`), written at dispatch. The label therefore belongs to the call
   forever and does not change when the server is later switched to live —
   which reading current config at render time would have done.
2. **The UI says so twice**: a banner on any task containing a simulated call,
   and a per-row "Simulated" pill so a row read in isolation is still
   unambiguous.
3. **The fake transcript announces itself** — its first line is
   `SIMULATED CALL — no telephone call was placed...`. Making the fake *more*
   convincing would have been the wrong fix; making it unmistakable is the
   right one.

The migration backfills existing rows from the `fake_` / `call_` id prefixes,
so history created before the column existed is labelled correctly rather than
defaulting to "real".

## 23. Deleting a task must not then re-fetch it

`act()` refreshed the task after every action, including delete — so removing a
task immediately requested the row it had just removed and logged a 404 in the
browser console. Callers can now opt out of the refresh, delete does, and
`router.refresh()` drops the entry from the sidebar. A 404 arriving from the
poller for any other reason marks the task gone, stops polling, and says so
rather than retrying a row that will never come back.

## 24. A country is not a place you can search

"Find the cheapest iPhone repair near me in finland" reported that there were no
iPhone repair shops in Finland. Nominatim resolves `finland` to
`addresstype: country` at 63.2467, 25.9209 -- rural central Finland, in a
bounding box 1181 x 705 km -- and Dial then searched a 10 km radius around that
centroid. The answer was true of that forest and useless to the user.

A coordinate alone cannot distinguish "Helsinki" from "Finland". `GeocodeResult`
therefore carries `addressType` and `spanKm` (derived from the bounding box),
and `isTooCoarseToSearch()` rejects countries, states and regions, plus anything
wider than 200 km -- which catches large administrative areas without flagging
genuinely big cities. Dubai (90 km) and Helsinki (42 km) pass; Finland does not.

When the location is too coarse, Dial asks which town or city rather than
searching and reporting an absence it never established.

Separately, zero results at the default radius no longer ends the task: it
widens once (4x, capped at 50 km) and searches again. A shop 12 km away is still
a useful answer, and one extra directory query is far cheaper than a wrong
"none found".

## 25. Whether to ask the user is a product decision, not a model decision

Switching the default model surfaced this. Asked to find an iPhone repair shop,
one model proceeded; another first wanted to know *"Which model of iPhone, and
what is the issue?"* -- a question the business asks on the call, not one Dial
needs in order to search.

Section 10's promise is that the user is not interrogated. Leaving that to
prompt wording alone means the product's core behaviour changes with whichever
model happens to be serving traffic, so `shouldAskClarification()` enforces it
in TypeScript. A question reaches the user only when proceeding would be unsafe
or impossible: a sensitive domain where details must never be invented,
credentials only the user holds, or an unbounded spend. Everything else is
defaulted or asked on the call, and an ignored question is logged.

## 26. The default model is the one that answers

`gemini-3.7-flash` -- the newest stable flash model, and the obvious default --
returned 503 on 3 of 3 probes during development, repeatedly. `gemini-3.5-flash`
returned 3 of 3 successes. `gemini-2.5-flash`, which earlier notes suggested as
a cheaper fallback, returns 404 on the Gemini API key in use and is not an
option at all.

The default is now `gemini-3.5-flash`, with `LLM_FALLBACK_MODELS` tried in order
when the primary is overloaded. Because individual models are rate-limited
separately, falling through the list converts a provider-wide "try again later"
into a slightly slower success. Only an overload triggers a fallback -- a
malformed request or a bad key fails identically everywhere, so retrying it
elsewhere would just waste time.

## 27. Intake questions, asked once and skippable

Requested directly: analyse the request and ask three to five questions before
starting. That sits in tension with section 10 ("do not ask unnecessary
questions"), so the two are kept distinct rather than merged:

- **Intake** (this) is deliberate: generated once, capped at five, presented as
  a single form with one-tap options, and skippable. The answers become task
  constraints and reach the call brief.
- **Mid-pipeline clarification** stays suppressed by `shouldAskClarification`.
  A model deciding halfway through that it would like to know something is not
  the same as a considered intake step.

Every question must change either *who gets called* or *what they get asked* --
a question whose answer changes neither is noise. The prompt bans asking for
anything already known, anything personal or sensitive, and anything about how
Dial works. `askClarifyingQuestions` turns the whole step off.

If generation fails or returns nothing, the task proceeds. Intake improves the
outcome; it must never be able to block it.

Answers are keyed on the ids Dial issued, and answers to ids it never asked are
discarded -- otherwise an arbitrary key would become a task constraint and reach
the call brief.

## 28. Dial's patience is not a ring timeout

Requested: wait 30 seconds, twice, then move to another business.

Implemented as `CALL_ANSWER_TIMEOUT_MS` x `CALL_MAX_ATTEMPTS_PER_BUSINESS`
(30s x 2 = 60s) of waiting, after which the call is marked `no_answer` and the
next business is dispatched.

The wording matters and is enforced in the UI text: CALL-E exposes **no ring
timeout and no cancellation**, so Dial stops *waiting* -- it cannot stop a call
that is already connecting. The event says "no answer after 60s -- trying
another business", never "cancelled".

Dial also does not redial the same business after abandoning it. Something may
still be live at the provider, and ringing a business twice at once is exactly
the harassment section 18 forbids.

## 29. Two bugs the wave feature exposed

Both found by writing the tests, not by reading the code.

**Later waves were never dispatched.** `maybeAdvance` treated every `pending`
call row as outstanding and returned early. But rows for waves 2 and 3 are
created up front and are `pending` precisely *because* they have not been
dialled yet -- so the guard fired every time, and only wave 1 ever ran. Those
rows then sat in the UI as "In progress" indefinitely. Outstanding now means
dispatched **and** unresolved (`providerCallId` present).

**The tally counted businesses that were never rung.** `contacted` was
`calls.length`, which included those undispatched rows. A task that dialled
three businesses reported "contacted 5". Since the entire point of the tally is
that every number in it is defensible, `contacted` now counts only calls that
actually reached the provider.

## 30. A category search is not a name search

"Find the most delicious croissant in Paris" failed with "could not reach the
business directory". Three compounding causes, all real.

**The domain was unmapped.** Gemini classified it as `bakery`, which was not in
the domain table, so there were no OSM tags to search. The table now covers 34
domains rather than 14, and keyword matching prefers the longest match so
"shoe repair" beats "shoe".

**The fallback was the wrong query shape.** With no tags, it matched business
*names* with a regex: `["name"~"bakery croissant",i]`. No bakery is called that,
and worse, Overpass has no index for a bare name regex — it scans every element
in the radius. Measured on a 3 km radius in central Paris: **55 seconds, then a
timeout**. That is now replaced by two better steps: guess the OSM tag from the
domain key (the interpreter emits OSM-flavoured snake_case, so `bakery` is
frequently the literal tag value, and the lookup is indexed), then fall back to
Nominatim free-text search, which is a purpose-built text index and answers in
under a second.

**A directory blip ended the task.** Overpass returns 504 under load often
enough that one endpoint is an availability problem on its own. There is now a
mirror, and a retryable discovery failure hands the job back to the queue with
backoff — the same treatment a busy model gets — instead of failing the task.
The user sees "the business directory is slow right now" and the work resumes.

Verified live afterwards: bakeries in Paris returned 79 businesses, 21 with
callable numbers, in under five seconds; bookshops 78 and 33.

## 31. The model chain has to be wide, because saturation moves

A task failed at interpretation with "could not reach a service it depends on".
Both models in the chain were 503 at once. Measured across the Gemini family in
one sweep:

| model | result |
| --- | --- |
| `gemini-3.5-flash` (then primary) | 0 of 3 |
| `gemini-3.7-flash` (then fallback) | 0 of 3 |
| `gemini-3.6-flash` | 3 of 3 |
| `gemini-3.5-flash-lite` | 3 of 3 |
| `gemini-3.1-flash-lite` | 3 of 3 |
| `gemini-3-flash-preview` | 3 of 3 |
| `gemini-2.5-pro` | 404 -- not on this key |

An hour earlier the first two had been the working ones. Saturation moves
between models, so a two-model chain is not resilience, it is a coin flip. The
chain is now six models deep, swept twice with a short pause between sweeps
(a rejected model fails in well under a second, so a second sweep is cheap), and
interpretation gets a longer queue retry budget on top.

Measured after the change: 5 of 5 interpretations succeeded, one of which fell
through to a second model mid-run.

## 32. An answer that names a place must move the search

The intake asked "Which city in Saudi Arabia are you located in?", was told
"Riyadh", stored it in `constraints.additional` -- and then searched Saudi
Arabia anyway, hitting the too-coarse guard. The answer improved the call brief
and changed nothing about where Dial looked.

`placeFromAnswers()` now recognises a location answer by its question id
(`city_location`, `area`, `district`, ...) and rewrites the task's location,
keeping the broader place for context: "Riyadh" alone is ambiguous worldwide,
"Riyadh, Saudi Arabia" is not. Non-answers ("anywhere", "no preference") are
ignored rather than geocoded.

Nominatim is also asked for English labels now. Without that, the coarse-place
message came back as "السعودية covers too large an area for Dial to search" --
the localised name dropped verbatim into an English sentence.

## 33. Widen on callable businesses, not on businesses found

Riyadh returned 14 phone-repair shops of which exactly **one** published a
number. Jeddah returned 49 with seven; Paris returned 79 bakeries with 21.
Directory phone coverage varies enormously by region, and finding fourteen
businesses you cannot ring is not a useful answer.

The widening trigger is therefore the count of *callable* businesses, not the
count found: below three, the radius widens once (4x, capped at 50 km) and the
better of the two passes is kept. In Riyadh that turned 14 found / 1 callable
into 40 found / 7 callable, and a task that could make one call into one that
made five.

## 34. A planned call that was never needed says so

Dial stops once it has enough answers, which leaves later planned calls
undialled. Those rows sat in the UI as "In progress" indefinitely -- describing
a call that was never going to happen.

They are now marked `not_needed` ("Dial had enough answers before reaching this
one") when the task completes. The row stays, because it is a real part of the
plan and of the evidence trail; it just stops claiming a call is under way.

## 35. Google as the directory, without teaching Dial who the directory is

Switching from OpenStreetMap to Google is a configuration change --
`DISCOVERY_PROVIDER=google` plus a key -- because everything above
`BusinessDiscoveryProvider` and `GeocodingProvider` works in terms of
`BusinessCandidate` and `GeocodeResult`. That was the point of the seam.

The seam only holds if both providers answer the same questions, and the
Google geocoder was answering four of the eight fields. The missing ones were
not cosmetic. `isTooCoarseToSearch` decides whether a match is a sensible
centre for a local search by reading `addressType` and `spanKm`; handed
Google's raw `administrative_area_level_1` and no span, it recognises nothing,
treats a whole country as searchable, and searches 10 km around its centroid.
That is precisely the "no iPhone repair shops in Finland" failure from section
24, and it would have come back silently on the day the key was set.

So Google's vocabulary is translated into Dial's -- `locality` to `city`,
`administrative_area_level_1` to `state` -- and the extent comes from
`geometry.bounds` where Google publishes it, falling back to `viewport`, which
is a display rectangle and can be padded.

Two Google-specific wrinkles:

**The timezone costs a request.** Country-to-city resolution reads the IANA
zone, which OpenStreetMap carries on the country relation but Google returns
only from a separate Time Zone API. It is fetched for country-sized matches
only -- asking on every geocode would be a request per task for no benefit.

**A rejected key must not look like an empty area.** `ZERO_RESULTS` is a real
answer and returns null. Every other non-OK status raises, because a disabled
API returning "nothing found there" is the kind of failure that gets debugged
for an afternoon. `REQUEST_DENIED` and 403 are reported as configuration
faults naming the likely cause, since the Places API, Geocoding API and Time
Zone API are enabled separately and the first run usually misses one.

`DISCOVERY_PROVIDER=auto` keeps OpenStreetMap alongside Google rather than
replacing it, because a phone number confirmed by two independent sources is
what lets a candidate be marked `phoneVerified`. Choosing `google` is a
deliberate trade of that corroboration for a single, better-maintained source.

A key that does not work yet is worse than no key. The three APIs are enabled
separately from issuing the key, so a fresh key has none of them on -- which was
the state of the first real key tried here. Choosing the geocoder on "is a key
present" alone meant every lookup threw and no task could resolve a location:
adding a credential broke a working app. In `auto` the geocoder is now Google
backed by Nominatim, so a rejected key costs a log line rather than the feature.
`google` mode keeps no fallback, because asking for one provider and silently
being served another is the quiet substitution Dial must not make.

## 36. The answer budget bounds ringing, not the call

Five businesses were reported "No answer within 60 seconds". CALL-E's own
record of the same five calls: one held a 96-turn conversation lasting six and
a half minutes and quoted a price of 2820; another ran 106 turns and reached a
live person; a third connected and exchanged eleven turns. Only one genuinely
failed to connect.

Every local row still read `provider_status=queued`. The budget had been spent
while the calls sat in CALL-E's queue, before a single phone rang. Dial gave
up, CALL-E dialled anyway -- it exposes no way to cancel a call in flight --
held the conversations, and the answers were discarded.

Three faults, one line of arithmetic:

**Queue time was counted as ringing.** The clock ran from dispatch. It now
starts when the call leaves the provider's queue, because until something
rings, nothing has gone unanswered.

**An answered call could be cut off.** Sixty seconds is a long ring and a short
conversation, and the budget was applied to both. `callPhase()` now reads the
attempts rather than the call status -- the call-level `in_progress` covers
queueing and dialling too, while an attempt distinguishes `dialing` from
`in_progress`. Transcript turns count as proof on their own: words were
exchanged, so somebody answered.

**A call written off was never looked at again.** Since it cannot be cancelled,
one Dial has stopped waiting for may still be connected and may still return
the answer the task was for. Polling now continues after Dial moves on, and a
terminal snapshot may reclaim a row marked `answer_timeout`. Leaving it saying
"no answer" when a price had been quoted would be a lie Dial held the evidence
to correct.

The wording was accurate for what the code measured and false about the world,
which is the worst combination: it reported a business as unresponsive when the
business had answered, quoted, and been ignored.

## 37. One process may hold the local database, and it must say so

The server died on startup with `Aborted(). Build with -sASSERTIONS for more
info.` -- a WASM-level abort naming nothing. It happened three times during
development, and each time the fix was to work out by hand which directory was
broken and move it aside.

The cause was always the same. PGlite is a single process holding a directory,
and `tsx watch` plus a few stray `npm run dev:api` invocations produce several
at once. They do not queue: they corrupt the database, and every start
afterwards aborts.

PGlite's own `postmaster.pid` cannot detect this -- it holds the sentinel `-42`
rather than a real process id, so every check reads as "nobody is there" and
the second server proceeds. Dial now writes `dial-server.lock` containing its
actual pid. A live holder is refused by name:

> Another Dial server (pid 26692) already has .pgdata open. PGlite allows one
> process at a time, and a second one corrupts the database.

A lock whose process is gone is cleared rather than blocking startup forever,
which is the failure mode a naive lock file would have introduced instead.

Recovery had to be split across two starts, which is not obvious. When a
database is found damaged, the directory cannot be moved *by the process that
found it*: the failed instance keeps handles inside it for the life of that
process, and Windows refuses to rename a directory with open handles. Renaming
it was attempted, failed with `EPERM`, and the error was swallowed -- so the
"fresh" start reopened the same broken directory and reported the same abort
with the cause now hidden. Instead the damaged copy is marked, the server stops
with an error that says what to do, and the next start clears it before opening
anything, which is the one moment no handles exist.

The damaged directory is always kept, never deleted. This is development data,
but it is still somebody's.

## 38. A number in the request is the answer, not a detail

"Call +971 55 550 1234 and ask about my order" needs no directory, no
geocoding and no location. The search stage exists to work out who to ring, and
that has already been settled. Asking where to look would be asking the user to
repeat what they just said, in a worse form.

So a task carrying a number skips discovery outright. It still goes through the
same ranking, policy gates, daily budget, blocked-number check and evidence
trail as a business Dial found -- only the finding is skipped.

The number is read in code rather than by the model. A phone number is a
precisely specified pattern with a library that validates it, so extraction is
exact and testable; a model asked the same question would occasionally return a
price or an order number, and Dial would ring it. The tests pin the cases that
matter: "iPhone 13", "2820 dirhams", "order number 12345678" and "table for 4 at
7pm" all yield nothing, and `999` is refused before the policy layer ever sees
it. A national number ("055 550 1234") is read against the country of the user's
last search, which is the best available evidence of where "local" is;
international form needs no such hint.

The candidate is named "The number you gave" rather than given an invented
business name, because nothing was looked up and a name would be a guess
presented as a fact. If the number is already in the user's contacts, its saved
name is used instead -- which is the point of contacts existing.

Contacts are renameable because that is the entire value. "+971 55 550 1234"
means nothing a month later; "Ahmed at the garage" means everything. Saving a
number already kept renames it rather than creating a second row. Numbers are
shown in full on that page, unlike everywhere else: the masking elsewhere
protects numbers Dial found, while these are numbers the user typed themselves,
and hiding them would only stop them recognising their own address book. Saving
from a task refers to the task rather than posting the number, so a raw number
never travels to the client and back to be stored.

## 39. A dedupe key reserves a slot, it does not claim one forever

A task answered a question and then sat in `interpreting`, its progress list
reading "Understanding request" with nothing after it. It never failed and
never retried. It simply stopped.

The queue's unique index on `dedupe_key` covers every row regardless of state.
Enqueueing is `ON CONFLICT (dedupe_key) DO NOTHING`, so a *completed* job kept
its key permanently and the same work could never be queued again. Answering a
question after the search had run re-interpreted the task, which tried to
enqueue `research:<taskId>` a second time; the insert was silently dropped, no
job ran, and nothing moved.

Silently is the operative word. The queue was working exactly as written, the
task was in a legitimate state, and no error existed anywhere to find.

The retry path already released the key -- with a comment explaining why a
retried job must be re-enqueueable later. Completion and death did not. They do
now, which is the same rule applied consistently: the key means "do not queue
this twice while one is outstanding", and a finished job is not outstanding.

Two things made the stall reachable in the first place, and both were worth
fixing on their own account:

**Skipping a question restarted the whole task.** The resume point was keyed on
whether the language question was *answered* rather than on which question was
asked, so skipping fell through to re-interpretation -- re-running the model and
the entire search to reach a decision already reached. Skipping is a decision
too.

**Intake questions ran before Dial worked out who to call.** They exist to
sharpen a search: which shop, what model, how soon. None of it applies when the
request named the person, and asking anyway is precisely the friction the
direct-dial path exists to avoid.

## 40. "Call Malik" is a lookup, not a search

Asked to "call malik and beg him to check if there is ice cream", Dial asked
which city to search. Malik is a contact. No city would have helped.

The interpreter had no way to say "the user named who to call", so a person's
name had to be squeezed into `searchQuery` as though it were a business
category, and the pipeline did the only thing it knew: try to find that category
somewhere, and ask where. `calleeName` now carries it, and a name that matches a
saved contact dials that contact directly.

When no contact matches, Dial says it has no number for that person and suggests
adding one, rather than asking for a postcode. The distinction matters: a
missing location is a question worth asking, and a missing person is not -- no
answer to "which city?" could ever produce Malik's number.

Contact names are matched longest-first, so somebody with both "Malik" and
"Malik at the garage" saved gets the more specific one rather than whichever the
database happened to return first.

## 41. Knowing who to call is half of it

"Call Malik" says who to ring and nothing about what to say when he answers. A
search never has this problem: "the cheapest screen repair" is both the target
and the question. A direct call carries only the target, and placing one on that
basis means ringing a real person with nothing to ask them.

So when Dial has a number but no stated purpose it asks: *"What do you want from
Malik?"* The purpose is a field the interpreter fills, not a length check on the
instruction -- "idk", "whatever" and "just call them" are answers, and none of
them is a purpose. The rule given to the model is the one that matters: set it
only if you could tell the person on the phone what is being asked of them.

An unclear answer earns another question, worded differently so the user can
tell they were not understood rather than assuming the app is stuck.

It stops after two. A user who cannot say what they want should not be held
hostage to the question, so Dial says it will keep the call general and goes
ahead. Two questions is persistence; five is an argument. That bound also means
a model that never recognises a purpose cannot trap a task in a loop -- which,
given the whole feature rests on the model's judgement, is not a hypothetical.

The purpose reaches the call brief in the user's own words rather than only as
Dial's paraphrase of it. When nothing was searched for, it is the only thing the
agent has to go on.

## 42. The ranking is a judgement, so the user can overrule it

Dial rings the businesses it ranked highest and stops. The ranking is a
judgement made from distance, opening hours and whether a number could be
verified -- and the user can see the whole list, including the one Dial skipped
because it was four kilometres away and happens to be the one across the road
from their office.

Every business Dial found now carries a "Call this one" button. It is the same
call path as any other: the same brief, the same policy gates, the same evidence
trail, and the outcome folds into the comparison so the final answer describes
every call rather than only the ones Dial chose.

The per-task ceiling deliberately does not apply. That limit exists to stop Dial
working through twenty businesses on its own initiative -- it bounds Dial's
autonomy, not the user's intent, and applying it here would mean refusing a
person who is standing right there asking. The daily budget does still apply,
because that is about real money and a real rate limit rather than about
judgement, and so does the policy gate, because it is the user's own standing
instruction about what Dial may do on a telephone.

A finished task reopens rather than gaining a call in the background. A result
that said "Dial spoke to 2 businesses" while a third is mid-conversation would
be wrong in the most ordinary way.

Refusals are distinguished rather than collapsed: a business with no number is a
permanent fact about that business, a spent budget is temporary, and a policy
refusal is the user's own setting. Each becomes a different status and a
different sentence, because "that didn't work" is not an answer anybody can act
on.

## 43. A failure nobody can name is a failure nobody can fix

Calls were failing with "The call could not be completed." The stored code was
`call_not_ready`, which had no entry in the message table -- so it fell through
to a sentence that is true of every failure and useful for none of them.

Worse, the provider's own explanation was discarded at the same moment. The
dispatch handler deliberately does not show provider text to the user, which is
right; but it was not logging it either. So the one place the answer existed,
it was thrown away, and working out what the service had objected to meant
probing the live API by hand.

Three fixes, and the third is the one that matters:

**Every code now says something specific.** Eight had no message. One key,
`recipient_schema_invalid`, matched no real code at all -- the API's is
`recipient_result_schema_invalid` -- so that mapping had never once applied.

**The provider's message is logged.** Kept out of the UI, kept in the logs,
along with whether the code was one Dial has wording for. An unmapped code is
now visible to whoever has to fix it.

**A test asserts the table is complete.** Every code the API can return must
have a message, no key may exist that is not a real code, and no code may render
as the generic sentence. That is what stops this happening again, and it is
worth more than the eight messages: the codes come from a generated schema that
will grow, and the next addition now fails a test rather than reaching a user as
a shrug.

`call_not_ready` is also now retried. It is not in the vendor's list of
retryable codes, but a call refused with it never reached a telephone -- no
provider id comes back, nothing is dialled -- so the only cost of trying again
is the request. Treating it as permanent meant writing a business off as
uncontactable because the service was momentarily busy. It is safe to retry
specifically because Dial sends a stable idempotency key: if the call really was
created and only the response was lost, the retry returns that same call rather
than placing a second one.

## 44. Stopping is not the same as finishing

A task rang five businesses, learned nothing usable from any of them, and
reported "Dial spoke to 5 businesses, but none could confirm what you asked
for" -- with ninety-three more sitting in the list untried. That is a report of
Dial's effort, not an answer to the question.

The per-task ceiling was doing two jobs and only one of them well. It exists so
Dial does not spend five calls where two would do; it was also, accidentally,
deciding when to give up. Those are different questions with different right
answers. Five is generous when calls are producing results and far too few when
none of them has.

So there are now two bounds. `MAX_CALLS_PER_TASK` still governs how much Dial
spends once it has something, and `MAX_CALLS_UNTIL_RESULT` governs how long it
keeps trying while it has nothing. While nothing usable has come back, a
business that answered unhelpfully is as good a reason to try someone else as
one that never picked up -- the distinction only matters once there is
something to protect.

It is still a bound, not an invitation: the higher ceiling is where Dial gives
up, and the daily budget binds regardless, because that one is about real money
rather than about judgement. And the moment something comparable arrives, the
persistence stops -- it exists to get an answer, not to exhaust the list.

The timeline says which is happening. "Trying X instead" and "Still nothing
usable — trying X" describe two different situations and should not read the
same.

## 45. Dial found them, so Dial can ring them back

The best verified option is a business Dial found, rang, and got an answer
from. Asking the user to pick up the phone themselves to act on that answer
wastes the thing that was just established.

The card now carries "Have Dial call them", and the user says what for --
"book me in for tomorrow morning", "order two of the large ones". The
instruction is theirs, in their own words, so there is nothing for Dial to
propose and nothing to invent.

It starts a new task rather than extending the finished one, for the same
reason a follow-up always should: the original was a question and this is a
commitment. It is interpreted from scratch, so its side effect, sensitivity and
authorization requirement are worked out afresh and the user's policy gates it
exactly as it would gate the same sentence typed into the box. An appointment
still waits for confirmation if that is what the policy says.

An empty instruction is refused. Ringing somebody with nothing to say to them
is the one thing this must never do.

## 46. Knowing when to stop talking

A real call ran to fifteen exchanges against a recorded message. The recording
said, three different ways, that the restaurant took enquiries only through its
website. Dial rephrased the question each time, said "I'll wait", said "I'll
hold", said "take your time", and asked again -- for minutes, at the customer's
expense, against a machine that could not hear it.

Nothing in the brief was wrong. There was simply nothing in it about when to
stop. "Do not argue, pressure, or call back repeatedly" reads as advice about
manner, not as a stop condition, so the agent kept being polite and kept going.
Persistence looked like the helpful choice at every individual turn, which is
how fifteen of them happen without anything going obviously wrong.

The brief now says when to hang up:

- Ask at most twice. If the second reply does not answer, thank them and end.
- If they say they cannot help by phone, or send you to a website, an email
  address, a live chat or a form -- thank them, end, and record it. Do not
  rephrase and try again.
- If two replies say substantially the same thing, it is a recording or a
  script. Asking a recording again cannot work.
- If asked to hold, wait once. Not twice.
- **Ending politely with no answer is a good outcome.** A long call that annoys
  somebody is worse than "unknown", because it costs the customer their
  reputation with that business.

That last line is the one that matters. Without it the agent has no reason to
prefer stopping, and every local decision points towards trying once more.

The refusal is also recorded in the business's own words -- "only takes
enquiries via the website". That is a real, useful answer about this business,
and the customer can act on it. "Unknown" with no reason is not.

## 47. An answer is worth acting on wherever it came from

Every business that gave a comparable answer now carries "Have Dial call",
not only the one that came top. Cheapest is not always the one wanted -- the
second-cheapest may be the one across the road, or the one that sounded like it
knew what it was talking about.

The instruction is the user's own words, typed into the prompt that follows, so
there is nothing for Dial to propose and nothing to invent. It starts a new task
which is interpreted from scratch, so a commitment is gated by the user's policy
exactly as the same sentence typed into the box would be.

## 48. Enough is a property of the task, not a constant

Dial stopped after three calls. Two of the first three had answered usefully,
and the rule was `useful >= 2`, so it went to comparison and finished --
presenting "the cheapest" on the strength of two quotes while ninety-five
businesses sat in the list untried.

Two is a defensible number for "don't spend five calls where two would do". It
is not a defensible basis for telling somebody which of ninety-eight shops is
cheapest. The mistake was writing a budget where a goal belonged.

The threshold is now `COMPARABLE_TARGET`, three by default, and a request that
names its own number wins -- "ring five places" is the user saying what enough
means, and `constraints.candidateLimit` already carried it.

That also settles which ceiling applies while Dial is still working. Short of
the goal, the bound is `MAX_CALLS_UNTIL_RESULT`, because that is the one about
"still trying" rather than "not spending more than needed". `MAX_CALLS_PER_TASK`
now means what its name suggests -- how many Dial plans up front -- and the
moment the goal is met it stops, whichever ceiling was in play.

Three older tests asserted the previous bound and now assert the new one. They
were not wrong; the thing they described changed, and they still guard against
ringing every business in the list.

## 49. Show the comparison, not just the winner

The result showed the best option and, when there happened to be alternatives, a
table. With one comparable answer there was no table at all -- so the page
looked identical whether Dial had weighed one business or five, and "best
verified option" carried the same visual weight either way.

The comparison now always appears when anything came back, including the
outcomes that could not be compared, marked as such. It opens by saying what was
actually weighed: "Dial compared 4 businesses that gave a usable answer and
picked Stop And Go", or, when there was only one, "Only one business gave a
comparable answer, so there was nothing to weigh it against."

That last sentence is the point of the change. A single quote presented as a
winner is the kind of quiet overstatement the honest-comparison rule exists to
prevent, and the fix is to say plainly how thin the basis was.

## 50. One phone at a time

Dial rang three businesses simultaneously. Three real people were interrupted
for a question the first of them may well have answered, and the user watching
saw a row of calls in flight with no way to tell which would come back.

`CALL_WAVE_SIZE` is now one. The machinery was already there -- `maybeAdvance`
refuses to start anything while a dispatched call is unresolved, so a wave of
one is a queue of one. It is slower, and it is what somebody making these calls
themselves would do.

`MAX_CALL_CONCURRENCY` is a different thing wearing a similar name: it is how
many *queue jobs* a worker takes at once, and interpreting, searching and
polling all run through that queue. Throttling it would slow every task without
making the phones any quieter. Both now say so where they are defined.

Finding this took longer than it should have, for a reason worth recording.
Vitest loads the repository's `.env` into `process.env`, so the developer's own
`CALL_WAVE_SIZE=3` was silently supplying the tests' fixtures. Changing the
default in code did nothing, twice, and the evidence said the config was one
while the running system behaved as three. The harness now pins every call limit
explicitly instead of inheriting it, because a suite whose meaning depends on an
untracked file is not a suite that proves anything.

That also means the default was never the whole fix: a `.env` that already
names the setting overrides it. The one in this repository was updated too.

## 51. "No" means two different things

Two calls to Paris bakeries. One recipient said only "Oui, Allô ?" and the line
ended; the other said "au revoir". CALL-E reported both accurately --
`question_answered: "no"` -- and Dial filed both as `answered_useful`, counted
them towards the comparison, and would have been willing to present "Oui, Allô
?" as a verified result.

One line caused it, and its comment sounded right:

> An explicit "no" is a real, useful answer: this business cannot help.

That is true of `can_repair: "no"` -- the user learns this shop cannot fix it.
It is the exact opposite of `question_answered: "no"`, which says nothing was
learned at all. The same field name, the same value, two contradictory meanings,
and the code could not tell them apart because nothing recorded which question
the field was asking.

A call family now declares it. `general_inquiry` and `status_check` ask *whether
an answer was obtained*; the rest ask *whether the business can help*. It is
asserted per family in the tests rather than inferred, because getting it
backwards is the whole bug.

The consequences were worse than a mislabelled row. Those calls counted towards
the comparable target, so Dial stopped early believing it had answers, and a
greeting was eligible to become the best verified option -- a verified result
where nothing had been verified.

## 52. Waiting your turn is not being stuck

The same records showed six businesses marked failed with `timeout`, having
never been dialled at all.

The safety net fired a fixed fifteen minutes after the first call, regardless of
what had happened since. That was survivable when Dial rang three businesses at
once. Ringing them one at a time, a task working properly through its list ran
past the deadline, and everything still queued was written off.

It is now a stall detector rather than a deadline: it looks at when the task
last did anything, and if that was recent it extends itself instead of giving
up. A genuinely stuck task is still caught, because nothing having happened is
exactly what it now measures.

Worth noting how this was found. It was not the reported problem -- the question
was who had hung up on a Paris bakery -- and it surfaced only because answering
that meant reading the real call records rather than reasoning about the code.

## 53. The design was never the one that was designed

`--font-sans` named Inter. Nothing anywhere loaded Inter. Every screen had been
rendering in whatever the operating system defaulted to -- Segoe UI on Windows,
Helvetica on a Mac -- and no two people reviewing it had been looking at the
same thing.

It is now Plus Jakarta Sans, built into the bundle by `next/font` rather than
fetched from Google at runtime: one less origin to depend on, no render-blocking
request, and a matched fallback so text is readable immediately and does not
jump when the real face arrives.

Three other things were broken rather than merely dated:

**The focus ring was cancelled on every input.** `.field input:focus` set
`outline: none` and changed only the border colour. It outranked the global
`:focus-visible` rule, so keyboard users lost the indicator in the one place it
matters most -- a form. Focus styling now lives on `:focus-visible` and pairs a
border colour with a ring.

**The live indicator never moved.** The component asked for
`animation: pulse`, nothing defined `pulse`, and the dot meaning "this is
happening right now" sat perfectly still.

**Two colours failed WCAG AA.** Muted text was 3.03:1 -- that is card labels,
tallies and timestamps. And the indigo everyone reaches for, `#6366F1`, is
4.47:1: close enough to look fine and close enough to fail. Every text pair is
now checked against 4.5:1 in both themes by a script rather than by eye, which
caught two more that a glance had passed: the muted grey cleared 4.5 on white
and failed on the canvas it actually sits on, and white on the dark-mode primary
button was 4.47.

Touch targets grow to 44px under `@media (pointer: coarse)` rather than
everywhere. A 34px icon button is comfortable with a mouse and a nuisance with a
thumb; the guidance is about fingers, so the query asks about the pointer.

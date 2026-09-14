# Dial

Ask for something that needs a phone call. Dial finds who to ring, rings them
until it has enough comparable answers, and tells you what each one actually
said.

```
"Find the cheapest place near me that can replace an iPhone 13 screen today."

  12 repair shops found near Dublin 2 · 9 reachable right now
  Dial is calling until 3 businesses give a comparable answer
  ●●●○○  3 of 3 answers · 5 businesses called of 10 max

  FixLab — EUR 89.00
  ✓ Same day  ✓ 90-day warranty  ✓ 2.1 km away

  Lowest verified quote among the 3 businesses that gave Dial a comparable
  price. Verified by phone at 15:42.

  Why not PhoneDoc at EUR 79? Could not do it until Thursday.
```

Read that last block again, because it is the whole point. Dial does not say
it found the cheapest shop in the city. It has no way to know that. It rang
five shops, three would quote over the phone, and of those three this was the
cheapest that could also do it today. That is a claim it can support, so that
is the claim it makes — and when a cheaper option lost, it says why.

## Why this is not one more "call a restaurant" demo

CALL-E holds the conversation. It does not decide who to call, whether an answer
was really an answer, when to stop calling, or what five answers mean together.
Something has to do that, and if it is hard-coded per vertical you have a demo
rather than a product.

Dial puts that logic above CALL-E and keeps it domain-agnostic. Adding plumbers
to a system that knew about phone repair is two table entries:

- **a call family** — what to ask, and the result schema to extract, in
  `packages/schemas/src/call-families.ts`
- **a category mapping** — how the domain maps to OpenStreetMap tags and Google
  Places types, in `packages/search/src/categories.ts`

Ranking, wave dispatch, evidence validation, comparison, the authorization gate
and both UIs already handle it. Seven call families and thirty-four domains
ship.

### Calling is goal-driven, not count-driven

Dial does not ring a fixed number of businesses. It calls until it has
`COMPARABLE_TARGET` usable answers (default 3), or a request that names its own
number — "ring five places" — and then stops, because every extra call costs
credit and rings a real person. Businesses that never answered are replaced by
the next candidate, up to `MAX_CALLS_UNTIL_RESULT` (default 10).

### Each call is smarter than the last

Before every call, Dial reads what earlier calls on the same task failed to
establish and puts those questions first in the brief. If four garages quoted a
price but none would discuss warranty, the fifth call leads with warranty
instead of collecting a fifth price nobody needed.

### It tells you what it is doing, and why it stopped

A task view shows the goal, how many comparable answers are in, calls placed
against the ceiling, and — the number that actually decides how far a task
gets — how many of the businesses found were *reachable*: listed number, open
right now, not excluded. "Completed" used to cover both "found what you asked
for" and "rang everyone and came up short"; those now get different sentences.

## The things it refuses to do

**It will not turn a non-answer into an answer.** When CALL-E cannot produce a
schema-valid result it returns `structured_result: null`. That is the honest "I
could not establish this" signal, and Dial propagates it. The comparison engine
drops such a call rather than reading a missing price as zero. A shop that said
"come in and we'll look at it" does not silently become the cheapest quote.

**It will not invent per-fact confidence.** CALL-E returns one confidence per
*call*. A display splitting that into "price: 92%, warranty: 61%" was designed,
built, and removed, because the numbers would have been made up.

**It will not convert currencies.** If quotes come back in euro and sterling,
Dial compares within the majority currency and says so in the caveats.

**It will not let a model authorise anything.** Side effect, sensitivity and
authorization requirement are *inputs* to a policy engine written in plain
TypeScript that reads stored user rows. "Find the cheapest plumber" runs
unattended. "Hire the cheapest plumber" stops and asks — before the first
call, not after.

**It will not chase an impossible request.** "Find dinosaur meat in Dubai" once
produced eighty-nine butchers and a call plan. The interpreter now checks
whether a request can be satisfied at all, before anything else, and says so
instead of spending your credit proving it.

## Side effects, stated plainly

**This app makes real phone calls to real businesses, and they cost credit.**

- Up to `MAX_CALLS_PER_TASK` calls planned per task (default 5), dispatched in
  waves of `CALL_WAVE_SIZE` (default 1), extended one business at a time up to
  `MAX_CALLS_UNTIL_RESULT` (default 10) while the goal is unmet.
- A per-user daily ceiling, reserved atomically so two workers cannot both spend
  the last of it.
- Every call opens by identifying itself as an AI assistant calling on behalf of
  a customer. This is not configurable.
- Every call has explicit end conditions in its brief: ask at most twice, hang
  up on a website redirect, treat two identical replies as a recording. These
  were written after a real call ran fifteen exchanges against an answering
  machine.
- **Pause** stops the next call from being placed and the working-time clock
  from running; **resume** picks up where it left off. **Cancel** stops
  everything not yet dialled. CALL-E exposes no cancellation for a call already
  in flight, so Dial does not render a button claiming otherwise — it reports
  how many were already connecting and records their answers when they land.
- Premium-rate and reserved-fiction number ranges are refused outright.
- No caller-ID spoofing, no retry-until-answer.

### Dial for Business

The same engine, pointed outward, for a business calling its own customers.
This **is** bulk calling, so its safeguards are listed separately:

- A business imports its customer list from a spreadsheet (`.xlsx` or `.csv`,
  parsed with no third-party dependency) and sees a **dry-run preview** —
  columns mapped, rows counted, nothing written — before anything is imported.
- Three workflow templates: appointment reminder, customer callback, and a job
  described in the business's own words. Each has a fixed result schema, so
  every recipient comes back with a structured outcome — confirmed,
  rescheduled, cancel requested, no answer — not a free-text summary.
- **Calling hours** are set per workflow and enforced at dispatch. A run
  started outside them is moved to the next window, not placed.
- A **do-not-call** flag or opt-out on a contact wins over everything, including
  a run the owner has already started.
- Dispatch is durable: `FOR UPDATE SKIP LOCKED`, exponential backoff, and a
  deterministic idempotency key (`biz:<recipientId>:a<attempt>`) on every
  provider call, so a worker that dies mid-run loses nothing and a retried job
  cannot ring anyone twice.
- **Limitation, stated honestly:** there is no endpoint to stop a run once it
  has started. Individual recipients can be excluded via do-not-call, and
  recipients outside calling hours are deferred, but the run itself cannot be
  cancelled from the API. This is the first thing on the list below.

## Running it without calling anyone

The no-call path is the **default**, not a flag you have to remember:

```bash
cp .env.example .env          # TEST_PROVIDER=mock is already set
# set LLM_API_KEY to a Gemini key — the only key required
npm install
npm run build
npm run db:migrate
npm run seed                  # prints a demo login
npm run dev:api & npm run dev:worker & npm run dev:web
```

`FakeCallProvider` is deterministic and deliberately produces the unhappy
outcomes too — no answer, voicemail, refusals, unparseable results — because
those are the paths most likely to be wrong. Every simulated call carries a
visible banner in both UIs; a simulated result is never presented as a real
one.

`TEST_PROVIDER=real` **without** `CALLE_API_KEY` throws at boot rather than
quietly running fake calls behind a UI that says LIVE. `GET /health` reports
which integrations are actually configured, so it is never ambiguous.

Business discovery is real either way: OpenStreetMap needs no key, and a live
query for phone repair near Dublin 2 returns real shops with real numbers.

## Placing one real call

```bash
TEST_PROVIDER=real npm run calle:verify -- +353871234567
```

One call, to one number typed on the command line, after a five-second abort
window. It refuses to take a number from discovery — ringing a real business has
to be a deliberate act, not a side effect of a script.

## What is supported

- **Provider:** CALL-E, via the official `@call-e/calle@^0.7.0` SDK. All
  outbound; the SDK exposes no inbound path, so Dial does not claim one.
- **Discovery:** OpenStreetMap (no key) and Google Places (optional), merged
  and de-duplicated.
- **Language model:** Google Gemini (`@google/genai`, default
  `gemini-3.6-flash`, with a fallback chain for rate limits), for task
  interpretation and intake questions. Without a key the API returns
  `503 llm_not_configured` — there is no rule-based fallback pretending to be
  language understanding.
- **Runtime:** Node ≥ 20. PostgreSQL in production (Neon in ours); PGlite in
  development and tests, which is real Postgres compiled to WASM.
- **Clients:** a Next.js 16 web app and an Expo / React Native mobile app on one
  account and one database, with feature parity: tasks, contacts, history,
  pause/resume, and the full business mode.
- **Contacts:** naming a person in a request — "call Malik and ask if he can
  come Saturday" — skips discovery and dials them. After any task with a direct
  number, the number can be saved, so next time the name is enough.

## The webhook boundary

CALL-E's deliveries are unsigned — the SDK's `webhooks.verify()` is deprecated
for exactly that reason. Dial treats a delivery as an untrusted hint that
something finished: it checks structure, requires `CALL-E-Event-Id` to match the
body, claims the event id so a replay is a no-op, and then **re-fetches the call
with its own API key** before writing anything.

A test posts a hostile delivery claiming a €1 quote. The stored price stays the
€95 the authenticated re-fetch returned.

## Verification status

475 automated tests across seven packages, run against real PGlite, the real
HTTP layer and the real worker loop. Lint and typecheck clean. Both mobile
platforms bundle.

**Real phone calls have been placed** during development, to real businesses,
with a live CALL-E key. Three things were learned from them and are in the
code above: the end-of-call rules came from a call that would not hang up on a
recording; the "reachable" count came from a task that stopped after two calls
because eighteen of twenty shops were closed; and the brief's "ask these first"
section came from watching calls re-confirm what three earlier calls had
already established.

Sample numbers throughout use `555 01xx` local parts within real country codes
(`+353 1 555 0100`, `+971 55 550 1234`), and API responses mask real numbers to
`+35***00`.

## What is not done

- A **stop** endpoint for a business run in progress.
- An evidence view tracing each claim in a recommendation back to the sentence
  a person said on the phone.
- Dial does not yet notice when a whole wave is being rejected at creation
  (for example an unsupported destination region) and stop early; it works
  through the planned calls and reports each failure.

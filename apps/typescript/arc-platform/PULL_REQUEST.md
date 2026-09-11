# Arc — AI media buying that makes the call

Arc plans a radio and creator campaign from a brief, then **phones the stations
and creators to get the actual rate**. Rate cards are stale and rates in Pakistan
are negotiated on the phone; the call is where the real number lives, so Arc
places it, hears the number read back, and writes down only what was confirmed.

Built with [CALL-E](https://heycall-e.com) for voice and Claude for planning.

---

## Setup

Node 20+ and a PostgreSQL database.

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL at minimum
npx prisma migrate deploy     # use the DIRECT db hostname, not a pooled one
npm run dev
```

`npm run build` and `npm run dev` both run `prisma generate` first, so a stale
client cannot outlive a schema change.

**Migrations must not run through a connection pooler.** `prisma migrate deploy`
takes a session-scoped advisory lock; through pgbouncer that lock is stranded on
an idle pooled backend and every later migration fails with P1002. Point
`DATABASE_URL` at the direct hostname for migrations, the pooled one for the app.
This is spelled out in `.env.example`.

`npm test` runs 283 unit tests across 31 files. No network, no database, no calls.

---

## Dry-run and preview behaviour

**Calls are simulated by default.** With no `CALLE_API_KEY`, every call path
returns a deterministic simulated result immediately — no phone is dialled and no
provider is contacted. The whole flow still runs end to end, and the simulation is
labelled at every layer it passes through:

- the call card shows a **SIMULATED** badge
- the `Call` row stores `mock: true`, set at the moment it is known and never
  re-derived afterwards
- a confirmed rate that came from a simulated call renders with a **Simulated**
  pill beside it on campaign detail

That last one matters most: without it a generated rate would look identical to
one heard on a real call. A simulated call stays distinguishable from a real one
forever.

There is also a fixture gallery under `/dev/*` — open by default in development,
closed in production unless `ARC_ENABLE_DEV_PAGES=1` — that renders every UI state — including the live call
board, replayed from captured real transcripts — with **no network, no CALL-E and
no phone**. It is the fastest way to see what the app does without any credentials
at all.

To place a real call you must set `CALLE_API_KEY` deliberately. There is no
default that dials.

---

## Side effects

Everything here is off unless the matching credential is set.

| Trigger | Effect | Gate |
|---|---|---|
| Confirming a plan line | **Places a real phone call** to a real person | `CALLE_API_KEY` |
| Batch panel | Places up to 12 calls at once (`CALLE_MAX_BATCH`) | `CALLE_API_KEY` |
| Generating a plan | Anthropic API request, billed to your key | `ANTHROPIC_API_KEY` |
| Any call | Writes `Call` rows and updates media-plan rows | `DATABASE_URL` |
| `/api/calle/reconcile` | Reads call state from CALL-E and writes results | `CRON_SECRET` |

The recurring job is a single `GET /api/calle/reconcile` on a five-minute
schedule, run by an **external** scheduler and authenticated with `CRON_SECRET`
as a bearer token. It is not a Vercel cron — Hobby accounts are capped at daily,
and daily is slower than the 24-hour collection window, so calls would be missed.

It holds no state, retries nothing and starts no work. It only asks CALL-E about
calls that were already placed, and writes down the answer. To stop it, stop
calling the endpoint or unset `CRON_SECRET`.

**Anyone Arc calls is told, in the agent's first sentence, that it is an AI.**
The disclosure has no off switch: no context field suppresses it and no code path
reaches CALL-E without it. It is pinned by `tests/disclosure.test.ts`. Someone who
asks not to be called ends the call there, not four questions later.

---

## Safety rules

The eight rules CONTRIBUTING.md asks a call-placing app to carry, and where
each one lives.

**Explicit user intent.** Nothing dials on its own. A call is placed by a
person pressing confirm on a specific plan line, or by the batch panel on a
shortlist they assembled. There is no background job that starts calls — the
only scheduled work reads the state of calls already placed. `inFlightCallTo()`
additionally refuses a second call to a number that already has one
outstanding.

**E.164 numbers.** `isE164()` gates every number before it reaches CALL-E, and
a target whose number fails is reported as unreachable rather than dialled.
`tests/dial-safety.test.ts` pins that the demo fallback never applies in
production — a number has to be supplied.

**Masking phone numbers in summaries.** Partly. Numbers are masked wherever
they are *published*: no real number appears anywhere in this repository, and
the three archived call records under `docs/calls/` each carry a note saying
their numbers were masked. Numbers are **not** masked in the in-app call cards
and summaries a signed-in operator sees, because that operator is the person
who typed the number and needs to check it. Stated plainly rather than claimed.

**No credential exposure.** Credentials are environment variables, read only in
server code. `/api/calle/health` reports whether each is present, never its
value. No `NEXT_PUBLIC_` variable carries a secret.

**No hidden recurring schedules.** There is exactly one recurring job — `GET
/api/calle/reconcile`, every five minutes, run by an external scheduler and
authenticated with `CRON_SECRET`. It starts no calls; it only asks CALL-E about
calls already placed and writes down the answer. Unset `CRON_SECRET` or stop
calling the endpoint and it stops.

**No duplicate jobs.** `inFlightCallTo()` blocks a second call to a number with
one outstanding, and the batch path de-duplicates targets before creating
anything. Both are covered by tests.

**Clear cancellation.** See the section below: a call in progress cannot be
cancelled, and that is a provider limit rather than an omission.

**Boundaries for medical, legal, financial and emergency content.** Carried in
the prompt itself (`BOUNDARIES` in `lib/calle-media.ts`), on both call paths.
The agent gives no medical, legal, financial or investment advice; on any
indication of a medical or safety emergency it tells the person to contact
their local emergency services and ends the call; it never collects payment,
bank or identity details; and it is not authorised to agree a contract or
commit to a booking. `tests/boundaries.test.ts` pins all of it.

## Cancellation

**A call in progress cannot be cancelled.** CALL-E's API is `POST /v1/calls` to
create and `GET /v1/calls/{id}` to read — there is no delete, no abort, and
nothing in the SDK for it. Once created, a call runs to completion or to failure.

So the guard sits before creation instead. `inFlightCallTo()` refuses a second
call to a number that already has one outstanding, scoped by number and capped at
30 minutes so a stuck row cannot block that number forever. The batch path
de-duplicates targets before creating anything.

Closing the tab stops the polling, not the call — the result is collected later by
the reconcile endpoint. If a connected call needs to stop, hang up at the handset.

---

## Credential handling

All credentials come from environment variables. Nothing is committed: only
`.env.example` is tracked, and it contains no values.

Secrets stay server-side. The only `NEXT_PUBLIC_` variables are a Clerk
publishable key, an app URL and a client timeout — no secret is exposed to the
browser bundle. `CALLE_API_KEY` and `ANTHROPIC_API_KEY` are read in route
handlers and server modules only.

`/api/calle/health` reports whether each credential is **present**, never its
value. `?probe=1` additionally spends one token to report whether the Anthropic
key actually *works*, because a boolean that only means "the variable is not
empty" answered `true` for a full day while every generation was silently falling
back to the offline sample.

**No real phone number ships in this repository.** Every number in the source,
fixtures, tests and archived call records is fictional. The three real calls
archived under `docs/calls/` were placed to handsets with the owner's permission;
each record carries a note saying its numbers were masked for publication and
nothing else was altered.

---

## What is real, and what is not

Real: the CALL-E integration end to end — create, poll, extract, score, persist,
link, confirm, and it has returned confirmed rates on real calls. Real: the
plan generation, the catalogue, the negotiation mandate, the
confirmation gate that keeps an unconfirmed number out of a field named
`confirmedRatePkr`.

Not proven: doing it *reliably*. CALL-E's queue grew from 14 seconds to over nine
minutes in six days and one request was never dialled at all. That is why calls
run simulated by default and why the reconcile endpoint exists. `README.md` has
the full account, including the call that succeeded at the provider while Arc had
already given up on it.

Arc would rather show a labelled simulation than an unlabelled fiction.

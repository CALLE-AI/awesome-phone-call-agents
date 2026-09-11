# Arc

**Arc is an AI media buyer for Pakistani radio and influencer advertising.** In this market the rate card is never on the website — so Arc phones the stations and the creators, collects live rates and airtime, and hands back a ranked media plan.

Radio and influencer advertising in Pakistan is negotiated by phone. There is no API, no public pricing, and no marketplace — a brand that wants to run a campaign calls fifteen sales desks and writes the answers on paper. Arc automates that: it builds a media plan with AI, phones each station and creator with a voice agent to confirm real availability and rates, and turns what the calls come back with into a booking.

---

## The loop

```
Brief  ──►  AI plan  ──►  CALL-E phones each line  ──►  Confirmed rate  ──►  Booking
                              │                              │
                         estimate                     what was heard
                              └──────── shown side by side ──┘
```

The point of the product is that middle column. An AI can estimate what a station charges; only a phone call can tell you the rate it will actually book at, and how much inventory is left. Arc stores both and shows them next to each other, so a brand can see where the estimate was wrong.

> **Status.** The CALL-E integration is complete — create, poll, extract, score, persist, link, confirm. What is unproven is doing that *reliably*: the provider's queue before dialling has been highly variable, and outbound to Pakistan is currently unavailable to this account. Calls therefore run **simulated by default**, clearly labelled everywhere they appear. [Full detail below.](#the-honest-limitation-the-queue-not-the-route)

---

## CALL-E integration

Arc uses [CALL-E](https://heycall-e.com) to place real outbound phone calls to media owners.

### What the agent does

It calls the station's ad sales desk (or a creator's manager), says in its first sentence that it is an AI, makes clear this is a pricing inquiry and not a commitment, and asks four questions. The disclosure has no off switch — no context field suppresses it and no code path reaches CALL-E without it — and someone who asks not to be called ends the call there, not four questions later. The task is assembled per target in [`lib/calle-media.ts`](lib/calle-media.ts) and carries the campaign's real details — advertiser, market, audience, budget and the actual flight dates:

> You are Arc, an AI assistant placing media-buying calls for **Shan Foods**, planning the "Ramzan Push" campaign in **Karachi**. The campaign runs **from 2026-09-01 to 2026-09-30**. The target audience is **adults 25-44 in Karachi**. The total campaign budget is about **PKR 450,000**. … Your FIRST sentence identifies you as an AI, before anything else and before you ask anything: "Hello, this is Arc, an AI assistant calling on behalf of **Shan Foods**." Never claim or imply that you are a person. If you are asked at any point whether you are a human, a recording or a bot, say plainly that you are an AI assistant and offer to have a colleague call back instead. If the person asks you not to call, says they are not interested, or asks to be removed from the list, acknowledge it, stop asking questions, thank them and end the call. Then say in one short sentence that you are calling about radio advertising, and ask if you have reached **the ad sales desk**.

Creators get a variant asking about interest, rate, deliverables, available dates and audience size.

### What it extracts

CALL-E is given a JSON schema and returns structured data from the conversation:

| Station | Creator |
|---|---|
| `available` — yes / no / unknown | `interested` — yes / no / unknown |
| `rate_per_spot` — number | `rate` — number |
| `spots_available` — integer | `deliverables` — string |
| `avail_dates` | `available_dates` |
| `audience_estimate` | `audience_size` |
| `notes` | `notes` |

`rate_per_spot` and `rate` are typed as numbers, so a rate that cannot be parsed arrives as null rather than as text pretending to be a price.

**That typing is proven on station calls and not on creator calls.** Station calls that came back with rates returned one rate each and returned it correctly. A creator call where the speaker quoted two prices came back with a single well-formed, schema-valid rate — and the wrong one of the two. The other price was mis-transcribed on every attempt and never became a number at all. A number that passes validation and is wrong is worse than a null, and nothing in the response flags it.

### How it runs

Real calls take 30 seconds to two minutes, which is longer than a serverless request can block, so the flow is **create then poll**:

1. `POST /api/calle/confirm` creates the call and returns a `callId` immediately
2. The client polls `POST /api/calle/status` every 4 seconds
3. On a terminal state the result is scored into a media-plan row and persisted

`POST /api/calle/batch` does the same for a whole shortlist at once, capped at 12 targets (`CALLE_MAX_BATCH`), and ranks the results.

The browser is no longer the only thing that can finish a call. It gives up after 20 minutes (`NEXT_PUBLIC_CALLE_MAX_WAIT_MS`), and `/api/calle/reconcile` asks CALL-E about any call still unresolved between two minutes and a day old, then writes down what it is told. It has two entry points:

- **`GET`**, authenticated with `CRON_SECRET` as a bearer token, run **every five minutes by an external scheduler** (see below). It sweeps every brand.
- **`POST`**, authenticated as the signed-in user and scoped to their own brand — the **Check for updates** button on campaign detail and the batch panel. With a queue that has run well past a filming window, waiting for a schedule is not something you can do on camera; this is the button that says "has it landed yet?".

That is deliberately **not a job queue**. It holds no state, retries nothing and starts no work; it only asks about calls already placed. It exists because a call that outlived the old eight-minute wall went on to complete at the provider and returned a confirmed rate that nobody ever collected.

**The schedule is not a Vercel cron.** It was, until Vercel rejected the deploy: *"Hobby accounts are limited to daily cron jobs."* Daily is not a schedule this can run on — `MAX_AGE_MS` is 24 hours, so a call created shortly before a daily sweep would be older than the window at the next one and would never be collected at all. Rather than stretch the interval to fit the plan, `vercel.json` was removed and the five-minute schedule moved to an external caller. Any scheduler works; it needs only:

```
GET https://<your-deployment>/api/calle/reconcile
Authorization: Bearer <CRON_SECRET>
every 5 minutes
```

### Stopping a call

**A call in progress cannot be cancelled.** This is a provider limit, not an
oversight: CALL-E's API exposes `POST /v1/calls` to create and `GET /v1/calls/{id}`
to read, and nothing else. There is no `DELETE`, no `PATCH`, no cancel or abort in
the SDK. Once a call is created it runs to completion or to failure, and the only
thing Arc controls after that point is whether it keeps listening.

So the guard sits **before** creation rather than after it. `inFlightCallTo()` in
[`lib/calls.ts`](lib/calls.ts) refuses to place a second call to a number that
already has one outstanding — scoped by number, reported by brand, with a
30-minute ceiling so a stuck row cannot block that number forever. The batch path
de-duplicates targets before it creates anything ([`tests/batch-dedupe.test.ts`](tests/batch-dedupe.test.ts)),
and [`tests/in-flight-guard.test.ts`](tests/in-flight-guard.test.ts) pins the
refusal.

Closing the tab stops the polling, not the call. The call continues at CALL-E and
its result is collected later by `/api/calle/reconcile` — which is the whole
reason that endpoint exists.

If you need a call to stop while it is connected, the honest answer is to hang up
at the handset.

### How results persist

Every call writes a `Call` row, whatever happened to it. Three outcomes are recorded distinctly, because they mean different things:

- **`RESULT`** — connected and returned structured data
- **`NO_RESULT`** — a person answered, but nothing usable came back
- **`NOT_CONNECTED`** — never reached the handset

Only a `RESULT` can confirm anything. When a campaign launches, [`lib/calls.ts`](lib/calls.ts) links completed calls to their plan lines and copies across **only what the call actually settled** — the rate it quoted, its verdict, its notes. The AI's estimate is never copied into a confirmed column to make a table look finished, and `confirmedReach` is deliberately left null because the scorer falls back to the plan's own audience estimate when a call returns no reach.

Every `Call` also carries a **`mock`** flag, set at the moment it is known and never re-derived. A simulated call stays distinguishable from a real one forever.

---

## Architecture

**Next.js 16** (App Router, React 19) · **Prisma 5** on **PostgreSQL** (Neon) · **Clerk** for auth · **Tailwind v4** with a token-based design system · **Anthropic** for plan generation · **CALL-E** for voice.

### Schema

```
Brand ──┬── BrandUser
        └── Campaign ──┬── MediaPlanItem ──┬── Call
                       ├── CampaignScript  │
                       └── Call ───────────┘
```

**`Campaign`** — the brief as approved at launch: budget, currency, flight dates, duration, the three cost lines and the two totals, plus the raw brief as JSON.

**`MediaPlanItem`** — one selected station or creator, and **the booking object**. It carries three sets of figures side by side:

| Stage | Fields |
|---|---|
| Estimated | `estCostPkr`, `estReach`, `matchScore`, `rationale` |
| Confirmed by call | `confirmedRatePkr`, `availability`, `confirmedDetail`, `confirmedNotes`, `confirmedAt` |
| Booked | `spots`, `bookedDates`, `bookedSlots`, `bookedTotalPkr`, `bookedAt` |

**`Call`** — one row per CALL-E attempt: the provider's call id, the number actually dialled, the outcome, the structured result kept whole, and the `mock` flag. `campaignId` and `mediaPlanItemId` are nullable on purpose — a call placed from a station's page has no campaign in scope.

**`CampaignScript`** — the radio scripts as the brand edited them, not as the model first wrote them.

### How a plan becomes a booking

A line moves through four states, and every transition has something that can trigger it:

```
SELECTED ──► CALLING ──► CONFIRMED ──► BOOKED
                    └──► DECLINED
```

`SELECTED` when the wizard puts it on the plan · `CALLING` while a call is in flight · `CONFIRMED` or `DECLINED` from the call's verdict · `BOOKED` when `POST /api/bookings` writes the terms.

There are deliberately no `pending_approval`, `live`, `delivered` or `reconciled` states. Each would need something that does not exist — a station-side actor, delivery proof, payments tied to a campaign. A state whose transition nothing can trigger is a label, not a state.

---

## Running it locally

```bash
git clone <repo> && cd arc-platform
npm install
cp .env.example .env.local      # then fill in the values below
npx prisma migrate deploy       # creates the schema
npm run dev                     # http://localhost:3000
```

Node 20+. `npm run build` runs `prisma generate` first. `npm test` runs the unit suite — nine files covering flight-date maths, the wizard's localStorage rehydration guard, the CALL-E task builder, the AI disclosure, the contact book's number resolution, and the dial-safety and batch de-duplication guards.

### Environment variables

**Required:**

| Variable | What it does |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`<br>`CLERK_SECRET_KEY` | Auth. Omit both and Clerk runs in **keyless mode**, provisioning a temporary dev instance automatically |

**Optional — each degrades gracefully:**

| Variable | Without it |
|---|---|
| `ANTHROPIC_API_KEY` | Plan generation falls back to a built-in sample plan |
| `CALLE_API_KEY` | **Calls are simulated** — see below |
| `ARC_CONTACTS` | **A fan-out dials one line instead of twelve.** JSON map of catalogue id to E.164 number, read server-side and never sent to the browser. Without it every target falls back to `CALLE_DEMO_PHONE`, the batch route de-duplicates the identical numbers, and a shortlist of twelve stations places a single call |
| `CALLE_DEMO_PHONE` | E.164 number to dial when a target has none |
| `CALLE_BASE_URL` | Defaults to `https://api.heycall-e.com` |
| `CALLE_MAX_BATCH` | Defaults to 12 targets per batch |
| `NEXT_PUBLIC_CALLE_MAX_WAIT_MS` | Defaults to 20 minutes before the browser hands the call to the reconcile cron |
| `CRON_SECRET` | The scheduled sweep (`GET /api/calle/reconcile`) refuses to run rather than read call records unauthenticated. The **Check for updates** button does not use it — that authenticates as the user |
| `STRIPE_SECRET_KEY`, `STRIPE_*_PRICE_ID` | Checkout and plan upgrades are inert |

---

## What is real, and what is simulated

Everything in the app is either read from the database or visibly marked as sample. That rule is not decorative — it is why several features were cut rather than filled with plausible numbers.

### Real

Campaigns, media plans, bookings, scripts and call records are all stored and read back. The analytics page reports only what the database holds: committed spend against approved budget, active campaigns, combined audience, and a line-by-line booking table. The dashboard's committed figure and the analytics page run the **same query**, so the two cannot disagree.

The station and creator catalogues (8 each) are static reference data in `app/radio/_data.ts` and `app/influencers/_data.ts` — real Pakistani stations with real frequencies, dayparts and audience splits, but not a live inventory feed. A generated plan may only recommend lines from those catalogues: the model is given the list and returns ids, every audience figure beside the id is joined from the catalogue afterwards, and an id we do not carry fails the whole generation rather than being dropped from it.

**`estTotalReach` changed meaning on 2 September 2026, and rows either side of that date are not comparable.** Before it, the campaign generator invented a per-flight reach figure with no source, and the column held that. After it, the figure is the sum of each line's real audience — a station's daily listeners, a creator's followers — read from the catalogue. The UI now calls it **Combined audience** everywhere, which is true of new rows and is the wrong name for older ones; there is no backfill, because the old numbers cannot be recomputed into the new quantity and inventing a conversion would be the same mistake one layer down. The same applies to `MediaPlanItem.estReach` per line.

### Simulated, and labelled

With no `CALLE_API_KEY`, calls return a deterministic simulated result immediately. The path is verified end to end and honest at every step: the call card shows a **SIMULATED** badge, the `Call` row stores `mock: true`, and campaign detail marks any confirmed rate that came from a simulated call with a **Simulated** pill beside it. Without that last mark a generated rate would render identically to one heard on a real call.

### What was removed rather than faked

Attribution modelling, a 30-day reach chart, best-performing time slots, average engagement, and a report generator were all deleted. Each needed something that does not exist — conversion tracking, a time series, traffic-lift data, delivery measurement. They are listed in `BRANDING.md` §9 with what each would need to come back.

### The honest limitation: the queue, not the route

The integration is complete — create, poll, extract, score, persist, link,
confirm. What is unproven is doing it *reliably*.

CALL-E holds a request in a queue before the handset rings, and that wait has
been highly variable — long enough, more than once, to outlive a filming
window, and on one occasion the request was never dialled at all. Nothing in
the API separates the two cases: `status` reads `queued` for a short wait and a
long one alike, so there is no way to tell a user whether their phone is about
to ring or whether nothing has happened yet.

Pakistan is served as an **International** line region CALL-E's docs describe
as "primarily intended for testing"; a local Pakistani line has to be requested
from them. Outbound to Pakistan is currently unavailable to this account
altogether.

Two things were found and worked around from this side. `locale: en-PK`
mangled spoken numbers, and `en-US` fixed it on the same speaker and the same
handset — which is why `DEFAULT_LOCALE` is `en-US` and not the country's own.
And attempts that report zero duration and zero transcript turns for calls that
demonstrably ran, which made working calls look like route failures.

That is why calls run **simulated by default**, clearly labelled everywhere
they appear, and why `/api/calle/reconcile` exists: a call that outlives the
polling window still completes at the provider, and the result has to be
collected rather than lost.

*The per-call measurements, configurations and provider identifiers behind all
of this are held privately and go to CALL-E on request. They are not published
here — they describe calls to people who answered a cold call and did not agree
to appear in a public repository.*

It is a provider problem with a named cause and a named ask. Pretending
otherwise would mean demoing on invented data — and Arc would rather show a
labelled simulation than an unlabelled fiction.

---

`BRANDING.md` documents the design system and carries the full engineering handover in §9.

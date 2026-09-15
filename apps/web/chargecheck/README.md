# ChargeCheck

**Don't trust the map. Call the station.**

A map can tell you a charging station exists. It can't tell you whether the
charger is actually working right now, whether someone is using it, whether
there's a queue, whether it takes the connector you need, or what it
actually costs. ChargeCheck closes that gap by using **CALL-E** to call the
station directly and ask, then turns the conversation into structured,
ranked, "verified right now" data.

The phone call is the missing API.

## Why a phone call

Charging-station apps and maps report what an operator advertised, not what
is true at this minute. The only source that knows the current state — is
this specific charger on, free, and reachable — is the person or system that
picks up the phone at the station. ChargeCheck never treats advertised
information as verified; it is either confirmed by a call or shown as
unverified.

## How CALL-E is used

For each selected station, ChargeCheck creates one CALL-E call task with a
schema that extracts exactly the fields a driver needs, and runs all
selected stations' calls concurrently:

```ts
const call = await client.calls.create(
  {
    task: buildTask(station, connector), // natural-language call script
    recipients: [{ phones: [station.phone] }],
    recipientResultSchema: buildRecipientResultSchema(connector),
    metadata: { workflow: "chargecheck", station_id: station.id },
  },
  { idempotencyKey: `chargecheck:${station.id}:${connector}:${todayKey()}` },
);
```

The app then polls `client.calls.get(callId)` to show the real CALL-E call
lifecycle live in the UI: `queued → in_progress → completed / failed`. Once
terminal, the per-recipient `structuredResult` (operational status, chargers
available, requested connector available, queue, price, payment
requirements, accessibility, notes, and an `answered_by` classification) is
read and passed to a small, fully deterministic ranking function — no LLM is
used for ranking, only for the call itself.

This mirrors the documented CALL-E Calls API contract exactly (see
[Architecture notes](#architecture-notes)) — nothing here is invented.

## Running it

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. No environment variables or setup are needed
to get started.

**Demo mode is on by default.** With demo mode on, ChargeCheck never dials
anyone — a `MockCallProvider` simulates the same `queued → in_progress →
completed` lifecycle with realistic, mixed outcomes (one station reports an
outage, one reports a queue, two report clean availability) so the full
product experience — including the "COULD NOT VERIFY" / "CALL VERIFIED"
states — can be exercised with zero calls placed.

To place a real CALL-E call:

1. Get a free API key from the [CALL-E dashboard](https://dashboard.heycall-e.com/login).
2. In the app, switch **Station set → US live test** (or add your own
   stations to `src/lib/stations.ts` with real numbers you own or are
   authorized to call).
3. Uncheck **Demo mode**.
4. Paste your key into the **Your CALL-E API key** field that appears, and
   click **Check availability**.

There is no shared or server-side API key anywhere in this app. Your key is
sent only with your own request, used to place that one call, and never
stored, logged, or reused — each person who tries live calling uses (and
pays for) their own CALL-E account.

## Configuring stations

Stations for the MVP demo live in `src/lib/stations.ts` as a small static
array (`name`, `phone`, `location`, `address`, `connectors`,
`advertisedHours`). This is intentionally not wired to a live station
directory yet — see [Limitations](#limitations). To try your own stations,
edit that file or extend `GET /api/stations` to read from your own source;
the rest of the app (orchestration, polling, ranking, UI) is unchanged.

## Architecture notes

- `src/lib/callProvider.ts` — the `CallProvider` abstraction. `CalleCallProvider`
  is the real integration (`@call-e/calle`, `client.calls.create` /
  `client.calls.get`), built fresh from whichever API key is passed into
  each call — never a server-side credential. `MockCallProvider` is a
  clearly labeled simulation used only in demo mode; the UI always shows a
  `DEMO / SIMULATION` badge when it's active, and a `LIVE CALL-E` badge
  otherwise. Both providers are stateless per call — a mock call's elapsed
  time is derived from a timestamp encoded in its call id, and the real
  provider always re-fetches status from CALL-E — so nothing is ever
  presented as real, and nothing depends on server memory surviving between
  requests (important for both Next.js dev recompiles and serverless
  deployments).
- `src/lib/callTask.ts` — builds the call `task` text (including the exact
  station address, since a live network support line is a call center, not
  a phone sitting at the charger, and leading with the requested connector
  type so it survives the model's own paraphrasing rather than getting
  buried in a longer checklist) and the `recipientResultSchema` using only
  the JSON Schema features CALL-E documents as supported (`type`,
  `properties`, `required`, `enum`, nested `object`,
  `additionalProperties: false`); every enum includes an `unknown`/`-1`
  fallback so an unclear answer is preserved as unclear rather than
  resolved into a guess.
- `src/lib/stations.ts` — `DEMO_STATIONS` (fictional Lahore–Islamabad route,
  always safe to "call" in demo mode) and `LIVE_US_STATIONS` (real 24/7
  published network support lines — Electrify America, EVgo, ChargePoint,
  Blink Charging — for the recorded live-call segment; see
  [Live US demo segment](#live-us-demo-segment)).
- `src/lib/ranking.ts` — deterministic scoring. A verified "out of service"
  or "connector unavailable" can never outrank a verified "available now",
  and any unverified/failed check is always ranked below any verified one.
- `src/app/api/check/start/route.ts` — dispatches one CALL-E call per
  selected station **concurrently** (`Promise.allSettled`) and returns the
  started calls directly to the client. A per-station idempotency key is
  derived from `stationId + connector + date` so a retried request doesn't
  place a duplicate call. If a station's call never starts (bad API key,
  CALL-E account issue, network failure), it's returned already marked
  `failed` with the real error — it's never given a `queued` status, so it
  can never render as stuck on "Calling…".
- `src/app/api/check/status/route.ts` — **stateless** poll: the client sends
  back the checks array it currently holds (plus its API key, for live
  checks), the route re-queries only the ones still in flight, and returns
  the merged array. There is no server-side session store, deliberately —
  an earlier version kept in-memory session state and broke in Next.js dev
  (each API route can be compiled as an independent module on first
  request, so `/status` got its own empty memory and never found what
  `/start` had created) and would have broken the same way on a serverless
  deployment. Both routes return clean JSON on any unexpected failure
  rather than an HTML error page, so the client's error handling always has
  something to read. If you want a version that survives full page reloads
  mid-check, persist the checks array (e.g. in `sessionStorage`) rather than
  reintroducing server memory.
- `src/app/page.tsx` — the client also enforces a 2-minute poll timeout per
  check (real calls typically resolve in 20-90s): anything still in flight
  past that is marked failed with a clear "Timed out" message and the UI
  moves on to the results screen, instead of polling forever with no
  feedback.

## Live US demo segment

For the part of the demo video where a real CALL-E call needs to happen and
be understood by an English-speaking recipient, use the **US live test**
station set in the app (dropdown on the form). It points at real, published,
24/7 customer support lines run by US charging networks — Electrify America,
EVgo, ChargePoint, and Blink Charging — rather than a private individual's
number or a station's own unlisted line. These lines exist specifically to
answer "is this charger working right now" questions from any driver, which
is why they're an appropriate target for a disclosed AI call; a personal
cell number or an on-site line at a business that doesn't publish itself as
a support line is not, and shouldn't be called without that business's
explicit agreement first. The call task always states the specific station
address and leads with the requested connector type so the agent asks the
support rep about the right location and the right connector, and opens
with an explicit AI disclosure, per CALL-E's own permission and disclosure
guidance. Confirm the numbers and addresses in `src/lib/stations.ts` are
still current before recording — support lines and station listings do
change.

## Deploying to Vercel (optional)

Deployment is not required for the hackathon submission — the PR into
`awesome-phone-call-agents` is what's judged. This is only if you also want
a shareable live URL.

1. Push this code to GitHub. If it's already living at `apps/web/chargecheck`
   inside your fork of `awesome-phone-call-agents`, you don't need a
   separate repo — Vercel can deploy a subfolder of a monorepo.
2. On [vercel.com](https://vercel.com), sign in with GitHub, **Add New →
   Project**, and import that repo.
3. In the import screen, set **Root Directory** to `apps/web/chargecheck`
   (skip this if you're deploying a standalone copy of just this folder).
4. Deploy. Framework preset (Next.js) is auto-detected. **No environment
   variables are required** — there is no server-side CALL-E key to
   configure, because every visitor supplies their own.

Once deployed, demo mode works for anyone who visits the URL with no
restriction or setup. If a visitor wants to place a real call, they paste
their own CALL-E API key into the field that appears when they turn off
demo mode — it's used for their request only, so your CALL-E account is
never touched by anyone else using the deployed site.

## Limitations

- Station data is a small static set (demo + two real US support lines),
  not a live directory integration.
- Status is polled from the client rather than pushed via webhook; a
  production version should use CALL-E's terminal webhooks (deduplicated
  via the `CALL-E-Event-Id` header) instead, and persist the checks array
  server-side keyed by an authenticated session rather than trusting the
  client to send it back.
- The Calls API has no cancel-in-flight operation; a longer-running version
  of this app should dispatch in waves rather than truly unbounded
  concurrency once station lists grow large.
- `answered_by` (human / IVR / voicemail / unknown) is asked for in the
  result schema, but CALL-E's own confidence in that classification is not
  independently re-verified against the transcript in this MVP.

## Future extensions

- Live station directory integration (e.g. an open charging-station API) in
  place of the static demo list.
- Terminal webhook receiver instead of polling, with event-id
  deduplication.
- Persisted call history so a "verified 2 minutes ago" station doesn't need
  to be re-called on every visit within some freshness window.
- Wave-based dispatch and a "verify only the top N by distance" mode for
  longer routes.

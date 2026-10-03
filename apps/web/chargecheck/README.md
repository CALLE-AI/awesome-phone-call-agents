# ChargeCheck

Verifies EV charging station availability by phone, using CALL-E to ask the
station directly and returning a structured, ranked result.

A map can tell a driver that a charging station exists. It cannot tell them
whether the charger is working right now, whether someone is using it,
whether there is a queue, whether it supports the connector they need, or
what it currently costs. That information usually exists only with the
person or system that answers the phone for that station.

## What the results mean

Every result this app produces is **call-reported**: what a CALL-E-placed
conversation extracted from whoever answered. It is not independently
verified station truth — nobody is physically checking the charger, and the
answer is only as good as the person on the line.

The app's language reflects this throughout. Results read "reported
available now" and "call-reported", never "verified". An answer the call
could not establish stays `unknown` rather than being resolved into a guess,
and a call whose outcome is genuinely ambiguous is labelled uncertain rather
than reported as a failure.

## How CALL-E is used

One call task per station, dispatched concurrently:

```ts
const call = await client.calls.create(
  {
    task: buildTask(station, connector),
    recipients: [{ phones: [station.phone] }],
    recipientResultSchema: buildRecipientResultSchema(connector),
    metadata: { workflow: "chargecheck", station_id: station.id },
  },
  { idempotencyKey: `chargecheck:${station.id}:${connector}:${todayKey()}` },
);
```

The app polls `client.calls.get(callId)` and surfaces the CALL-E call
lifecycle directly in the UI (`queued → in_progress → completed / failed`).
On a terminal status, the per-recipient `structuredResult` — operational
status, chargers available, requested connector available, queue, wait,
price, payment requirements, accessibility, notes, and an `answered_by`
classification — is passed to a deterministic ranking function. No model is
involved in ranking; CALL-E's role ends at producing a schema-valid result.

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. No environment variables are required.

### No-call default

Demo mode is enabled by default and places no calls. A `MockCallProvider`
simulates the same `queued → in_progress → completed` lifecycle across a
fictional station set with mixed outcomes — one reported outage, one
reported queue, two reported available — so the full workflow, including the
"could not confirm" states, runs without dialling anyone. The UI displays a
`DEMO / SIMULATION` badge whenever this provider is active and a
`LIVE CALL-E` badge otherwise; simulated results are never presented as
real.

### Placing a live call

1. Obtain an API key from the [CALL-E dashboard](https://dashboard.heycall-e.com/login).
2. Select the **US live test** station set. Only stations in this set are
   eligible for live calling — see [Live-call authorization](#live-call-authorization).
3. Disable **Demo mode**.
4. Enter the API key, confirm the operator attestation, and start the check.

The key is supplied per request by whoever is using the app. There is no
server-side or shared credential anywhere in this project: the key is used
for the requests it arrives with and is never stored, logged, or reused.

## Live-call authorization

Three checks gate live calling in `src/app/api/check/start/route.ts`. All
are enforced server-side and cannot be bypassed by modifying the request
payload.

**Station allowlist.** Each `Station` carries a `liveCallAuthorized` flag.
Only reviewed entries in `LIVE_US_STATIONS` set it. The fictional
`DEMO_STATIONS` set never does, so selecting a demo station with demo mode
disabled is refused with a 403 regardless of API key or attestation.

**E.164 validation.** Each authorized station's number is checked against
E.164 before a call is attempted (`src/lib/liveCallGuard.ts`). This is a
format check only; it does not establish that a number is reachable or
correctly attributed.

**Operator attestation.** Live requests must carry
`operatorAttestation: true`, surfaced in the UI as an explicit checkbox
confirming the operator is authorized to have CALL-E place a disclosed AI
call to the selected numbers. This is a recorded confirmation, not an
authorization system — it does not verify the operator's identity, and it
does not make an arbitrary number safe to call.

### Destinations in the live set

`LIVE_US_STATIONS` contains published, 24/7 customer support lines operated
by US charging networks. These lines exist to answer questions of exactly
this kind from any driver, which is what makes them an appropriate
destination for a disclosed AI call. A personal number, or an on-site line
at a business that does not publish itself as a support channel, is not, and
should not be called without that business's prior agreement.

Because these are centralized support desks rather than phones at the
charger, each call task states the specific station address and leads with
the requested connector type, so the request is not generalized away during
the conversation. Every task opens with an explicit AI disclosure.

Verify these numbers and addresses before use; support lines and station
listings change.

## Phone-number handling

Numbers are masked before reaching the client. `GET /api/stations` returns
all but the final four digits replaced, and the UI does not render station
phone numbers at all.

Free text is redacted separately. `src/lib/redact.ts` passes provider and
SDK error messages, CALL-E `evidence` strings, and the free-text fields of
structured results (`notes`, `price_per_kwh`, `payment_requirements`,
`accessibility`) through phone-number redaction before either API route
responds. This runs uniformly rather than only on the station list, so a
number cannot surface through an error string or through something a call
recipient happened to say.

## Side effects and cancellation

Live mode places real outbound phone calls to the selected destinations —
one call per selected station, dispatched concurrently. Demo mode places
none.

There is no recurring or scheduled workflow: a check runs once when
started and does not repeat. The CALL-E Calls API exposes no
cancel-in-flight operation, so an already-dispatched call cannot be recalled
by this app; a per-station idempotency key derived from
`stationId + connector + date` prevents a retried request from placing a
duplicate call for the same station on the same day.

## Configuring stations

`src/lib/stations.ts` holds two static arrays: `DEMO_STATIONS` (fictional,
demo mode only) and `LIVE_US_STATIONS` (reviewed, `liveCallAuthorized`).

To add a live-callable destination, add an entry to `LIVE_US_STATIONS` with
a valid E.164 number you own or are authorized to call, and set
`liveCallAuthorized: true`. Adding a station elsewhere, or omitting the
flag, will not make it live-callable — by design.

## Architecture

| Path | Responsibility |
| --- | --- |
| `src/lib/callProvider.ts` | `CallProvider` abstraction. `CalleCallProvider` wraps `@call-e/calle`, constructed per request from the supplied key. `MockCallProvider` is the no-call simulation. Defines `KnownCallError` for failures the app can fully explain. |
| `src/lib/liveCallGuard.ts` | E.164 validation and the live-call station allowlist. |
| `src/lib/redact.ts` | Phone-number redaction applied to all outbound free text. |
| `src/lib/callTask.ts` | Call task text and `recipientResultSchema`. |
| `src/lib/ranking.ts` | Deterministic scoring and result headlines. |
| `src/app/api/check/start/route.ts` | Authorization checks, then concurrent dispatch. |
| `src/app/api/check/status/route.ts` | Stateless status polling. |
| `src/app/page.tsx` | UI, attestation control, client-side poll timeout. |

### Result schema

`buildRecipientResultSchema` uses only the JSON Schema features CALL-E
documents as supported: `type`, `properties`, `required`, `enum`, nested
`object`, and `additionalProperties: false`. Every enum includes an
`unknown` member and every numeric field a `-1` sentinel, so an answer the
call did not establish is preserved as unestablished rather than omitted or
inferred.

### Ranking

Scoring is plain arithmetic over the call-reported result, so outcomes are
reproducible and inspectable. A reported "out of service" or "connector
unavailable" cannot outrank a reported "available now". Any check without a
completed result ranks below every completed one, and a check flagged
`outcomeUncertain` ranks lowest of all — it carries less information than a
call known to have failed. CALL-E's completion confidence acts only as a
tiebreaker, never as a primary factor.

### Uncertain outcomes

A failure to create or poll a call is not automatically a confirmed
non-event. `KnownCallError` marks failures the app can fully explain, such
as a missing API key. Anything else — a network failure, an unexpected SDK
error, or a call that never reaches a terminal status within the client's
two-minute poll timeout — is flagged `outcomeUncertain`, because whether
CALL-E received and processed the call is genuinely unknown. The UI
distinguishes these from definite failures, and ranking treats them as
carrying less information rather than more.

### State

Neither API route keeps server-side session state. The client holds the
checks array returned by `/start` and sends it back on each `/status` poll;
the route re-queries only the entries still in flight and returns the merged
result. Both routes return JSON on unexpected failure rather than an HTML
error page, so client-side error handling always has a parseable response.

This means an in-flight check does not survive a full page reload. An
application needing that should persist the checks array client-side rather
than reintroducing server memory, which is unreliable across serverless
invocations.

## Deployment

The app runs anywhere Next.js does and requires no environment variables,
since credentials are supplied per request. On a public deployment, demo
mode is fully usable by any visitor with no setup, and live calling remains
gated by the authorization checks above.

## Limitations

- Station data is a small static set, not a live directory integration.
- Status is polled from the client rather than delivered by webhook. A
  production deployment should use CALL-E's terminal webhooks, deduplicated
  via the `CALL-E-Event-Id` header, and persist state server-side against an
  authenticated session rather than trusting the client to return it.
- The Calls API exposes no cancel-in-flight operation. A deployment
  handling larger station lists should dispatch in waves rather than
  unbounded concurrency.
- `answered_by` (human / IVR / voicemail / unknown) is requested in the
  result schema but is not independently re-checked against the transcript.
- The operator attestation records a confirmation; it does not verify
  operator identity or authorization.

## Future work

- Live station directory integration, with the same `liveCallAuthorized`
  and E.164 gating applied to any discovered station before it becomes
  eligible for a live call.
- Terminal webhook ingestion with event-id deduplication, replacing client
  polling.
- A freshness window over stored results, so a station reported on recently
  is not re-called by every subsequent request.
- Wave-based dispatch and distance-bounded station selection for longer
  routes.

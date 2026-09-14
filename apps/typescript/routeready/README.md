# RouteReady

The delivery route that calls ahead. While a rider is still riding, RouteReady uses CALL-E to phone the next customers on the route, turns each answer into a strict structured result, re-orders the remaining stops around what customers actually said, and shows the rider one short instruction.

Pre-delivery confirmation apps call a customer once, before dispatch. RouteReady works during the route: the arrival time decides who to call, and the answer changes the order of the stops that are left.

## The problem

In cash-on-delivery markets such as Bangladesh, India and Southeast Asia, a large share of first delivery attempts fail because nobody is ready at the door. Riders make up for it by phoning customers themselves, often while riding, and still arrive at doors that are not ready while a ready customer two streets away waits. Route planners optimise the order once in the morning; nothing updates it from what customers say during the day.

## How it works

Each time something changes on the route:

1. **Arrival times.** The engine projects when the rider reaches every remaining stop in the current order, using road travel times.
2. **Pick one call.** There is one phone line, so at most one call is in flight. The next call goes to the soonest stop the rider will reach in 6 to 45 minutes that has not been called today. Each customer is called at most once a day.
3. **Call through CALL-E.** `client.calls.create` places a disclosed AI call with the order reference, the arrival time, the cash amount and a strict `recipientResultSchema` (see [Result schema](#result-schema)). The idempotency key is `routeready:<run>:<stop>`, so a retried request can never dial twice. `calls.get` and `calls.listEvents` stream the conversation into the rider app while it happens.
4. **Evidence gate.** An answer may change the route only if the call completed, it reached the planned number, the customer was reached, their own words are quoted, they said when, and CALL-E's completion confidence is medium or high. Anything else is recorded as unverified and changes nothing.
5. **Re-order.** A branch-and-bound search tries every order of the remaining stops (up to nine) with each customer's ready time as the earliest delivery time, and keeps the cheapest: finish time plus twice the minutes past any promised window, plus a small penalty per moved stop so the route never flips for a trivial gain. Ties keep the current order.
6. **Rider instruction.** The rider app shows one instruction: the next stop, whether the customer is ready, the landmark they gave and the cash to collect, with a message on screen whenever the route changes.

| Customer said | Route effect |
| --- | --- |
| Ready now | Earliest delivery is now; the stop can move up |
| Within 15 minutes / 15 to 45 minutes | Earliest delivery is the arrival time told on the call plus 15 or 45 minutes, or the clock time they named |
| Later today | Taken off this loop and listed as a revisit after the time they named |
| Not today | Taken off the route; rescheduling needs dispatcher approval |
| Anything unclear, no answer, low confidence, no quote | No change, no redial |

## Your route with real calls

Hosted: https://awesome-phone-call-agents-xloz.onrender.com/route (free instance; the first visit can take a minute to wake up). Locally: `npm start`, then open `http://127.0.0.1:3000/route`.

1. **Paste your CALL-E API key.** It is checked with a read-only request, held only inside that route's CALL-E client in server memory, never saved, logged or sent back to the browser, and dropped when the route ends.
2. **Pin 1 to 5 stops on the map.** Each stop has a customer name, a phone number with its country, an optional address and cash to collect. Place the rider 🛵 where the route starts.
3. **Choose the call-ahead time** (3 to 20 minutes), the rider's average speed and whether each call says it is a test with no real parcel.
4. **Choose the rider's location source.** *Drag on the map* moves the rider by dragging or tapping, so the route can be tested from a desk. *My phone's GPS* follows the phone's position while the page is open.
5. **Ride.** Arrival times come from road-adjusted distance at the chosen speed. When the next uncalled customer is within the call-ahead time, `client.calls.create` places the call with the same task, result schema and idempotency key pattern as the demo day, and the transcript streams into the app. The answer goes through the same evidence gate, and a verified answer re-orders the remaining stops with the same search. Press **Delivered** or **Nobody home** at each door.
6. **End the route** with ✕. No new calls start and the key is discarded. A route nobody has open ends after 20 minutes, and every route ends after 3 hours.

Each visitor's route is separate. The browser holds a random session id for it; CALL-E only ever sees a separate public run id in the metadata and idempotency key. On this screen the re-ordering also weighs how long each customer waits for their parcel, so a customer who asked for half an hour never sends the rider past a ready customer next door.

To try the whole flow without real calls, point the server at a local fake of the CALL-E API with `CALLE_BASE_URL`.

## Try it without an account

Node 20.12 or later. Nothing below places a call or needs a CALL-E key.

```bash
cd apps/typescript/routeready
npm install
npm test          # re-ordering checked against exhaustive search, evidence gate, answer rules, engine, schema sync
npm run sim       # the demo day twice, without calls and with RouteReady, then a comparison
npm start         # rider app at /app, two-phone showcase at /, your own route at /route on http://127.0.0.1:3000
```

In the app, press **Start the day**. The demo day is a fictional Dhaka route with eight stops, reserved `+1 555-01xx` numbers and scripted customers. `npm run sim` prints the same comparison:

| | Without calls | With RouteReady |
| --- | --- | --- |
| Failed attempts at the door | 2 | 0 |
| Minutes waiting at doors | 3 | 0 |
| Trips avoided (customer said later or not today) | 0 | 2 |
| Calls placed | 0 | 7 ($0.35 at $0.05 each) |
| Route finished | 11:26 | 11:10 |

The two runs share the same ground truth for every customer; only what the route knows differs.

## Pace

A day is meant to be watched. Scripted calls play out line by line over about seventeen seconds, each answer holds for a few seconds before the next call starts, and route changes appear as a message on the rider's screen. Slow, Normal and Fast set how fast the riding between calls runs, and the day can be paused at any time.

## Live calls (opt-in)

Live calls are off unless all of the following are true:

1. `.env` (git-ignored) contains `ROUTEREADY_LIVE=1`, a server-side `CALLE_API_KEY`, and `LIVE_TARGETS` mapping stops to numbers you own or whose owners agreed, for example `LIVE_TARGETS=s2=+1XXXXXXXXXX@US,s3=+1XXXXXXXXXX@US`. Stops without a target keep scripted customers, so a demo can mix a few real calls into the simulated day.
2. The server listens on a loopback address (`HOST=127.0.0.1`, the default). The shared demo day's transcripts and controls have no login, so with any other `HOST` live calls on the demo day are turned off. Visitor routes at `/route` are separate: each is reached only with its own random session id.
3. The rider app's **Start with live calls** button asks for the start token printed in the terminal and the consent statement.

Copy `.env.example` to `.env` to start. The API key never reaches the browser and every number on screen and in logs is masked. While the server listens on loopback it also refuses requests that name another host, and every `POST` from another site is refused.

While a live call is in flight the day clock drops to real time, so a call is never shown shorter than it was, and it holds there for twelve seconds afterwards so the result stays on screen.

**Region note.** As of 12 September 2026 CALL-E rejects outbound calls to Bangladesh numbers in both English and Bengali (`422 call_not_ready`) and staff recommend US destinations or the official US test hotline for integration tests ([call-e-integrations#98](https://github.com/CALLE-AI/call-e-integrations/issues/98)). The demo day is set in Dhaka, but live targets must currently be US, Singapore or Australia numbers.

### One-call smoke test

`npm run smoke` previews one readiness call (masked number, full task text, idempotency key) without calling. `npm run smoke:live` places it to `SMOKE_PHONE` and prints the streamed events, the structured result and the transcript, with every phone number masked, including numbers inside provider messages and transcripts; the saved result under `results/` is masked the same way. The idempotency key comes from `SMOKE_ID`, so re-running never dials twice. Changing `SMOKE_ID` is the only way to place a second smoke call, and doing so is the operator's explicit approval of a repeat call.

Author-reported result against CALL-E's US test hotline: accepted immediately, ringing after about 60 seconds, a 54-second conversation, final result after 137 seconds. The hotline is an AI receptionist, so CALL-E correctly returned `reached_recipient: "no"` and `readiness: "unknown"`, and the gate would leave the route unchanged, even though CALL-E also reported `taskCompleted: true` with high confidence.

Also author-reported: a live day in the app with one stop mapped to the same hotline streamed the conversation into the live call card while it happened (4 to 23 transcript lines over about two minutes, with the day clock in real time), classified the receptionist's answer as unverified, and left the route unchanged.

## Result schema

Sent as `recipientResultSchema` on every call; defined in [`src/calle/task.ts`](src/calle/task.ts). It uses only the schema features CALL-E supports and an `unknown` value for every enum.

| Field | Values |
| --- | --- |
| `reached_recipient` | `yes`, `no`, `unknown` |
| `readiness` | `ready_now`, `within_15_min`, `15_to_45_min`, `later_today`, `not_today`, `unknown` |
| `ready_clock_time` | `HH:MM` if the customer named a time, otherwise empty |
| `handoff` | `in_person`, `guard_or_neighbor`, `none`, `unknown` |
| `cod_cash_ready` | `yes`, `no`, `not_applicable`, `unknown` |
| `landmark` | the customer's directions, or empty |
| `customer_quote` | the customer's own words about timing, never paraphrased |
| `quote_in_english` | English translation of the quote |

## Safety and side effects

- Preview, simulation and tests never contact CALL-E. Live calls on the demo day need the environment switch, the start token and the consent statement. Your own route needs the visitor's own API key and the consent statement, and calls go to the numbers they entered, charged to their own account.
- Calls disclose that they are an AI assistant in the first sentence, never ask for card, bank, password or identity details, and never promise an exact delivery time.
- One call at a time, and no automatic redial after a failed, unclear or ambiguous call.
- **The queue stops on ambiguity.** If CALL-E answers a create request with a 4xx refusal (other than 408 or 409), no call exists and the next stop may be called. Any other failure (network error, timeout, 5xx, 408, 409) leaves it unknown whether the call was placed, so no further call starts that day or on that route, and the screen says to check the call in the CALL-E dashboard. A live call that has not reached a terminal status after 15 minutes keeps the line busy and stops the queue the same way; it is never treated as over.
- **Each customer at most once a day, by number.** A destination number is recorded when its call is attempted, so an ambiguous creation counts. Two stops with the same number are rejected, on a route and in `LIVE_TARGETS`. A number already called today on this server, by any route or an earlier demo day, is not called again unless a person ticks an explicit approval for a repeat call for a different reason. The record is in memory, keeps numbers only as hashes, and is forgotten on a server restart.
- **Keys only go to CALL-E.** A real API key, whether a visitor's or the server's, is only sent to an approved HTTPS CALL-E origin. `CALLE_BASE_URL` pointing anywhere else, such as a local fake, accepts keys starting with `dummy-` only.
- An answer changes the route only through the evidence gate. "Not today" is a recommendation that a dispatcher must approve; RouteReady writes nothing to any courier, shop or payment system.
- Phone numbers are masked in the browser, the event log, the terminal and error responses, including numbers that appear inside CALL-E transcripts, event messages and errors. The API key stays on the server. Transcripts are shown as untrusted text and escaped.
- On your own route, text a visitor types (names, addresses, shop name) is cut to one short line before it reaches a call task. At most 5 stops per route and 30 routes per server; idle routes end after 20 minutes and every route after 3 hours.
- Smoke-test results are saved under `results/`, which is git-ignored, with phone numbers masked.

## Cancellation

CALL-E has no cancel endpoint. **Stop** ends the day loop so no further calls are started, but a call CALL-E already accepted will still ring and finish. Closing the browser does not stop the server; stop it with Ctrl+C. Nothing recurs: every day is started by hand.

## Limitations

- On the demo day the route, the rider's movement and the scripted customers are simulated; only live targets are real calls.
- On your own route, arrival times are estimates from straight-line distance times 1.35 at a fixed speed, not live traffic, and routes live in server memory, so a server restart ends them.
- Travel times come from the public OSRM demo server with free-flow speeds, scaled by a fixed traffic factor of 2. They were downloaded once into `fixtures/` with `npm run build:travel`.
- One rider and at most nine stops searched exhaustively; later stops keep their order.
- A customer who does not answer is not called again that day; the rider tries the door as usual.
- The once-a-day record lives in one server's memory. Two servers, or a restart, do not share it.
- Phone numbers spoken as words in a transcript cannot be recognised and masked.
- This is a hackathon reference app, not a production dispatch system.

## Layout

```
src/core/     arrival times, call picker, evidence gate, answer rules, re-ordering, distance estimates, fixture loading
src/calle/    call task text and result schema; live (CALL-E SDK) and scripted call ports
src/engine/   the demo day loop and event descriptions
src/field/    your own route: real-time session, setup validation, per-visitor registry
src/server/   web server, run controller and live-mode configuration
web/          the rider app (route, stops, calls, today), your-route setup and riding screens, the two-phone showcase page
fixtures/     the Dhaka demo day and its saved road data
scripts/      smoke call, simulation and road-data download
tests/        unit and engine tests
```

## Validation

```bash
npm run check
npm test
npm run sim
python3 ../../../scripts/validate_repository.py
```

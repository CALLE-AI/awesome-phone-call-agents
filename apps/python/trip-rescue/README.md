# Trip Rescue

**A voice agent that calls you the moment your flight is disrupted, and gets you rebooked before you've opened an app.**

Built on [CALL-E](https://www.heycall-e.com/) (Python SDK `calle-ai`) for the phone call, and [Duffel](https://duffel.com) for real flight search, booking, and rebooking.

---

## The problem

When a flight is cancelled or delayed past a connection, the traveler finds out from a gate announcement or a push notification, then has to open an app, search for alternatives themselves, and either rebook online or wait on hold with the airline. A similar pattern — an AI voice agent proactively calling a traveler the instant a trip is disrupted and handling the rebooking on the call — won at a Sabre-backed, American Airlines/PayPal-judged Voice AI hackathon in July 2026 (the winning project there was called FixTrip; see `docs/RESEARCH.md`). Trip Rescue is a CALL-E-native take on the same idea: the disruption doesn't wait for the traveler to check their phone, and neither does the fix.

## What it does

1. A disruption is detected on a booked order (in this build, triggered manually or by a scheduled check — see **Known limitations** below for why).
2. Trip Rescue asks **Duffel** for real, live rebooking options on the same route (an actual order-change request against the traveler's real order, not a canned list).
3. **CALL-E** calls the traveler, identifies itself clearly as an automated assistant, reads out up to three real options with prices and times, and asks which one they'd like — or whether none work, or they'd rather speak to a person.
4. If the traveler accepts an option, Trip Rescue confirms it on **Duffel** immediately, on the same call. If they decline, are unreachable, or ask for a human, **the order is never touched** — see **Design notes**.

## Why the split matters

The call is where the model does the least amount of interpretation possible: it reads real options, listens for one of five closed outcomes, and reports it back. The decision of *what happens next* — which order-change to confirm, whether to touch the booking at all — lives in `orchestrator.py`, in plain, tested code, not inferred from a transcript. A model that hallucinated an acceptance on an unanswered call, or invented a price that wasn't offered, can't accidentally rebook anyone: `handle_disruption` only acts on the closed `decision` enum in `schemas.py`, and only when `reachable` is true.

## Architecture

```
DisruptionEvent (order_id, reason)
        |
        v
DuffelClient.find_rebooking_options()  --> real order_change_offers from Duffel,
        |                                    sorted soonest-first, widening to
        |                                    nearby dates if the exact date is empty
        v
RunStore.record_disruption()  --> logged to SQLite before the call is placed
        |
        v
TripRescueCaller.call_traveler_with_options()  --> CALL-E places the call,
        |                                            returns a closed decision
        v
orchestrator.handle_disruption()  --> plain code decides: confirm, or don't
        |
        v
DuffelClient.confirm_rebooking()  --> real order_change + confirm on Duffel
        |
        v
RunStore.record_outcome()  --> logged to SQLite once resolved
```

## Verified live, not just in docs

Every Duffel call in `duffel_client.py` was proven against Duffel's real sandbox before being written into this codebase, twice: once by hand (booking reference `LQKYWD`, LHR→JFK, rebooked from Oct 15 to Oct 16, $216.81 → $341.81), and once again reproducing the exact request/response shapes this module sends (booking reference `UUEGXU`, rebooked Oct 20 → Oct 21, $348.47), which caught a real bug before it shipped: Duffel's passenger validation rejects fictional `+1555...`-range numbers with `invalid_phone_number` — fixed by defaulting the demo script to a real-format number and documenting it loudly in `--help`.

## Setup

Requires Python 3.11+.

```bash
python -m venv .venv
source .venv/bin/activate   # .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env
```

### Dry run (default, no credentials, no network)

```bash
python scripts/simulate_disruption.py
```

### Live (real Duffel sandbox booking + real CALL-E call)

```bash
export DRY_RUN=false
export DUFFEL_API_KEY=duffel_test_your_key_here   # Duffel dashboard -> Developers -> Access tokens
export CALLE_API_KEY=calle_test_your_key_here
python scripts/simulate_disruption.py --phone +1XXXXXXXXXX   # a real, reachable number
```

### Viewing a run

Every run of `simulate_disruption.py` — dry or live — writes its result to `web/data/last_run.js` and prints where. Open `web/index.html` in a browser afterward to see it rendered as a trip confirmation: original vs. new departure, the options Duffel offered on the call, which one (if any) was chosen, and whether the order was actually touched. No server or build step — it's a static page with no dependencies; just open the file. (The repo ships with sample data pre-populated so the page has something to show before you've run it yourself; it's clearly labeled as sample data until you do.)

Every run is also appended to a local SQLite file (`trip_rescue_runs.sqlite3` by default, override with `--db-path`) via `trip_rescue/store.py`, independent of the web viewer — see **Known limitations** for what this is and isn't.

## Tests

```bash
python -m pytest tests/ -v
```

28 tests, all offline: dry-run fixtures for the Duffel and CALL-E clients, orchestrator tests that assert on the decision logic specifically — accepted option 2 confirms option 2 (not just the first one), declined/unreachable/human-requested/no-options all leave the order untouched, at most 3 options are ever offered even if Duffel returns more, and an unrecognized decision value fails safe rather than guessing — plus tests for the persistence store (`store.py`) and, using `httpx.MockTransport` to fake Duffel's live responses without any real network access, tests that the live-mode rebooking search actually sorts by departure time and actually widens to nearby dates, not just the already-sorted dry-run fixture.

## Side effects

- **Dry run (default):** no network calls at all. Every Duffel and CALL-E interaction returns deterministic fixtures.
- **Live mode:** places a real (sandbox) Duffel booking and order change, and places a real CALL-E phone call to the number you pass in. `DRY_RUN=false` is required explicitly; there is no accidental live mode.
- **The order is only ever modified after a live, reachable call in which the traveler explicitly chose one of the offered options.** No background job, retry, or webhook in this build can change a booking on its own.
- Each disruption is idempotent per `order_id` + `detected_at` (`idempotency_key` passed to CALL-E), so a retried trigger doesn't place a duplicate call.

## Known limitations (stated directly, not hidden)

- **Disruption detection is simulated, not live.** A real-time flight-status feed that pushes a cancellation the instant it happens (FlightAware AeroAPI, Cirium, or a direct airline feed) is a paid/enterprise product in every case we found, and none of that was obtainable inside a 4-day hackathon build. `scripts/simulate_disruption.py` stands in for that trigger. Everything downstream — asking Duffel for options, calling the traveler, confirming the change — is real and identical either way; only the "how do we learn a flight was cancelled" step is a stand-in. See `docs/RESEARCH.md`.
- **Rebooking options still come from a single route and a single cabin class.** `find_rebooking_options` now widens the date search automatically (the requested date, then ±1 day by default, closest first, via `search_window_days`) when the exact date has nothing available, and always returns options sorted soonest-first regardless of what order Duffel's API happens to return them in — but nearby airports and other cabin classes are still out of scope for this build.
- **Only the CALL-E `create_and_wait` one-shot call API is used**, not a published Goal — this build's task/result-schema pairing changes per disruption (different flight, different options), which fits the one-shot API more directly than a fixed Goal template.
- **Persistence is now a single local SQLite file (`trip_rescue/store.py`), not a real datastore.** Every disruption is recorded before the call is placed and the outcome is recorded once it resolves — matching the pattern other apps in this repo use — so a crash mid-call now leaves a row proving a call was attempted, instead of losing that fact entirely. A production deployment would still want a real database, retention policy, and an actual crash-recovery sweep over unresolved rows, none of which this build does.
- **Passenger contact phone doubles as the Duffel booking contact number**, which is realistic (it's usually the same number) but means a live demo needs a real, reachable phone from the start, not a placeholder.

## Go-to-market

Airlines already pay for delay/cancellation rebooking at scale (call centers, chatbots, app flows); the wedge here is speed and channel — voice, proactive, on the call before the traveler has even checked their phone — not a new problem. Initial users would be OTAs and travel management companies (who already hold PNRs across multiple airlines and have a direct incentive to reduce support-call volume during irregular operations) rather than airlines themselves, who mostly run their own IROPS tooling in-house.

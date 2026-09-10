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
DuffelClient.find_rebooking_options()  --> real order_change_offers from Duffel
        |
        v
TripRescueCaller.call_traveler_with_options()  --> CALL-E places the call,
        |                                            returns a closed decision
        v
orchestrator.handle_disruption()  --> plain code decides: confirm, or don't
        |
        v
DuffelClient.confirm_rebooking()  --> real order_change + confirm on Duffel
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

## Tests

```bash
python -m pytest tests/ -v
```

17 tests, all offline: dry-run fixtures for the Duffel and CALL-E clients, and orchestrator tests that assert on the decision logic specifically — accepted option 2 confirms option 2 (not just the first one), declined/unreachable/human-requested/no-options all leave the order untouched, at most 3 options are ever offered even if Duffel returns more, and an unrecognized decision value fails safe rather than guessing.

## Side effects

- **Dry run (default):** no network calls at all. Every Duffel and CALL-E interaction returns deterministic fixtures.
- **Live mode:** places a real (sandbox) Duffel booking and order change, and places a real CALL-E phone call to the number you pass in. `DRY_RUN=false` is required explicitly; there is no accidental live mode.
- **The order is only ever modified after a live, reachable call in which the traveler explicitly chose one of the offered options.** No background job, retry, or webhook in this build can change a booking on its own.
- Each disruption is idempotent per `order_id` + `detected_at` (`idempotency_key` passed to CALL-E), so a retried trigger doesn't place a duplicate call.

## Known limitations (stated directly, not hidden)

- **Disruption detection is simulated, not live.** A real-time flight-status feed that pushes a cancellation the instant it happens (FlightAware AeroAPI, Cirium, or a direct airline feed) is a paid/enterprise product in every case we found, and none of that was obtainable inside a 4-day hackathon build. `scripts/simulate_disruption.py` stands in for that trigger. Everything downstream — asking Duffel for options, calling the traveler, confirming the change — is real and identical either way; only the "how do we learn a flight was cancelled" step is a stand-in. See `docs/RESEARCH.md`.
- **Rebooking options come from a single route/date query, not a full search across cabin classes or nearby airports.** A production version would widen the search (nearby dates, nearby airports, other cabins) before calling.
- **Only the CALL-E `create_and_wait` one-shot call API is used**, not a published Goal — this build's task/result-schema pairing changes per disruption (different flight, different options), which fits the one-shot API more directly than a fixed Goal template.
- **No persistence layer.** A production deployment would store the disruption -> call -> outcome record (SQLite at minimum, matching the pattern other apps in this repo use) so a crash mid-call doesn't lose the fact that a call was placed. This build runs one disruption per process invocation.
- **Passenger contact phone doubles as the Duffel booking contact number**, which is realistic (it's usually the same number) but means a live demo needs a real, reachable phone from the start, not a placeholder.

## Go-to-market

Airlines already pay for delay/cancellation rebooking at scale (call centers, chatbots, app flows); the wedge here is speed and channel — voice, proactive, on the call before the traveler has even checked their phone — not a new problem. Initial users would be OTAs and travel management companies (who already hold PNRs across multiple airlines and have a direct incentive to reduce support-call volume during irregular operations) rather than airlines themselves, who mostly run their own IROPS tooling in-house.

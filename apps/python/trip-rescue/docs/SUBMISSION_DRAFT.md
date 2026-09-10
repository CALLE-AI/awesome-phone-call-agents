# Devpost submission draft

## Project name

Trip Rescue

## Elevator pitch (one line)

The moment your flight is cancelled, your phone rings — and by the time you hang up, you're already rebooked.

## What it does

Trip Rescue watches a traveler's booking, and when it's disrupted, it doesn't wait for them to notice. It asks Duffel for real, live rebooking options on the spot, then has a CALL-E voice agent call the traveler directly, read out up to three real alternatives with actual prices and departure times, and ask which one they'd like — or whether none of them work, or they'd rather talk to a person. If the traveler accepts an option, it's confirmed on their real booking before the call ends. No option is ever invented, and the booking is never changed without the traveler's explicit, on-call confirmation.

## The problem

The US flight cancellation rate reached 1.4% in 2024 (up from 1.3% the year before), and at hub airports like Washington Reagan National, over a quarter of flights are delayed and nearly 4% are cancelled outright. Every one of those disruptions currently gets discovered by the traveler — a gate announcement, a push notification — who then has to open an app or call the airline themselves. Trip Rescue flips who does the noticing.

## How we built it

- **Duffel** for real flight search, instant booking, and the order-change/confirm flow that actually moves a passenger to a new flight. Every one of these calls was proven against Duffel's live sandbox before being written into the codebase — twice, independently (booking references `LQKYWD` and `UUEGXU`) — which caught a real validation bug (Duffel rejects fictional `+1555...`-range phone numbers) before it could surprise us on demo day.
- **CALL-E** (`calle-ai` Python SDK) for the actual phone call, using `calls.create_and_wait` with a closed, enum-driven `result_schema` so the call can only report one of five defined outcomes (accepted option 1/2/3, declined all, asked for a human) — never a free-text decision the rest of the system has to interpret.
- A plain-code orchestrator that owns every decision about *whether to touch the booking* — the voice model reports what happened, the orchestrator decides what happens next, and it only ever confirms a change after a reachable call with an explicit accepted-option decision.

## Challenges we ran into

The two paid dependencies a "real" version of this would need — a live flight-status feed and a production airline/GDS relationship — were both out of reach in a multi-day build. Rather than fake it silently, the disruption trigger is explicitly a stand-in (documented loudly in the README and the CLI's own `--help` text), while the rebooking mechanic itself is fully real against Duffel's sandbox.

## What's next

Widening the rebooking search to nearby airports and dates and other cabins, adding persistence so a crash mid-call doesn't lose the record of what was offered, and — if this moves past a hackathon build — a real disruption feed and a partnership with an OTA or travel management company that already holds PNRs across multiple airlines, rather than going airline-by-airline.

## Built with

Python, calle-ai (CALL-E Python SDK), Duffel API, httpx, pytest.

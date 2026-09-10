#!/usr/bin/env python3
"""Trigger a Trip Rescue run end to end.

This is the "demo button": in production, DisruptionEvent would arrive from
a paid flight-status feed (FlightAware/Cirium) or an airline's own webhook.
Nobody on this team has access to one of those for a 4-day hackathon build,
so this script stands in for that trigger -- everything downstream of the
DisruptionEvent (find options -> call -> confirm) is identical either way.
See docs/RESEARCH.md for why that substitution is the honest thing to do.

Usage:
    # Dry run (default): no network calls, deterministic fixtures.
    python scripts/simulate_disruption.py

    # Live: books a real Duffel Airways test-mode trip, then simulates and
    # resolves a disruption on it, placing a real CALL-E call.
    DRY_RUN=false DUFFEL_API_KEY=duffel_test_... CALLE_API_KEY=calle_test_... \\
        python scripts/simulate_disruption.py --phone +15555550100
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from datetime import datetime, timezone

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0] + "/src")

from trip_rescue.calle_client import TripRescueCaller  # noqa: E402
from trip_rescue.duffel_client import DuffelClient  # noqa: E402
from trip_rescue.models import DisruptionEvent  # noqa: E402
from trip_rescue.orchestrator import handle_disruption  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--origin", default="LHR")
    parser.add_argument("--destination", default="JFK")
    parser.add_argument("--departure-date", default="2026-10-15")
    parser.add_argument("--new-departure-date", default="2026-10-16")
    parser.add_argument(
        "--phone",
        default="+442080160509",
        help=(
            "E.164 phone number, in dry-run this can be anything. In live mode it goes "
            "into the Duffel passenger record (which rejects fictional 555-range US numbers "
            "with invalid_phone_number, confirmed against the sandbox on 2026-09-10) AND is "
            "the number CALL-E actually dials -- so for a live demo it must be a real, "
            "reachable phone, not a placeholder."
        ),
    )
    parser.add_argument("--name", default="Jordan Traveler")
    parser.add_argument("--reason", default="cancelled", choices=["cancelled", "delayed_missed_connection"])
    args = parser.parse_args()

    with DuffelClient() as duffel, TripRescueCaller() as caller:
        mode = "DRY RUN" if duffel.dry_run else "LIVE"
        print(f"[{mode}] Booking {args.origin}->{args.destination} on {args.departure_date} for {args.name}...")

        offers = duffel.search_offers(origin=args.origin, destination=args.destination, departure_date=args.departure_date)
        duffel_offer = next((o for o in offers if o.get("owner", {}).get("name") == "Duffel Airways"), offers[0])
        booking = duffel.book_offer(duffel_offer, passenger_phone=args.phone, passenger_name=args.name)
        print(f"  Booked: order={booking.order_id} ref={booking.booking_reference} total={booking.total_amount} {booking.total_currency}")

        disruption = DisruptionEvent(
            order_id=booking.order_id,
            reason=args.reason,
            detected_at=datetime.now(timezone.utc).isoformat(),
        )
        print(f"\n[{mode}] Disruption detected: {disruption.reason} on order {disruption.order_id}")
        print("  Calling traveler with real rebooking options...")

        outcome = handle_disruption(
            booking,
            disruption,
            duffel=duffel,
            caller=caller,
            new_departure_date=args.new_departure_date,
        )

        print("\nOutcome:")
        print(json.dumps(_serialize(outcome), indent=2, default=str))


def _serialize(outcome) -> dict:
    d = asdict(outcome)
    return d


if __name__ == "__main__":
    main()

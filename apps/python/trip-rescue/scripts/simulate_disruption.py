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
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PROJECT_ROOT / "src"))

from trip_rescue.calle_client import TripRescueCaller  # noqa: E402
from trip_rescue.duffel_client import DuffelClient  # noqa: E402
from trip_rescue.models import Booking, DisruptionEvent, RebookingOutcome  # noqa: E402
from trip_rescue.orchestrator import handle_disruption  # noqa: E402
from trip_rescue.store import RunStore  # noqa: E402

_RUN_OUTPUT_PATH = _PROJECT_ROOT / "web" / "data" / "last_run.js"
_DEFAULT_DB_PATH = _PROJECT_ROOT / "trip_rescue_runs.sqlite3"


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
    parser.add_argument(
        "--db-path",
        default=str(_DEFAULT_DB_PATH),
        help="SQLite file each run's disruption/outcome record is written to (see trip_rescue/store.py).",
    )
    args = parser.parse_args()

    store = RunStore(args.db_path)

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
            store=store,
        )

        print("\nOutcome:")
        print(json.dumps(_serialize(outcome), indent=2, default=str))

        run_path = _write_run_for_web(
            mode=mode,
            booking=booking,
            disruption=disruption,
            requested_new_departure_date=args.new_departure_date,
            outcome=outcome,
        )
        print(f"\nWrote results-viewer data to {run_path}")
        print(f"Open {_PROJECT_ROOT / 'web' / 'index.html'} in a browser to view it.")
        print(f"Recorded this run in {args.db_path} (see trip_rescue/store.py).")


def _serialize(outcome) -> dict:
    d = asdict(outcome)
    return d


def _write_run_for_web(
    *,
    mode: str,
    booking: Booking,
    disruption: DisruptionEvent,
    requested_new_departure_date: str,
    outcome: RebookingOutcome,
) -> Path:
    """Write this run's result as a small JS data file the static results
    viewer (web/index.html) reads directly.

    This is a plain ``<script>``-loaded global, not a fetch()'d JSON file, on
    purpose: opening web/index.html straight off disk (double-click, no local
    server) is blocked from fetch()-ing a sibling file by the browser's
    file:// CORS rules, but a plain <script src="data/last_run.js"> tag is
    not. Every run overwrites this file, so the viewer always reflects the
    most recent invocation of this script.
    """
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "booking": asdict(booking),
        "disruption": asdict(disruption),
        "requested_new_departure_date": requested_new_departure_date,
        "outcome": _serialize(outcome),
    }
    _RUN_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    _RUN_OUTPUT_PATH.write_text(
        "// Auto-generated by scripts/simulate_disruption.py -- do not edit by hand.\n"
        "// Loaded by web/index.html as a plain global (see the docstring on\n"
        "// _write_run_for_web for why this isn't a fetch()'d .json file.\n"
        "window.TRIP_RESCUE_RUN = " + json.dumps(payload, indent=2, default=str) + ";\n",
        encoding="utf-8",
    )
    return _RUN_OUTPUT_PATH


if __name__ == "__main__":
    main()

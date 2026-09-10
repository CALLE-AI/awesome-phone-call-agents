from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from trip_rescue.duffel_client import DuffelClient  # noqa: E402


def test_dry_run_needs_no_api_key():
    client = DuffelClient(dry_run=True)
    assert client.dry_run is True


def test_dry_run_search_returns_deterministic_offers():
    client = DuffelClient(dry_run=True)
    offers = client.search_offers(origin="LHR", destination="JFK", departure_date="2026-10-15")
    assert len(offers) >= 1
    assert offers[0]["owner"]["name"] == "Duffel Airways"


def test_dry_run_book_offer_produces_a_booking():
    client = DuffelClient(dry_run=True)
    offers = client.search_offers(origin="LHR", destination="JFK", departure_date="2026-10-15")
    booking = client.book_offer(offers[0], passenger_phone="+15555550100", passenger_name="Jordan Traveler")
    assert booking.origin == "LHR"
    assert booking.destination == "JFK"
    assert booking.passenger_phone == "+15555550100"


def test_dry_run_rebooking_options_are_ordered_soonest_first():
    client = DuffelClient(dry_run=True)
    offers = client.search_offers(origin="LHR", destination="JFK", departure_date="2026-10-15")
    booking = client.book_offer(offers[0], passenger_phone="+15555550100", passenger_name="Jordan Traveler")
    options = client.find_rebooking_options(booking, new_departure_date="2026-10-16")
    departures = [o.departing_at for o in options]
    assert departures == sorted(departures)


def test_live_mode_without_api_key_raises_immediately():
    try:
        DuffelClient(dry_run=False, api_key=None)
    except ValueError as exc:
        assert "DUFFEL_API_KEY" in str(exc)
    else:
        raise AssertionError("expected ValueError when api_key is missing in live mode")

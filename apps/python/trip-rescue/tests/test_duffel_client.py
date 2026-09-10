from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from trip_rescue.duffel_client import DuffelClient  # noqa: E402

from fakes import make_booking  # noqa: E402


def _offer(offer_id: str, *, departing_at: str, arriving_at: str = "2026-10-16T14:20:00") -> dict:
    return {
        "id": offer_id,
        "slices": {"add": [{"segments": [{"departing_at": departing_at, "arriving_at": arriving_at}]}]},
        "change_total_amount": "50.00",
        "change_total_currency": "USD",
        "new_total_amount": "266.81",
        "new_total_currency": "USD",
    }


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


def test_live_mode_sorts_rebooking_options_by_departure_even_if_duffel_does_not():
    # Duffel does not promise order_change_offers come back in departure
    # order. The traveler hears them read out "in order" on the call, so
    # find_rebooking_options must not just trust the API's own ordering.
    offers_out_of_order = [
        _offer("oco_late", departing_at="2026-10-16T21:00:00"),
        _offer("oco_early", departing_at="2026-10-16T06:00:00"),
        _offer("oco_mid", departing_at="2026-10-16T13:00:00"),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": {"order_change_offers": offers_out_of_order}})

    client = DuffelClient(dry_run=False, api_key="duffel_test_fake", transport=httpx.MockTransport(handler))
    options = client.find_rebooking_options(make_booking(), new_departure_date="2026-10-16", search_window_days=0)

    assert [o.change_offer_id for o in options] == ["oco_early", "oco_mid", "oco_late"]


def test_live_mode_widens_search_to_nearby_dates_when_exact_date_has_no_offers():
    requested_dates: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        departure_date = body["data"]["slices"]["add"][0]["departure_date"]
        requested_dates.append(departure_date)
        if departure_date == "2026-10-17":  # the day after the requested date
            return httpx.Response(200, json={"data": {"order_change_offers": [_offer("oco_next_day", departing_at="2026-10-17T09:00:00")]}})
        return httpx.Response(200, json={"data": {"order_change_offers": []}})

    client = DuffelClient(dry_run=False, api_key="duffel_test_fake", transport=httpx.MockTransport(handler))
    options = client.find_rebooking_options(make_booking(), new_departure_date="2026-10-16", search_window_days=1)

    assert [o.change_offer_id for o in options] == ["oco_next_day"]
    # Closest-first: the exact date, then +1 day, before it would try -1 day.
    assert requested_dates == ["2026-10-16", "2026-10-17"]


def test_search_window_days_zero_only_queries_the_exact_date():
    requested_dates: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requested_dates.append(body["data"]["slices"]["add"][0]["departure_date"])
        return httpx.Response(200, json={"data": {"order_change_offers": []}})

    client = DuffelClient(dry_run=False, api_key="duffel_test_fake", transport=httpx.MockTransport(handler))
    options = client.find_rebooking_options(make_booking(), new_departure_date="2026-10-16", search_window_days=0)

    assert options == []
    assert requested_dates == ["2026-10-16"]

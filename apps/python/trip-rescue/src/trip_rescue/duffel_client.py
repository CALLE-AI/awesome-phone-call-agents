"""Thin wrapper around the Duffel API for the two things Trip Rescue needs:
booking a trip, and rebooking one that's been disrupted.

Every method has a dry-run path (deterministic, no network, no credentials)
and a live path. Live mode was verified against Duffel's real test-mode
sandbox on 2026-09-10: a real LHR-JFK search, a real Duffel Airways order
(booking reference LQKYWD), a real order-change request, and a real
confirmed rebooking to the next day's departure. The request/response shapes
below match what that session actually returned, not just the docs.

Duffel API reference: https://duffel.com/docs/api
"""

from __future__ import annotations

import os
from dataclasses import asdict
from datetime import datetime, timedelta
from typing import Any

import httpx

from trip_rescue.models import Booking, RebookingOption

DUFFEL_BASE_URL = "https://api.duffel.com"
DUFFEL_VERSION = "v2"


class DuffelError(Exception):
    """Raised for any non-2xx response from the Duffel API."""

    def __init__(self, status_code: int, payload: Any) -> None:
        self.status_code = status_code
        self.payload = payload
        super().__init__(f"Duffel API error {status_code}: {payload}")


class DuffelClient:
    """Dry-run by default. Pass an api_key (or set DUFFEL_API_KEY) and
    dry_run=False to hit the real sandbox.
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        dry_run: bool | None = None,
        base_url: str = DUFFEL_BASE_URL,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.api_key = api_key or os.environ.get("DUFFEL_API_KEY")
        self.dry_run = dry_run if dry_run is not None else os.environ.get("DRY_RUN", "true").lower() != "false"
        if not self.dry_run and not self.api_key:
            raise ValueError("DUFFEL_API_KEY is required when dry_run=False.")
        self._base_url = base_url
        self._client = (
            httpx.Client(
                base_url=base_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Duffel-Version": DUFFEL_VERSION,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                timeout=timeout,
                # None keeps httpx's real default transport; tests pass an
                # httpx.MockTransport here to exercise the live-mode request
                # paths (sorting, date-widening) without any real network
                # access or credentials.
                transport=transport,
            )
            if not self.dry_run
            else None
        )

    def close(self) -> None:
        if self._client is not None:
            self._client.close()

    def __enter__(self) -> "DuffelClient":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    # -- Booking a trip -----------------------------------------------

    def search_offers(self, *, origin: str, destination: str, departure_date: str) -> list[dict[str, Any]]:
        """Return raw Duffel offers for a one-way search."""
        if self.dry_run:
            return _FAKE_OFFERS
        resp = self._request(
            "POST",
            "/air/offer_requests?return_offers=true",
            json={
                "data": {
                    "slices": [{"origin": origin, "destination": destination, "departure_date": departure_date}],
                    "passengers": [{"type": "adult"}],
                    "cabin_class": "economy",
                }
            },
        )
        return resp["data"]["offers"]

    def book_offer(self, offer: dict[str, Any], *, passenger_phone: str, passenger_name: str) -> Booking:
        """Create an instant order for the given offer. Returns our own
        lightweight Booking record, not the raw Duffel payload.
        """
        if self.dry_run:
            given, _, family = passenger_name.partition(" ")
            return Booking(
                order_id="ord_dryrun0000000000000001",
                booking_reference="DRYRUN",
                passenger_phone=passenger_phone,
                passenger_name=passenger_name,
                slice_id="sli_dryrun0000000000000001",
                origin=_FAKE_OFFERS[0]["slices"][0]["origin"]["iata_code"],
                destination=_FAKE_OFFERS[0]["slices"][0]["destination"]["iata_code"],
                departing_at=_FAKE_OFFERS[0]["slices"][0]["segments"][0]["departing_at"],
                total_amount=_FAKE_OFFERS[0]["total_amount"],
                total_currency=_FAKE_OFFERS[0]["total_currency"],
            )

        given, _, family = passenger_name.partition(" ")
        passengers = [
            {
                "id": p["id"],
                "title": "mr",
                "gender": "m",
                "given_name": given or "Traveler",
                "family_name": family or "Rescue",
                "born_on": "1990-01-01",
                "email": "traveler@example.com",
                "phone_number": passenger_phone,
            }
            for p in offer["passengers"]
        ]
        resp = self._request(
            "POST",
            "/air/orders",
            json={
                "data": {
                    "type": "instant",
                    "selected_offers": [offer["id"]],
                    "payments": [
                        {"type": "balance", "amount": offer["total_amount"], "currency": offer["total_currency"]}
                    ],
                    "passengers": passengers,
                }
            },
        )
        order = resp["data"]
        slice0 = order["slices"][0]
        return Booking(
            order_id=order["id"],
            booking_reference=order["booking_reference"],
            passenger_phone=passenger_phone,
            passenger_name=passenger_name,
            slice_id=slice0["id"],
            origin=slice0["origin"]["iata_code"],
            destination=slice0["destination"]["iata_code"],
            departing_at=slice0["segments"][0]["departing_at"],
            total_amount=order["total_amount"],
            total_currency=order["total_currency"],
        )

    # -- Rebooking a disrupted trip -------------------------------------

    def find_rebooking_options(
        self,
        booking: Booking,
        *,
        new_departure_date: str,
        search_window_days: int = 1,
    ) -> list[RebookingOption]:
        """Ask Duffel what it would take to move this booking to a new date
        on the same route. Returns the available order-change offers,
        soonest departure first.

        Duffel does not guarantee ``order_change_offers`` come back in
        departure order, but the traveler hears them read out "in order" on
        the call and the orchestrator keeps only the first three -- so this
        sorts by departure time before returning, in both live and dry-run
        mode, rather than trusting whatever order the API (or the fixture)
        happens to return them in.

        If the exact requested date has no offers at all, this widens the
        search to ``search_window_days`` days on either side (closest date
        first) before giving up -- a same-day cancellation is often easiest
        to resolve by looking at the day before or after, not just the exact
        date first guessed. Pass ``search_window_days=0`` to disable this and
        query only the exact date, matching the old behavior.
        """
        if self.dry_run:
            return sorted(_FAKE_REBOOKING_OPTIONS, key=lambda o: o.departing_at)

        for candidate_date in _search_dates(new_departure_date, search_window_days):
            options = self._request_rebooking_options(booking, candidate_date)
            if options:
                return sorted(options, key=lambda o: o.departing_at)
        return []

    def _request_rebooking_options(self, booking: Booking, departure_date: str) -> list[RebookingOption]:
        resp = self._request(
            "POST",
            "/air/order_change_requests",
            json={
                "data": {
                    "order_id": booking.order_id,
                    "slices": {
                        "remove": [{"slice_id": booking.slice_id}],
                        "add": [
                            {
                                "origin": booking.origin,
                                "destination": booking.destination,
                                "departure_date": departure_date,
                                "cabin_class": "economy",
                            }
                        ],
                    },
                }
            },
        )
        offers = resp["data"].get("order_change_offers", [])
        options: list[RebookingOption] = []
        for offer in offers:
            new_slice = (offer.get("slices", {}) or {}).get("add", [{}])[0]
            segments = new_slice.get("segments", [])
            options.append(
                RebookingOption(
                    change_offer_id=offer["id"],
                    departing_at=segments[0]["departing_at"] if segments else departure_date,
                    arriving_at=segments[-1]["arriving_at"] if segments else None,
                    change_fee_amount=offer["change_total_amount"],
                    change_fee_currency=offer["change_total_currency"],
                    new_total_amount=offer["new_total_amount"],
                    new_total_currency=offer.get("new_total_currency", offer["change_total_currency"]),
                )
            )
        return options

    def confirm_rebooking(self, option: RebookingOption) -> Booking:
        """Actually move the passenger onto the chosen option. This is the
        two-step Duffel flow proven live: create the order_change from the
        selected offer, then confirm it with payment for the fare
        difference. Returns the order's new state as a Booking.
        """
        if self.dry_run:
            return Booking(
                order_id="ord_dryrun0000000000000001",
                booking_reference="DRYRUN",
                passenger_phone="+10000000000",
                passenger_name="Dry Run",
                slice_id="sli_dryrun0000000000000002",
                origin=_FAKE_OFFERS[0]["slices"][0]["origin"]["iata_code"],
                destination=_FAKE_OFFERS[0]["slices"][0]["destination"]["iata_code"],
                departing_at=option.departing_at,
                total_amount=option.new_total_amount,
                total_currency=option.new_total_currency,
            )

        create_resp = self._request(
            "POST",
            "/air/order_changes",
            json={"data": {"selected_order_change_offer": option.change_offer_id}},
        )
        order_change_id = create_resp["data"]["id"]

        self._request(
            "POST",
            f"/air/order_changes/{order_change_id}/actions/confirm",
            json={
                "data": {
                    "payment": {
                        "type": "balance",
                        "amount": option.change_fee_amount,
                        "currency": option.change_fee_currency,
                    }
                }
            },
        )

        # Re-fetch the order for its authoritative post-change state, same
        # as the live spike: the confirm response shape varies, the order
        # resource is the source of truth.
        order_id = create_resp["data"].get("order_id") or create_resp["data"].get("order", {}).get("id")
        order = self.get_order(order_id) if order_id else None
        if order is None:
            # Fall back to what we already know if the order id wasn't
            # echoed back -- callers can always re-fetch by booking_reference.
            return Booking(
                order_id="unknown",
                booking_reference="unknown",
                passenger_phone="",
                passenger_name="",
                slice_id="unknown",
                origin="",
                destination="",
                departing_at=option.departing_at,
                total_amount=option.new_total_amount,
                total_currency=option.new_total_currency,
            )
        slice0 = order["slices"][0]
        return Booking(
            order_id=order["id"],
            booking_reference=order["booking_reference"],
            passenger_phone="",
            passenger_name="",
            slice_id=slice0["id"],
            origin=slice0["origin"]["iata_code"],
            destination=slice0["destination"]["iata_code"],
            departing_at=slice0["segments"][0]["departing_at"],
            total_amount=order["total_amount"],
            total_currency=order["total_currency"],
        )

    def get_order(self, order_id: str) -> dict[str, Any] | None:
        if self.dry_run:
            return None
        resp = self._request("GET", f"/air/orders/{order_id}")
        return resp["data"]

    # -- internals --------------------------------------------------------

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        assert self._client is not None
        response = self._client.request(method, path, **kwargs)
        payload = response.json()
        if response.status_code >= 400:
            raise DuffelError(response.status_code, payload)
        return payload


def _search_dates(center: str, window_days: int) -> list[str]:
    """Dates to try, closest to ``center`` first: center, then +1/-1, +2/-2,
    and so on out to ``window_days``. Kept as a plain function (not a method)
    so it's trivial to unit test the ordering on its own.
    """
    center_date = datetime.strptime(center, "%Y-%m-%d").date()
    dates = [center_date]
    for offset in range(1, window_days + 1):
        dates.append(center_date + timedelta(days=offset))
        dates.append(center_date - timedelta(days=offset))
    return [d.isoformat() for d in dates]


# Deterministic fixtures for dry-run mode and tests. Shaped like the real
# responses seen in the live spike (LHR-JFK, Duffel Airways, $216.81 base
# fare, $125 change fee to the next day) so dry-run output reads the same as
# a live run.
_FAKE_OFFERS: list[dict[str, Any]] = [
    {
        "id": "off_dryrun0000000000000001",
        "owner": {"name": "Duffel Airways"},
        "total_amount": "216.81",
        "total_currency": "USD",
        "passengers": [{"id": "pas_dryrun0000000000000001"}],
        "slices": [
            {
                "origin": {"iata_code": "LHR"},
                "destination": {"iata_code": "JFK"},
                "segments": [{"departing_at": "2026-10-15T10:50:00"}],
            }
        ],
    }
]

_FAKE_REBOOKING_OPTIONS: list[RebookingOption] = [
    RebookingOption(
        change_offer_id="oco_dryrun0000000000000001",
        departing_at="2026-10-16T06:00:00",
        arriving_at="2026-10-16T14:20:00",
        change_fee_amount="125.00",
        change_fee_currency="USD",
        new_total_amount="341.81",
        new_total_currency="USD",
    ),
    RebookingOption(
        change_offer_id="oco_dryrun0000000000000002",
        departing_at="2026-10-16T13:30:00",
        arriving_at="2026-10-16T21:55:00",
        change_fee_amount="98.00",
        change_fee_currency="USD",
        new_total_amount="314.81",
        new_total_currency="USD",
    ),
    RebookingOption(
        change_offer_id="oco_dryrun0000000000000003",
        departing_at="2026-10-17T10:50:00",
        arriving_at="2026-10-17T19:15:00",
        change_fee_amount="60.00",
        change_fee_currency="USD",
        new_total_amount="276.81",
        new_total_currency="USD",
    ),
]

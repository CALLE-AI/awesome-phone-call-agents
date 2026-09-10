"""In-memory fakes for the orchestrator tests. No network, no credentials,
no CALL-E or Duffel SDK involved -- just objects that satisfy the same
methods orchestrator.handle_disruption calls.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from trip_rescue.calle_client import CallOutcome
from trip_rescue.models import Booking, RebookingOption


def make_booking(**overrides) -> Booking:
    defaults = dict(
        order_id="ord_test0000000000000001",
        booking_reference="TEST01",
        passenger_phone="+15555550100",
        passenger_name="Jordan Traveler",
        slice_id="sli_test0000000000000001",
        origin="LHR",
        destination="JFK",
        departing_at="2026-10-15T10:50:00",
        total_amount="216.81",
        total_currency="USD",
    )
    defaults.update(overrides)
    return Booking(**defaults)


def make_options(count: int = 3) -> list[RebookingOption]:
    base = [
        RebookingOption(
            change_offer_id=f"oco_test000000000000000{i + 1}",
            departing_at=f"2026-10-16T0{6 + i * 3}:00:00",
            arriving_at=None,
            change_fee_amount=str(125 - i * 30),
            change_fee_currency="USD",
            new_total_amount=str(341.81 - i * 30),
            new_total_currency="USD",
        )
        for i in range(3)
    ]
    return base[:count]


@dataclass
class FakeDuffelClient:
    """Records calls made to it so tests can assert on them, and returns
    canned options / confirmations instead of hitting the network.
    """

    options_to_return: list[RebookingOption] = field(default_factory=make_options)
    confirm_calls: list[RebookingOption] = field(default_factory=list)
    find_calls: list[tuple] = field(default_factory=list)

    def find_rebooking_options(self, booking: Booking, *, new_departure_date: str) -> list[RebookingOption]:
        self.find_calls.append((booking.order_id, new_departure_date))
        return self.options_to_return

    def confirm_rebooking(self, option: RebookingOption) -> Booking:
        self.confirm_calls.append(option)
        return make_booking(departing_at=option.departing_at, total_amount=option.new_total_amount)


@dataclass
class FakeCaller:
    """Returns a pre-scripted CallOutcome instead of placing a real call."""

    outcome: CallOutcome
    calls_made: list[tuple] = field(default_factory=list)

    def call_traveler_with_options(self, *, booking: Booking, disruption, options: list[RebookingOption]) -> CallOutcome:
        self.calls_made.append((booking.order_id, tuple(o.change_offer_id for o in options)))
        return self.outcome

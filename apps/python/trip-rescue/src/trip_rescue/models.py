"""Plain data shapes passed between the Duffel side and the CALL-E side.

Kept as simple, JSON-serializable dataclasses on purpose: everything that
crosses the disruption -> call -> rebook boundary should be easy to log,
replay, and write into a test fixture without any SDK-specific types leaking
across module boundaries.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Booking:
    """A single passenger's existing Duffel order that may need rebooking."""

    order_id: str
    booking_reference: str
    passenger_phone: str
    passenger_name: str
    slice_id: str
    origin: str
    destination: str
    departing_at: str  # ISO 8601
    total_amount: str
    total_currency: str


@dataclass(frozen=True)
class DisruptionEvent:
    """A signal that a booked flight has been disrupted.

    In production this would arrive from an airline ops feed or a paid
    flight-status provider (FlightAware/Cirium/direct airline webhook). This
    hackathon build accepts the same shape from a manual trigger or a
    scheduled check, so swapping in a real feed later only means writing a
    new producer of this dataclass -- nothing downstream changes.
    """

    order_id: str
    reason: str  # e.g. "cancelled", "delayed_missed_connection"
    detected_at: str  # ISO 8601
    source: str = "manual-trigger"  # "manual-trigger" | "airline-feed" (future)


@dataclass(frozen=True)
class RebookingOption:
    """One alternative flight Duffel is willing to move the passenger onto."""

    change_offer_id: str
    departing_at: str
    arriving_at: str | None
    change_fee_amount: str
    change_fee_currency: str
    new_total_amount: str
    new_total_currency: str


@dataclass(frozen=True)
class RebookingOutcome:
    """What actually happened after the call -- the record worth keeping."""

    order_id: str
    call_id: str | None
    traveler_reachable: bool
    chosen_option: RebookingOption | None
    confirmed: bool
    new_departing_at: str | None
    new_booking_reference: str | None
    transcript_summary: str | None = None
    options_offered: list[RebookingOption] = field(default_factory=list)

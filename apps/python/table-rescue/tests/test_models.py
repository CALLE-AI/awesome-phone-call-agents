import pytest

from table_rescue.models import (
    CallOutcome,
    CallStatus,
    Reservation,
    ReservationStatus,
    WaitlistEntry,
    WaitlistStatus,
)
from table_rescue.safety import SafetyViolation


def test_reservation_roundtrip():
    line = {
        "booking_id": "R-001",
        "name": "Fictional Guest",
        "phone": "+15550101",
        "party_size": 4,
        "slot": "2026-09-10T19:00:00+07:00",
        "consent": True,
    }
    reservation = Reservation.from_line(line)
    assert reservation.status == ReservationStatus.PENDING_CONFIRM
    assert Reservation.from_line(reservation.to_line()) == reservation


def test_waitlist_entry_roundtrip():
    line = {
        "entry_id": "W-001",
        "name": "Fictional Waitlist",
        "phone": "+15550111",
        "party_size": 4,
        "window_start": "2026-09-10T18:00:00+07:00",
        "window_end": "2026-09-10T21:00:00+07:00",
        "priority": 1,
        "consent": True,
    }
    entry = WaitlistEntry.from_line(line)
    assert entry.status == WaitlistStatus.WAITING
    assert WaitlistEntry.from_line(entry.to_line()) == entry


def test_call_outcome_from_payload():
    payload = {"status": "CANCELLED", "new_slot": None, "notes": "cannot make it"}
    outcome = CallOutcome.from_payload("run-1", "R-001", payload)
    assert outcome.status == CallStatus.CANCELLED
    assert outcome.run_id == "run-1"
    assert outcome.target_id == "R-001"
    assert outcome.new_slot is None


def test_reservation_from_line_rejects_non_e164_phone():
    line = {
        "booking_id": "R-001", "name": "Guest", "phone": "0304 not a phone",
        "party_size": 2, "slot": "2026-09-10T19:00:00+07:00", "consent": True,
    }
    with pytest.raises(SafetyViolation, match="INVALID_E164"):
        Reservation.from_line(line)


def test_waitlist_from_line_rejects_non_e164_phone():
    line = {
        "entry_id": "W-001", "name": "Guest", "phone": "555-0101",
        "party_size": 2, "window_start": "2026-09-10T18:00:00+07:00",
        "window_end": "2026-09-10T21:00:00+07:00", "priority": 1, "consent": True,
    }
    with pytest.raises(SafetyViolation, match="INVALID_E164"):
        WaitlistEntry.from_line(line)


def test_call_outcome_carries_uncertainty_reason():
    outcome = CallOutcome.from_payload(
        "run-1", "R-001",
        {"status": "UNCERTAIN", "uncertainty_reason": "UNPARSEABLE_SUMMARY"},
    )
    assert outcome.status == CallStatus.UNCERTAIN
    assert outcome.uncertainty_reason == "UNPARSEABLE_SUMMARY"

from datetime import datetime, time as dt_time, timezone

import pytest

from table_rescue.engine import BudgetExceededError, CascadeEngine, EngineConfig
from table_rescue.models import (
    CallOutcome,
    CallStatus,
    Reservation,
    ReservationStatus,
    WaitlistEntry,
    WaitlistStatus,
)
from table_rescue.stores import AuditLog

NOW = datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc)
SLOT = "2026-09-10T19:00:00+07:00"
WINDOW_START = "2026-09-10T18:00:00+07:00"
WINDOW_END = "2026-09-10T21:00:00+07:00"


class FakeClient:
    def __init__(self, payloads):
        self.payloads = payloads  # target_id -> list[dict], popped per call
        self.dialed = []

    def place_call(self, request):
        self.dialed.append(request.target_id)
        payload = self.payloads[request.target_id].pop(0)
        return CallOutcome.from_payload(request.run_id, request.target_id, payload)


def make_reservation(booking_id="R-001", party_size=4, consent=True):
    return Reservation(
        booking_id=booking_id,
        name="Fictional Guest",
        phone="+15550101",
        party_size=party_size,
        slot=SLOT,
        consent=consent,
    )


def make_entry(entry_id="W-001", party_size=4, priority=1, consent=True):
    return WaitlistEntry(
        entry_id=entry_id,
        name="Fictional Waitlist",
        phone="+15550111",
        party_size=party_size,
        window_start=WINDOW_START,
        window_end=WINDOW_END,
        priority=priority,
        consent=consent,
    )


def make_engine(tmp_path, payloads, config=None):
    audit = AuditLog(tmp_path / "runs" / "run-1")
    client = FakeClient(payloads)
    engine = CascadeEngine(client, audit, config)
    return engine, client, audit


def test_confirm_reservation_transitions_status(tmp_path):
    engine, client, _ = make_engine(
        tmp_path,
        {"R-001": [{"status": "CANCELLED", "new_slot": None, "notes": "cannot make it"}]},
    )
    reservation = make_reservation()
    outcome = engine.confirm_reservation("run-1", reservation, NOW)
    assert outcome.status == CallStatus.CANCELLED
    assert reservation.status == ReservationStatus.CANCELLED
    assert client.dialed == ["R-001"]


def test_confirm_reservation_retries_no_answer_once(tmp_path):
    engine, client, _ = make_engine(
        tmp_path,
        {
            "R-001": [
                {"status": "NO_ANSWER", "new_slot": None, "notes": "nobody"},
                {"status": "CONFIRMED", "new_slot": None, "notes": "second try"},
            ]
        },
    )
    reservation = make_reservation()
    outcome = engine.confirm_reservation("run-1", reservation, NOW)
    assert outcome.status == CallStatus.CONFIRMED
    assert reservation.status == ReservationStatus.CONFIRMED
    assert client.dialed == ["R-001", "R-001"]


def test_non_consented_reservation_is_never_dialed(tmp_path):
    engine, client, _ = make_engine(tmp_path, {})
    outcome = engine.confirm_reservation("run-1", make_reservation(consent=False), NOW)
    assert outcome.status == CallStatus.SKIPPED_NO_CONSENT
    assert client.dialed == []


def test_duplicate_run_target_is_skipped(tmp_path):
    engine, client, _ = make_engine(
        tmp_path,
        {"R-001": [{"status": "CONFIRMED", "new_slot": None, "notes": "ok"}]},
    )
    engine.confirm_reservation("run-1", make_reservation(), NOW)
    second = engine.confirm_reservation("run-1", make_reservation(), NOW)
    assert second.status == CallStatus.SKIPPED_DUPLICATE
    assert client.dialed == ["R-001"]


def test_calls_outside_window_are_skipped(tmp_path):
    config = EngineConfig(call_window_start=dt_time(13, 0), call_window_end=dt_time(14, 0))
    engine, client, _ = make_engine(tmp_path, {}, config)
    outcome = engine.confirm_reservation("run-1", make_reservation(), NOW)
    assert outcome.status == CallStatus.SKIPPED_OUT_OF_WINDOW
    assert client.dialed == []


def test_budget_guard_raises_before_dialing(tmp_path):
    config = EngineConfig(max_calls=1)
    payloads = {
        "R-001": [{"status": "CONFIRMED", "new_slot": None, "notes": "ok"}],
        "R-002": [{"status": "CONFIRMED", "new_slot": None, "notes": "ok"}],
    }
    engine, client, _ = make_engine(tmp_path, payloads, config)
    engine.confirm_reservation("run-1", make_reservation("R-001"), NOW)
    with pytest.raises(BudgetExceededError):
        engine.confirm_reservation("run-1", make_reservation("R-002"), NOW)
    assert client.dialed == ["R-001"]


def test_cancelled_run_refuses_to_dial(tmp_path):
    engine, client, audit = make_engine(tmp_path, {})
    audit.append(
        CallOutcome(run_id="run-1", target_id="-", status=CallStatus.CANCELLED_BY_OPERATOR)
    )
    outcome = engine.confirm_reservation("run-1", make_reservation(), NOW)
    assert outcome.status == CallStatus.CANCELLED_BY_OPERATOR
    assert client.dialed == []

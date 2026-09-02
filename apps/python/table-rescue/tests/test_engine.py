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


def test_fill_slot_walks_waitlist_in_priority_order_until_accepted(tmp_path):
    payloads = {
        "W-002": [{"status": "DECLINED", "new_slot": None, "notes": "no"}],
        "W-001": [{"status": "ACCEPTED", "new_slot": None, "notes": "yes"}],
    }
    engine, client, _ = make_engine(tmp_path, payloads)
    slot = make_reservation()
    entries = [make_entry("W-002", priority=1), make_entry("W-001", priority=2)]
    placed = engine.fill_slot("run-1", slot, entries, NOW)
    assert [o.status for o in placed] == [CallStatus.DECLINED, CallStatus.ACCEPTED]
    assert slot.status == ReservationStatus.RECOVERED
    assert entries[0].status == WaitlistStatus.DECLINED
    assert entries[1].status == WaitlistStatus.ACCEPTED
    assert client.dialed == ["W-002", "W-001"]


def test_select_candidates_filters_party_size_and_window(tmp_path):
    engine, client, _ = make_engine(
        tmp_path, {"W-001": [{"status": "ACCEPTED", "new_slot": None, "notes": "yes"}]}
    )
    slot = make_reservation(party_size=4)
    too_small = make_entry("W-001", party_size=2)
    assert engine.select_candidates(slot, [too_small]) == []
    out_of_window = make_entry("W-001")
    out_of_window.window_end = "2026-09-10T17:00:00+07:00"
    assert engine.select_candidates(slot, [out_of_window]) == []
    no_consent = make_entry("W-001", consent=False)
    assert engine.select_candidates(slot, [no_consent]) == []
    matching = make_entry("W-001")
    assert engine.select_candidates(slot, [matching]) == [matching]
    assert client.dialed == []


def test_party_size_tolerance_allows_smaller_parties(tmp_path):
    engine, _, _ = make_engine(tmp_path, {}, EngineConfig(party_size_tolerance=2))
    slot = make_reservation(party_size=4)
    smaller = make_entry("W-001", party_size=2)
    assert engine.select_candidates(slot, [smaller]) == [smaller]
    bigger = make_entry("W-002", party_size=6)
    assert engine.select_candidates(slot, [bigger]) == []


from hypothesis import given, settings
from hypothesis import strategies as st

DIAL_STATUSES = ["CONFIRMED", "CANCELLED", "NO_ANSWER"]


@given(
    statuses=st.lists(st.sampled_from(DIAL_STATUSES), min_size=0, max_size=6),
    max_calls=st.integers(min_value=1, max_value=4),
)
@settings(max_examples=50, deadline=None)
def test_engine_never_exceeds_budget(tmp_path_factory, statuses, max_calls):
    tmp_path = tmp_path_factory.mktemp("prop")
    payloads = {
        f"R-{i:03d}": [{"status": status, "new_slot": None, "notes": ""}]
        for i, status in enumerate(statuses)
    }
    engine, client, _ = make_engine(
        tmp_path, payloads, EngineConfig(max_calls=max_calls, no_answer_retries=0)
    )
    try:
        for i in range(len(statuses)):
            engine.confirm_reservation("run-1", make_reservation(f"R-{i:03d}"), NOW)
    except BudgetExceededError:
        pass
    assert engine.calls_made <= max_calls
    assert len(client.dialed) <= max_calls


@given(
    statuses=st.lists(st.sampled_from(DIAL_STATUSES), min_size=1, max_size=6),
)
@settings(max_examples=50, deadline=None)
def test_engine_never_dials_a_target_twice_in_one_run(tmp_path_factory, statuses):
    tmp_path = tmp_path_factory.mktemp("prop")
    payloads = {
        f"R-{i:03d}": [{"status": status, "new_slot": None, "notes": ""}]
        for i, status in enumerate(statuses)
    }
    engine, client, _ = make_engine(tmp_path, payloads, EngineConfig(no_answer_retries=0))
    for i in range(len(statuses)):
        engine.confirm_reservation("run-1", make_reservation(f"R-{i:03d}"), NOW)
        second = engine.confirm_reservation("run-1", make_reservation(f"R-{i:03d}"), NOW)
        assert second.status == CallStatus.SKIPPED_DUPLICATE
    assert len(client.dialed) == len(set(client.dialed))

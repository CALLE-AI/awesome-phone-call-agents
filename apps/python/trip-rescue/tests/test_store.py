from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from trip_rescue.models import DisruptionEvent, RebookingOutcome  # noqa: E402
from trip_rescue.store import RunStore  # noqa: E402

from fakes import make_booking, make_options  # noqa: E402


def _disruption(**overrides) -> DisruptionEvent:
    defaults = dict(order_id="ord_test0000000000000001", reason="cancelled", detected_at="2026-09-10T00:00:00Z")
    defaults.update(overrides)
    return DisruptionEvent(**defaults)


def test_record_disruption_then_outcome_round_trips_through_get_outcome(tmp_path):
    store = RunStore(tmp_path / "runs.sqlite3")
    booking = make_booking()
    disruption = _disruption()
    options = make_options(3)

    assert store.get_outcome(disruption) is None
    assert store.already_resolved(disruption) is False

    store.record_disruption(booking, disruption)
    assert store.already_resolved(disruption) is False  # a call was attempted, but nothing resolved yet

    outcome = RebookingOutcome(
        order_id=booking.order_id,
        call_id="cal_1",
        traveler_reachable=True,
        chosen_option=options[0],
        confirmed=True,
        new_departing_at=options[0].departing_at,
        new_booking_reference="NEWREF",
        transcript_summary="picked option 1",
        options_offered=options,
    )
    store.record_outcome(disruption, outcome)

    assert store.already_resolved(disruption) is True
    stored = store.get_outcome(disruption)
    assert stored["confirmed"] is True
    assert stored["new_booking_reference"] == "NEWREF"
    assert stored["chosen_option"]["change_offer_id"] == options[0].change_offer_id


def test_record_outcome_works_even_without_a_prior_record_disruption_call(tmp_path):
    # The no-options-available path in orchestrator.py never calls
    # record_disruption (no call is ever placed), so record_outcome must be
    # able to create the row itself rather than assuming one already exists.
    store = RunStore(tmp_path / "runs.sqlite3")
    disruption = _disruption(order_id="ord_no_options")
    outcome = RebookingOutcome(
        order_id="ord_no_options",
        call_id=None,
        traveler_reachable=False,
        chosen_option=None,
        confirmed=False,
        new_departing_at=None,
        new_booking_reference=None,
        transcript_summary="No rebooking options were available.",
        options_offered=[],
    )

    store.record_outcome(disruption, outcome)

    assert store.already_resolved(disruption) is True
    assert store.get_outcome(disruption)["confirmed"] is False


def test_record_disruption_is_idempotent_for_a_retried_trigger(tmp_path):
    store = RunStore(tmp_path / "runs.sqlite3")
    booking = make_booking()
    disruption = _disruption()

    store.record_disruption(booking, disruption)
    store.record_disruption(booking, disruption)  # simulate a retried trigger

    runs = [r for r in store.all_runs() if r["order_id"] == disruption.order_id]
    assert len(runs) == 1


def test_all_runs_reflects_every_recorded_disruption(tmp_path):
    store = RunStore(tmp_path / "runs.sqlite3")
    booking = make_booking()
    store.record_disruption(booking, _disruption(order_id="ord_a"))
    store.record_disruption(booking, _disruption(order_id="ord_b"))

    order_ids = {r["order_id"] for r in store.all_runs()}
    assert order_ids == {"ord_a", "ord_b"}


def test_a_second_store_instance_over_the_same_file_sees_prior_writes(tmp_path):
    # This is the crash-recovery scenario the store exists for: a fresh
    # process opening the same db file should see what an earlier process
    # already wrote.
    db_path = tmp_path / "runs.sqlite3"
    booking = make_booking()
    disruption = _disruption()

    RunStore(db_path).record_disruption(booking, disruption)

    reopened = RunStore(db_path)
    assert reopened.already_resolved(disruption) is False
    assert len(reopened.all_runs()) == 1

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from trip_rescue.calle_client import TripRescueCaller, _build_task  # noqa: E402
from trip_rescue.models import DisruptionEvent  # noqa: E402

from fakes import make_booking, make_options  # noqa: E402


def test_dry_run_needs_no_api_key():
    caller = TripRescueCaller(dry_run=True)
    assert caller.dry_run is True


def test_dry_run_call_accepts_soonest_option_and_places_no_real_call():
    caller = TripRescueCaller(dry_run=True)
    booking = make_booking()
    disruption = DisruptionEvent(order_id=booking.order_id, reason="cancelled", detected_at="2026-09-10T00:00:00Z")
    options = make_options(3)

    outcome = caller.call_traveler_with_options(booking=booking, disruption=disruption, options=options)

    assert outcome.reachable is True
    assert outcome.decision == "accepted_option_1"
    assert outcome.call_id is None  # nothing was actually dialed


def test_call_with_no_options_short_circuits_without_a_call():
    caller = TripRescueCaller(dry_run=True)
    booking = make_booking()
    disruption = DisruptionEvent(order_id=booking.order_id, reason="cancelled", detected_at="2026-09-10T00:00:00Z")

    outcome = caller.call_traveler_with_options(booking=booking, disruption=disruption, options=[])

    assert outcome.reachable is False
    assert outcome.decision == "declined_all"


def test_task_text_never_invents_numbers_beyond_what_was_passed_in():
    booking = make_booking()
    disruption = DisruptionEvent(order_id=booking.order_id, reason="cancelled", detected_at="2026-09-10T00:00:00Z")
    options = make_options(2)

    task = _build_task(booking=booking, disruption=disruption, options=options)

    for option in options:
        assert option.departing_at in task
        assert option.new_total_amount in task
    assert "option_3" not in task  # only as many options as were actually offered


def test_live_mode_without_api_key_raises_immediately():
    try:
        TripRescueCaller(dry_run=False, api_key=None)
    except ValueError as exc:
        assert "CALLE_API_KEY" in str(exc)
    else:
        raise AssertionError("expected ValueError when api_key is missing in live mode")

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from trip_rescue.calle_client import CallOutcome  # noqa: E402
from trip_rescue.models import DisruptionEvent  # noqa: E402
from trip_rescue.orchestrator import handle_disruption  # noqa: E402
from trip_rescue.store import RunStore  # noqa: E402

from fakes import FakeCaller, FakeDuffelClient, make_booking, make_options  # noqa: E402


def _disruption() -> DisruptionEvent:
    return DisruptionEvent(order_id="ord_test0000000000000001", reason="cancelled", detected_at="2026-09-10T00:00:00Z")


def test_accepted_option_confirms_the_chosen_offer_not_just_the_first_one():
    booking = make_booking()
    options = make_options(3)
    duffel = FakeDuffelClient(options_to_return=options)
    caller = FakeCaller(outcome=CallOutcome(reachable=True, decision="accepted_option_2", traveler_notes="", call_id="cal_1"))

    outcome = handle_disruption(booking, _disruption(), duffel=duffel, caller=caller, new_departure_date="2026-10-16")

    assert outcome.confirmed is True
    assert outcome.chosen_option == options[1]
    assert duffel.confirm_calls == [options[1]]
    assert outcome.new_departing_at == options[1].departing_at


def test_declined_all_does_not_touch_the_order():
    booking = make_booking()
    duffel = FakeDuffelClient()
    caller = FakeCaller(outcome=CallOutcome(reachable=True, decision="declined_all", traveler_notes="none work for me", call_id="cal_2"))

    outcome = handle_disruption(booking, _disruption(), duffel=duffel, caller=caller, new_departure_date="2026-10-16")

    assert outcome.confirmed is False
    assert outcome.chosen_option is None
    assert duffel.confirm_calls == []
    assert outcome.transcript_summary == "none work for me"


def test_requested_human_agent_does_not_touch_the_order():
    booking = make_booking()
    duffel = FakeDuffelClient()
    caller = FakeCaller(outcome=CallOutcome(reachable=True, decision="requested_human_agent", traveler_notes="", call_id="cal_3"))

    outcome = handle_disruption(booking, _disruption(), duffel=duffel, caller=caller, new_departure_date="2026-10-16")

    assert outcome.confirmed is False
    assert duffel.confirm_calls == []


def test_unreachable_traveler_does_not_touch_the_order_even_with_a_decision_present():
    # A voice model hallucinating a decision on an unanswered call is exactly
    # the failure mode the reachable flag exists to catch.
    booking = make_booking()
    duffel = FakeDuffelClient()
    caller = FakeCaller(outcome=CallOutcome(reachable=False, decision="accepted_option_1", traveler_notes="", call_id=None))

    outcome = handle_disruption(booking, _disruption(), duffel=duffel, caller=caller, new_departure_date="2026-10-16")

    assert outcome.confirmed is False
    assert outcome.traveler_reachable is False
    assert duffel.confirm_calls == []


def test_no_options_available_skips_the_call_entirely():
    booking = make_booking()
    duffel = FakeDuffelClient(options_to_return=[])
    caller = FakeCaller(outcome=CallOutcome(reachable=True, decision="accepted_option_1", traveler_notes="", call_id="cal_4"))

    outcome = handle_disruption(booking, _disruption(), duffel=duffel, caller=caller, new_departure_date="2026-10-16")

    assert outcome.confirmed is False
    assert caller.calls_made == []  # never call the traveler with nothing to offer


def test_at_most_three_options_are_offered_even_if_duffel_returns_more():
    booking = make_booking()
    many_options = make_options(3) * 4  # simulate a route with many extra options upstream
    duffel = FakeDuffelClient(options_to_return=many_options[:9])
    caller = FakeCaller(outcome=CallOutcome(reachable=True, decision="accepted_option_1", traveler_notes="", call_id="cal_5"))

    outcome = handle_disruption(booking, _disruption(), duffel=duffel, caller=caller, new_departure_date="2026-10-16")

    assert len(outcome.options_offered) == 3
    _, offered_ids = caller.calls_made[0]
    assert len(offered_ids) == 3


def test_unknown_decision_value_is_treated_as_no_change():
    # Defensive: if CALL-E ever returns something outside the closed enum,
    # fail safe rather than guess an index.
    booking = make_booking()
    duffel = FakeDuffelClient()
    caller = FakeCaller(outcome=CallOutcome(reachable=True, decision="something_unexpected", traveler_notes="", call_id="cal_6"))

    outcome = handle_disruption(booking, _disruption(), duffel=duffel, caller=caller, new_departure_date="2026-10-16")

    assert outcome.confirmed is False
    assert duffel.confirm_calls == []


def test_store_records_the_disruption_before_the_call_and_the_outcome_after(tmp_path):
    # Addresses the README's "no persistence layer" limitation: a store, when
    # given, must see the disruption recorded even before the outcome is
    # known, so a crash mid-call still leaves proof a call was attempted.
    booking = make_booking()
    disruption = _disruption()
    options = make_options(3)
    duffel = FakeDuffelClient(options_to_return=options)
    caller = FakeCaller(outcome=CallOutcome(reachable=True, decision="accepted_option_1", traveler_notes="", call_id="cal_store_1"))
    store = RunStore(tmp_path / "runs.sqlite3")

    outcome = handle_disruption(booking, disruption, duffel=duffel, caller=caller, new_departure_date="2026-10-16", store=store)

    assert store.already_resolved(disruption) is True
    stored = store.get_outcome(disruption)
    assert stored["confirmed"] is True
    assert stored["call_id"] == outcome.call_id


def test_store_still_records_an_outcome_when_no_options_were_available(tmp_path):
    # This path never calls the traveler, so record_disruption is never
    # reached -- record_outcome must stand on its own here.
    booking = make_booking()
    disruption = _disruption()
    duffel = FakeDuffelClient(options_to_return=[])
    caller = FakeCaller(outcome=CallOutcome(reachable=True, decision="accepted_option_1", traveler_notes="", call_id="cal_store_2"))
    store = RunStore(tmp_path / "runs.sqlite3")

    handle_disruption(booking, disruption, duffel=duffel, caller=caller, new_departure_date="2026-10-16", store=store)

    assert store.already_resolved(disruption) is True
    assert store.get_outcome(disruption)["confirmed"] is False
    assert caller.calls_made == []


def test_handle_disruption_without_a_store_behaves_exactly_as_before():
    # store is optional and defaults to None -- existing callers (and the
    # tests above it in this file) must be unaffected.
    booking = make_booking()
    options = make_options(3)
    duffel = FakeDuffelClient(options_to_return=options)
    caller = FakeCaller(outcome=CallOutcome(reachable=True, decision="accepted_option_1", traveler_notes="", call_id="cal_7"))

    outcome = handle_disruption(booking, _disruption(), duffel=duffel, caller=caller, new_departure_date="2026-10-16")

    assert outcome.confirmed is True

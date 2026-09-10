"""The ladder, end to end, for every scripted scenario."""

from __future__ import annotations

from datetime import timedelta

import pytest

from positive_contact.cli import execute_run, seed_ledger
from positive_contact.escalate import (
    OperatorError,
    approve_field_visit,
    operator_confirm,
    operator_refuse,
    sweep_cutoff,
)
from positive_contact.models import IntentState
from positive_contact.preflight import run_preflight
from positive_contact.transports.fixture import FixtureTransport
from tests.conftest import SCENARIOS


@pytest.fixture
def demo_run(ledger, demo_preflight, now):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    outcome = execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=True)
    return outcome, transport


@pytest.fixture
def edge_run(ledger, edge_preflight, now):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, edge_preflight)
    outcome = execute_run(ledger, transport, edge_preflight, now=now, simulated_clock=True)
    return outcome, transport


def final_state(ledger, contact_id):
    intents = ledger.list_intents_for_contact(contact_id)
    assert intents, contact_id
    latest = sorted(intents, key=lambda item: (item.ladder_step, item.created_at))[-1]
    return ledger.reconstruct(latest.intent_id)


def states(ledger, contact_id):
    return [
        ledger.reconstruct(intent.intent_id)
        for intent in sorted(
            ledger.list_intents_for_contact(contact_id), key=lambda item: item.ladder_step
        )
    ]


# -- the nine scenarios ------------------------------------------------------------


@pytest.mark.parametrize("contact_id", ["pc-001", "pc-002", "pc-003", "pc-004", "pc-005"])
def test_scenario_live_acknowledgement_confirms_on_the_first_step(
    demo_run, ledger, contact_id
):
    _outcome, _transport = demo_run
    assert final_state(ledger, contact_id) is IntentState.CONFIRMED
    assert ledger.count_calls_for_contact(contact_id) == 1


@pytest.mark.parametrize("contact_id", ["pc-006", "pc-007"])
def test_scenario_voicemail_then_acknowledgement_confirms_on_the_second_step(
    demo_run, ledger, contact_id
):
    _outcome, _transport = demo_run
    assert states(ledger, contact_id) == [
        IntentState.UNCONFIRMED_WAITING,
        IntentState.CONFIRMED,
    ]
    assert ledger.count_calls_for_contact(contact_id) == 2


def test_scenario_voicemail_all_the_way_ends_in_a_field_visit(demo_run, ledger, event):
    _outcome, _transport = demo_run
    assert final_state(ledger, "pc-008") is IntentState.FIELD_VISIT_PENDING
    # The whole ladder ran: primary, primary retry, alternate, primary retry.
    assert [item.ladder_step for item in ledger.list_intents_for_contact("pc-008")] == [1, 2, 3, 4]
    assert ledger.count_calls_for_contact("pc-008") == 4
    orders = {order.contact_id for order in ledger.list_work_orders(event.event_id)}
    assert "pc-008" in orders


def test_scenario_medical_question_opens_human_review_and_gives_no_advice(demo_run, ledger):
    _outcome, _transport = demo_run
    intents = ledger.list_intents_for_contact("pc-009")
    disposition = ledger.get_disposition(intents[0].intent_id)
    assert disposition.reason_code == "medical_question_priority_review"
    assert disposition.needs_assistance.value == "medical_question"
    # The ladder stopped: no second call was placed to a person waiting on a callback.
    assert ledger.count_calls_for_contact("pc-009") == 1


def test_scenario_wrong_number_retires_the_number_and_never_redials(demo_run, ledger):
    _outcome, _transport = demo_run
    assert ledger.is_retired("pc-010")
    assert ledger.count_calls_for_contact("pc-010") == 1
    assert [item.ladder_step for item in ledger.list_intents_for_contact("pc-010")] == [1]


def test_scenario_refused_never_redials(demo_run, ledger):
    _outcome, _transport = demo_run
    assert ledger.count_calls_for_contact("pc-011") == 1
    assert [item.ladder_step for item in ledger.list_intents_for_contact("pc-011")] == [1]


def test_scenario_unsupported_locale_is_never_dialled(demo_run, ledger):
    _outcome, _transport = demo_run
    assert ledger.list_intents_for_contact("pc-012") == []
    assert ledger.count_calls_for_contact("pc-012") == 0
    assert ledger.get_contact("pc-012") is not None  # still in scope, still counted


def test_scenario_no_answer_then_acknowledgement(edge_run, ledger):
    _outcome, _transport = edge_run
    assert states(ledger, "pc-101") == [IntentState.UNCONFIRMED_WAITING, IntentState.CONFIRMED]


def test_scenario_contradiction_opens_human_review(edge_run, ledger):
    _outcome, _transport = edge_run
    intents = ledger.list_intents_for_contact("pc-102")
    disposition = ledger.get_disposition(intents[0].intent_id)
    assert disposition.reason_code == "contradiction_voicemail_greeting_vs_acknowledged"
    assert final_state(ledger, "pc-102") in {
        IntentState.NEEDS_HUMAN,
        IntentState.FIELD_VISIT_PENDING,
    }


def test_scenario_unknown_submission_stops_and_places_no_second_call(edge_run, ledger):
    _outcome, transport = edge_run
    assert ledger.count_calls_for_contact("pc-103") == 0
    intents = ledger.list_intents_for_contact("pc-103")
    assert len(intents) == 1
    assert ledger.reconstruct(intents[0].intent_id) is IntentState.SUBMISSION_UNKNOWN


def test_scenario_language_barrier_opens_a_bilingual_callback_and_never_redials(
    edge_run, ledger
):
    _outcome, _transport = edge_run
    intents = ledger.list_intents_for_contact("pc-104")
    disposition = ledger.get_disposition(intents[0].intent_id)
    assert disposition.reason_code == "language_barrier_bilingual_callback_no_redial"
    assert ledger.count_calls_for_contact("pc-104") == 1


# -- the cutoff --------------------------------------------------------------------


def test_a_needs_human_item_that_hits_the_cutoff_becomes_a_field_visit(demo_run, ledger, event):
    _outcome, _transport = demo_run
    # The demo run advances the simulated clock to the cutoff, so the unresolved medical
    # question, wrong number and refusal all end up in the field-visit queue.
    for contact_id in ("pc-009", "pc-010", "pc-011"):
        assert final_state(ledger, contact_id) is IntentState.FIELD_VISIT_PENDING
    orders = {order.contact_id for order in ledger.list_work_orders(event.event_id)}
    assert {"pc-008", "pc-009", "pc-010", "pc-011"} <= orders


def test_the_sweep_does_nothing_before_the_cutoff(ledger, demo_preflight, event, policy, now):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=False)
    assert sweep_cutoff(ledger, event, policy, now=event.field_visit_cutoff - timedelta(hours=1)) == []


def test_human_review_pauses_automation_but_not_the_deadline(
    ledger, demo_preflight, event, policy, now
):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=False)
    open_before = ledger.list_intents(event.event_id, [IntentState.NEEDS_HUMAN])
    assert open_before, "the demo should leave review items open before the cutoff"

    moved = sweep_cutoff(ledger, event, policy, now=event.field_visit_cutoff)
    assert set(moved) >= {intent.intent_id for intent in open_before}


def test_a_work_order_is_created_once_per_contact(demo_run, ledger, event):
    _outcome, _transport = demo_run
    orders = ledger.list_work_orders(event.event_id)
    assert len(orders) == len({order.contact_id for order in orders})


def test_max_calls_per_contact_is_never_exceeded(demo_run, ledger, policy):
    _outcome, _transport = demo_run
    for contact in ledger.list_contacts("psps-demo-2026-09"):
        assert ledger.count_calls_for_contact(contact.contact_id) <= policy.max_calls_per_contact


# -- operator actions --------------------------------------------------------------


def test_an_operator_confirmation_requires_evidence(
    ledger, demo_preflight, event, policy, now
):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=False)
    open_items = ledger.list_intents(event.event_id, [IntentState.NEEDS_HUMAN])
    intent = open_items[0]

    with pytest.raises(OperatorError, match="cite a transcript span"):
        operator_confirm(ledger, intent, actor="op-7", evidence_text="  ", now=now)
    with pytest.raises(OperatorError, match="who made it"):
        operator_confirm(ledger, intent, actor="", evidence_text="they said yes", now=now)


def test_an_operator_confirmation_is_recorded_against_the_operator(
    ledger, demo_preflight, event, policy, now
):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=False)
    intent = ledger.list_intents(event.event_id, [IntentState.NEEDS_HUMAN])[0]

    operator_confirm(
        ledger, intent, actor="op-7", evidence_text="Yes, I heard you.", now=now
    )
    assert ledger.reconstruct(intent.intent_id) is IntentState.CONFIRMED
    last = ledger.list_transitions(intent.intent_id)[-1]
    assert last.actor == "op-7"
    assert last.evidence_refs["operator_evidence"] == "Yes, I heard you."


def test_an_operator_can_record_a_refusal(ledger, demo_preflight, event, policy, now):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=False)
    intent = ledger.list_intents(event.event_id, [IntentState.NEEDS_HUMAN])[0]
    operator_refuse(ledger, intent, actor="op-7", evidence_text="Asked us to stop", now=now)
    assert ledger.reconstruct(intent.intent_id) is IntentState.CLOSED_REFUSED


def test_a_field_visit_is_issued_only_after_approval(demo_run, ledger, event, now):
    _outcome, _transport = demo_run
    order = next(
        order for order in ledger.list_work_orders(event.event_id) if order.approved_at is None
    )
    assert final_state(ledger, order.contact_id) is IntentState.FIELD_VISIT_PENDING

    issued = approve_field_visit(ledger, event, order.work_order_id, actor="op-7", now=now)
    assert issued
    assert final_state(ledger, order.contact_id) is IntentState.FIELD_VISIT_ISSUED
    refreshed = {item.work_order_id: item for item in ledger.list_work_orders(event.event_id)}
    assert refreshed[order.work_order_id].approved_by == "op-7"


def test_a_field_visit_needs_a_named_approver(demo_run, ledger, event, now):
    _outcome, _transport = demo_run
    order = ledger.list_work_orders(event.event_id)[0]
    with pytest.raises(OperatorError, match="who approved it"):
        approve_field_visit(ledger, event, order.work_order_id, actor="  ", now=now)


def test_approving_an_unknown_field_visit_raises(demo_run, ledger, event, now):
    _outcome, _transport = demo_run
    with pytest.raises(OperatorError, match="no prepared field visit"):
        approve_field_visit(ledger, event, "wo:does-not-exist", actor="op-7", now=now)


# -- the run as a whole ------------------------------------------------------------


def test_the_whole_demo_ladder_terminates(demo_run, ledger):
    outcome, _transport = demo_run
    assert outcome.iterations < 400
    for contact in ledger.list_contacts("psps-demo-2026-09"):
        for intent in ledger.list_intents_for_contact(contact.contact_id):
            assert ledger.reconstruct(intent.intent_id) in set(IntentState)


def test_every_intent_has_a_reconstructible_audit_trail(demo_run, ledger):
    _outcome, _transport = demo_run
    for intent in ledger.list_intents("psps-demo-2026-09"):
        assert ledger.reconstruct(intent.intent_id) is intent.state


def test_a_step_that_cannot_finish_before_the_cutoff_skips_to_a_field_visit(
    ledger, event, policy, demo_preflight
):
    """Start the run so late that step 2 could not be adjudicated in time."""
    late = event.field_visit_cutoff - timedelta(minutes=30)
    transport = FixtureTransport(SCENARIOS)
    result = run_preflight(
        event, policy, [
            {
                "contact_id": "pc-006",
                "first_name": "Dolores",
                "phone_e164": "+14155550106",
                "alt_phone_e164": "",
                "locale": "en-US",
                "tz": "America/Los_Angeles",
                "service_address_short": "950 block of Maple Dr",
            }
        ],
        now=late,
    )
    seed_ledger(ledger, result)
    execute_run(ledger, transport, result, now=late, simulated_clock=True)
    # Step 1 voicemail; step 2 would land 45 minutes out, past the cutoff.
    assert [item.ladder_step for item in ledger.list_intents_for_contact("pc-006")] == [1]
    assert final_state(ledger, "pc-006") is IntentState.FIELD_VISIT_PENDING

from conftest import make_call
from fieldline.protocol import (
    CheckinOutcome,
    EscalationOutcome,
    classify_checkin,
    classify_escalation,
    decide,
)


# --- classify_checkin -------------------------------------------------
def test_safe_checkin():
    call = make_call(structured_result={"checkin_status": "safe", "duress_phrase_detected": False})
    assert classify_checkin(call) is CheckinOutcome.SAFE


def test_duress_overrides_stated_safe():
    call = make_call(structured_result={"checkin_status": "safe", "duress_phrase_detected": True})
    assert classify_checkin(call) is CheckinOutcome.DURESS


def test_needs_assistance():
    for status in ("needs_assistance", "emergency"):
        call = make_call(structured_result={"checkin_status": status, "duress_phrase_detected": False})
        assert classify_checkin(call) is CheckinOutcome.NEEDS_HELP


def test_no_answer_when_no_result_and_no_transcript():
    assert classify_checkin(make_call(structured_result=None)) is CheckinOutcome.NO_ANSWER


def test_unclear_when_conversation_but_no_result():
    call = make_call(structured_result=None, turns=[("bot", "hi"), ("user", "…")])
    assert classify_checkin(call) is CheckinOutcome.UNCLEAR


def test_api_failure_degrades_to_no_answer():
    # Fail-soft: an unplaceable call keeps the cascade moving.
    assert classify_checkin(make_call(status="failed")) is CheckinOutcome.NO_ANSWER


# --- decide -----------------------------------------------------------
def test_safe_schedules_next():
    assert decide(CheckinOutcome.SAFE, dials_made=1, max_retries=1).kind == "schedule_next"


def test_no_answer_retries_then_escalates():
    assert decide(CheckinOutcome.NO_ANSWER, dials_made=1, max_retries=1).kind == "retry"
    step = decide(CheckinOutcome.NO_ANSWER, dials_made=2, max_retries=1)
    assert step.kind == "escalate" and not step.silent


def test_duress_escalates_silently_and_immediately():
    step = decide(CheckinOutcome.DURESS, dials_made=1, max_retries=5)
    assert step.kind == "escalate" and step.silent


def test_needs_help_escalates_loudly():
    step = decide(CheckinOutcome.NEEDS_HELP, dials_made=1, max_retries=5)
    assert step.kind == "escalate" and not step.silent


# --- classify_escalation ---------------------------------------------
def test_escalation_stand_down():
    call = make_call(structured_result={"contact_reached": True, "heard_from_worker_since_checkin": True})
    assert classify_escalation(call) is EscalationOutcome.STAND_DOWN


def test_escalation_handed_off():
    call = make_call(structured_result={"contact_reached": True, "assuming_coordination": True})
    assert classify_escalation(call) is EscalationOutcome.HANDED_OFF


def test_escalation_will_check():
    call = make_call(structured_result={"contact_reached": True, "will_check_in_person": True})
    assert classify_escalation(call) is EscalationOutcome.WILL_CHECK


def test_escalation_not_reached():
    assert classify_escalation(make_call(structured_result=None)) is EscalationOutcome.NOT_REACHED
    assert classify_escalation(make_call(status="failed")) is EscalationOutcome.NOT_REACHED
    call = make_call(structured_result={"contact_reached": False})
    assert classify_escalation(call) is EscalationOutcome.NOT_REACHED

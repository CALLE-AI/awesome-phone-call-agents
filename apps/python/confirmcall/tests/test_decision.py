from datetime import datetime

from models.appointment import Appointment, AppointmentStatus
from services.decision_service import CallResult, apply_call_result


def make_appointment():
    return Appointment(
        event_id="demo-001",
        customer_name="Demo Customer",
        customer_phone="+12025550123",
        service_name="Haircut",
        start_time=datetime(2026, 9, 13, 10, 0),
    )


def test_confirmed():
    appointment = make_appointment()

    result = CallResult(
        outcome="confirmed",
        call_id="call-001",
    )

    updated = apply_call_result(appointment, result)

    assert updated.status == AppointmentStatus.CONFIRMED
    assert updated.call_id == "call-001"


def test_cancelled():
    appointment = make_appointment()

    result = CallResult(
        outcome="cancelled",
        call_id="call-002",
    )

    updated = apply_call_result(appointment, result)

    assert updated.status == AppointmentStatus.CANCELLED


def test_reschedule_requested():
    appointment = make_appointment()

    result = CallResult(
        outcome="reschedule_requested",
        requested_time="Monday at 2 PM",
        call_id="call-003",
    )

    updated = apply_call_result(appointment, result)

    assert updated.status == AppointmentStatus.RESCHEDULE_REQUESTED
    assert updated.requested_time == "Monday at 2 PM"


def test_no_answer():
    appointment = make_appointment()

    result = CallResult(
        outcome="no_answer",
        call_id="call-004",
    )

    updated = apply_call_result(appointment, result)

    assert updated.status == AppointmentStatus.NO_ANSWER


def test_unknown_goes_to_human():
    appointment = make_appointment()

    result = CallResult(
        outcome="unknown",
        customer_notes="Customer response was unclear.",
        call_id="call-005",
    )

    updated = apply_call_result(appointment, result)

    assert updated.status == AppointmentStatus.NEEDS_HUMAN
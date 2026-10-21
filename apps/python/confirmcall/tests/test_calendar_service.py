from models.appointment import AppointmentStatus
from services.calendar_service import event_to_appointment


def make_event(description, start="2026-09-13T09:00:00Z"):
    return {
        "id": "event-123",
        "summary": "Haircut Appointment",
        "description": description,
        "start": {
            "dateTime": start,
        },
    }


def test_confirmcall_event_is_parsed():
    event = make_event(
        "\n".join(
            [
                "CONFIRMCALL=true",
                "CUSTOMER_NAME=Alice Demo",
                "CUSTOMER_PHONE=+12025550123",
                "SERVICE=Haircut",
                "STATUS=confirmed",
                "CALL_ID=test-call-123",
            ]
        )
    )

    appointment = event_to_appointment(event)

    assert appointment is not None
    assert appointment.customer_name == "Alice Demo"
    assert appointment.service_name == "Haircut"
    assert appointment.status == AppointmentStatus.CONFIRMED
    assert appointment.call_id == "test-call-123"


def test_reschedule_request_is_parsed():
    event = make_event(
        "\n".join(
            [
                "CONFIRMCALL=true",
                "CUSTOMER_NAME=Clara Demo",
                "CUSTOMER_PHONE=+12025550123",
                "SERVICE=Service Visit",
                "STATUS=reschedule_requested",
                "REQUESTED_TIME=Monday at 2:00 PM",
            ]
        )
    )

    appointment = event_to_appointment(event)

    assert appointment.status == (
        AppointmentStatus.RESCHEDULE_REQUESTED
    )

    assert appointment.requested_time == (
        "Monday at 2:00 PM"
    )


def test_non_confirmcall_event_is_ignored():
    event = make_event(
        "\n".join(
            [
                "CUSTOMER_NAME=Random Customer",
                "STATUS=pending",
            ]
        )
    )

    appointment = event_to_appointment(event)

    assert appointment is None


def test_unknown_calendar_status_needs_human():
    event = make_event(
        "\n".join(
            [
                "CONFIRMCALL=true",
                "CUSTOMER_NAME=Test Customer",
                "CUSTOMER_PHONE=+12025550123",
                "SERVICE=Consultation",
                "STATUS=something_weird",
            ]
        )
    )

    appointment = event_to_appointment(event)

    assert appointment.status == (
        AppointmentStatus.NEEDS_HUMAN
    )
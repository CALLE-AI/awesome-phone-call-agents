from datetime import datetime
from zoneinfo import ZoneInfo

from models.appointment import Appointment
from services.calle_service import build_call_task


def test_build_call_task_contains_appointment_details():
    appointment = Appointment(
        event_id="test-event",
        customer_name="Alice Demo",
        customer_phone="+12025550123",
        service_name="Haircut",
        start_time=datetime(
            2026,
            9,
            13,
            10,
            0,
            tzinfo=ZoneInfo("Africa/Lagos"),
        ),
    )

    task = build_call_task(appointment)

    assert "Alice Demo" in task
    assert "Haircut" in task
    assert "September 13" in task
    assert "confirmed" in task
    assert "cancelled" in task
    assert "reschedule_requested" in task
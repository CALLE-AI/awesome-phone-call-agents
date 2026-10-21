from dataclasses import dataclass
from typing import Optional

from models.appointment import Appointment, AppointmentStatus


@dataclass
class CallResult:
    outcome: str
    requested_time: Optional[str] = None
    customer_notes: Optional[str] = None
    call_id: Optional[str] = None


def apply_call_result(
    appointment: Appointment,
    result: CallResult,
) -> Appointment:

    outcome = result.outcome.strip().lower()

    if outcome == "confirmed":
        appointment.status = AppointmentStatus.CONFIRMED

    elif outcome == "cancelled":
        appointment.status = AppointmentStatus.CANCELLED

    elif outcome == "reschedule_requested":
        appointment.status = AppointmentStatus.RESCHEDULE_REQUESTED
        appointment.requested_time = result.requested_time

    elif outcome == "no_answer":
        appointment.status = AppointmentStatus.NO_ANSWER

    else:
        appointment.status = AppointmentStatus.NEEDS_HUMAN

    appointment.call_id = result.call_id

    return appointment
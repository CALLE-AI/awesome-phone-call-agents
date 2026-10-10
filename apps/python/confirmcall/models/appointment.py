from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Optional


class AppointmentStatus(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    RESCHEDULE_REQUESTED = "reschedule_requested"
    NO_ANSWER = "no_answer"
    NEEDS_HUMAN = "needs_human"


@dataclass
class Appointment:
    event_id: str
    customer_name: str
    customer_phone: str
    service_name: str
    start_time: datetime

    status: AppointmentStatus = AppointmentStatus.PENDING
    requested_time: Optional[str] = None
    call_id: Optional[str] = None
"""
Call Dispositions & EHR Transition State Machine
"""
from __future__ import annotations
from typing import Dict, Any, Tuple
from .models import AppointmentStatus


def evaluate_confirmation_disposition(
    structured_result: Dict[str, Any],
    operator_confirmed: bool = False
) -> Tuple[AppointmentStatus, bool]:
    """
    Evaluates structured extraction from a confirmation call.
    Returns: (New Proposed AppointmentStatus, Requires Operator Review: bool)
    """
    will_attend = structured_result.get("will_attend", "unknown").lower()
    
    if will_attend == "yes":
        if operator_confirmed:
            return AppointmentStatus.CONFIRMED, False
        return AppointmentStatus.CONFIRMED, True  # Staged for confirmation review
    elif will_attend in ("no", "reschedule"):
        if operator_confirmed:
            return AppointmentStatus.RESCHEDULE_REQUESTED, False
        return AppointmentStatus.RESCHEDULE_REQUESTED, True
    elif will_attend == "cancelled":
        if operator_confirmed:
            return AppointmentStatus.CANCELLED, False
        return AppointmentStatus.CANCELLED, True
    return AppointmentStatus.SCHEDULED, True

"""
Scripted CALL-E answers that let the HTTP API run end to end without placing a
call. Enabled only by SIGNCALL_API_DEMO_MOCKS=1.

The resolver is built per run because a clinic's offered slot is checked
against this user's own free window by exact datetime containment, so a fixed
slot would match one profile and fail every other. It answers with the user's
own first free hour, formatted "HH:MM".

Scripted outcome: the clinic accepts insurance, offers the user's slot and says
a photo ID is required; the family list declines; the first freelance
interpreter is available; and once the user approves, the booking succeeds and
that interpreter confirms. Declines and dead ends are covered by the scenarios
in dev/text_harness.py.
"""

from __future__ import annotations

import threading

from ..calle.run import CallPurpose, CallResult
from ..workflow.types import UserInput

DEMO_RATE_PER_HOUR = 95.0
DEMO_MINIMUM_HOURS = 2.0


def _ok(structured: dict) -> CallResult:
    return CallResult(
        status="completed",
        task_completed=True,
        completion_confidence=0.9,
        structured_result=structured,
    )


def build_resolver(user: UserInput, gate: "threading.Event | None" = None):
    """`gate`, when given, blocks every mocked call until it is set; the test
    harness uses it to hold a run open and prove a concurrent second run is
    refused."""
    window = user.free_windows[0]
    slot_date = window.start.strftime("%Y-%m-%d")
    slot_time = window.start.strftime("%H:%M")
    slot_key = f"{slot_date} {slot_time}"

    def resolver(task: str, phone: str, purpose: CallPurpose) -> CallResult:
        if gate is not None:
            gate.wait(timeout=30.0)
        if purpose is CallPurpose.CLINIC_BOOK:
            return _ok({
                "booked": True,
                "confirmed_by": "Demo front desk",
                "booking_reference": f"DEMO-{slot_date}",
                "requirements": [],
            })
        if purpose is CallPurpose.CLINIC_SEARCH:
            return _ok({
                "accepts_insurance": True,
                "available_slots": [{"date": slot_date, "time": slot_time}],
                "requirements": ["Bring a photo ID and your insurance card"],
                "additional_notes": "",
            })
        if purpose is CallPurpose.INTERPRETER_CONFIRM:
            return _ok({"confirmed": True})
        if purpose is CallPurpose.CLINIC_CANCEL:
            return _ok({"cancelled": True})
        if purpose is CallPurpose.INTERPRETER_AVAILABILITY:
            return _ok({
                "coverable_slots": [slot_key],
                "rate_per_hour": DEMO_RATE_PER_HOUR,
                "minimum_hours": DEMO_MINIMUM_HOURS,
            })
        if purpose is CallPurpose.FAMILY_AVAILABILITY:
            # Declining keeps the demo on the freelance path, the fuller sequence.
            return _ok({"coverable_slots": []})
        if purpose is CallPurpose.FAMILY_CONFIRM:
            return _ok({"confirmed": True})
        return _ok({})  # release calls read nothing back

    return resolver


def build_cancel_resolver():
    """Scripted answers for cancel_appointment()'s calls. Separate from
    build_resolver() because a cancellation can run long after the original
    UserInput is gone, and needs no calendar-aware answers."""

    def resolver(task: str, phone: str, purpose: CallPurpose) -> CallResult:
        if purpose is CallPurpose.CLINIC_CANCEL:
            return _ok({"cancelled": True})
        return _ok({})  # release calls read nothing back

    return resolver

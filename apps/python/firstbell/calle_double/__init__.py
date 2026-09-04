"""A CALL-E test double, because the platform ships no sandbox.

    from calle_double import CalleDouble, Outcome, build_client

    double = CalleDouble()
    double.set_outcome("+919000000001", Outcome.no_answer())
    client = build_client(double)          # a real CalleClient, dials nobody
"""

from .engine import (
    API_ERROR_CODES,
    ATTEMPT_STATUSES,
    CALL_STATUSES,
    FAILURE_CODES,
    RECIPIENT_STATUSES,
    WEBHOOK_EVENTS,
    CalleDouble,
    DoubleError,
    Outcome,
)
from .transport import build_client, build_transport

__all__ = [
    "CalleDouble", "Outcome", "DoubleError",
    "build_client", "build_transport",
    "CALL_STATUSES", "RECIPIENT_STATUSES", "ATTEMPT_STATUSES",
    "WEBHOOK_EVENTS", "API_ERROR_CODES", "FAILURE_CODES",
]

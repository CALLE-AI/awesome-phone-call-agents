"""A CALL-E test double, because the platform ships no sandbox.

    from calle_double import CalleDouble, Outcome, build_client

    double = CalleDouble()
    double.set_outcome("+915550000001", Outcome.no_answer())
    client = build_client(double)          # a real CalleClient, dials nobody

Installable on its own, because a test double that only exists inside one repository is a
test double nobody else can use:

    pip install -e apps/python/firstbell/calle_double
"""

# This package's own version, and the SDK version its responses were checked against.
# They are different numbers on purpose. `__version__` is this double; `CONFORMS_TO` is
# the release of `calle-ai` whose real API responses `tools/double_conformance.py`
# compared these shapes to. A double carrying only one number cannot answer the question
# a user asks first, which is not "how new is this" but "what is it pretending to be".
__version__ = "0.1.0"
CONFORMS_TO = "calle-ai==0.7.0"

from .engine import (
    API_ERROR_CODES,
    ATTEMPT_SIP_CODES,
    ATTEMPT_STATUSES,
    CALL_STATUSES,
    FAILURE_CODES,
    RECIPIENT_STATUSES,
    WEBHOOK_EVENTS,
    CalleDouble,
    DoubleError,
    ScenarioError,
    OBSERVED_ATTEMPT_SIP_CODE,
    Outcome,
)
from .transport import build_client, build_transport

__all__ = [
    "__version__", "CONFORMS_TO",
    "CalleDouble", "Outcome", "DoubleError", "ScenarioError",
    "build_client", "build_transport",
    "CALL_STATUSES", "RECIPIENT_STATUSES", "ATTEMPT_STATUSES",
    "WEBHOOK_EVENTS", "API_ERROR_CODES", "FAILURE_CODES",
    "ATTEMPT_SIP_CODES", "OBSERVED_ATTEMPT_SIP_CODE",
]

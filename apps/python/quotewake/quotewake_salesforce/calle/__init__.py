"""CALL-E planning integration for QuoteWake Salesforce."""

from .client import CallEPlanningClient, CallEPlanningError
from .simulator import (
    CallSimulationError,
    RETRY_OUTCOMES,
    SimulationOutcome,
    simulate_call,
)
from quotewake_salesforce.domain.models import CallResult

__all__ = [
    "CallEPlanningClient",
    "CallEPlanningError",
    "CallSimulationError",
    "CallResult",
    "RETRY_OUTCOMES",
    "SimulationOutcome",
    "simulate_call",
]

"""Deterministic local CALL-E substitute for the QuoteWake ES demo.

The simulator deliberately has no network or CALL-E CLI dependency.  It accepts
the same stable planning request used by the CALL-E adapter and returns a small
structured result that can exercise the Salesforce write-back workflow.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from quotewake_salesforce.domain.models import (
    CallPlanRequest,
    CallResult,
    SimulationOutcome,
)

# Backwards-compatible name for callers that imported the first simulator API.
SimulatedCallResult = CallResult


_OUTCOME_DETAILS: dict[SimulationOutcome, tuple[str, str, str, str]] = {
    SimulationOutcome.INTERESTED: (
        "Interested",
        "high",
        "The customer was simulated as interested in the quote.",
        "A sales representative should follow up with the customer.",
    ),
    SimulationOutcome.NOT_INTERESTED: (
        "Not Interested",
        "low",
        "The customer was simulated as not interested in the quote.",
        "Do not schedule another follow-up unless the customer re-engages.",
    ),
    SimulationOutcome.CALL_BACK_LATER: (
        "Call Back Later",
        "medium",
        "The customer was simulated as requesting a later follow-up.",
        "Retry the follow-up at the requested time.",
    ),
    SimulationOutcome.NO_ANSWER: (
        "No Answer",
        "unknown",
        "The simulated call was not answered.",
        "Retry the follow-up at the configured next time.",
    ),
    SimulationOutcome.BUSY: (
        "Busy",
        "unknown",
        "The simulated recipient line was busy.",
        "Retry the follow-up at the configured next time.",
    ),
    SimulationOutcome.INVALID_NUMBER: (
        "Invalid Number",
        "unknown",
        "The simulated contact number was invalid.",
        "Ask a human owner to correct the Contact phone number.",
    ),
    SimulationOutcome.ERROR: (
        "Error",
        "unknown",
        "The simulated provider returned an error before completing the call.",
        "Retry the follow-up after investigating the provider error.",
    ),
}

RETRY_OUTCOMES = frozenset(
    {
        SimulationOutcome.CALL_BACK_LATER,
        SimulationOutcome.NO_ANSWER,
        SimulationOutcome.BUSY,
        SimulationOutcome.ERROR,
    }
)


class CallSimulationError(ValueError):
    """Raised when a simulation request does not satisfy its contract."""


def _normalize_datetime(value: datetime, *, field: str) -> datetime:
    """Normalize an aware DateTime to UTC and Salesforce second precision."""

    if value.tzinfo is None or value.utcoffset() is None:
        raise CallSimulationError(f"{field} must be timezone-aware.")
    utc_value = value.astimezone(timezone.utc)
    return utc_value.replace(microsecond=0)


def _parse_outcome(value: str | SimulationOutcome) -> SimulationOutcome:
    try:
        return value if isinstance(value, SimulationOutcome) else SimulationOutcome(value)
    except ValueError as exc:
        choices = ", ".join(item.value for item in SimulationOutcome)
        raise CallSimulationError(f"Unsupported simulation outcome: {value}. Choose: {choices}.") from exc


def simulate_call(
    request: CallPlanRequest,
    outcome: str | SimulationOutcome,
    *,
    now: datetime,
    next_follow_up_at: datetime | None = None,
) -> CallResult:
    """Return a deterministic result without invoking CALL-E or a network API."""

    normalized_now = _normalize_datetime(now, field="Simulation timestamp")
    normalized_next = (
        _normalize_datetime(next_follow_up_at, field="Next follow-up timestamp")
        if next_follow_up_at is not None
        else None
    )
    if request.region.strip().upper() != "ES":
        raise CallSimulationError("The local simulator currently supports region ES only.")

    selected = _parse_outcome(outcome)
    if selected in RETRY_OUTCOMES:
        if normalized_next is None:
            raise CallSimulationError(
                f"Outcome {selected.value} requires a timezone-aware --next-follow-up-at."
            )
        if normalized_next <= normalized_now:
            raise CallSimulationError("--next-follow-up-at must be in the future.")
    elif normalized_next is not None:
        raise CallSimulationError(
            f"Outcome {selected.value} is terminal and cannot include --next-follow-up-at."
        )

    canonical_time = normalized_next.isoformat() if normalized_next else ""
    seed = "|".join(
        (request.quote_id, selected.value, request.language.strip(), request.region.strip().upper(), canonical_time)
    )
    simulation_id = "sim-" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]
    result_outcome, interest, summary, next_action = _OUTCOME_DETAILS[selected]
    return CallResult(
        quote_id=request.quote_id,
        simulation_id=simulation_id,
        provider_status="SIMULATED_COMPLETED",
        outcome=result_outcome,
        interest_level=interest,
        preferred_date=None,
        summary=summary,
        next_action=next_action,
        next_follow_up_at=normalized_next,
        simulation_timestamp=normalized_now,
    )

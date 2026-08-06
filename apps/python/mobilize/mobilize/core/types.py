"""Core data types shared across the mobilize engine.

Keep these plain and serializable (JSON-friendly dicts/dataclasses) so the
same types flow through the ledger, both transports, and the dashboard
without translation layers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CallOutcome(str, Enum):
    FIRM_YES = "firm_yes"
    SOFT_YES = "soft_yes"
    NO = "no"
    INELIGIBLE = "ineligible"
    NO_ANSWER = "no_answer"
    FAILED = "failed"


@dataclass(frozen=True)
class Need:
    """A mobilization request: get `count` confirmations by `deadline_minutes`."""

    label: str
    count: int
    deadline_minutes: float
    location: str
    max_calls: int


@dataclass(frozen=True)
class Candidate:
    """One member of the consented pool who may be called."""

    id: str
    phone: str
    name: str
    days_since_last_action: float
    distance_km: float
    historical_accept_rate: float  # prior: how often they say yes when asked
    historical_showup_rate: float  # prior: how often a stated yes becomes real action
    eligible: bool = True
    timezone: str = "UTC"  # IANA name, e.g. "Asia/Kolkata" -- governs calling-hour checks

    def prior_score(self) -> float:
        """Higher is better: more likely to say yes AND follow through."""
        recency = min(1.0, self.days_since_last_action / 90.0)
        distance_penalty = 1.0 / (1.0 + self.distance_km / 10.0)
        return (
            0.4 * self.historical_accept_rate
            + 0.4 * self.historical_showup_rate
            + 0.1 * recency
            + 0.1 * distance_penalty
        )


@dataclass(frozen=True)
class CallResult:
    """Normalized result of one dispatched call, from either transport."""

    call_id: str
    candidate_id: str
    outcome: CallOutcome
    commitment_score: float  # 0..1, calibrated probability of actually showing up
    stated_yes: bool
    evidence: str
    transcript: list[dict] = field(default_factory=list)
    started_at: datetime = field(default_factory=utcnow)
    completed_at: datetime | None = None
    raw: dict = field(default_factory=dict)


@dataclass
class Wave:
    """One dispatched batch within a mobilization."""

    index: int
    candidate_ids: list[str]
    dispatched_at: datetime = field(default_factory=utcnow)
    results: list[CallResult] = field(default_factory=list)


@dataclass
class MobilizeResult:
    need: Need
    confirmed: list[CallResult]
    all_results: list[CallResult]
    waves: list[Wave]
    calls_used: int
    time_to_fill_seconds: float | None
    filled: bool
    over_recruitment_ratio: float

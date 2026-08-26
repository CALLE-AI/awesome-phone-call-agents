"""Pure initial-selection and retry policy for QuoteWake."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone, tzinfo

from .models import (
    CALL_RESULT_OUTCOME_VOCABULARY,
    CallOutcomeKind,
    CallResult,
    FollowUpUpdate,
    QuoteCandidate,
)

DEFAULT_ALLOWED_QUOTE_STATUSES = frozenset({"Presented"})
ACTIONABLE_FOLLOW_UP_STATUSES = frozenset({"Retry"})
_MINIMUM_RETRY_DELAY = timedelta(seconds=1)
_RETRY_OUTCOMES = frozenset(
    {"call_back_later", "call_not_established", "no_answer", "busy"}
)
_COMPLETED_OUTCOMES = frozenset({"interested"})


def normalize_outcome(value: str) -> str:
    return "_".join(value.strip().lower().replace("-", " ").split())


@dataclass(frozen=True)
class InitialFollowUpTiming:
    minimum_delay: timedelta
    standard_delay: timedelta
    due_soon_window: timedelta


@dataclass(frozen=True)
class RetryPolicy:
    """Retry policy; accepted CALL-E attempts increment the counter."""

    max_attempts: int
    retry_delays: tuple[timedelta, ...]
    retry_outcomes: frozenset[str]
    technical_failure_retry_delay: timedelta
    completed_outcomes: frozenset[str]

    def __post_init__(self) -> None:
        if self.max_attempts < 1 or len(self.retry_delays) != self.max_attempts - 1:
            raise ValueError("retry policy has an invalid attempt/delay configuration")
        if any(delay < timedelta(0) for delay in self.retry_delays):
            raise ValueError("retry delays cannot be negative")
        if self.technical_failure_retry_delay < timedelta(0):
            raise ValueError("technical failure retry delay cannot be negative")
        unknown = (
            self.retry_outcomes | self.completed_outcomes
        ) - CALL_RESULT_OUTCOME_VOCABULARY
        if unknown:
            raise ValueError(
                "retry policy contains unsupported outcomes: "
                + ", ".join(sorted(unknown))
            )
        if self.retry_outcomes != _RETRY_OUTCOMES:
            raise ValueError(
                "retry policy retry_outcomes must be exactly: "
                + ", ".join(sorted(_RETRY_OUTCOMES))
            )
        if self.completed_outcomes != _COMPLETED_OUTCOMES:
            raise ValueError(
                "retry policy completed_outcomes must be exactly: interested"
            )

    def delay_after_attempt(self, attempt_count: int) -> timedelta:
        if not 1 <= attempt_count < self.max_attempts:
            raise ValueError("no retry delay configured for this attempt count")
        return self.retry_delays[attempt_count - 1]

    def retries_outcome(self, outcome: str) -> bool:
        """Return whether an outcome is eligible for another business call."""

        return normalize_outcome(outcome) in self.retry_outcomes

    def is_completed_outcome(self, outcome: str) -> bool:
        return normalize_outcome(outcome) in self.completed_outcomes


@dataclass(frozen=True)
class FollowUpPolicies:
    retry: RetryPolicy

    @property
    def retry_policy(self) -> RetryPolicy:
        return self.retry


@dataclass(frozen=True)
class SelectionPolicy:
    initial_follow_up_timing: InitialFollowUpTiming
    retry_policy: RetryPolicy
    actionable_follow_up_statuses: frozenset[str] = ACTIONABLE_FOLLOW_UP_STATUSES
    allowed_quote_statuses: frozenset[str] = DEFAULT_ALLOWED_QUOTE_STATUSES
    business_timezone: tzinfo = timezone.utc

    @property
    def max_attempts(self) -> int:
        return self.retry_policy.max_attempts


def calculate_next_follow_up(
    quote: QuoteCandidate,
    result: CallResult,
    policies: FollowUpPolicies,
    *,
    occurred_at: datetime | None = None,
) -> FollowUpUpdate:
    """Calculate exactly the four persisted QuoteWake fields."""

    call_time = occurred_at or result.occurred_at
    if call_time is None or call_time.tzinfo is None or call_time.utcoffset() is None:
        raise ValueError("a timezone-aware call timestamp is required")
    call_time = call_time.astimezone(timezone.utc).replace(microsecond=0)
    if result.quote_id != quote.quote_id:
        raise ValueError("call result does not match the selected Quote")
    if (
        result.outcome_kind is CallOutcomeKind.BUSINESS
        and result.outcome not in CALL_RESULT_OUTCOME_VOCABULARY
    ):
        raise ValueError("call result contains an unsupported business outcome")

    retry = policies.retry
    if result.outcome_kind is CallOutcomeKind.TECHNICAL_FAILURE:
        # This branch is reserved for failures before CALL-E accepts a call.
        # Accepted calls are represented as business outcomes, including
        # ``unknown``, so they always consume an attempt below.
        attempts = quote.attempt_count
        # A technical failure is not an invitation to spin in an immediate
        # retry loop.  Zero is accepted in configuration for dry-run fixtures,
        # but the persisted state always moves into the future.
        next_at = call_time + max(retry.technical_failure_retry_delay, _MINIMUM_RETRY_DELAY)
        status = "Retry"
    else:
        attempts = quote.attempt_count + 1
        if retry.retries_outcome(result.outcome) and attempts < retry.max_attempts:
            requested = result.next_follow_up_at
            next_at = (
                requested.astimezone(timezone.utc).replace(microsecond=0)
                if normalize_outcome(result.outcome) == "call_back_later"
                and requested is not None
                and requested.tzinfo is not None
                and requested.utcoffset() is not None
                and requested > call_time
                    else call_time + max(retry.delay_after_attempt(attempts), _MINIMUM_RETRY_DELAY)
            )
            status = "Retry"
        else:
            next_at = None
            status = "Completed" if retry.is_completed_outcome(result.outcome) else "Stopped"
    return FollowUpUpdate(
        attempt_count=attempts,
        follow_up_status=status,
        next_follow_up_at=next_at,
    )


def configured_quote_statuses(values: list[str] | None = None) -> frozenset[str]:
    statuses = values or os.environ.get("QUOTEWAKE_ALLOWED_QUOTE_STATUSES", "Presented").split(",")
    result = frozenset(value.strip() for value in statuses if value.strip())
    if not result:
        raise ValueError("at least one allowed Quote status is required")
    return result

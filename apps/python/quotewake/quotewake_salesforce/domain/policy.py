"""Pure, configurable follow-up policies used by QuoteWake."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone, tzinfo

from .models import CallOutcomeKind, CallResult, FollowUpUpdate, QuoteCandidate


DEFAULT_ALLOWED_QUOTE_STATUSES = frozenset({"Presented"})
ACTIONABLE_FOLLOW_UP_STATUSES = frozenset({"Retry"})


def normalize_outcome(value: str) -> str:
    """Normalize provider/config outcome names to a stable comparison key."""

    return "_".join(value.strip().lower().replace("-", " ").split())


@dataclass(frozen=True)
class InitialFollowUpTiming:
    """Timing thresholds loaded from QuoteWake TOML."""

    minimum_delay: timedelta
    standard_delay: timedelta
    due_soon_window: timedelta


@dataclass(frozen=True)
class RetryPolicy:
    """Retry rules for business outcomes and provider failures.

    ``max_attempts`` counts business attempts, including the first call.
    ``retry_delays`` is indexed by the attempt that just completed, so it has
    exactly ``max_attempts - 1`` entries.
    """

    max_attempts: int
    retry_delays: tuple[timedelta, ...]
    retry_outcomes: frozenset[str]
    technical_failure_retry_delay: timedelta
    completed_outcomes: frozenset[str]

    def __post_init__(self) -> None:
        if isinstance(self.max_attempts, bool) or self.max_attempts < 1:
            raise ValueError("retry.max_attempts must be at least 1.")
        if len(self.retry_delays) != self.max_attempts - 1:
            raise ValueError(
                "retry.retry_delays_days must contain exactly max_attempts - 1 values."
            )
        if any(delay < timedelta(0) for delay in self.retry_delays):
            raise ValueError("retry delays cannot be negative.")
        if self.technical_failure_retry_delay < timedelta(0):
            raise ValueError("retry.technical_failure_retry_delay_minutes cannot be negative.")

    def delay_after_attempt(self, attempt_count: int) -> timedelta:
        """Return the configured delay after a completed business attempt."""

        if attempt_count < 1 or attempt_count >= self.max_attempts:
            raise ValueError("No retry delay is configured for this attempt count.")
        return self.retry_delays[attempt_count - 1]

    def retries_outcome(self, outcome: str) -> bool:
        return normalize_outcome(outcome) in self.retry_outcomes

    def is_completed_outcome(self, outcome: str) -> bool:
        return normalize_outcome(outcome) in self.completed_outcomes


@dataclass(frozen=True)
class CooldownPolicy:
    """Minimum interval between calls to the same Quote."""

    enabled: bool
    minimum_delay: timedelta

    def __post_init__(self) -> None:
        if self.minimum_delay < timedelta(0):
            raise ValueError("cooldown.minimum_delay_hours cannot be negative.")

    def next_allowed_at(self, last_follow_up_at: datetime | None) -> datetime | None:
        if not self.enabled or last_follow_up_at is None:
            return None
        return last_follow_up_at + self.minimum_delay


_WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


@dataclass(frozen=True)
class CallingHoursPolicy:
    """Optional local-time window in which calls may be started."""

    enabled: bool
    days: frozenset[int]
    start: time
    end: time
    timezone: tzinfo = timezone.utc

    def __post_init__(self) -> None:
        if not self.days.issubset(set(_WEEKDAYS.values())):
            raise ValueError("calling_hours.days contains an invalid weekday.")
        if self.start >= self.end:
            raise ValueError("calling_hours.start must be before calling_hours.end.")
        if self.enabled and not self.days:
            raise ValueError("calling_hours.days cannot be empty when calling hours are enabled.")

    @classmethod
    def day_number(cls, value: str) -> int:
        try:
            return _WEEKDAYS[value.strip().lower()]
        except KeyError as exc:
            raise ValueError(f"Unknown calling-hours weekday: {value}") from exc

    def is_allowed_now(self, now: datetime) -> bool:
        """Return whether an aware instant falls inside the configured window."""

        if now.tzinfo is None or now.utcoffset() is None:
            raise ValueError("now must be timezone-aware")
        if not self.enabled:
            return True
        local = now.astimezone(self.timezone)
        return local.weekday() in self.days and self.start <= local.time() < self.end

    def next_allowed_at(self, instant: datetime) -> datetime:
        """Move an instant to the next configured window, preserving an instant.

        The search is intentionally bounded to eight local dates: a valid
        enabled weekly schedule always has a result in that interval.
        """

        if instant.tzinfo is None or instant.utcoffset() is None:
            raise ValueError("instant must be timezone-aware")
        normalized = instant.astimezone(timezone.utc)
        if not self.enabled:
            return normalized
        if self.is_allowed_now(normalized):
            return normalized
        local = normalized.astimezone(self.timezone)
        for offset in range(0, 8):
            candidate_date = local.date() + timedelta(days=offset)
            if candidate_date.weekday() not in self.days:
                continue
            candidate_local = datetime.combine(candidate_date, self.start, self.timezone)
            candidate = candidate_local.astimezone(timezone.utc)
            if candidate >= normalized:
                return candidate
        raise ValueError("calling_hours schedule has no next allowed time")


@dataclass(frozen=True)
class FollowUpPolicies:
    """The three configurable policy areas applied to one Quote."""

    retry: RetryPolicy
    cooldown: CooldownPolicy
    calling_hours: CallingHoursPolicy

    @property
    def retry_policy(self) -> RetryPolicy:
        return self.retry

    @property
    def cooldown_policy(self) -> CooldownPolicy:
        return self.cooldown

    @property
    def calling_hours_policy(self) -> CallingHoursPolicy:
        return self.calling_hours


@dataclass(frozen=True)
class SelectionPolicy:
    """Configurable business policy for the read-only selection stage."""

    initial_follow_up_timing: InitialFollowUpTiming
    retry_policy: RetryPolicy
    cooldown_policy: CooldownPolicy
    calling_hours_policy: CallingHoursPolicy
    actionable_follow_up_statuses: frozenset[str] = ACTIONABLE_FOLLOW_UP_STATUSES
    allowed_quote_statuses: frozenset[str] = DEFAULT_ALLOWED_QUOTE_STATUSES
    business_timezone: tzinfo = timezone.utc

    @property
    def max_attempts(self) -> int:
        """Expose the configured limit for selection and existing callers."""

        return self.retry_policy.max_attempts

    @property
    def cooldown(self) -> CooldownPolicy:
        return self.cooldown_policy

    @property
    def calling_hours(self) -> CallingHoursPolicy:
        return self.calling_hours_policy


def is_call_allowed_now(now: datetime, policy: CallingHoursPolicy) -> bool:
    """Small function boundary used by selection and call orchestration."""

    return policy.is_allowed_now(now)


def calculate_next_follow_up(
    quote: QuoteCandidate,
    result: CallResult,
    policies: FollowUpPolicies,
    *,
    occurred_at: datetime | None = None,
) -> FollowUpUpdate:
    """Calculate all Quote fields resulting from one normalized call.

    Technical failures do not consume a business attempt. Every scheduled
    retry is then constrained by the Quote cooldown and, when enabled, moved
    into the next configured calling-hours window.
    """

    call_time = occurred_at or result.simulation_timestamp
    if call_time is None or call_time.tzinfo is None or call_time.utcoffset() is None:
        raise ValueError("A timezone-aware call timestamp is required.")
    call_time = call_time.astimezone(timezone.utc).replace(microsecond=0)
    if result.quote_id != quote.quote_id:
        raise ValueError("Call result does not match the selected Quote.")

    technical = result.outcome_kind is CallOutcomeKind.TECHNICAL_FAILURE
    if technical:
        attempt_count = quote.attempt_count
        next_at = call_time + policies.retry.technical_failure_retry_delay
        status = "Retry"
    else:
        attempt_count = quote.attempt_count + 1
        if policies.retry.retries_outcome(result.outcome) and attempt_count < policies.retry.max_attempts:
            requested = result.next_follow_up_at
            if (
                normalize_outcome(result.outcome) == "call_back_later"
                and requested is not None
                and requested.tzinfo is not None
                and requested.utcoffset() is not None
                and requested > call_time
            ):
                next_at = requested.astimezone(timezone.utc).replace(microsecond=0)
            else:
                next_at = call_time + policies.retry.delay_after_attempt(attempt_count)
            status = "Retry"
        else:
            next_at = None
            status = "Completed" if policies.retry.is_completed_outcome(result.outcome) else "Stopped"

    if next_at is not None:
        # The call just completed is the new cooldown anchor.  The existing
        # Salesforce Last_Follow_Up_At__c is used by the next eligibility pass.
        cooldown_at = policies.cooldown.next_allowed_at(call_time)
        if cooldown_at is not None and cooldown_at > next_at:
            next_at = cooldown_at
        next_at = policies.calling_hours.next_allowed_at(next_at)

    return FollowUpUpdate(
        attempt_count=attempt_count,
        last_follow_up_at=call_time,
        last_follow_up_result=result.outcome,
        follow_up_status=status,
        next_follow_up_at=next_at,
    )


def configured_quote_statuses(values: list[str] | None = None) -> frozenset[str]:
    """Read allowed commercial statuses from CLI values or environment."""

    if values:
        statuses = values
    else:
        configured = os.environ.get("QUOTEWAKE_ALLOWED_QUOTE_STATUSES", "")
        statuses = configured.split(",") if configured.strip() else list(DEFAULT_ALLOWED_QUOTE_STATUSES)
    normalized = frozenset(status.strip() for status in statuses if status.strip())
    if not normalized:
        raise ValueError(
            "At least one allowed commercial Quote status is required. "
            "Use --allowed-quote-status or QUOTEWAKE_ALLOWED_QUOTE_STATUSES."
        )
    return normalized


def weekdays_from_names(values: list[str]) -> frozenset[int]:
    """Convert TOML weekday names into ``datetime.weekday`` numbers."""

    return frozenset(CallingHoursPolicy.day_number(value) for value in values)
